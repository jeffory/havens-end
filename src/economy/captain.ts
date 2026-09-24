import type { Contract } from './contracts';
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
}

export const STARTING_GOLD = 200;

export function createCaptain(home: Port): Captain {
  return { gold: STARTING_GOLD, lastPort: home, standing: startingStanding(), contracts: [], logbook: {} };
}
