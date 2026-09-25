/** Unique finds from buried treasure: each is found once, and each does something. */
export type RelicId = 'spyglass' | 'cutlass' | 'lodestone' | 'ledger' | 'doubloon';
export const RELIC_LIST: readonly RelicId[] = ['spyglass', 'cutlass', 'lodestone', 'ledger', 'doubloon'];

export const RELICS: Record<RelicId, { name: string; detail: string }> = {
  spyglass: { name: 'The Admiral’s Spyglass', detail: 'Ship names show from much further off, day or night.' },
  cutlass: { name: 'Blackwood’s Cutlass', detail: 'Your blade bites deeper: a quarter more damage in a duel.' },
  lodestone: { name: 'The Lodestone', detail: 'Within 20 paces of a chest you hold a map for, it tugs toward it.' },
  ledger: { name: 'The Smuggler’s Ledger', detail: 'Its false bottoms fool every customs officer: your muskets are never found.' },
  doubloon: { name: 'The Lucky Doubloon', detail: 'Captured ships give up a quarter more gold.' },
};

/** Does the captain have it? */
export const hasRelic = (captain: { relics: readonly RelicId[] }, relic: RelicId): boolean => captain.relics.includes(relic);

/** How much further the spyglass lets you read a ship's name. */
export const SPYGLASS_RANGE = 1.75;
/** The cutlass's bite, and the doubloon's luck. */
export const CUTLASS_POWER = 1.25;
export const DOUBLOON_GOLD = 1.25;
/** How near a chest the lodestone stirs. */
export const LODESTONE_RANGE = 20;
