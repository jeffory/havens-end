import { describe, expect, it } from 'vitest';
import { ComfyClient, RunError } from './client';
import { Graph } from './graph';

interface FakeOptions {
  /** History entries returned on successive polls (the last one repeats). 'down' = network error, a number = that HTTP status. */
  history: Array<unknown | 'down' | number>;
  promptStatus?: number;
  promptBody?: unknown;
  /** Raw text body for /prompt (e.g. a proxy's HTML error page). */
  promptText?: string;
  /** The /prompt request fails at the network level (the response is lost). */
  promptDown?: boolean;
}

/** An in-memory stand-in for the ComfyUI HTTP API, recording what it was sent. */
function fakeComfy(opts: FakeOptions) {
  const sent: { prompt?: any; promptCalls: number; uploads: FormData[] } = { promptCalls: 0, uploads: [] };
  let polls = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname === '/prompt') {
      sent.promptCalls++;
      sent.prompt = JSON.parse(String(init?.body));
      if (opts.promptDown) throw new TypeError('fetch failed');
      if (opts.promptText) return new Response(opts.promptText, { status: opts.promptStatus ?? 502 });
      return Response.json(opts.promptBody ?? { prompt_id: 'p1' }, { status: opts.promptStatus ?? 200 });
    }
    if (url.pathname === '/history/p1') {
      const entry = opts.history[Math.min(polls++, opts.history.length - 1)];
      if (entry === 'down') throw new TypeError('fetch failed');
      if (typeof entry === 'number') return new Response('<html>Bad Gateway</html>', { status: entry });
      return Response.json(entry ? { p1: entry } : {});
    }
    if (url.pathname.startsWith('/object_info/')) {
      const type = decodeURIComponent(url.pathname.slice('/object_info/'.length));
      const schema = { input: { required: {}, optional: { blur: ['INT', { default: 3 }], extra: ['IMAGE'] } } };
      return Response.json(type === 'EmptyImage' ? { [type]: schema } : {});
    }
    if (url.pathname === '/view') return new Response(`bytes:${url.searchParams.get('subfolder')}/${url.searchParams.get('filename')}`);
    if (url.pathname === '/upload/image') {
      sent.uploads.push(init?.body as FormData);
      return Response.json({ name: 'stored.png', subfolder: '', type: 'input' });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, sent };
}

const success = {
  status: { status_str: 'success', completed: true, messages: [] },
  outputs: {
    '2': { images: [{ filename: 'color_00001_.png', subfolder: 'assetgen', type: 'output' }] },
    '3': { '3d': [{ filename: 'chest_00001_.glb', subfolder: 'assetgen/3d', type: 'output' }] },
  },
};

function twoOutputGraph() {
  const g = new Graph();
  const img = g.add('EmptyImage', {});
  g.save('color', img.out(0));
  g.saveModel('model', img.out(0));
  return g;
}

describe('ComfyClient.run', () => {
  it('submits with the API key, waits for success and returns files by role', async () => {
    const { fetch, sent } = fakeComfy({ history: [null, { status: { status_str: 'running' }, outputs: {} }, success] });
    const client = new ComfyClient({ url: 'http://comfy.test', apiKey: 'k-123', fetch, pollMs: 1 });

    const result = await client.run(twoOutputGraph());

    expect(sent.prompt.extra_data).toEqual({ api_key_comfy_org: 'k-123' });
    expect(sent.prompt.prompt['1'].class_type).toBe('EmptyImage');
    expect(result.files.color.map((b) => b.toString())).toEqual(['bytes:assetgen/color_00001_.png']);
    expect(result.files.model.map((b) => b.toString())).toEqual(['bytes:assetgen/3d/chest_00001_.glb']);
  });

  it('fills omitted widget inputs with the server-declared defaults before submitting', async () => {
    const { fetch, sent } = fakeComfy({ history: [success] });

    await new ComfyClient({ url: 'http://comfy.test', fetch, pollMs: 1 }).run(twoOutputGraph());

    expect(sent.prompt.prompt['1'].inputs).toEqual({ blur: 3 });
  });

  it('sends no key when none is configured', async () => {
    const { fetch, sent } = fakeComfy({ history: [success] });
    await new ComfyClient({ url: 'http://comfy.test', fetch, pollMs: 1 }).run(twoOutputGraph());
    expect(sent.prompt.extra_data).toEqual({});
  });

  it('throws the failing node and its message on an execution error', async () => {
    const failed = {
      status: {
        status_str: 'error',
        messages: [['execution_error', { node_type: 'GeminiImage2Node', exception_message: 'Unauthorized: Please login first to use this node.' }]],
      },
      outputs: {},
    };
    const { fetch } = fakeComfy({ history: [failed] });

    await expect(new ComfyClient({ url: 'http://comfy.test', fetch, pollMs: 1 }).run(twoOutputGraph())).rejects.toThrow(
      /GeminiImage2Node.*Please login first/,
    );
  });

  it('explains a graph the server rejects before queueing', async () => {
    const { fetch } = fakeComfy({
      history: [],
      promptStatus: 400,
      promptBody: { error: { message: 'Prompt outputs failed validation' }, node_errors: { '1': { class_type: 'EmptyImage', errors: [{ details: 'width: value too small' }] } } },
    });

    await expect(new ComfyClient({ url: 'http://comfy.test', fetch, pollMs: 1 }).run(twoOutputGraph())).rejects.toThrow(
      /EmptyImage.*width: value too small/,
    );
  });
});

