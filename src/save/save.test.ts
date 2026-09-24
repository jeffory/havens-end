import { describe, expect, it } from 'vitest';
import { Sea } from '../combat/sea';
import { shipClass } from '../combat/vessel';
import { SEA_LEVEL } from '../config';
import { Economy } from '../economy/economy';
import type { Port } from '../economy/ports';
import { Land } from '../land/Land';
import { footprintSamples } from '../sailing/hull';
import { BRIG, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP } from '../sailing/ships';
import { Weather } from '../sailing/weather';
import { Block } from '../voxel/blocks';
import { CHUNK_VOLUME } from '../voxel/Chunk';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { decodeRuns, encodeRuns } from './rle';

function box(length: number, beam: number): Float32Array {
  const cells: Array<[number, number]> = [];
  for (let x = 0; x < beam; x++) for (let z = 0; z < length; z++) cells.push([x - beam / 2, z - length / 2]);
  return footprintSamples(cells);
}
const CLASSES = new Map([SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG].map((type) => [type, shipClass(type, box(15, 5), 2.5, 16)] as const));
const PORTS: Port[] = [0, 1].map((id) => ({
  id,
  name: `Port ${id}`,
  faction: 'merchant',
  x: 3000 + id * 500,
  z: 0,
  heading: 0,
  islandX: 3000 + id * 500,
  islandZ: 0,
  pier: { x: 3000, y: 13, z: 0 },
  places: [],
}));

/** A flat island, generated the same way every time: the "world seed". */
function world(): VoxelWorld {
  const w = new VoxelWorld();
  for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) for (let y = 0; y <= SEA_LEVEL; y++) w.setVoxel(x, y, z, y === SEA_LEVEL ? Block.Grass : Block.Dirt);
  w.trackEdits();
  return w;
}

function game(w = world()) {
  const sea = new Sea(w, new Weather({ cells: [] }), CLASSES, SLOOP, PORTS, 1, false);
  Object.assign(sea.player.ship, { x: 50, z: 0 });
  return { world: w, sea, economy: new Economy(sea, PORTS, 1), land: new Land(w, sea) };
}

describe('saves', () => {
  it('run-length encode chunk data losslessly and small', () => {
    const data = new Uint8Array(CHUNK_VOLUME);
    data.fill(Block.Stone, 0, 20000);
    data[25000] = Block.Grass;
    const text = encodeRuns(data);
    expect(text.length).toBeLessThan(400);
    expect(decodeRuns(text, CHUNK_VOLUME)).toEqual(data);
  });

  it('bring back the captain, their ship, the markets and their camp, onto a freshly generated world', () => {
    const a = game();
    a.sea.captain.gold = 1234;
    a.sea.captain.standing.imperial = -40;
    a.sea.player.cargo = { rum: 12 };
    a.sea.refit(a.sea.classFor(BRIG), 'Your brig');
    a.sea.player.upgrades = ['copper'];
    Object.assign(a.sea.player.ship, { x: 50, z: 0 }); // the yard put her at the port's berth: bring her back
    a.economy.arrive(PORTS[0]);
    a.economy.accept(PORTS[0], a.economy.offers(PORTS[0], 'office').find((c) => c.kind === 'bounty')!.id);
    a.economy.lines(PORTS[0])[0].stock = 3;
    a.land.goAshore();
    a.land.pack.timber = 45;
    a.land.pack.caneCuttings = 1;
    a.land.build('campfire', 20, 0, 0);
    Object.assign(a.land.walker!, { x: 10.5, z: 10.5, y: SEA_LEVEL + 1, facing: 0 });
    a.land.use('hoe');
    a.land.use('caneCuttings');
    a.sea.time = 500;

    const saved = JSON.parse(JSON.stringify({
      sea: a.sea.snapshot(),
      economy: a.economy.snapshot(),
      land: a.land.snapshot(),
      edits: a.world.editedChunks().map((c) => ({ cx: c.cx, cy: c.cy, cz: c.cz, data: encodeRuns(c.data) })),
    }));

    const b = game();
    for (const e of saved.edits) b.world.loadChunk(e.cx, e.cy, e.cz, decodeRuns(e.data, CHUNK_VOLUME));
    b.sea.restore(saved.sea);
    b.economy.restore(saved.economy);
    b.land.restore(saved.land);

    expect(b.sea.captain.gold).toBe(1234);
    expect(b.sea.captain.standing.imperial).toBe(-40);
    expect(b.sea.player.cls.design).toBe(BRIG);
    expect(b.sea.player.cls.type.topSpeed).toBeCloseTo(BRIG.topSpeed * 1.08);
    expect(b.sea.player.cargo).toEqual({ rum: 12 });
    expect(b.sea.captain.contracts).toEqual(a.sea.captain.contracts);
    expect(b.sea.ashore).toBe(true);
    expect(b.sea.time).toBe(500);
    expect(b.economy.lines(PORTS[0])[0].stock).toBe(3);
    expect(b.economy.offers(PORTS[0], 'office')).toEqual(a.economy.offers(PORTS[0], 'office'));
    expect(b.land.buildings).toEqual(a.land.buildings);
    expect(b.land.crops).toEqual(a.land.crops);
    expect(b.land.pack).toEqual(a.land.pack);
    expect(b.land.walker).toMatchObject({ x: 10.5, z: 10.5 });
    // The voxels too: the fire and the planted field.
    expect(b.world.getVoxel(20, SEA_LEVEL + 1, 0)).toBe(Block.Embers);
    expect(b.world.getVoxel(10, SEA_LEVEL, 11)).toBe(Block.Soil);
    expect(b.world.getVoxel(10, SEA_LEVEL + 1, 11)).toBe(Block.Sprout);
  });
});
