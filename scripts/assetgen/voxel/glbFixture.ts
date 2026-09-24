/** Test helper: a GLB holding one textured triangle, with optional node transforms. */
export interface FixtureOptions {
  node?: { translation?: number[]; scale?: number[]; matrix?: number[] };
  /** When set, the mesh node becomes the child of a node with this transform. */
  parent?: { translation?: number[]; scale?: number[]; matrix?: number[] };
  extensionsRequired?: string[];
  /** Replaces the default triangle (vertex positions, 3 floats each). */
  positions?: number[];
  uvs?: number[];
  indices?: number[];
  image?: { mime: string; bytes: Uint8Array };
}

export function makeGlb(opts: FixtureOptions = {}): Uint8Array {
  const positions = new Float32Array(opts.positions ?? [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const uvs = new Float32Array(opts.uvs ?? [0, 0, 1, 0, 0, 1]);
  const indices = new Uint16Array(opts.indices ?? [0, 1, 2]);
  const image = opts.image ?? { mime: 'image/png', bytes: new Uint8Array([7, 7, 7]) };

  const parts = [new Uint8Array(positions.buffer), new Uint8Array(uvs.buffer), new Uint8Array(indices.buffer), image.bytes];
  const views: Array<{ buffer: number; byteOffset: number; byteLength: number }> = [];
  let offset = 0;
  for (const p of parts) {
    views.push({ buffer: 0, byteOffset: offset, byteLength: p.length });
    offset += Math.ceil(p.length / 4) * 4;
  }
  const bin = new Uint8Array(offset);
  parts.forEach((p, i) => bin.set(p, views[i].byteOffset));

  const meshNode = { mesh: 0, ...opts.node };
  const nodes = opts.parent ? [{ ...opts.parent, children: [1] }, meshNode] : [meshNode];
  const json = {
    asset: { version: '2.0' },
    extensionsRequired: opts.extensionsRequired,
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0, mode: 4 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 0.5, 1], baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ mimeType: image.mime, bufferView: 3 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: uvs.length / 2, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };

  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  jsonBytes = new Uint8Array([...jsonBytes, ...new Array(pad).fill(0x20)]);

  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  const binAt = 20 + jsonBytes.length;
  view.setUint32(binAt, bin.length, true);
  view.setUint32(binAt + 4, 0x004e4942, true); // 'BIN\0'
  out.set(bin, binAt + 8);
  return out;
}
