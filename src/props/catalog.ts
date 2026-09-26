import type { ShipModel } from '../sailing/shipModel';
import { instanceVoxels, mvToGame, type VoxFile } from '../vox/parseVox';
import { paletteFromRgba } from '../voxel/palette';
import { clock, lantern, porchPost, porchRail, signboard, signpost, wallLantern } from './models';
import type { Point, PropKind, PropModel } from './types';

/** The middle of a model's foot: centred across x and z, at its lowest voxel. */
function foot(cells: ArrayLike<number>): Point & { minZ: number } {
  let [minX, maxX, minY, minZ, maxZ] = [Infinity, -Infinity, Infinity, Infinity, -Infinity];
  for (let i = 0; i < cells.length; i += 4) {
    minX = Math.min(minX, cells[i]);
    maxX = Math.max(maxX, cells[i]);
    minY = Math.min(minY, cells[i + 1]);
    minZ = Math.min(minZ, cells[i + 2]);
    maxZ = Math.max(maxZ, cells[i + 2]);
  }
  return { x: (minX + maxX + 1) / 2, y: minY, z: (minZ + maxZ + 1) / 2, minZ };
}

/** The sloop's hull (no sails or flag), a block a voxel, for the ship on the stocks: her origin at her stern, on her keel. */
export function hullOnStocks(sloop: ShipModel): PropModel {
  const f = foot(sloop.hull.cells);
  return { cells: sloop.hull.cells, palette: { ...paletteFromRgba(sloop.palette), flags: new Uint8Array(256) }, origin: { x: f.x, y: f.y, z: f.minZ }, scale: 1, reserve: true };
}

/** A prop from a MagicaVoxel file: every object in it as one, standing on the middle of its foot. */
export function propFromVox(file: VoxFile, scale = 0.25): PropModel {
  const cells: number[] = [];
  for (const instance of file.instances) {
    const voxels = instanceVoxels(file, instance);
    for (let i = 0; i < voxels.length; i += 4) cells.push(...mvToGame(voxels[i], voxels[i + 1], voxels[i + 2]), voxels[i + 3]);
  }
  const { x, y, z } = foot(cells);
  return { cells: Int32Array.from(cells), palette: { ...paletteFromRgba(file.palette), flags: new Uint8Array(256) }, origin: { x, y, z }, scale };
}

/** Every prop the towns use, built once at startup. The sloop's model gives the ship on the stocks. */
export function propCatalog(sloop: ShipModel): Record<PropKind, PropModel> {
  return {
    lantern: lantern(),
    wallLantern: wallLantern(),
    signTavern: signboard('tavern'),
    signOffice: signboard('office'),
    signpostMarket: signpost('market'),
    signpostShipyard: signpost('shipyard'),
    clock: clock(),
    porchPost: porchPost(),
    porchRail: porchRail(),
    hullOnStocks: hullOnStocks(sloop),
  };
}
