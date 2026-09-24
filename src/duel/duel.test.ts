import { describe, expect, it } from 'vitest';
import { Duel, type DuelConfig, type DuelEvent, type DuelIntent, IDLE } from './duel';
import { DUEL_SKILLS } from './duelAi';
import { MOVES } from './moves';

const DT = 1 / 60;

function duel(config: Partial<DuelConfig> = {}): Duel {
  const d = new Duel({
    halfLength: 6,
    playerHp: 100,
    playerPower: 1,
    enemyHp: 100,
    enemyPower: 1,
    enemySkill: DUEL_SKILLS.pirate,
    seed: 1,
    ...config,
  });
  // Face off at arm's length.
  d.player.x = -0.8;
  d.enemy.x = 0.8;
  return d;
}

/** Steps the duel. Attack and roll are presses: they're sent on the first tick only. */
function run(d: Duel, seconds: number, player: Partial<DuelIntent> = {}, enemy: Partial<DuelIntent> = {}): DuelEvent[] {
  const events: DuelEvent[] = [];
  let first = true;
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    const p = { ...IDLE, ...player };
    const e = { ...IDLE, ...enemy };
    if (!first) {
      p.attack = e.attack = null;
      p.roll = e.roll = false;
    }
    d.step(DT, p, e);
    events.push(...d.takeEvents());
    first = false;
  }
  return events;
}

const kinds = (events: DuelEvent[]) => events.map((e) => e.kind);

describe('attacks', () => {
  it('land within reach and miss beyond it', () => {
    const near = duel();
    run(near, 0.8, { attack: 'light' });
    expect(near.enemy.hp).toBeCloseTo(100 - MOVES.light.damage);

    const far = duel();
    far.enemy.x = 5;
    run(far, 0.8, { attack: 'light' });
    expect(far.enemy.hp).toBe(100);
  });

  it('chain into a three-hit combo with a harder finisher', () => {
    const d = duel();
    run(d, 0.35, { attack: 'light' });
    run(d, 0.3, { attack: 'light' });
    run(d, 0.9, { attack: 'light' });
    expect(d.enemy.hp).toBeLessThanOrEqual(100 - 9 - 9 - 13 + 0.01);
  });

  it('need stamina', () => {
    const d = duel();
    d.player.stamina = 0;
    run(d, 0.1, { attack: 'heavy' });
    expect(d.player.state).not.toBe('attack');
  });
});

describe('defence', () => {
  it('blocking takes only a scratch, and costs stamina', () => {
    const d = duel();
    const events = run(d, 0.8, { attack: 'light' }, { block: true });
    expect(kinds(events)).toContain('blocked');
    expect(d.enemy.hp).toBeGreaterThan(98);
    expect(d.enemy.stamina).toBeLessThan(100);
  });

  it('a well-timed parry turns the blow aside and staggers the attacker', () => {
    const d = duel();
    run(d, 0.55, { attack: 'heavy' }); // heavy lands at 0.65
    const events = run(d, 0.3, {}, { block: true }); // raise the guard 0.1s before impact
    expect(kinds(events)).toContain('parried');
    expect(d.enemy.hp).toBe(100);
    expect(d.player.state).toBe('stagger');
  });

  it('a parry raised too early is just a block', () => {
    const d = duel();
    run(d, 0.1, { attack: 'heavy' });
    const events = run(d, 0.8, {}, { block: true });
    expect(kinds(events)).toContain('blocked');
    expect(kinds(events)).not.toContain('parried');
  });

  it('red thrusts go straight through a guard', () => {
    const d = duel();
    run(d, 1.2, { attack: 'thrust' }, { block: true });
    expect(d.enemy.hp).toBeCloseTo(100 - MOVES.thrust.damage);
  });

  it('a roll started just before a red thrust lands goes through it untouched', () => {
    const d = duel();
    run(d, 0.7, { attack: 'thrust' }); // thrust lands at 0.75, while the roller is still in reach
    const events = run(d, 0.8, {}, { roll: true, move: -1 });
    expect(d.enemy.hp).toBe(100);
    expect(kinds(events)).toContain('dodged');
  });

  it('rolling away early simply takes you out of reach', () => {
    const d = duel();
    run(d, 0.3, { attack: 'thrust' });
    run(d, 1, {}, { roll: true, move: 1 });
    expect(d.enemy.hp).toBe(100);
  });

  it('a kick breaks a raised guard', () => {
    const d = duel();
    const events = run(d, 0.6, { attack: 'kick' }, { block: true });
    expect(kinds(events)).toContain('guardBreak');
    expect(d.enemy.state).toBe('stagger');
  });

  it('running out of stamina behind a guard breaks it', () => {
    const d = duel();
    d.enemy.stamina = 10; // less than a heavy block costs, even after regaining some behind the guard
    const events = run(d, 1, { attack: 'heavy' }, { block: true });
    expect(kinds(events)).toContain('guardBreak');
  });
});

