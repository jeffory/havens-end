import type { Faction } from '../combat/vessel';

/** Who runs a port: the Crown (imperial), the merchants' guild (a free port) or the Brethren (a pirate haven). */
export type PortFaction = Exclude<Faction, 'player'>;
export const PORT_FACTIONS: readonly PortFaction[] = ['imperial', 'merchant', 'pirate'];

/** A harbour: where it is, who runs it, and where a ship lies when she's in port. */
export interface Port {
  /** Index into the archipelago's port list; also the port's key in markets and the logbook. */
  id: number;
  name: string;
  faction: PortFaction;
  /** The berth: open water off the pier head, bow toward the sea. Ships leave port from here. */
  x: number;
  z: number;
  heading: number;
  /** Centre of the port's island, for the chart. */
  islandX: number;
  islandZ: number;
}

export const FACTION_NAMES: Record<PortFaction, string> = {
  imperial: 'the Crown',
  merchant: 'the Guild',
  pirate: 'the Brethren',
};

export const PORT_KINDS: Record<PortFaction, string> = {
  imperial: 'Imperial port',
  merchant: 'Free port',
  pirate: 'Pirate haven',
};
