import { barrelAt, crateAt, EIGHTH, kit } from './kit';
import type { PropModel } from './types';

/** A barrel standing on the floor, a block high. */
export function barrel(): PropModel {
  const s = kit('stave', 'staveDark', 'hoop', 'lid');
  barrelAt(s, 1, 0, 1);
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}

/** A crate, three quarters of a block each way. */
export function crate(): PropModel {
  const s = kit('crate', 'crateLight', 'crateDark');
  crateAt(s, 1, 0, 1, 6, 6, 6);
  return s.model({ x: 4, y: 0, z: 4 }, EIGHTH);
}
