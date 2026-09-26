import { Sketch } from './sketch';
import type { PropModel } from './types';

const IRON = 0x2f3237;
const GLASS = 0xffd27a;
const TIMBER = 0x6b4a2b;
const FRAME = 0x4a3320;
const WHITE = 0xf2eee2;
const GOLD = 0xe0b83a;

/**
 * A lantern: an iron base, glowing glass four high all round, an iron roof and a cap. Four
 * voxels across, from (x0, y0, z0). The glass has no bars across it: after dark, a corner bar
 * split it into two lit panes under a black roof, and the lantern read as a face with glowing eyes.
 */
function cage(s: Sketch, x0: number, y0: number, z0: number): void {
  s.box(x0, y0, z0, x0 + 3, y0, z0 + 3, 'iron');
  s.box(x0, y0 + 1, z0, x0 + 3, y0 + 4, z0 + 3, 'glass');
  s.box(x0, y0 + 5, z0, x0 + 3, y0 + 5, z0 + 3, 'iron');
  s.box(x0 + 1, y0 + 6, z0 + 1, x0 + 2, y0 + 6, z0 + 2, 'iron');
}

/** A lantern on top of a post: half a block across, an eighth of a block a voxel. */
export function lantern(): PropModel {
  const s = new Sketch().paint('iron', IRON).paint('glass', GLASS, true);
  cage(s, -2, 0, -2);
  return s.model({ x: 0, y: 0, z: 0 }, 0.125);
}

/** A lantern hung from an iron bracket on a wall, beside a door. */
export function wallLantern(): PropModel {
  const s = new Sketch().paint('iron', IRON).paint('glass', GLASS, true);
  s.box(-1, 7, 0, 0, 7, 5, 'iron'); // the bracket, out from the wall; the lantern's cap hangs from it
  cage(s, -2, 0, 2);
  return s.model({ x: 0, y: 0, z: 0 }, 0.125);
}

type Place = 'tavern' | 'office' | 'market' | 'shipyard';

/** Each place's board: its colour, and its device in rows (top first) of I iron, W white, B brown, G gold, Y dark gold. */
const DEVICES: Record<Place, { field: number; rows: readonly string[] }> = {
  tavern: { field: 0x2f5d3a, rows: ['WWW..', 'BBBB.', 'BBB.B', 'BBBB.'] }, // a tankard of ale
  office: { field: 0x2b3f6b, rows: ['.GGG.', 'GGYGG', 'GGYGG', '.GGG.'] }, // a seal
  market: { field: 0x8c3a2c, rows: ['..I..', 'IIIII', 'G.I.G', 'GGIGG'] }, // scales
  shipyard: { field: 0x46607a, rows: ['..I..', '.III.', 'I.I.I', '.III.'] }, // an anchor
};

function signPaints(place: Place): Sketch {
  return new Sketch()
    .paint('frame', FRAME)
    .paint('field', DEVICES[place].field)
    .paint('iron', IRON)
    .paint('white', WHITE)
    .paint('brown', 0x8a5a2b)
    .paint('gold', GOLD)
    .paint('darkGold', 0xb8912a);
}

/** A board 7 long and 6 tall in the z–y plane at x = 0, out from z0 and down from `top`: a frame, the field, the device. */
function board(s: Sketch, z0: number, top: number, place: Place): void {
  for (let z = z0; z < z0 + 7; z++) {
    for (let y = top - 5; y <= top; y++) s.put(0, y, z, z === z0 || z === z0 + 6 || y === top - 5 || y === top ? 'frame' : 'field');
  }
  s.rowsZ(z0 + 1, top - 4, 0, DEVICES[place].rows, { I: 'iron', W: 'white', B: 'brown', G: 'gold', Y: 'darkGold' });
}

/** A signboard hung on a bracket out from the wall by a door, with the place's device. */
export function signboard(place: 'tavern' | 'office'): PropModel {
  const s = signPaints(place);
  s.box(0, 3, 0, 0, 3, 7, 'iron'); // the bracket
  s.put(0, 2, 1, 'iron').put(0, 2, 7, 'iron'); // its hooks
  board(s, 1, 1, place);
  return s.model({ x: 0.5, y: 0, z: 0 }, 0.25);
}

/** A post by a way in with the place's board hung from an arm: for the market's open hall and the shipyard's shed. */
export function signpost(place: 'market' | 'shipyard'): PropModel {
  const s = signPaints(place);
  s.box(0, 0, -1, 1, 10, 0, 'frame'); // the post
  s.box(0, 10, 1, 0, 10, 8, 'iron'); // the arm
  s.put(0, 9, 2, 'iron').put(0, 9, 8, 'iron');
  board(s, 2, 8, place);
  return s.model({ x: 1, y: 0, z: 0 }, 0.25);
}

/** A clock on the front of the Governor's House: a gold rim round a white face, and its hands. Two blocks across. */
export function clock(): PropModel {
  const s = new Sketch().paint('rim', GOLD).paint('face', WHITE).paint('hand', 0x1c1c22);
  s.rows(-4, 0, 0, ['..RRRR..', '.RFFFFR.', 'RFFHFFFR', 'RFFHFFFR', 'RFFHHHFR', 'RFFFFFFR', '.RFFFFR.', '..RRRR..'], { R: 'rim', F: 'face', H: 'hand' });
  return s.model({ x: 0, y: 0, z: 0 }, 0.25);
}

/** A porch post, from the deck up to the canopy: two and a half blocks. */
export function porchPost(): PropModel {
  return new Sketch().paint('timber', TIMBER).box(-1, 0, -1, 0, 9, 0, 'timber').model({ x: 0, y: 0, z: 0 }, 0.25);
}

/** A block's length of porch rail: a top rail on two balusters, running along x. */
export function porchRail(): PropModel {
  const s = new Sketch().paint('timber', TIMBER);
  s.box(-2, 3, 0, 1, 3, 0, 'timber');
  for (const x of [-2, 0]) s.box(x, 0, 0, x, 2, 0, 'timber');
  return s.model({ x: 0, y: 0, z: 0.5 }, 0.25);
}
