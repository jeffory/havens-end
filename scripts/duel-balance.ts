/**
 * Duel balance harness: a scripted player (human-ish reaction times, sloppy to sharp
 * parry timing) fights every enemy captain over 40 seeds. Run: npm run duel:balance
 */
import { Duel, IDLE, type DuelIntent } from '../src/duel/duel';
import { DUEL_SKILLS } from '../src/duel/duelAi';
import { MOVES } from '../src/duel/moves';
import { impactIn } from '../src/duel/timing';

/** A decent human: parries white swings (with sloppy timing), rolls red ones, counters. */
function bot(d: Duel, skillLevel: number): DuelIntent {
  const me = d.player, foe = d.enemy;
  const intent: DuelIntent = { ...IDLE };
  const gap = foe.x - me.x;
  const impact = impactIn(foe);
  const reaction = 0.18 + (1 - skillLevel) * 0.12;
  if (impact !== null && foe.t >= reaction) {
    const spec = MOVES[foe.move!];
    if (spec.telegraph === 'red' && impact < 0.3) { intent.roll = true; intent.move = Math.sign(gap); return intent; }
    if (spec.telegraph === 'white') {
      // Human timing error: aim for impact - 0.08, jitter by skill.
      const aim = 0.08 + (d.random() - 0.5) * (0.5 - skillLevel * 0.4);
      intent.block = impact < Math.max(0.02, aim) || me.blockHeld && impact < 0.3;
      return intent;
    }
  }
  if (Math.abs(gap) > 1.7) intent.move = Math.sign(gap);
  else if (me.state === 'idle' || me.state === 'walk' || (me.state === 'attack' && me.move === 'light')) {
    intent.attack = foe.state === 'stagger' ? 'heavy' : foe.state === 'block' && d.random() < 0.3 ? 'kick' : 'light';
  }
  return intent;
}

{
  const out: string[] = [];
  for (const skill of ['merchant', 'pirate', 'imperial'] as const) {
    for (const level of [0.3, 0.7, 1]) {
      let wins = 0, total = 0, time = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const s = DUEL_SKILLS[skill]; const d = new Duel({ halfLength: 6, playerHp: 100, playerPower: 1, enemyHp: s.hp, enemyPower: s.power, enemySkill: s, seed });
        while (!d.winner && d.time < 120) d.step(1 / 60, bot(d, level));
        total++; if (d.winner === 'player') wins++; time += d.time;
      }
      out.push(`${skill.padEnd(9)} player-skill ${level}: wins ${wins}/${total}, avg ${(time / total).toFixed(1)}s`);
    }
  }
  console.log(out.join('\n'));
}
