import type { Faction } from '../combat/vessel';
import { PORT_KINDS, type PortFaction } from './ports';

/** How each faction regards the captain, from -100 (hated) to 100 (honoured). */
export type Standing = Record<PortFaction, number>;

/** A merchant captain's son: the guild knows you, the Crown doesn't care yet, and pirates see a mark. */
export const STARTING_STANDING: Readonly<Standing> = { imperial: 0, merchant: 15, pirate: -30 };

/** What the captain did to a ship: fired on her unprovoked, sank her, or took her. */
export type Deed = 'attack' | 'sink' | 'capture';

/**
 * Standing changes per deed, by the victim's flag. Piracy against merchants angers the
 * guild and, less, the Crown; hunting pirates pleases both; the Brethren admire anyone
 * who hurts the Crown.
 */
const DEEDS: Record<PortFaction, Record<Deed, Partial<Standing>>> = {
  imperial: {
    attack: { imperial: -12, pirate: 4 },
    sink: { imperial: -8, pirate: 4 },
    capture: { imperial: -8, pirate: 6 },
  },
  merchant: {
    attack: { merchant: -8, imperial: -4, pirate: 2 },
    sink: { merchant: -8, imperial: -3, pirate: 2 },
    capture: { merchant: -6, imperial: -3, pirate: 3 },
  },
  pirate: {
    attack: { pirate: -5 },
    sink: { pirate: -5, imperial: 5, merchant: 5 },
    capture: { pirate: -5, imperial: 6, merchant: 6 },
  },
};

export interface StandingChange {
  faction: PortFaction;
  from: number;
  to: number;
}

/** Records a deed against a ship of `victim`'s flag; returns what changed. */
export function applyDeed(standing: Standing, victim: Faction, deed: Deed): StandingChange[] {
  if (victim === 'player') return [];
  const changes: StandingChange[] = [];
  for (const [faction, amount] of Object.entries(DEEDS[victim][deed]) as Array<[PortFaction, number]>) {
    const change = adjust(standing, faction, amount);
    if (change) changes.push(change);
  }
  return changes;
}

/** Moves one faction's standing, clamped to ±100. */
export function adjust(standing: Standing, faction: PortFaction, amount: number): StandingChange | null {
  const from = standing[faction];
  const to = Math.max(-100, Math.min(100, from + amount));
  if (to === from) return null;
  standing[faction] = to;
  return { faction, from, to };
}

/** At or below this, a faction's harbours turn you away. Pirate havens take almost anyone. */
export const CLOSED_AT: Readonly<Standing> = { imperial: -50, merchant: -50, pirate: -80 };
/** The Crown hunts captains it has outlawed. */
const OUTLAW_AT = -25;
/** Pirates leave their friends alone, and merchants stop running from them. */
const FRIEND_AT = 20;

export const portOpen = (standing: Standing, faction: PortFaction): boolean => standing[faction] > CLOSED_AT[faction];

/** Do this flag's warships attack the player on sight? (Anyone the player fires on fights back regardless.) */
export function huntsPlayer(standing: Standing, faction: Faction): boolean {
  if (faction === 'imperial') return standing.imperial <= OUTLAW_AT;
  if (faction === 'pirate') return standing.pirate < FRIEND_AT;
  return false;
}

/** Merchant captains run from strangers, but let friends of the guild come close. */
export const merchantsWary = (standing: Standing): boolean => standing.merchant < FRIEND_AT;

/**
 * Multiplier on what you pay in a faction's ports (what they pay you is divided by it).
 * Pirate havens take anyone's gold at a fair price; only friends get better.
 */
export function priceFactor(standing: Standing, faction: PortFaction): number {
  const s = faction === 'pirate' ? Math.max(0, standing.pirate) : standing[faction];
  if (s >= 50) return 0.94;
  if (s >= FRIEND_AT) return 0.97;
  if (s >= 0) return 1;
  return 1 + Math.min(1, -s / 50) * 0.18;
}

export function rankName(value: number): string {
  if (value >= 50) return 'Honoured';
  if (value >= FRIEND_AT) return 'Friendly';
  if (value > OUTLAW_AT) return 'Neutral';
  if (value > -50) return 'Unwelcome';
  return 'Hostile';
}

/** The news when a change crosses a line that matters: who attacks you, and which harbours will have you. */
export function standingNews({ faction, from, to }: StandingChange): string[] {
  const down = (line: number) => from > line && to <= line;
  const up = (line: number) => from <= line && to > line;
  const news: string[] = [];
  const kind = `${PORT_KINDS[faction]}s`;
  if (down(CLOSED_AT[faction])) news.push(`${kind} are now closed to you.`);
  if (up(CLOSED_AT[faction])) news.push(`${kind} will receive you again.`);
  if (faction === 'imperial' && down(OUTLAW_AT)) news.push('The Crown has put a price on your head: Imperial warships will attack on sight.');
  if (faction === 'imperial' && up(OUTLAW_AT)) news.push('The Crown no longer counts you an outlaw.');
  if (faction === 'pirate' && up(FRIEND_AT - 1)) news.push('The Brethren count you as one of their own: pirates will leave you be.');
  if (faction === 'pirate' && down(FRIEND_AT - 1)) news.push('The Brethren no longer count you a friend.');
  if (faction === 'merchant' && up(FRIEND_AT - 1)) news.push("Merchant captains trust you now: they won't run from you.");
  if (faction === 'merchant' && down(FRIEND_AT - 1)) news.push('Merchant captains will run from you now.');
  return news;
}

/** The fixer's work: each favour moves a faction this far, and no further than BRIBE_CEILING. */
export const BRIBE_STEP = 15;
export const BRIBE_CEILING = 25;

/** Gold for the fixer's next favour with a faction, or null when there's nothing more a bribe can do. */
export function bribeCost(value: number): number | null {
  const step = Math.min(BRIBE_STEP, BRIBE_CEILING - value);
  if (step <= 0) return null;
  // The deeper the grudge (or the higher you climb), the more hands need greasing.
  return Math.round(((150 + 8 * Math.abs(value)) * step) / BRIBE_STEP / 10) * 10;
}

export const startingStanding = (): Standing => ({ ...STARTING_STANDING });

