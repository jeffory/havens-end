import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayOptions } from '../audio/sfx/Sfx';
import type { LoopId, SoundId } from '../audio/sfx/sounds';
import { LOOP_IDS } from '../audio/sfx/sounds';
import type { SeaEvent } from '../combat/sea';
import type { DuelEvent } from '../duel/duel';
import type { Action, LandEvent } from '../land/Land';
import type { TreasureEvent } from '../treasure/Treasure';
import { SoundDirector, type SoundSink } from './SoundDirector';

class FakeSink implements SoundSink {
  played: Array<[SoundId, PlayOptions | undefined]> = [];
  loops: Array<Readonly<Record<LoopId, number>>> = [];
  play(id: SoundId, options?: PlayOptions): void {
    this.played.push([id, options]);
  }
  setLoops(levels: Readonly<Record<LoopId, number>>): void {
    this.loops.push(levels);
  }
  get ids(): SoundId[] {
    return this.played.map(([id]) => id);
  }
}

let sink: FakeSink;
let sounds: SoundDirector;
beforeEach(() => {
  sink = new FakeSink();
  sounds = new SoundDirector(sink, (x) => ({ distance: x, pan: 0 }));
});

const fire = (x: number): SeaEvent => ({ kind: 'fire', x, y: 0, z: 0, dirX: 1, dirZ: 0, vessel: 1 });
const noBuildings = () => undefined;
const P = { x: 0, y: 0, z: 0 };

describe('SoundDirector at sea', () => {
  it('a broadside is a cannon per gun', () => {
    sounds.sea([fire(1), fire(2), fire(3)], () => null);
    expect(sink.played).toEqual([
      ['cannon', { at: { distance: 1, pan: 0 } }],
      ['cannon', { at: { distance: 2, pan: 0 } }],
      ['cannon', { at: { distance: 3, pan: 0 } }],
    ]);
  });

  it('chain shot tears sail as well as hull', () => {
    sounds.sea([{ kind: 'hit', x: 5, y: 0, z: 0, ammo: 'chain', vessel: 2 }], () => null);
    expect(sink.ids).toEqual(['hull-hit', 'sail-tear']);
    expect(sink.played[0][1]?.at).toEqual({ distance: 5, pan: 0 });
  });

  it('grape splashes softly', () => {
    sounds.sea([{ kind: 'splash', x: 4, z: 0, ammo: 'grape' }], () => null);
    expect(sink.played).toEqual([['splash', { at: { distance: 4, pan: 0 }, gain: 0.5 }]]);
  });

  it('grape hits softly, round shot at full strength', () => {
    sounds.sea([
      { kind: 'hit', x: 1, y: 0, z: 0, ammo: 'grape', vessel: 2 },
      { kind: 'hit', x: 1, y: 0, z: 0, ammo: 'round', vessel: 2 },
    ], () => null);
    expect(sink.played.map(([id, o]) => [id, o?.gain])).toEqual([['hull-hit', 0.5], ['hull-hit', undefined]]);
  });

  it('thuds, barrels and blasts', () => {
    sounds.sea([
      { kind: 'thud', x: 1, y: 0, z: 0 },
      { kind: 'barrel', x: 1, z: 0 },
      { kind: 'explosion', x: 1, z: 0 },
    ], () => null);
    expect(sink.played.map(([id, o]) => [id, o?.gain])).toEqual([['hull-hit', 0.5], ['splash', 0.4], ['barrel-blast', undefined]]);
  });

  it('a ship going down is heard where she is', () => {
    sounds.sea([{ kind: 'sinking', vessel: 7, name: 'x', faction: 'pirate' }], (id) => (id === 7 ? { x: 9, z: 0 } : null));
    expect(sink.played).toEqual([['sinking', { at: { distance: 9, pan: 0 } }]]);
  });

  it('setting sail is heard once, as the sails go up', () => {
    sounds.sails(0, 0, 0);
    sounds.sails(0.5, 0, 0);
    expect(sink.ids).toEqual(['sails-set']);
    sounds.sails(0.5, 0, 0);
    expect(sink.ids).toEqual(['sails-set']);
    sounds.sails(0, 0, 0);
    sounds.sails(1, 0, 0);
    expect(sink.ids).toEqual(['sails-set', 'sails-set']);
  });

  it('back aboard after the sails were counted furled ashore, the first order is heard', () => {
    sounds.sails(0.5, 0, 0);
    sounds.sails(0, 0, 0); // ashore: Game counts the sails as furled
    sounds.sails(0, 0, 0);
    sounds.sails(0.5, 0, 0);
    expect(sink.ids).toEqual(['sails-set', 'sails-set']);
  });
});

