import type { Contract } from './contracts';
import type { Cargo } from './goods';
import type { Logbook } from './logbook';
import type { Port } from './ports';
import { type Standing, startingStanding } from './reputation';

/** The player as a person rather than a ship: everything that survives losing the ship. */
export interface Captain {
  gold: number;
  /** Where the captain last made port: jail and shipwreck both put you ashore here. */
  lastPort: Port;
  standing: Standing;
  contracts: Contract[];
  logbook: Logbook;
  /** What the captain carries on foot: timber and stone gathered, seed, the harvest. */
  pack: Cargo;
}

export const STARTING_GOLD = 200;
/** How much the captain can carry ashore. */
export const PACK_SIZE = 40;

export function createCaptain(home: Port): Captain {
  return { gold: STARTING_GOLD, lastPort: home, standing: startingStanding(), contracts: [], logbook: {}, pack: {} };
}
