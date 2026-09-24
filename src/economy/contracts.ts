import type { Faction } from '../combat/vessel';
import { GOOD_INFO, type Good } from './goods';
import type { Port, PortFaction } from './ports';

interface Terms {
  id: number;
  /** The port that posted it. */
  issuer: number;
  /** Whose standing the job earns (or costs, if it's failed). */
  faction: PortFaction;
  reward: number;
  standing: number;
  /** Sea time it must be done by. */
  deadline: number;
}

/**
 * Freight: goods loaded at the issuing port for delivery elsewhere. The captain puts
 * up a bond worth the cargo, returned with the fee on delivery, so the goods can't
 * simply be sold off. `black`: smuggled, handed over in the tavern's back room of an
 * Imperial port rather than on the quay.
 */
export interface Delivery extends Terms {
  kind: 'delivery';
  port: number;
  good: Good;
  amount: number;
  bond: number;
  black: boolean;
}

/** Sink or take ships of a flag, then collect where it was posted. */
export interface Bounty extends Terms {
  kind: 'bounty';
  target: PortFaction;
  count: number;
  progress: number;
}

export type Contract = Delivery | Bounty;

/** How many jobs a captain can have on at once. */
export const MAX_CONTRACTS = 3;
/** Standing lost with the issuer for a job not done in time. */
export const FAILURE_PENALTY = 5;

/** Where a job is handed in. */
export const turnInPort = (c: Contract): number => (c.kind === 'delivery' ? c.port : c.issuer);

/** Counts a sunk or captured ship toward any unfinished bounty on her flag; returns the bounties credited. */
export function creditBounties(contracts: readonly Contract[], victim: Faction): Bounty[] {
  const credited: Bounty[] = [];
  for (const c of contracts) {
    if (c.kind !== 'bounty' || c.target !== victim || c.progress >= c.count) continue;
    c.progress++;
    credited.push(c);
  }
  return credited;
}

export const BOUNTY_NOUNS: Record<PortFaction, [string, string]> = {
  pirate: ['pirate ship', 'pirate ships'],
  merchant: ['merchant prize', 'merchant prizes'],
  imperial: ['Imperial warship', 'Imperial warships'],
};

/** One line describing the job, e.g. "Carry 20 cloth to Kingsreach". */
export function contractTitle(c: Contract, ports: readonly Port[]): string {
  if (c.kind === 'bounty') {
    const [one, many] = BOUNTY_NOUNS[c.target];
    return `Sink or take ${c.count === 1 ? `a ${one}` : `${c.count} ${many}`}`;
  }
  const where = ports[c.port].name;
  const what = `${c.amount} ${GOOD_INFO[c.good].label.toLowerCase()}`;
  return c.black ? `Smuggle ${what} into ${where}` : `Carry ${what} to ${where}`;
}
