import { instanceVoxels, mvToGame, type VoxFile } from '../vox/parseVox';
import { paletteFromRgba } from '../voxel/palette';
import { banner, bar, barCask, barrel, bed, chair, chest, crate, desk, deskGrand, hearth, ledgerChest, mapTable, rug, type RugColours, runner, shelf, stool, strongbox, table, treasureChest } from './furniture';
import { counter, handCart, stall } from './market';
import { clock, lantern, porchPost, porchRail, signboard, signpost, wallLantern } from './models';
import type { Point, PropKind, PropModel } from './types';
import { pitchPot, ropeCoil, sawhorse, shipOnStocks, timberRack, workbench } from './yard';

/** The middle of a model's foot: centred across x and z, at its lowest voxel. */
function foot(cells: ArrayLike<number>): Point {
  let [minX, maxX, minY, minZ, maxZ] = [Infinity, -Infinity, Infinity, Infinity, -Infinity];
  for (let i = 0; i < cells.length; i += 4) {
    minX = Math.min(minX, cells[i]);
    maxX = Math.max(maxX, cells[i]);
    minY = Math.min(minY, cells[i + 1]);
    minZ = Math.min(minZ, cells[i + 2]);
    maxZ = Math.max(maxZ, cells[i + 2]);
  }
  return { x: (minX + maxX + 1) / 2, y: minY, z: (minZ + maxZ + 1) / 2 };
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

/** Each port's rugs and runners: the Crown's crimson and gold, the Guild's blue, Haven's sea green and sand, the Brethren's tar and bone. */
const RUGS = {
  crown: { field: 'crimson', border: 'rugBorder', motif: 'gold' },
  guild: { field: 'guildBlue', border: 'linen', motif: 'gold' },
  sea: { field: 'seaGreen', border: 'sand', motif: 'blueWare' },
  brethren: { field: 'tar', border: 'blanket', motif: 'bone' },
} as const satisfies Record<string, RugColours>;

/** Every prop the towns use, built once at startup. */
export function propCatalog(): Record<PropKind, PropModel> {
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
    hullOnStocks: shipOnStocks(),
    barrel: barrel(),
    crate: crate(),
    stallProduceRed: stall('red', 'produce'),
    stallClothRed: stall('red', 'cloth'),
    stallProduceBlue: stall('blue', 'produce'),
    stallClothBlue: stall('blue', 'cloth'),
    handCart: handCart(),
    bed: bed(),
    table: table(),
    stool: stool(),
    chair: chair(),
    shelfCrockery: shelf('crockery'),
    shelfBottles: shelf('bottles'),
    shelfBooks: shelf('books'),
    chest: chest(),
    hearth: hearth(),
    rug: rug(RUGS.crown),
    runner: runner(RUGS.crown),
    rugGuild: rug(RUGS.guild),
    rugSea: rug(RUGS.sea),
    rugBrethren: rug(RUGS.brethren),
    runnerGuild: runner(RUGS.guild),
    runnerSea: runner(RUGS.sea),
    runnerBrethren: runner(RUGS.brethren),
    bar: bar(),
    barCask: barCask(),
    desk: desk(),
    counterProduce: counter('produce'),
    counterCloth: counter('cloth'),
    deskGrand: deskGrand(),
    strongbox: strongbox(),
    ledgerChest: ledgerChest(),
    treasureChest: treasureChest(),
    mapTable: mapTable(),
    bannerCrown: banner('crown'),
    bannerGuild: banner('guild'),
    bannerBrethren: banner('brethren'),
    workbench: workbench(),
    sawhorse: sawhorse(),
    timberRack: timberRack(),
    ropeCoil: ropeCoil(),
    pitchPot: pitchPot(),
  };
}
