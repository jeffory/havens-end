import { describe, expect, it } from 'vitest';
import type { Gun } from './land/firearms';
import type { Land } from './land/Land';
import { Shore } from './Shore';
import type { FootHud } from './ui/FootHud';

/** The captain on foot, with only what the hotbar asks of the land: the guns they own. */
function onFoot(guns: Gun[]): Shore {
  const land = { sea: { captain: { guns } } } as unknown as Land;
  const hud = { onSelect: null } as unknown as FootHud;
  const none = null as never;
  return new Shore(land, none, none, hud, none, none, none);
}

describe('on foot', () => {
  it('keeps what’s in hand when a gun bought ashore adds a slot before it', () => {
    const guns: Gun[] = [];
    const shore = onFoot(guns);
    shore.select(4);
    expect(shore.held).toBe('tobaccoSeed');
    guns.push('pistol');
    expect(shore.items().indexOf('tobaccoSeed')).toBe(5);
    expect(shore.held).toBe('tobaccoSeed');
  });

  it('puts down what was being placed, and stops digging, when the captain is brought down', () => {
    const shore = onFoot([]);
    shore.place('campfire');
    shore['digging'] = { x: 0, z: 0, left: 1 };
    shore.broughtDown();
    expect(shore.placing).toBeNull();
    expect(shore['digging']).toBeNull();
  });
});
