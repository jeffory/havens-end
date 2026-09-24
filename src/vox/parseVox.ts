/**
 * MagicaVoxel .vox reader (format versions 150 and 200, including the world-editor
 * scene graph). Spec: https://github.com/ephtracy/voxel-model
 *
 * Everything here is in MagicaVoxel space: Z up, right-handed. Use mvToGame() to
 * convert cells into the game's Y-up space.
 */

export interface VoxModel {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  /** (x, y, z, colourIndex) byte quads, model-local. */
  voxels: Uint8Array;
}

/** One placed copy of a model in the scene. */
export interface VoxInstance {
  /** `_name` of the nearest named transform above the shape; '' if none. */
  name: string;
  model: number;
  /** Row-major 3×3 world rotation (entries are -1, 0 or 1). */
  rotation: Int8Array;
  /** World translation of the model's pivot. */
  translation: [number, number, number];
}

export interface VoxFile {
  models: VoxModel[];
  instances: VoxInstance[];
  /** RGBA bytes per colour index: palette[i * 4 .. i * 4 + 3]. Index 0 is empty space. */
  palette: Uint8Array;
}

interface TransformNode { kind: 'transform'; name: string; hidden: boolean; layer: number; child: number; rotation: Int8Array; translation: [number, number, number] }
interface GroupNode { kind: 'group'; children: number[] }
interface ShapeNode { kind: 'shape'; models: number[] }
type SceneNode = TransformNode | GroupNode | ShapeNode;

const IDENTITY = Int8Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1);

export function parseVox(buffer: ArrayBuffer): VoxFile {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (buffer.byteLength < 8 || tag(bytes, 0) !== 'VOX ') throw new Error('parseVox: not a MagicaVoxel .vox file');
  const version = view.getInt32(4, true);
  if (version !== 150 && version !== 200) throw new Error(`parseVox: unsupported .vox version ${version}`);

  const models: VoxModel[] = [];
  const nodes = new Map<number, SceneNode>();
  const hiddenLayers = new Set<number>();
  let palette: Uint8Array | null = null;
  let pendingSize: [number, number, number] | null = null;

  let offset = 8;
  // MAIN's children are the whole file; walk them flat (other chunks have no children).
  if (tag(bytes, offset) !== 'MAIN') throw new Error('parseVox: missing MAIN chunk');
  offset += 12;

  while (offset + 12 <= buffer.byteLength) {
    const id = tag(bytes, offset);
    const contentSize = view.getInt32(offset + 4, true);
    const childrenSize = view.getInt32(offset + 8, true);
    const body = offset + 12;
    const reader = new Reader(view, body);

    switch (id) {
      case 'SIZE':
        pendingSize = [reader.int(), reader.int(), reader.int()];
        break;
      case 'XYZI': {
        if (!pendingSize) throw new Error('parseVox: XYZI chunk without a SIZE chunk');
        const count = reader.int();
        const [sizeX, sizeY, sizeZ] = pendingSize;
        models.push({ sizeX, sizeY, sizeZ, voxels: bytes.slice(reader.offset, reader.offset + count * 4) });
        pendingSize = null;
        break;
      }
      case 'RGBA':
        // File entry i is colour index i + 1.
        palette = new Uint8Array(256 * 4);
        palette.set(bytes.subarray(body, body + 255 * 4), 4);
        break;
      case 'nTRN': {
        const nodeId = reader.int();
        const attributes = reader.dict();
        const child = reader.int();
        reader.int(); // reserved
        const layer = reader.int();
        const frames = reader.int();
        const frame = frames > 0 ? reader.dict() : {};
        const t = (frame._t ?? '0 0 0').split(' ').map(Number);
        nodes.set(nodeId, {
          kind: 'transform',
          name: attributes._name ?? '',
          hidden: attributes._hidden === '1',
          layer,
          child,
          rotation: frame._r !== undefined ? decodeRotation(Number(frame._r)) : IDENTITY,
          translation: [t[0], t[1], t[2]],
        });
        break;
      }
      case 'nGRP': {
        const nodeId = reader.int();
        reader.dict();
        const count = reader.int();
        const children: number[] = [];
        for (let i = 0; i < count; i++) children.push(reader.int());
        nodes.set(nodeId, { kind: 'group', children });
        break;
      }
      case 'nSHP': {
        const nodeId = reader.int();
        reader.dict();
        const count = reader.int();
        const shapeModels: number[] = [];
        for (let i = 0; i < count; i++) {
          shapeModels.push(reader.int());
          reader.dict();
        }
        nodes.set(nodeId, { kind: 'shape', models: shapeModels });
        break;
      }
      case 'LAYR': {
        const layerId = reader.int();
        if (reader.dict()._hidden === '1') hiddenLayers.add(layerId);
        break;
      }
      // Materials, cameras, notes etc. don't affect geometry.
    }
    offset = body + contentSize + childrenSize;
  }

  if (!palette) throw new Error('parseVox: no RGBA palette chunk (re-save the file in MagicaVoxel 0.99 or newer)');

  const instances: VoxInstance[] = [];
  if (nodes.size === 0) {
    // Pre-scene-graph file: every model sits at the origin.
    models.forEach((_, model) => instances.push({ name: '', model, rotation: IDENTITY, translation: [0, 0, 0] }));
  } else {
    collect(nodes, hiddenLayers, 0, IDENTITY, [0, 0, 0], '', instances);
  }
  return { models, instances, palette };
}