describe('movement', () => {
  it('rolls pass through the other fighter', () => {
    const d = duel();
    run(d, 0.6, { roll: true, move: 1 });
    expect(d.player.x).toBeGreaterThan(d.enemy.x);
  });

  it('fighters otherwise keep their distance and stay on deck', () => {
    const d = duel();
    run(d, 3, { move: 1 });
    expect(d.enemy.x - d.player.x).toBeGreaterThan(0.8);
    run(d, 10, { move: -1 });
    expect(d.player.x).toBeGreaterThanOrEqual(-6);
  });
});

describe('outcome', () => {
  it('ends when a captain goes down', () => {
    const d = duel({ enemyHp: 5 });
    const events = run(d, 0.8, { attack: 'light' });
    expect(d.winner).toBe('player');
    expect(kinds(events)).toContain('defeated');
  });

  it('crew advantage shows in who hits harder', () => {
    const d = duel({ playerPower: 1.25 });
    run(d, 0.8, { attack: 'light' });
    expect(d.enemy.hp).toBeCloseTo(100 - MOVES.light.damage * 1.25);
  });
});

describe('enemy captains', () => {
  /** Lets the AI fight a player who just stands there, or keeps swinging heavies. */
  function bout(skill: keyof typeof DUEL_SKILLS, player: (d: Duel) => Partial<DuelIntent>, seconds = 90) {
    const d = new Duel({ halfLength: 6, playerHp: 100, playerPower: 1, enemyHp: 100, enemyPower: 1, enemySkill: DUEL_SKILLS[skill], seed: 7 });
    const events: DuelEvent[] = [];
    for (let t = 0; t < seconds && !d.winner; t += DT) {
      d.step(DT, { ...IDLE, ...player(d) });
      events.push(...d.takeEvents());
    }
    return { d, events };
  }

  it('beat a captain who does nothing', () => {
    for (const skill of ['merchant', 'pirate', 'imperial'] as const) {
      expect(bout(skill, () => ({})).d.winner).toBe('enemy');
    }
  });

  it('parry more the better they are', () => {
    // A player who walks in and throws heavy after heavy.
    const hacker = (d: Duel) => ({ move: Math.sign(d.enemy.x - d.player.x), attack: d.player.state === 'idle' || d.player.state === 'walk' ? ('heavy' as const) : null });
    const parries = (skill: keyof typeof DUEL_SKILLS) => bout(skill, hacker, 40).events.filter((e) => e.kind === 'parried' && e.side === 'enemy').length;
    expect(parries('imperial')).toBeGreaterThan(parries('merchant'));
  });

  it('play out identically from the same seed', () => {
    const replay = () => JSON.stringify(bout('imperial', (d) => ({ attack: d.time % 2 < 0.02 ? 'light' : null })).d.player);
    expect(replay()).toBe(replay());
  });
});