describe('ComfyClient.run when things go wrong', () => {
  it('never resubmits a workflow whose POST lost its response (it may already be queued and billed)', async () => {
    const { fetch, sent } = fakeComfy({ history: [success], promptDown: true });

    await expect(new ComfyClient({ url: 'http://comfy.test', fetch, pollMs: 1 }).run(twoOutputGraph())).rejects.toThrow(/may already be queued/);
    expect(sent.promptCalls).toBe(1);
  });

  it('keeps polling through proxy errors and dropped connections', async () => {
    const { fetch } = fakeComfy({ history: [502, 'down', 504, success] });

    const result = await new ComfyClient({ url: 'http://comfy.test', fetch, pollMs: 1 }).run(twoOutputGraph());

    expect(result.files.color).toHaveLength(1);
  });

  it('reports an HTML error page from /prompt by its status instead of a JSON parse error', async () => {
    const { fetch } = fakeComfy({ history: [], promptText: '<html>Bad Gateway</html>', promptStatus: 502 });

    await expect(new ComfyClient({ url: 'http://comfy.test', fetch, pollMs: 1 }).run(twoOutputGraph())).rejects.toThrow(/HTTP 502/);
  });

  it('still hands back outputs that were saved before a later node failed', async () => {
    const failedLate = {
      status: { status_str: 'error', messages: [['execution_error', { node_type: 'BiRefNetRMBG', exception_message: 'boom' }]] },
      outputs: { '2': success.outputs['2'] },
    };
    const { fetch } = fakeComfy({ history: [failedLate] });

    const error = await new ComfyClient({ url: 'http://comfy.test', fetch, pollMs: 1 }).run(twoOutputGraph()).catch((e) => e);

    expect(error).toBeInstanceOf(RunError);
    expect(error.message).toMatch(/BiRefNetRMBG.*boom/);
    expect(error.files.color.map((b: Buffer) => b.toString())).toEqual(['bytes:assetgen/color_00001_.png']);
  });

  it('names the prompt and where its outputs will land when it times out', async () => {
    const { fetch } = fakeComfy({ history: [null] });

    await expect(new ComfyClient({ url: 'http://comfy.test', fetch, pollMs: 1, timeoutMs: 20 }).run(twoOutputGraph())).rejects.toThrow(
      /p1.*output\/assetgen/,
    );
  });
});

describe('ComfyClient.uploadImage', () => {
  it('uploads as a multipart form and returns the name LoadImage should use', async () => {
    const { fetch, sent } = fakeComfy({ history: [] });

    const name = await new ComfyClient({ url: 'http://comfy.test', fetch }).uploadImage(Buffer.from([1, 2, 3]));

    expect(name).toBe('stored.png');
    expect(sent.uploads[0].get('image')).toBeInstanceOf(Blob);
    expect(sent.uploads[0].get('overwrite')).toBe('true');
  });
});