function collect(
  nodes: Map<number, SceneNode>,
  hiddenLayers: Set<number>,
  nodeId: number,
  rotation: Int8Array,
  translation: [number, number, number],
  name: string,
  out: VoxInstance[],
): void {
  const node = nodes.get(nodeId);
  if (!node) return;
  if (node.kind === 'transform') {
    if (node.hidden || hiddenLayers.has(node.layer)) return;
    const t = node.translation;
    const worldT: [number, number, number] = [
      rotation[0] * t[0] + rotation[1] * t[1] + rotation[2] * t[2] + translation[0],
      rotation[3] * t[0] + rotation[4] * t[1] + rotation[5] * t[2] + translation[1],
      rotation[6] * t[0] + rotation[7] * t[1] + rotation[8] * t[2] + translation[2],
    ];
    collect(nodes, hiddenLayers, node.child, multiply(rotation, node.rotation), worldT, node.name || name, out);
  } else if (node.kind === 'group') {
    for (const child of node.children) collect(nodes, hiddenLayers, child, rotation, translation, name, out);
  } else {
    for (const model of node.models) out.push({ name, model, rotation, translation });
  }
}

/**
 * World cells of an instance as (x, y, z, colourIndex) quads, MagicaVoxel space.
 * A model is placed by its pivot, the voxel corner at floor(size / 2), which keeps
 * every voxel on the world grid.
 */
export function instanceVoxels(file: VoxFile, instance: VoxInstance): Int32Array {
  const model = file.models[instance.model];
  const r = instance.rotation;
  const [tx, ty, tz] = instance.translation;
  const px = Math.floor(model.sizeX / 2);
  const py = Math.floor(model.sizeY / 2);
  const pz = Math.floor(model.sizeZ / 2);
  const v = model.voxels;
  const out = new Int32Array(v.length);
  for (let i = 0; i < v.length; i += 4) {
    // Rotate the voxel's centre about the pivot, then take the cell it lands in.
    const lx = v[i] + 0.5 - px;
    const ly = v[i + 1] + 0.5 - py;
    const lz = v[i + 2] + 0.5 - pz;
    out[i] = Math.floor(r[0] * lx + r[1] * ly + r[2] * lz + tx);
    out[i + 1] = Math.floor(r[3] * lx + r[4] * ly + r[5] * lz + ty);
    out[i + 2] = Math.floor(r[6] * lx + r[7] * ly + r[8] * lz + tz);
    out[i + 3] = v[i + 3];
  }
  return out;
}

/**
 * MagicaVoxel cell → game cell. MagicaVoxel is Z-up; the game is Y-up. Ships are
 * authored bow toward +Y with starboard at +X, and come out bow toward +Z with port
 * at +X: a proper rotation, so nothing is mirrored.
 */
export function mvToGame(x: number, y: number, z: number): [number, number, number] {
  return [-x - 1, z, y];
}

/** Decodes the spec's packed rotation byte into a row-major 3×3 matrix. */
export function decodeRotation(byte: number): Int8Array {
  const first = byte & 3;
  const second = (byte >> 2) & 3;
  const third = 3 - first - second;
  const m = new Int8Array(9);
  m[first] = byte & 16 ? -1 : 1;
  m[3 + second] = byte & 32 ? -1 : 1;
  m[6 + third] = byte & 64 ? -1 : 1;
  return m;
}

function multiply(a: Int8Array, b: Int8Array): Int8Array {
  const m = new Int8Array(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      m[row * 3 + col] = a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
    }
  }
  return m;
}

const tag = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

class Reader {
  constructor(
    private readonly view: DataView,
    public offset: number,
  ) {}

  int(): number {
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  string(): string {
    const length = this.int();
    const text = new TextDecoder().decode(new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length));
    this.offset += length;
    return text;
  }

  dict(): Record<string, string> {
    const out: Record<string, string> = {};
    const count = this.int();
    for (let i = 0; i < count; i++) {
      const key = this.string();
      out[key] = this.string();
    }
    return out;
  }
}
