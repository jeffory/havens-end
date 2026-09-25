import { type Camera, Raycaster, Vector2, Vector3 } from 'three';
import { partOfDay } from './core/clock';
import type { Controls } from './core/Controls';
import type { Input } from './core/Input';
import { PACK_SIZE } from './economy/captain';
import { cargoCount, GOOD_INFO, type Good } from './economy/goods';
import type { Port, PortPlace } from './economy/ports';
import { type Held, type Interaction, type Land, type Target, TOOL_LIST, type Tool, TOWN_RADIUS } from './land/Land';
import { hasRelic, LODESTONE_RANGE } from './treasure/relics';
import type { Treasure } from './treasure/Treasure';
import { PLANTABLE } from './land/crops';
import { type Building, STRUCTURES, type Structure } from './land/structures';
import type { CameraRig } from './render/CameraRig';
import type { LandView } from './render/LandView';
import type { FootHud } from './ui/FootHud';
import { OFFICE_NAMES } from './ui/port/OfficeTab';
import type { WorldLabel } from './ui/WorldLabels';
import { Block, type BlockId } from './voxel/blocks';
import { raycastVoxels, type VoxelReader } from './voxel/raycast';

/** What the shore needs from the game around it: menus, saving, and going back to sea. */
export interface ShoreHost {
  openPort(place: PortPlace): void;
  openStore(building: Building): void;
  /** The camp screen, from its fire (or one of its workshops). */
  openCamp(fire: Building, building: Building): void;
  openBuildMenu(): void;
  openSystem(): void;
  rest(): void;
  aboard(message: string): void;
  toast(text: string, tone?: 'info' | 'good' | 'bad'): void;
  /** Is this block cut away from view (a tree or roof between the camera and the captain)? */
  hidden(x: number, y: number, z: number, id: BlockId): boolean;
}

const TOOL_LABELS: Record<Tool, string> = { axe: 'Axe', pickaxe: 'Pickaxe', hoe: 'Hoe' };
const SWING_SECONDS = 0.38;
/** How long it takes to dig for treasure, and how far the captain can shift before they've given up. */
const DIG_SECONDS = 1.5;
const DIG_WANDER = 0.3;
const HINT_SECONDS = 2.5;
/** How long a town's land stays marked out after you try to work it, fading in and out. */
const TOWN_SECONDS = 5;
const TOWN_FADE_IN = 0.25;
const TOWN_FADE_OUT = 1.2;
/** How far away the mouse can place a building. */
const PLACE_REACH = 18;
const PLACE_LABELS: Record<PortPlace['kind'], string> = { market: 'Market', tavern: 'Tavern', shipyard: 'Shipyard', office: 'Governor' };

/**
 * The captain on foot: turns controls into orders for the `Land` (walking, tools,
 * building, using things), and keeps the on-foot view and HUD in step. Like the duel's
 * scene, it's the glue between the simulation and what's drawn.
 */
export class Shore {
  private item = 0;
  placing: { kind: Structure; rot: number } | null = null;
  private swing: number | null = null;
  /** Digging for treasure: where the captain stood to dig, and how long is left. */
  private digging: { x: number; z: number; left: number } | null = null;
  private hint: { text: string; until: number; ok: boolean; tally?: boolean } | null = null;
  /** A town whose land is marked out on the ground (you tried to work it), and when. */
  private town: { port: Port; at: number } | null = null;
  /** What's been picked up lately, for the hint ("+3 timber, +1 sapling"). */
  private gains = new Map<Good, number>();
  /** The cell under the mouse, while the mouse is being used. */
  private hover: { x: number; y: number; z: number; nx: number; ny: number; nz: number } | null = null;
  private mouseUntil = 0;
  private lastPointer = { x: 0, y: 0 };
  private clock = 0;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  /** The world as the mouse sees it: what's cut away from view isn't there. */
  private readonly seen: VoxelReader = {
    getVoxel: (x, y, z) => {
      const id = this.land.world.getVoxel(x, y, z);
      return id !== Block.Air && this.host.hidden(x, y, z, id) ? Block.Air : id;
    },
  };
  readonly focus = new Vector3();

  constructor(
    private readonly land: Land,
    private readonly treasure: Treasure,
    private readonly view: LandView,
    private readonly hud: FootHud,
    private readonly rig: CameraRig,
    private readonly input: Input,
    private readonly host: ShoreHost,
  ) {
    hud.onSelect = (i) => this.select(i);
  }

