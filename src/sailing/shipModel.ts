import { instanceVoxels, mvToGame, type VoxFile } from '../vox/parseVox';
import { outlineFromFootprint } from './hull';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** A group of voxels that moves as one. Coordinates are "model space": game axes, integer cells. */
export interface ModelPart {
  /** (x, y, z, colourIndex) quads. */
  cells: Int32Array;
  /** Point the part turns about: sails where their yard meets the mast, flags where they meet the mast. */
  pivot: Point3;
}

export interface ShipModel {
  /** Everything that doesn't move relative to the deck: hull, masts, rigging, guns. */
  hull: ModelPart;
  sails: ModelPart[];
  flags: ModelPart[];
  /** RGBA bytes per colour index, straight from the .vox file. */
  palette: Uint8Array;
  /** Model-space point that becomes the ship's origin: middle of the hull, at the waterline. */
  origin: Point3;
  /** Waterline footprint boundary in ship-local (x, z), for collision. */
  outline: Float32Array;
  /** Ship-local z of the bow tip and stern, and the half-width of the hull. */
  bow: number;
  stern: number;
  halfBeam: number;
}

/**
 * Turns a MagicaVoxel ship into game parts. Authoring conventions (see docs/ARCHITECTURE.md):
 * bow toward +Y, starboard toward +X; objects named `sail…` (flat panels hung on the
 * forward face of a mast) brace and furl, `flag…`
 * stream downwind, everything else is hull. `draft` is how deep the keel sits below
 * the waterline, so the art needs no waterline marker.
 */
export function buildShipModel(file: VoxFile, draft: number): ShipModel {
  const hull: number[] = [];
  const sails: number[][] = [];
  const flags: number[][] = [];

  for (const instance of file.instances) {
    const name = instance.name.toLowerCase();
    const target = name.startsWith('sail') ? push(sails) : name.startsWith('flag') ? push(flags) : hull;
    const voxels = instanceVoxels(file, instance);
    for (let i = 0; i < voxels.length; i += 4) {
      target.push(...mvToGame(voxels[i], voxels[i + 1], voxels[i + 2]), voxels[i + 3]);
    }
  }
  if (hull.length === 0) throw new Error('buildShipModel: the model has no hull voxels');

  const hullBox = bounds(hull);
  const origin = {
    x: (hullBox.minX + hullBox.maxX + 1) / 2,
    y: hullBox.minY + draft,
    z: (hullBox.minZ + hullBox.maxZ + 1) / 2,
  };

  // The waterline footprint: hull cells from the keel to one voxel above the water.
  const footprint = new Map<string, [number, number]>();
  for (let i = 0; i < hull.length; i += 4) {
    if (hull[i + 1] >= origin.y + 1) continue;
    const x = hull[i] - origin.x;
    const z = hull[i + 2] - origin.z;
    footprint.set(`${x},${z}`, [x, z]);
  }

  return {
    hull: { cells: Int32Array.from(hull), pivot: { ...origin } },
    sails: sails.map((cells) => {
      const box = bounds(cells);
      // A square sail hangs on the forward face of its mast: it swings about its own aft face.
      return { cells: Int32Array.from(cells), pivot: { x: (box.minX + box.maxX + 1) / 2, y: box.maxY + 1, z: box.minZ } };
    }),
    flags: flags.map((cells) => {
      const box = bounds(cells);
      return { cells: Int32Array.from(cells), pivot: { x: (box.minX + box.maxX + 1) / 2, y: box.maxY + 1, z: box.maxZ + 1 } };
    }),
    palette: file.palette,
    origin,
    outline: outlineFromFootprint(footprint.values()),
    bow: hullBox.maxZ + 1 - origin.z,
    stern: hullBox.minZ - origin.z,
    halfBeam: (hullBox.maxX + 1 - hullBox.minX) / 2,
  };
}

function push(parts: number[][]): number[] {
  const part: number[] = [];
  parts.push(part);
  return part;
}

function bounds(cells: ArrayLike<number>) {
  const box = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (let i = 0; i < cells.length; i += 4) {
    box.minX = Math.min(box.minX, cells[i]);
    box.maxX = Math.max(box.maxX, cells[i]);
    box.minY = Math.min(box.minY, cells[i + 1]);
    box.maxY = Math.max(box.maxY, cells[i + 1]);
    box.minZ = Math.min(box.minZ, cells[i + 2]);
    box.maxZ = Math.max(box.maxZ, cells[i + 2]);
  }
  return box;
}
