import type { RelicId } from '../treasure/relics';
import type { TreasureMap } from '../treasure/Treasure';
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
  /** Settlers hired in a tavern, aboard until they're settled at a camp. */
  passengers: number;
  /** Treasure maps in the captain's case. */
  maps: TreasureMap[];
  /** Unique finds from buried treasure. */
  relics: RelicId[];
  /** Pieces of Blackwood's chart found. */
  pieces: number;
  /** The sealed letter from Blackwood's hoard. */
  letter: boolean;
}

export const STARTING_GOLD = 200;
/** How much the captain can carry ashore. */
export const PACK_SIZE = 40;
/** Settlers a ship will carry, over and above her crew. */
export const PASSENGER_BERTHS = 8;

export function createCaptain(home: Port): Captain {
  return { gold: STARTING_GOLD, lastPort: home, standing: startingStanding(), contracts: [], logbook: {}, pack: {}, passengers: 0, maps: [], relics: [], pieces: 0, letter: false };
}