  /** The hotbar: the tools, each kind of seed, and saplings. */
  items(): Held[] {
    return [...TOOL_LIST, ...PLANTABLE, 'sapling'];
  }

  /** Takes up the item in hotbar slot `i` (clicked, or its number key). */
  select(i: number): void {
    if (i >= 0 && i < this.items().length) this.item = i;
  }

  /** Something was picked up: it's added to the running tally in the hint. */
  picked(good: Good, amount: number): void {
    const tallying = this.hint?.tally && this.clock < this.hint.until;
    if (!tallying) this.gains.clear();
    this.gains.set(good, (this.gains.get(good) ?? 0) + amount);
    const text = [...this.gains].map(([g, n]) => `+${n} ${GOOD_INFO[g].label.toLowerCase()}`).join(', ');
    this.hint = { text, until: this.clock + HINT_SECONDS, ok: true, tally: true };
  }

  get held(): Held {
    return this.items()[this.item];
  }

  /** Placing a building from the build menu. */
  place(kind: Structure): void {
    this.placing = { kind, rot: 0 };
  }

  /** One fixed step: walk, and act on what was pressed. */
  update(dt: number, controls: Controls): void {
    this.clock += dt;
    if (this.swing !== null) {
      this.swing += dt / SWING_SECONDS;
      // Digging is one swing of the spade after another.
      if (this.swing >= 1) this.swing = this.digging ? 0 : null;
    }
    const { forwardX, forwardZ, rightX, rightZ } = this.rig.groundAxes();
    const mx = rightX * controls.walkX + forwardX * controls.walkY;
    const mz = rightZ * controls.walkX + forwardZ * controls.walkY;
    if (Math.hypot(mx, mz) > 0.1) this.mouseUntil = 0; // walking with keys or stick: work in front again
    this.land.move(dt, mx, mz);
    this.keepDigging(dt);

    // Esc (and Start) put down what you're placing, or else open the menu; B only puts it down.
    const cancel = controls.take('cancel');
    const system = controls.take('system');
    if (this.placing && cancel + system > 0) this.placing = null;
    else if (system > 0) this.host.openSystem();

    const items = this.items().length;
    for (let i = 0; i < items; i++) if (controls.take(`item${i + 1}` as 'item1') > 0) this.select(i);
    const step = controls.take('itemNext') - controls.take('itemPrev');
    if (step !== 0) {
      if (this.placing) this.placing.rot = (this.placing.rot + step + 4) % 4;
      else this.item = (this.item + step + items) % items;
    }

    if (controls.take('build') > 0) {
      if (this.placing) this.placing = null;
      else this.host.openBuildMenu();
    }
    if (controls.take('interact') > 0) this.interact();
    const atCursor = controls.take('useAtCursor') > 0;
    if (controls.take('use') > 0 || atCursor) this.use(atCursor);
    if (controls.take('dig') > 0) this.startDigging();
  }

  private interact(): void {
    const what = this.land.interaction();
    if (!what) return;
    switch (what.kind) {
      case 'board': {
        const result = this.land.goAboard();
        this.host.aboard(result.message);
        break;
      }
      case 'door':
        this.host.openPort(what.place);
        break;
      case 'rest':
        this.host.rest();
        break;
      case 'camp':
        this.host.openCamp(what.fire, what.building);
        break;
      case 'store':
        this.host.openStore(what.building);
        break;
      case 'harvest':
        this.report(this.land.harvest(what.crop));
        break;
    }
  }

  private use(atCursor: boolean): void {
    if (this.placing) {
      const spot = this.placeSpot();
      if (!spot) return;
      const result = this.land.build(this.placing.kind, spot.x, spot.z, this.placing.rot);
      this.report(result);
      this.markTown(spot);
      if (result.ok && !STRUCTURES[this.placing.kind].freeform) this.placing = null;
      return;
    }
    const target = this.cursor(atCursor) ?? this.land.front();
    if (!target) return;
    this.digging = null;
    this.swing = 0;
    this.report(this.land.use(this.held, target));
    this.markTown(target);
  }

  /** Starts digging for treasure where the captain stands (F, right-click, LT), if the ground can be dug. */
  private startDigging(): void {
    const w = this.land.walker;
    if (this.placing || this.digging || !w) return;
    const aim = this.land.digAim();
    if (!aim.ok) {
      this.report({ ok: false, message: aim.reason });
      this.markTown({ x: Math.floor(w.x), z: Math.floor(w.z) });
      return;
    }
    this.digging = { x: w.x, z: w.z, left: DIG_SECONDS };
    this.swing = 0;
    this.report({ ok: true, message: 'Digging…' });
  }

