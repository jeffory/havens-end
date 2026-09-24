import { createHash, randomUUID } from 'node:crypto';
import { fillWidgetDefaults, type NodeInfo } from './defaults';
import type { Graph } from './graph';

export interface ClientOptions {
  /** Base URL of the ComfyUI server, e.g. http://127.0.0.1:8188 */
  url: string;
  /** Comfy platform API key; partner (paid) nodes fail without it. */
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  pollMs?: number;
  /** Per-run limit. 3D generation takes ~3 minutes, so the default is generous. */
  timeoutMs?: number;
}

export interface RunResult {
  promptId: string;
  /** Downloaded output files, by the role their save node was registered under. */
  files: Record<string, Buffer[]>;
}

/** A failed run. `files` holds outputs saved before the failure, e.g. a paid image before a later node broke. */
export class RunError extends Error {
  constructor(
    message: string,
    readonly promptId: string | undefined,
    readonly files: Record<string, Buffer[]> = {},
  ) {
    super(message);
  }
}

interface OutputFile {
  filename: string;
  subfolder: string;
  type: string;
}

interface HistoryEntry {
  status?: { status_str?: string; messages?: Array<[string, Record<string, unknown>]> };
  outputs?: Record<string, Record<string, unknown>>;
}

/** Per-request limit; long waits happen in the polling loop, not in a single request. */
const REQUEST_TIMEOUT_MS = 120_000;
const WHERE_OUTPUTS_LAND = "its outputs land in the ComfyUI server's output/assetgen/ folder";

/** Thin client for the ComfyUI HTTP API: upload inputs, run a graph, fetch its outputs. */
export class ComfyClient {
  private readonly base: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private readonly schemaCache = new Map<string, NodeInfo | undefined>();

  constructor(private readonly options: ClientOptions) {
    this.base = options.url.replace(/\/+$/, '');
    this.fetch = options.fetch ?? globalThis.fetch;
    this.pollMs = options.pollMs ?? 1500;
    this.timeoutMs = options.timeoutMs ?? 15 * 60_000;
  }

  get hasApiKey(): boolean {
    return Boolean(this.options.apiKey);
  }

  async run(graph: Graph): Promise<RunResult> {
    const extra_data = this.options.apiKey ? { api_key_comfy_org: this.options.apiKey } : {};
    const prompt = fillWidgetDefaults(graph.toJSON(), await this.schemas(graph));
    let res: Response;
    try {
      // Never retried: if only the response was lost, the job is already queued (and billed).
      res = await this.fetch(`${this.base}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, client_id: randomUUID(), extra_data }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new RunError(
        `Lost contact while submitting to ComfyUI (${(error as Error).message}). The job may already be queued; ` +
          `check the server's queue before retrying, and if it ran, ${WHERE_OUTPUTS_LAND}.`,
        undefined,
      );
    }
    const text = await res.text();
    if (!res.ok) throw new RunError(`ComfyUI rejected the workflow: HTTP ${res.status} ${describeRejection(text)}`, undefined);
    const promptId = String(JSON.parse(text).prompt_id);

    const entry = await this.waitFor(promptId);
    const files = await this.collect(graph, entry);
    if (entry.status?.status_str !== 'success') {
      throw new RunError(`ComfyUI run ${promptId} failed: ${describeExecutionError(entry)}`, promptId, files);
    }
    return { promptId, files };
  }

