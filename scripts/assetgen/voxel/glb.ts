/**
 * Minimal binary glTF (GLB) reader for voxelizing generated 3D models: triangle meshes
 * with node transforms baked into positions, UVs, vertex colours and the base-colour
 * texture. Not supported: Draco/meshopt compression, sparse accessors, skins, morphs.
 */
export interface GlbMesh {
  /** World-space positions (x, y, z per vertex), glTF axes: +y up. */
  positions: Float32Array;
  uvs?: Float32Array;
  /** Vertex colours, RGBA 0..1. */
  colors?: Float32Array;
  indices: Uint32Array;
  /** Material base colour factor, RGBA 0..1. */
  baseColor: [number, number, number, number];
  /** Index into `images` of the base-colour texture. */
  image?: number;
}

export interface Glb {
  meshes: GlbMesh[];
  images: Array<{ mime: string; bytes: Uint8Array }>;
}

type Mat4 = number[];

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function parseGlb(bytes: Uint8Array): Glb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file (bad magic)');
  let json: any = null;
  let bin: Uint8Array | null = null;
  for (let at = 12; at < bytes.length; ) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const chunk = bytes.subarray(at + 8, at + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    at += 8 + length;
  }
  if (!json || !bin) throw new Error('GLB is missing its JSON or BIN chunk');
  const required: string[] = json.extensionsRequired ?? [];
  if (required.some((e) => e.includes('draco') || e.includes('meshopt'))) {
    throw new Error(`Compressed GLB (${required.join(', ')}); Draco/meshopt decoding is not supported`);
  }

  const buffer = bin;
  const accessor = (index: number): { values: Float32Array | Uint32Array; size: number } => {
    const a = json.accessors[index];
    const bv = json.bufferViews[a.bufferView];
    const size = COMPONENTS[a.type];
    const bytesPer = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 || a.componentType === 5122 ? 2 : 1;
    const stride = bv.byteStride ?? size * bytesPer;
    const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const dv = new DataView(buffer.buffer, buffer.byteOffset + start, bv.byteLength - (a.byteOffset ?? 0));
    const out = a.componentType === 5125 ? new Uint32Array(a.count * size) : new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < size; c++) {
        const o = i * stride + c * bytesPer;
        let v: number;
        switch (a.componentType) {
          case 5126: v = dv.getFloat32(o, true); break;
          case 5125: v = dv.getUint32(o, true); break;
          case 5123: v = dv.getUint16(o, true); if (a.normalized) v /= 65535; break;
          case 5122: v = dv.getInt16(o, true); if (a.normalized) v = Math.max(v / 32767, -1); break;
          case 5121: v = dv.getUint8(o); if (a.normalized) v /= 255; break;
          case 5120: v = dv.getInt8(o); if (a.normalized) v = Math.max(v / 127, -1); break;
          default: throw new Error(`Unsupported accessor component type ${a.componentType}`);
        }
        out[i * size + c] = v;
      }
    }
    return { values: out, size };
  };

  const meshes: GlbMesh[] = [];
  const visit = (nodeIndex: number, parent: Mat4) => {
    const node = json.nodes[nodeIndex];
    const world = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4) continue; // triangles only
        const pos = accessor(prim.attributes.POSITION).values;
        const positions = new Float32Array(pos.length);
        for (let i = 0; i < pos.length; i += 3) {
          const [x, y, z] = [pos[i], pos[i + 1], pos[i + 2]];
          positions[i] = world[0] * x + world[4] * y + world[8] * z + world[12];
          positions[i + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
          positions[i + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
        }
        const count = positions.length / 3;
        const indices = prim.indices !== undefined ? Uint32Array.from(accessor(prim.indices).values) : Uint32Array.from({ length: count }, (_, i) => i);
        const material = prim.material !== undefined ? json.materials[prim.material] : undefined;
        const pbr = material?.pbrMetallicRoughness ?? {};
        const textureIndex = pbr.baseColorTexture?.index;
        const mesh: GlbMesh = {
          positions,
          indices,
          baseColor: (pbr.baseColorFactor ?? [1, 1, 1, 1]) as GlbMesh['baseColor'],
          image: textureIndex !== undefined ? json.textures[textureIndex].source : undefined,
        };
        if (prim.attributes.TEXCOORD_0 !== undefined) mesh.uvs = Float32Array.from(accessor(prim.attributes.TEXCOORD_0).values);
        if (prim.attributes.COLOR_0 !== undefined) {
          const { values, size } = accessor(prim.attributes.COLOR_0);
          mesh.colors = new Float32Array(count * 4);
          for (let i = 0; i < count; i++) {
            for (let c = 0; c < 3; c++) mesh.colors[i * 4 + c] = values[i * size + c];
            mesh.colors[i * 4 + 3] = size === 4 ? values[i * size + 3] : 1;
          }
        }
        meshes.push(mesh);
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots: number[] = scene?.nodes ?? json.nodes.map((_: unknown, i: number) => i);
  for (const root of roots) visit(root, identity());

  const images = (json.images ?? []).map((img: any) => {
    if (img.bufferView === undefined) throw new Error('GLB image refers to an external URI; only embedded images are supported');
    const bv = json.bufferViews[img.bufferView];
    return { mime: img.mimeType as string, bytes: buffer.slice(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength) };
  });
  return { meshes, images };
}

function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Node matrix, or T * R * S from translation / rotation (quaternion) / scale. Column-major. */
function localMatrix(node: any): Mat4 {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}
