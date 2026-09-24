/** A link to another node's output: [node id, output index]. */
export type Ref = [string, number];

export interface ApiNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

/** A ComfyUI workflow in API format, as POST /prompt takes it. */
export type ApiGraph = Record<string, ApiNode>;

export interface NodeHandle {
  id: string;
  out(index: number): Ref;
}

/**
 * Builds API-format graphs in code. Save nodes are registered under a role name
 * ("color", "mask", "model") so results can be picked out of the history by meaning.
 */
export class Graph {
  readonly roles: Record<string, string> = {};
  private readonly nodes: ApiGraph = {};
  private next = 1;

  add(classType: string, inputs: Record<string, unknown>): NodeHandle {
    const id = String(this.next++);
    const defined = Object.fromEntries(Object.entries(inputs).filter(([, v]) => v !== undefined));
    this.nodes[id] = { class_type: classType, inputs: defined };
    return { id, out: (index: number) => [id, index] };
  }

  /** Saves an IMAGE output; the file comes back under `role`. */
  save(role: string, image: Ref): void {
    this.roles[role] = this.add('SaveImage', { images: image, filename_prefix: `assetgen/${role}` }).id;
  }

  /** Saves a 3D model output (GLB); the file comes back under `role`. */
  saveModel(role: string, model: Ref): void {
    this.roles[role] = this.add('SaveGLB', { mesh: model, filename_prefix: `assetgen/3d/${role}` }).id;
  }

  toJSON(): ApiGraph {
    return this.nodes;
  }
}
