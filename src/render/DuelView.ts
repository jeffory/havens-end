import { DirectionalLight, Group, Vector3 } from 'three';
import type { CharacterModel } from '../duel/characterModel';
import type { Duel, Fighter, Side } from '../duel/duel';
import type { ShipModel } from '../sailing/shipModel';
import { CharacterView } from './CharacterView';

/** How far off the centre line the captains fight: toward the camera, well clear of the masts. */
const LATERAL = 1.5;
const CAMERA_DISTANCE = 11.5;
/** High enough to look down onto the deck (~30°), so the near hull doesn't wall off the fight. */
const CAMERA_HEIGHT = 7.5;

/**
 * Where two captains fight, in the space of the group they stand in: along its z axis,
 * `lateral` off its centre line, on a floor at `floor`, watched from its +x side
 * (`side` 1) or −x side (−1).
 */
export interface DuelStage {
  floor: number;
  centre: number;
  halfLength: number;
  side: 1 | -1;
  lateral: number;
}

/** A prize's deck: the longest flat stretch, on the side away from the player's ship (`playerSide`, ship-local x sign). */
export function deckStage(ship: ShipModel, playerSide: number): DuelStage {
  const side = playerSide > 0 ? -1 : 1;
  const run = flatDeck(ship, side * LATERAL);
  return { floor: ship.deck, centre: (run.from + run.to) / 2, halfLength: Math.max(2.5, (run.to - run.from) / 2 - 0.6), side, lateral: side * LATERAL };
}

/** Open ground, the group set down where the fight is and turned so its z runs across the view. */
export const groundStage = (halfLength: number): DuelStage => ({ floor: 0, centre: 0, halfLength, side: 1, lateral: 0 });

/**
 * The duel on stage: two captains on the prize's deck (riding her motion) or on open
 * ground, framed from the side. Duel x runs along the stage; it's laid out so +x is
 * screen right from the side the camera watches.
 */
export class DuelView {
  readonly stage = new Group();
  readonly halfLength: number;
  private readonly fighters: Record<Side, CharacterView>;
  /** +1: the camera watches from the stage's +x side; -1: from −x. */
  private readonly side: 1 | -1;
  private readonly centre: number;
  private readonly deckY: number;
  private readonly lateral: number;
  private readonly scratch = new Vector3();

  constructor(
    private readonly deck: Group,
    where: DuelStage,
    playerModel: CharacterModel,
    enemyModel: CharacterModel,
    /** A ghost fights the player: pale, glowing and see-through. */
    ghost = false,
  ) {
    this.side = where.side;
    this.deckY = where.floor;
    this.centre = where.centre;
    this.lateral = where.lateral;
    this.halfLength = where.halfLength;
    this.fighters = { player: new CharacterView(playerModel), enemy: new CharacterView(enemyModel, ghost) };
    this.stage.add(this.fighters.player.root, this.fighters.enemy.root);
    // A soft fill from the camera's side, so dark coats still read against a dark hull.
    const fill = new DirectionalLight(0xfff1dc, 0.9);
    fill.position.set(this.side * 10, this.deckY + 6, this.centre);
    fill.target.position.set(this.lateral, this.deckY + 1, this.centre);
    this.stage.add(fill, fill.target);
    this.stage.name = 'duel';
    deck.add(this.stage);
  }

  update(duel: Duel, dt: number, time: number): void {
    for (const f of [duel.player, duel.enemy]) {
      const view = this.fighters[f.side];
      view.root.position.copy(this.local(f.x, 0));
      // Face along the keel toward the opponent; mirror if needed so the sword arm faces the camera.
      const forward = -this.side * f.facing; // ship-local z of "forward"
      view.root.rotation.y = forward > 0 ? 0 : Math.PI;
      const swordSideX = -Math.cos(view.root.rotation.y); // where the right arm (local -x) ends up
      view.root.scale.x = Math.abs(view.root.scale.x) * (Math.sign(swordSideX) === this.side ? 1 : -1);
      view.update(f, dt, time);
    }
  }

  /** World position of a point on the fighting line: `x` along the duel, `height` above the deck. */
  worldAt(x: number, height: number, out = new Vector3()): Vector3 {
    this.deck.updateWorldMatrix(true, false);
    return out.copy(this.local(x, height)).applyMatrix4(this.deck.matrixWorld);
  }

  /** A fighter's head, sword-hand and chest in world space, for effects and the HUD. */
  anchor(f: Fighter, height: number, out = new Vector3()): Vector3 {
    return this.worldAt(f.x, height, out);
  }

  /** Where the camera should sit and look, framing both captains from the side. */
  cameraFor(duel: Duel, position: Vector3, target: Vector3): void {
    const mid = (duel.player.x + duel.enemy.x) / 2;
    const spread = Math.abs(duel.player.x - duel.enemy.x);
    const distance = CAMERA_DISTANCE + Math.max(0, spread - 3) * 0.9;
    this.deck.updateWorldMatrix(true, false);
    target.copy(this.local(mid, 0.8)).applyMatrix4(this.deck.matrixWorld);
    position.copy(this.local(mid, CAMERA_HEIGHT)).add(this.scratch.set(this.side * distance, 0, 0)).applyMatrix4(this.deck.matrixWorld);
  }

  dispose(): void {
    this.deck.remove(this.stage);
    this.fighters.player.dispose();
    this.fighters.enemy.dispose();
  }

  private local(x: number, height: number): Vector3 {
    return this.scratch.set(this.lateral, this.deckY + height, this.centre - this.side * x).clone();
  }
}

/** The longest stretch along the keel where the deck is flat at `lateral`: quarterdecks and forecastles excluded. */
function flatDeck(ship: ShipModel, lateral: number): { from: number; to: number } {
  const o = ship.origin;
  const column = Math.floor(o.x + lateral);
  const tops = new Map<number, number>();
  const cells = ship.hull.cells;
  for (let i = 0; i < cells.length; i += 4) {
    if (cells[i] !== column) continue;
    const z = cells[i + 2];
    tops.set(z, Math.max(tops.get(z) ?? -Infinity, cells[i + 1] + 1));
  }
  const deck = Math.round(ship.deck + o.y);
  let best = { from: 0, to: 0 };
  let runStart: number | null = null;
  let previous = -Infinity;
  for (const z of [...tops.keys()].sort((a, b) => a - b)) {
    const flat = tops.get(z) === deck;
    if (!flat) runStart = null;
    else if (runStart === null || z !== previous + 1) runStart = z;
    if (runStart !== null && z + 1 - runStart > best.to - best.from) best = { from: runStart, to: z + 1 };
    previous = z;
  }
  return { from: best.from - o.z, to: best.to - o.z };
}
