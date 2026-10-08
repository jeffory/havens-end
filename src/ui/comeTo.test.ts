import { describe, expect, it } from 'vitest';
import { comeToCard } from './comeTo';

describe('the come-to card', () => {
  it('lost at sea', () => {
    expect(comeToCard({ kind: 'sunk', ship: 'sloop', goods: 12, port: 'Haven' })).toEqual({
      title: 'Lost at sea',
      line: 'Your sloop went down, and 12 goods with her. You wash ashore at Haven, where the harbourmaster finds you another.',
    });
    expect(comeToCard({ kind: 'sunk', ship: 'brig', goods: 0, port: 'Port Royal' }).line).toBe('Your brig went down. You wash ashore at Port Royal, where the harbourmaster finds you another.');
  });

  it('in irons', () => {
    expect(comeToCard({ kind: 'jailed', fine: 300, goods: 12, port: 'Haven' })).toEqual({
      title: 'In irons',
      line: 'Your freedom costs 300 gold, and your 12 goods are seized. You’re released at Haven with a fresh sloop.',
    });
    expect(comeToCard({ kind: 'jailed', fine: 0, goods: 0, port: 'Haven' }).line).toBe('Your freedom costs 0 gold. You’re released at Haven with a fresh sloop.');
  });

  it('left for dead', () => {
    expect(comeToCard({ kind: 'bandits', toll: 45, pack: true })).toEqual({
      title: 'Left for dead',
      line: 'Your crew carries you back aboard. The bandits took 45 gold, and your pack lies where you fell.',
    });
    expect(comeToCard({ kind: 'bandits', toll: 45, pack: false }).line).toBe('Your crew carries you back aboard. The bandits took 45 gold.');
  });

  it('the dead keep their gold', () => {
    expect(comeToCard({ kind: 'guardian', toll: 80 })).toEqual({
      title: 'The dead keep their gold',
      line: 'You come to at dawn beside the hole, 80 gold lighter. The hoard, and its guardian, are still there.',
    });
  });
});