  /** A moment's digging: done, it turns up what's there (if anything); walking off gives it up. */
  private keepDigging(dt: number): void {
    const d = this.digging;
    const w = this.land.walker;
    if (!d) return;
    if (!w || Math.hypot(w.x - d.x, w.z - d.z) > DIG_WANDER) {
      this.digging = null;
      this.swing = null;
      this.hint = null;
      return;
    }
    d.left -= dt;
    if (d.left > 0) return;
    this.digging = null;
    this.report(this.land.dig());
  }

  /** Trying to work a town's land marks it out on the ground for a while, so you can see where yours could start. */
  private markTown(spot: { x: number; z: number }): void {
    const port = this.land.townAt(spot.x, spot.z);
    if (port) this.town = { port, at: this.clock };
  }

  /** The town's land to mark out on the ground now, and how strongly, if any. */
  townLand(): { x: number; z: number; radius: number; amount: number } | null {
    const t = this.town;
    const age = t ? this.clock - t.at : Infinity;
    if (!t || age > TOWN_SECONDS || !this.land.walker) {
      this.town = null;
      return null;
    }
    return { x: t.port.x, z: t.port.z, radius: TOWN_RADIUS, amount: Math.min(1, age / TOWN_FADE_IN, (TOWN_SECONDS - age) / TOWN_FADE_OUT) };
  }

  private report(result: { ok: boolean; message: string }): void {
    if (result.message) this.hint = { text: result.message, until: this.clock + HINT_SECONDS, ok: result.ok };
  }

  /** The block under the mouse, if the mouse is what's being used (or was just clicked) and the captain can reach it. */
  private cursor(clicked = false): Target | null {
    const h = this.hover;
    if (!h || !(clicked || this.mouseActive())) return null;
    return this.land.reaches(h.x, h.y, h.z) ? { x: h.x, y: h.y, z: h.z, face: { x: h.nx, y: h.ny, z: h.nz } } : null;
  }

  private mouseActive(): boolean {
    return this.clock < this.mouseUntil;
  }

  private inReach(cell: { x: number; z: number }, reach: number): boolean {
    const w = this.land.walker!;
    return Math.hypot(cell.x + 0.5 - w.x, cell.z + 0.5 - w.z) <= reach;
  }

  /** Where the building being placed would go: under the mouse, or in front of the captain. */
  private placeSpot(): { x: number; z: number } | null {
    const w = this.land.walker;
    if (!w || !this.placing) return null;
    if (this.mouseActive() && this.hover && this.inReach(this.hover, PLACE_REACH)) return { x: this.hover.x, z: this.hover.z };
    const spec = STRUCTURES[this.placing.kind];
    const ahead = spec.freeform ? 1.25 : Math.max(spec.w, spec.d) / 2 + 1.5;
    return { x: Math.floor(w.x + Math.sin(w.facing) * ahead), z: Math.floor(w.z + Math.cos(w.facing) * ahead) };
  }

  /** Per frame: the view, the marker or ghost, the HUD, and the signs to show. */
  render(alpha: number, frameSeconds: number, time: number, camera: Camera): WorldLabel[] {
    const w = this.land.walker;
    if (!w) return [];
    this.view.update(w, alpha, this.digging ? 'spade' : this.held, this.swing, frameSeconds, time);
    this.focus.copy(this.view.captain.root.position).setY(this.view.captain.root.position.y + 1.2);
    this.pick(camera);

    let hint = this.hint && this.clock < this.hint.until ? this.hint.text : null;
    let hintOk = this.hint?.ok ?? false;
    let placing: string | null = null;
    if (this.placing) {
      const spec = STRUCTURES[this.placing.kind];
      const spot = this.placeSpot()!;
      const where = this.land.placement(this.placing.kind, spot.x, spot.z, this.placing.rot);
      const height = this.placing.kind === 'path' ? 0.15 : spec.freeform ? 1 : 4;
      this.view.showGhost({ ...where.plot, y: this.placing.kind === 'path' ? where.y - 0.1 : where.y, height, ok: where.ok });
      this.view.mark(null);
      const cost = Object.entries(spec.cost).map(([g, n]) => `${n} ${GOOD_INFO[g as Good].label.toLowerCase()}`).join(', ');
      placing = `${spec.label} (${cost}) · Space / click to build${spec.freeform ? '' : ' · Q R turn'} · Esc done`;
      if (!where.ok) {
        hint = where.reason;
        hintOk = false;
      }
    } else {
      this.view.showGhost(null);
      const target = this.cursor() ?? this.land.front();
      // Nothing can be worked in town, so there's nothing to mark.
      const aim = this.digging ? this.land.digAim() : target && !this.land.inTown(target.x, target.z) ? this.land.aim(this.held, target) : null;
      this.view.mark(aim && aim.x !== undefined ? { x: aim.x, y: aim.y!, z: aim.z!, ok: aim.ok } : null);
    }

    const pack = this.land.pack;
    this.hud.update({
      slots: this.items().map((held, i) => ({
        key: `${i + 1}`,
        label: isTool(held) ? TOOL_LABELS[held] : GOOD_INFO[held].label,
        count: isTool(held) ? undefined : this.land.available(held),
        active: i === this.item,
      })),
      packUsed: cargoCount(pack),
      packSize: PACK_SIZE,
      packSummary: (Object.entries(pack) as Array<[Good, number]>).map(([g, n]) => `${n} ${GOOD_INFO[g].label.toLowerCase()}`).join(', '),
      prompt: promptFor(this.land.interaction(), this.land.sea.clock.phase),
      north: this.north(),
      lodestone: this.lodestone(),
      hint,
      hintOk,
      placing,
    });
    return this.signs();
  }

