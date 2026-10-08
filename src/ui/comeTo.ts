/** Each way of going down, and what the card needs to tell of it. */
export type ComeTo =
  | { kind: 'sunk'; ship: string; goods: number; port: string }
  | { kind: 'jailed'; fine: number; goods: number; port: string }
  | { kind: 'bandits'; toll: number; pack: boolean }
  | { kind: 'guardian'; toll: number };

/** What the fade shows: a title (the card has one; sleep doesn't), and a line. */
export interface Card {
  title?: string;
  line: string;
}

/** The card for going down: a title, and a line of what happened and where you came to. */
export function comeToCard(c: ComeTo): Required<Card> {
  switch (c.kind) {
    case 'sunk':
      return { title: 'Lost at sea', line: `Your ${c.ship} went down${c.goods > 0 ? `, and ${c.goods} goods with her` : ''}. You wash ashore at ${c.port}, where the harbourmaster finds you another.` };
    case 'jailed':
      return { title: 'In irons', line: `Your freedom costs ${c.fine} gold${c.goods > 0 ? `, and your ${c.goods} goods are seized` : ''}. You’re released at ${c.port} with a fresh sloop.` };
    case 'bandits':
      return { title: 'Left for dead', line: `Your crew carries you back aboard. The bandits took ${c.toll} gold${c.pack ? ', and your pack lies where you fell' : ''}.` };
    case 'guardian':
      return { title: 'The dead keep their gold', line: `You come to at dawn beside the hole, ${c.toll} gold lighter. The hoard, and its guardian, are still there.` };
  }
}