describe('SoundDirector ashore', () => {
  const work = (action: Action): LandEvent => ({ kind: 'work', action, ...P });
  it.each<[string, LandEvent, Array<[SoundId, number | undefined]>]>([
    ['fell', work('fell'), [['tree-fall', undefined]]],
    ['chop', work('chop'), [['axe-chop', undefined]]],
    ['mine', work('mine'), [['pickaxe', undefined]]],
    ['break', work('break'), [['outcrop-break', undefined]]],
    ['dig', work('dig'), [['dig', undefined]]],
    ['till', work('till'), [['dig', undefined]]],
    ['plant', work('plant'), [['dig', 0.5]]],
    ['harvest', work('harvest'), [['pickup', undefined]]],
    ['unbuild', work('unbuild'), [['axe-chop', undefined]]],
    ['fish', work('fish'), [['splash', 0.3]]],
    ['catch', work('catch'), [['splash', 0.3]]],
    ['pickup', { kind: 'pickup', good: 'fish', amount: 1 }, [['pickup', undefined]]],
    ['built', { kind: 'built', structure: 'campfire', ...P }, [['axe-chop', 0.7]]],
    ['razed', { kind: 'razed', structure: 'campfire', ...P }, [['axe-chop', 0.7]]],
    ['shot hits', { kind: 'shot', gun: 'rifle', from: P, to: P, hit: 'creature' }, [['rifle', undefined], ['bullet-hit', 1]]],
    ['shot misses', { kind: 'shot', gun: 'pistol', from: P, to: P, hit: null }, [['pistol', undefined], ['bullet-hit', 0.4]]],
    ['musket', { kind: 'shot', gun: 'musket', from: P, to: P, hit: 'captain' }, [['musket', undefined], ['bullet-hit', 1]]],
    ['hurt', { kind: 'hurt', ...P }, [['captain-hurt', undefined]]],
    ['alarm', { kind: 'alarm', ...P }, [['bandit-shout', undefined]]],
    ['goat bolts', { kind: 'bolt', creature: 'goat', ...P }, [['goat', undefined]]],
    ['boar bolts', { kind: 'bolt', creature: 'boar', ...P }, [['boar', undefined]]],
    ['loaded', { kind: 'loaded', gun: 'pistol' }, [['reload', undefined]]],
  ])('each land event plays its sound: %s', (_, event, expected) => {
    sounds.land([event], noBuildings);
    expect(sink.played.map(([id, o]) => [id, o?.gain])).toEqual(expected);
  });

  it('places land sounds where they happen', () => {
    sounds.land([{ kind: 'shot', gun: 'rifle', from: { x: 3, y: 0, z: 0 }, to: { x: 8, y: 0, z: 0 }, hit: null }], noBuildings);
    expect(sink.played.map(([, o]) => o?.at?.distance)).toEqual([3, 8]);
  });

  it("a sawpit's work is heard, a smokehouse's isn't", () => {
    const kinds = ['sawpit', 'smokehouse', 'forge'];
    const made = (building: number): LandEvent => ({ kind: 'made', building, ...P });
    sounds.land([made(0), made(1), made(2), made(9)], (id) => kinds[id]);
    expect(sink.ids).toEqual(['saw', 'forge-hammer']);
  });

  it('crabs bolt in silence', () => {
    sounds.land([{ kind: 'bolt', creature: 'crab', ...P }], noBuildings);
    expect(sink.played).toEqual([]);
  });

  it('one footstep per footfall, on the ground underfoot', () => {
    sounds.footfall(4, 'sand', 2, 0, 0);
    expect(sink.played).toEqual([]);
    sounds.footfall(5, 'sand', 2, 0, 0);
    expect(sink.played).toEqual([['step-sand', { at: { distance: 2, pan: 0 } }]]);
    sounds.footfall(5, 'sand', 2, 0, 0);
    expect(sink.ids).toEqual(['step-sand']);
    sounds.footfall(7, 'wood', 2, 0, 0);
    expect(sink.ids).toEqual(['step-sand', 'step-wood']);
  });
});

describe('SoundDirector elsewhere', () => {
  it('treasure found, and its guardian', () => {
    const events: TreasureEvent[] = [
      { kind: 'found', map: 1, ...P, gold: 100 },
      { kind: 'guardian', map: 2, ...P },
    ];
    sounds.treasure(events);
    expect(sink.ids).toEqual(['chest-found', 'guardian-wail']);
  });

  it.each<[DuelEvent, SoundId[]]>([
    [{ kind: 'swing', side: 'player', move: 'light' }, ['swing']],
    [{ kind: 'swing', side: 'player', move: 'kick' }, []],
    [{ kind: 'hit', side: 'enemy', move: 'kick', damage: 1, x: 0, riposte: false }, ['kick']],
    [{ kind: 'hit', side: 'enemy', move: 'heavy', damage: 1, x: 0, riposte: false }, ['grunt']],
    [{ kind: 'blocked', side: 'player', x: 0 }, ['block']],
    [{ kind: 'parried', side: 'player', x: 0 }, ['parry']],
    [{ kind: 'guardBreak', side: 'player', x: 0 }, ['blade-clash']],
    [{ kind: 'defeated', side: 'enemy' }, ['grunt']],
    [{ kind: 'dodged', side: 'enemy' }, []],
  ])("the duel's events each have their sound: %o", (event, expected) => {
    sounds.duel(event);
    expect(sink.ids).toEqual(expected);
  });

  it('menu sounds play centred', () => {
    sounds.ui('coins');
    expect(sink.played).toEqual([['coins', undefined]]);
  });

  it('the surroundings set the loops', () => {
    sounds.surroundings({ where: null, speed: 1, wind: 1, shore: 0, port: 0, fire: 0, night: false });
    expect(sink.loops).toEqual([Object.fromEntries(LOOP_IDS.map((id) => [id, 0]))]);
  });
});