  /** Which way north is on screen, clockwise from up (radians), for the compass. */
  private north(): number {
    const { forwardZ, rightZ } = this.rig.groundAxes();
    return Math.atan2(-rightZ, -forwardZ);
  }

  /** With the lodestone, which way it tugs toward a buried chest you hold the map for. */
  private lodestone(): string | null {
    const w = this.land.walker;
    if (!w || !hasRelic(this.land.sea.captain, 'lodestone')) return null;
    const pull = this.treasure.pull(w.x, w.z, LODESTONE_RANGE);
    if (!pull) return null;
    if (pull.distance < 1.5) return 'The lodestone pulls straight down: dig!';
    const points = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    const point = points[Math.round(((Math.atan2(pull.dx, -pull.dz) / (Math.PI * 2)) * 8 + 8) % 8) % 8];
    return `The lodestone tugs to the ${point}.`;
  }

  /** Signs over the doors of the port you're walking in. */
  private signs(): WorldLabel[] {
    const port: Port | null = this.land.sea.docked;
    if (!port) return [];
    return port.places.map((p, i) => ({
      id: `${port.id}-${i}`,
      x: p.x,
      y: p.y + 3.2,
      z: p.z,
      text: p.kind === 'office' ? OFFICE_NAMES[port.faction] : PLACE_LABELS[p.kind],
    }));
  }

  /** Tracks the voxel under the mouse; moving the mouse makes it the target for a couple of seconds. */
  private pick(camera: Camera): void {
    const p = this.input.pointer;
    if (p.x !== this.lastPointer.x || p.y !== this.lastPointer.y) {
      this.lastPointer = { x: p.x, y: p.y };
      if (p.inside) this.mouseUntil = this.clock + 2.5;
    }
    this.hover = null;
    if (!p.inside) return;
    this.raycaster.setFromCamera(this.ndc.set(p.x, p.y), camera);
    const { origin: o, direction: d } = this.raycaster.ray;
    const hit = raycastVoxels(this.seen, o.x, o.y, o.z, d.x, d.y, d.z, 400);
    if (hit) this.hover = hit;
  }
}

const isTool = (held: Held): held is Tool => (TOOL_LIST as readonly string[]).includes(held);

/** Late enough to turn in: the evening, or the night. */
export const sleepy = (phase: number): boolean => ['evening', 'night'].includes(partOfDay(phase));

function promptFor(what: Interaction | null, phase: number): string | null {
  if (!what) return null;
  const key = 'E / 🎮 A';
  switch (what.kind) {
    case 'board':
      return `${key}: back aboard`;
    case 'door':
      return `${key}: ${what.place.kind === 'office' ? 'the governor' : PLACE_LABELS[what.place.kind].toLowerCase()}`;
    case 'rest':
      return `${key}: ${sleepy(phase) ? 'sleep till morning' : 'rest'} (saves the game)`;
    case 'camp':
      return `${key}: ${what.building === what.fire ? 'the camp: settlers, workshops, stores' : `the ${STRUCTURES[what.building.kind].label.toLowerCase()}`}`;
    case 'store':
      return `${key}: the storehouse`;
    case 'harvest':
      return `${key}: harvest`;
  }
}
