/** An object to write: a model plus where its minimum corner sits in the MagicaVoxel world. */
export interface VoxObject {
  name: string;
  size: [number, number, number];
  min: [number, number, number];
  /** (x, y, z, colourIndex) with model-local coordinates and colour index 1..255. */
  voxels: Array<readonly [number, number, number, number]>;
  hidden?: boolean;
}

/**
 * Minimal MagicaVoxel .vox writer (version 200): one model and one named transform
 * per object under a single group, plus the palette. Used to generate placeholder
 * art that opens in MagicaVoxel as an editable template, and by tests.
 */
export function writeVox(objects: VoxObject[], palette: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];

  for (const object of objects) {
    chunks.push(chunk('SIZE', ints(...object.size)));
    const xyzi = new Uint8Array(4 + object.voxels.length * 4);
    new DataView(xyzi.buffer).setInt32(0, object.voxels.length, true);
    object.voxels.forEach((voxel, i) => xyzi.set(voxel, 4 + i * 4));
    chunks.push(chunk('XYZI', xyzi));
  }

  // Scene: root transform 0 -> group 1 -> (transform, shape) per object.
  const children = objects.map((_, i) => 2 + i * 2);
  chunks.push(chunk('nTRN', concat(ints(0), dict({}), ints(1, -1, -1, 1), dict({}))));
  chunks.push(chunk('nGRP', concat(ints(1), dict({}), ints(children.length, ...children))));
  objects.forEach((object, i) => {
    // MagicaVoxel positions a model by its pivot, the corner at floor(size / 2).
    const t = object.size.map((s, axis) => object.min[axis] + Math.floor(s / 2));
    const attributes: Record<string, string> = { _name: object.name };
    if (object.hidden) attributes._hidden = '1';
    chunks.push(chunk('nTRN', concat(ints(children[i]), dict(attributes), ints(children[i] + 1, -1, 0, 1), dict({ _t: t.join(' ') }))));
    chunks.push(chunk('nSHP', concat(ints(children[i] + 1), dict({}), ints(1, i), dict({}))));
  });
  chunks.push(chunk('LAYR', concat(ints(0), dict({}), ints(-1))));

  // Colour index i is stored as file entry i - 1.
  const rgba = new Uint8Array(256 * 4);
  rgba.set(palette.subarray(4, 256 * 4), 0);
  chunks.push(chunk('RGBA', rgba));

  const body = concat(...chunks);
  return concat(ascii('VOX '), ints(200), ascii('MAIN'), ints(0, body.length), body);
}

function chunk(id: string, content: Uint8Array): Uint8Array {
  return concat(ascii(id), ints(content.length, 0), content);
}

function ints(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setInt32(i * 4, v, true));
  return out;
}

function dict(entries: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = [ints(Object.keys(entries).length)];
  for (const [key, value] of Object.entries(entries)) parts.push(string(key), string(value));
  return concat(...parts);
}

function string(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  return concat(ints(bytes.length), bytes);
}

const ascii = (text: string) => new TextEncoder().encode(text);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