  /** Stores an image in ComfyUI's input folder; returns the name a LoadImage node takes. */
  async uploadImage(bytes: Uint8Array): Promise<string> {
    const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 16);
    const form = () => {
      const f = new FormData();
      f.set('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), `assetgen-${hash}.png`);
      f.set('type', 'input');
      f.set('overwrite', 'true');
      return f;
    };
    // Safe to retry: the same bytes overwrite the same content-addressed name.
    const res = await this.request('/upload/image', () => ({ method: 'POST', body: form() }));
    if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status} ${await res.text()}`);
    const { name, subfolder } = (await res.json()) as { name: string; subfolder?: string };
    return subfolder ? `${subfolder}/${name}` : name;
  }

  async getJson<T>(path: string): Promise<T> {
    const res = await this.request(path);
    if (!res.ok) throw new HttpError(`GET ${path}: HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  }

  /** Node schemas for the graph's node types, fetched once per type. */
  private async schemas(graph: Graph): Promise<Record<string, NodeInfo>> {
    const types = [...new Set(Object.values(graph.toJSON()).map((n) => n.class_type))];
    await Promise.all(
      types
        .filter((t) => !this.schemaCache.has(t))
        .map(async (t) => {
          const body = await this.getJson<Record<string, NodeInfo>>(`/object_info/${encodeURIComponent(t)}`);
          this.schemaCache.set(t, body[t]);
        }),
    );
    return Object.fromEntries(types.flatMap((t) => (this.schemaCache.get(t) ? [[t, this.schemaCache.get(t)!]] : [])));
  }

  /** Polls until the run finishes (successfully or not). Proxy errors and dropped connections count as "not yet". */
  private async waitFor(promptId: string): Promise<HistoryEntry> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      try {
        const entry = (await this.getJson<Record<string, HistoryEntry>>(`/history/${promptId}`))[promptId];
        const status = entry?.status?.status_str;
        if (status === 'success' || status === 'error') return entry;
      } catch (error) {
        const transient = !(error instanceof HttpError) || error.status >= 500;
        if (!transient) throw error;
      }
      if (Date.now() > deadline) {
        throw new RunError(`ComfyUI run ${promptId} is still going after ${this.timeoutMs / 1000}s; stopped waiting. When it finishes, ${WHERE_OUTPUTS_LAND}.`, promptId);
      }
      await sleep(this.pollMs);
    }
  }

  /** Downloads whatever each role's save node produced. */
  private async collect(graph: Graph, entry: HistoryEntry): Promise<Record<string, Buffer[]>> {
    const files: Record<string, Buffer[]> = {};
    for (const [role, nodeId] of Object.entries(graph.roles)) {
      const outputs = outputFiles(entry.outputs?.[nodeId]);
      if (outputs.length) files[role] = await Promise.all(outputs.map((f) => this.download(f)));
    }
    return files;
  }

  private async download(file: OutputFile): Promise<Buffer> {
    const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
    const res = await this.request(`/view?${q}`);
    if (!res.ok) throw new Error(`Download of ${file.filename} failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** An idempotent request with a timeout, retried once after a network failure (not an HTTP error). */
  private async request(path: string, init: () => RequestInit = () => ({})): Promise<Response> {
    const attempt = () => this.fetch(this.base + path, { ...init(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    try {
      return await attempt();
    } catch {
      await sleep(1000);
      return attempt();
    }
  }
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function outputFiles(output: Record<string, unknown> | undefined): OutputFile[] {
  if (!output) return [];
  const files: OutputFile[] = [];
  for (const value of Object.values(output)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) if (item && typeof item === 'object' && 'filename' in item) files.push(item as OutputFile);
  }
  return files;
}

function describeExecutionError(entry: HistoryEntry): string {
  const messages = entry.status?.messages ?? [];
  if (messages.some(([kind]) => kind === 'execution_interrupted')) return 'interrupted on the server';
  const error = messages.find(([kind]) => kind === 'execution_error')?.[1];
  if (!error) return 'unknown error (no execution_error message)';
  return `${error.node_type} (node ${error.node_id ?? '?'}): ${String(error.exception_message ?? '').trim()}`;
}

/** The server's validation errors, or the start of whatever else came back (e.g. a proxy's HTML page). */
function describeRejection(text: string): string {
  let body: Record<string, any>;
  try {
    body = JSON.parse(text);
  } catch {
    return text.slice(0, 200);
  }
  const parts = [body.error?.message ?? 'invalid workflow'];
  for (const node of Object.values<any>(body.node_errors ?? {})) {
    for (const e of node.errors ?? []) parts.push(`${node.class_type}: ${e.details || e.message}`);
  }
  return parts.join('; ');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
