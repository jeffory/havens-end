import { createElement } from 'react';
import { Color, Fog, NeutralToneMapping, PCFShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
import { type Ammo, AMMO_TYPES } from './combat/ammo';
import { REGION_NAMES, regionTier } from './combat/encounters';
import { type DockProblem, type PlayerOrders, Sea, type SeaEvent } from './combat/sea';
import { reloadTime, type ShipClass, shipClass, type Side, toLocal } from './combat/vessel';
import { SIM_HZ } from './config';
import { type DuelCast, DuelScene } from './DuelScene';
import { buildCharacterModel, type CharacterModel } from './duel/characterModel';
import type { DuelIntent } from './duel/duel';
import { BOUNTY_NOUNS } from './economy/contracts';
import { Economy, type Notice } from './economy/economy';
import { cargoCount } from './economy/goods';
import type { Port, PortPlace } from './economy/ports';
import { standingNews } from './economy/reputation';
import { type Action, Controls } from './core/Controls';
import { GameLoop } from './core/GameLoop';
import { Input } from './core/Input';
import { SeabedMap } from './ocean/SeabedMap';
import { WATER_LEVEL } from './ocean/waves';
import { BarrelsView } from './render/BarrelsView';
import { CameraRig } from './render/CameraRig';
import { ChunkRenderer } from './render/ChunkRenderer';
import { Effects } from './render/Effects';
import { FleetView } from './render/FleetView';
import { OceanRenderer } from './render/OceanRenderer';
import { RangeArcs } from './render/RangeArcs';
import { ShotsView } from './render/ShotsView';
import { Sun } from './render/Sun';
import { WakePool } from './render/Wake';
import { WindStreaks } from './render/WindStreaks';
import { angleOffWind, pointOfSailName } from './sailing/pointOfSail';
import { buildShipModel, type ShipModel } from './sailing/shipModel';
import { SHIP_TYPES, SLOOP, type ShipType } from './sailing/ships';
import { Weather, type Wind } from './sailing/weather';
import { Land } from './land/Land';
import type { Building } from './land/structures';
import { LandView } from './render/LandView';
import { Shore } from './Shore';
import { BuildMenu } from './ui/BuildMenu';
import { ChartScreen } from './ui/ChartScreen';
import { FootHud } from './ui/FootHud';
import { StoreScreen } from './ui/StoreScreen';
import { WorldLabels } from './ui/WorldLabels';
import { SystemMenu } from './ui/SystemMenu';
import { decodeRuns, encodeRuns } from './save/rle';
import { AUTOSAVE, deleteSave, SAVE_VERSION, type SaveData, type SaveSummary, writeSave } from './save/storage';
import { CHUNK_VOLUME } from './voxel/Chunk';
import { SHIP_LABELS } from './economy/shipyard';
import type { ChartProps } from './ui/ChartView';
import { DuelHud } from './ui/DuelHud';
import { type CombatReadout, Hud, type NavReadout } from './ui/Hud';
import { Overlay } from './ui/Overlay';
import { PortScreen, type Tab } from './ui/port/PortScreen';
import { type ShipLabel, ShipLabels } from './ui/ShipLabels';
import { parseVox } from './vox/parseVox';
import { VoxelWorld } from './voxel/VoxelWorld';
import { buildArchipelago, type IslandPlan, planArchipelago } from './worldgen/archipelago';

const WORLD_SEED = 1717;
const SKY_COLOR = new Color(0xa9d9ea);
const STORM_COLOR = new Color(0x74879a);
/** Chunks remeshed per frame after startup (~2-3 ms each). */
const REMESH_BUDGET = 2;
/** Seconds of travel the camera looks ahead of the ship, so you see where you're going. */
const LOOK_AHEAD = 0.8;
/** Chunks meshed before the first frame: the home island. Further islands follow, nearest first. */
const STARTUP_CHUNKS = 64;
const LABEL_RANGE = 220;
/**
 * In a fight the camera also frames the nearest enemy within FRAME_RANGE, shifting
 * FRAME_SHARE of the way toward her, but never more than FRAME_MAX_SHIFT so your
 * own ship stays well on screen.
 */
const FRAME_RANGE = 100;
const FRAME_SHARE = 0.4;
const FRAME_MAX_SHIFT = 22;
/** Captain models, by faction (the player's own is 'player'). */
const CAPTAINS = ['player', 'imperial', 'merchant', 'pirate'] as const;
const COMPASS_POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** Menu actions passed to whatever screen is open. */
const MENU_ACTIONS: readonly Action[] = ['navUp', 'navDown', 'navLeft', 'navRight', 'confirm', 'back', 'tabPrev', 'tabNext', 'chart'];
/** Orders for the ship while the captain's ashore: none. */
const ANCHORED: PlayerOrders = { rudder: 0, sails: 0, ammo: 'round', fire: [], board: false };
/** Sea seconds between autosaves. */
const AUTOSAVE_SECONDS = 180;
const REFUSALS: Record<DockProblem, (port: string) => string> = {
  closed: (port) => `${port} is closed to you. A fixer in another port might smooth things over.`,
  fast: (port) => `Take in sail: you're coming into ${port} too fast to go alongside.`,
  enemies: () => "You can't go alongside with enemies on your tail.",
};

/**
 * Composition root: builds the world, wires simulation to rendering, runs the loop.
 *
 * What goes where: state that must be saved, replayed or kept deterministic lives in
 * the `Sea` (and the voxel world) and changes only in update(). Everything render()
 * touches is derived from it and could be thrown away and rebuilt.
 */
export class Game {
  readonly world = new VoxelWorld();
  readonly weather = new Weather({ seed: WORLD_SEED });
  readonly islands: readonly IslandPlan[];
  readonly ports: readonly Port[];
  readonly sea: Sea;
  readonly economy: Economy;
  readonly land: Land;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly sky = SKY_COLOR.clone();
  private readonly fog = new Fog(this.sky, 100, 300);
  private readonly input: Input;
  private readonly controls: Controls;
  private readonly rig: CameraRig;
  private readonly sun: Sun;
  private readonly terrain: ChunkRenderer;
  private readonly ocean: OceanRenderer;
  private readonly seabed: SeabedMap;
  /** Sea seconds until the next autosave. */
  private autosaveIn = AUTOSAVE_SECONDS;
  private readonly wakes = new WakePool();
  private readonly streaks: WindStreaks;
  private readonly effects = new Effects();
  private readonly fleet: FleetView;
  private readonly shots = new ShotsView();
  private readonly barrels = new BarrelsView();
  private readonly arcs = new RangeArcs();
  private readonly landView: LandView;
  private readonly footHud: FootHud;
  private readonly signs: WorldLabels;
  private readonly shore: Shore;
  private readonly hud: Hud;
  private readonly labels: ShipLabels;
  private readonly duelHud: DuelHud;
  private readonly overlay: Overlay;
  private readonly loop: GameLoop;
  /** The port the player chose on the chart; the compass points to it. */
  private course: Port | null = null;
  /** Rebuilds whatever menu is open with fresh props (after the course changes). */
  private screen: (() => void) | null = null;
  /** The captains' duel in progress, if boarding led to one. The sea waits while it's on. */
  private duel: DuelScene | null = null;
  /** Seconds spent in duels and menus: keeps the waves moving while the sea simulation waits. */
  private pausedTime = 0;

  /** Standing orders from the helm: canvas and shot type persist between key presses. */
  private readonly orders: PlayerOrders = { rudder: 0, sails: 0, ammo: 'round', fire: [], board: false };
  private readonly cameraTarget = new Vector3();
  private readonly threat = new Vector3();

  /** Loads the ship and captain art, then builds the game. */
  static async create(container: HTMLElement): Promise<Game> {
    const models = new Map<ShipType, ShipModel>();
    const files = new Map<string, Promise<ArrayBuffer>>();
    for (const type of SHIP_TYPES) {
      if (!files.has(type.model)) files.set(type.model, load(`${import.meta.env.BASE_URL}${type.model}`));
      models.set(type, buildShipModel(parseVox(await files.get(type.model)!), type.draft));
    }
    const captains = new Map<string, CharacterModel>();
    for (const name of CAPTAINS) {
      captains.set(name, buildCharacterModel(parseVox(await load(`${import.meta.env.BASE_URL}models/characters/${name}.vox`))));
    }
    return new Game(container, models, captains);
  }

  private constructor(
    private readonly container: HTMLElement,
    models: Map<ShipType, ShipModel>,
    private readonly captains: Map<string, CharacterModel>,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.toneMapping = NeutralToneMapping; // keeps the palette's hues, unlike ACES
    container.appendChild(this.renderer.domElement);

    this.scene.background = this.sky;
    this.scene.fog = this.fog;

    this.islands = planArchipelago(WORLD_SEED);
    this.ports = buildArchipelago(this.world, this.islands);
    this.world.trackEdits(); // from here on, changes are what a save stores

    const classes = new Map<ShipType, ShipClass>();
    for (const [type, model] of models) classes.set(type, shipClass(type, model.footprint, model.deck, model.top));
    this.sea = new Sea(this.world, this.weather, classes, SLOOP, this.ports, WORLD_SEED);
    this.economy = new Economy(this.sea, this.ports, WORLD_SEED);
    this.land = new Land(this.world, this.sea);
    const seabed = (this.seabed = new SeabedMap(this.world, 256, this.ship.x, this.ship.z));

    this.input = new Input(this.renderer.domElement);
    this.controls = new Controls(this.input);
    this.rig = new CameraRig(container.clientWidth / container.clientHeight);
    this.sun = new Sun(this.scene);
    this.terrain = new ChunkRenderer(this.world);
    this.ocean = new OceanRenderer(seabed, this.wakes);
    this.streaks = new WindStreaks(this.weather);
    this.fleet = new FleetView(models, this.wakes, this.effects, this.arcs);
    this.hud = new Hud(container);
    this.labels = new ShipLabels(container);
    this.signs = new WorldLabels(container);
    this.duelHud = new DuelHud(container);
    this.footHud = new FootHud(container);
    this.overlay = new Overlay(container);
    this.landView = new LandView(captains.get('player')!);
    this.shore = new Shore(this.land, this.landView, this.footHud, this.rig, this.input, {
      openPort: (place) => this.openPort(place),
      openStore: (building) => this.openStore(building),
      openBuildMenu: () => this.openBuildMenu(),
      openSystem: () => this.openSystem(false),
      rest: () => this.rest(),
      aboard: (message) => this.toSea(message),
      toast: (text, tone) => this.hud.toast(text, tone),
    });
    this.scene.add(
      this.terrain.group,
      this.ocean.group,
      this.fleet.group,
      this.shots.mesh,
      this.barrels.mesh,
      this.effects.mesh,
      this.streaks.mesh,
      this.landView.group,
    );

    this.loop = new GameLoop(
      {
        beginFrame: () => this.controls.poll(),
        update: (dt) => this.update(dt),
        render: (alpha, seconds) => this.render(alpha, seconds),
      },
      SIM_HZ,
    );
    window.addEventListener('resize', this.onResize);
  }

  get ship() {
    return this.sea.player.ship;
  }

  /** Starts the loop. `title` opens the game menu first (to carry on from the autosave). */
  start(title = false): void {
    const w = this.land.walker;
    this.rig.snapTo(this.cameraTarget.set(w?.x ?? this.ship.x, w ? w.y + 1.2 : WATER_LEVEL, w?.z ?? this.ship.z));
    this.terrain.update(STARTUP_CHUNKS, this.rig.focus); // the island in view, before the first frame
    if (!this.restored) this.hud.toast(`Welcome to ${this.ports[0].name}. B to go ashore and trade, M for the chart, W to make sail.`);
    if (title) this.openSystem(true);
    this.loop.start();
  }

  private restored = false;

  // ---- Saving and loading ----

  /** Everything a save needs: the seed plus what's changed. */
  snapshot(): SaveData {
    return {
      version: SAVE_VERSION,
      seed: WORLD_SEED,
      sea: this.sea.snapshot(),
      economy: this.economy.snapshot(),
      land: this.land.snapshot(),
      course: this.course?.id ?? null,
      edits: this.world.editedChunks().map((c) => ({ cx: c.cx, cy: c.cy, cz: c.cz, data: encodeRuns(c.data) })),
    };
  }

  /** Puts a save's state onto this freshly generated world. */
  restore(data: SaveData): void {
    if (data.version !== SAVE_VERSION || data.seed !== WORLD_SEED) throw new Error('That save is from a different version of the game.');
    for (const e of data.edits) this.world.loadChunk(e.cx, e.cy, e.cz, decodeRuns(e.data, CHUNK_VOLUME));
    this.sea.restore(data.sea);
    this.economy.restore(data.economy);
    this.land.restore(data.land);
    this.course = data.course === null ? null : (this.ports[data.course] ?? null);
    this.seabed.rebuild();
    this.restored = true;
    if (this.land.walker) this.toFoot('');
    this.hud.toast('Game loaded.', 'good');
  }

  summary(): SaveSummary {
    const p = this.sea.player;
    const x = this.land.walker?.x ?? p.ship.x;
    const z = this.land.walker?.z ?? p.ship.z;
    const port = this.sea.docked ?? this.ports.find((q) => Math.hypot(q.x - x, q.z - z) < 150);
    const camp = this.land.walker && this.land.claimed(x, z);
    return {
      gold: this.sea.captain.gold,
      ship: SHIP_LABELS.get(p.cls.design) ?? p.cls.design.name,
      place: port ? port.name : camp ? 'your camp' : this.land.walker ? 'ashore' : REGION_NAMES[regionTier(x, z)].toLowerCase(),
      time: this.sea.time,
    };
  }

  /** Saves to a slot. A snapshot is taken now; writing it finishes in the background. */
  save(slot: string): Promise<void> {
    return writeSave({ slot, savedAt: Date.now(), summary: this.summary(), data: this.snapshot() });
  }

  private autosave(): void {
    if (this.duel || this.sea.player.status !== 'afloat') return;
    this.autosaveIn = AUTOSAVE_SECONDS;
    this.save(AUTOSAVE).catch(() => undefined); // no storage (private window): nothing to be done
  }

  /** Resting at a fire or in a hut saves the game. */
  private rest(): void {
    this.autosave();
    this.hud.toast('You rest a while. The game is saved.', 'good');
  }

  private openSystem(title: boolean): void {
    this.openMenu(() =>
      this.overlay.show(
        'system',
        createElement(SystemMenu, {
          title,
          summary: this.summary(),
          resume: this.closeScreen,
          save: (name) => this.save(name),
          load: (slot) => location.assign(`${location.pathname}?load=${encodeURIComponent(slot)}`),
          remove: (slot) => deleteSave(slot),
          newGame: () => location.assign(`${location.pathname}?new`),
          nav: this.overlay.handlers,
        }),
      ),
    );
  }

  private update(dt: number): void {
    const { controls, orders } = this;
    if (this.duel) {
      this.duel.step(dt, this.duelIntent());
      return;
    }
    // In a menu or poring over the chart: the sea waits.
    if (this.overlay.kind) return;
    this.autosaveIn -= dt;
    if (this.autosaveIn <= 0) this.autosave();
    if (this.land.walker) {
      // On foot: the captain walks and works, the ship rides at anchor, and time goes on.
      this.shore.update(dt, controls);
      this.sea.step(dt, ANCHORED);
      this.economy.step(dt);
      return;
    }
    orders.rudder = controls.rudder;
    orders.sails = Math.min(1, Math.max(0, orders.sails + (controls.take('sailUp') - controls.take('sailDown')) * 0.5));
    if (controls.take('ammoRound')) orders.ammo = 'round';
    if (controls.take('ammoChain')) orders.ammo = 'chain';
    if (controls.take('ammoGrape')) orders.ammo = 'grape';
    for (let n = controls.take('ammoNext'); n > 0; n--) orders.ammo = nextAmmo(orders.ammo);
    const fire: Side[] = [];
    if (controls.take('firePort')) fire.push('port');
    if (controls.take('fireStarboard')) fire.push('starboard');
    orders.fire = fire;
    // B boards the ship alongside, goes alongside in a harbour, or else rows ashore.
    const board = controls.take('board') > 0;
    orders.board = board && (this.sea.boardingTarget() !== null || this.sea.harbour() !== null);
    if (board && !orders.board && this.sea.player.status === 'afloat') {
      const result = this.land.goAshore();
      if (result.ok) this.toFoot(result.message);
      else this.hud.toast(result.message, 'bad');
    }

    this.sea.step(dt, orders);
    this.economy.step(dt);
    if (this.sea.player.status !== 'afloat') orders.sails = 0;
    if (this.sea.docked && !this.land.walker) this.stepAshore(this.sea.docked);
  }

  private render(alpha: number, frameSeconds: number): void {
    const { controls, rig, sea } = this;
    const player = sea.player;

    // Camera controls and menus are presentation only, so they run per frame rather than per sim step.
    for (let n = controls.take('rotateLeft'); n > 0; n--) rig.rotate(-1);
    for (let n = controls.take('rotateRight'); n > 0; n--) rig.rotate(1);
    rig.zoom(controls.takeZoom(frameSeconds));
    if (this.overlay.kind) {
      for (const action of MENU_ACTIONS) for (let n = controls.take(action); n > 0; n--) this.overlay.nav(action);
    } else if (!this.duel && controls.take('chart') > 0) {
      this.openChart();
    } else if (!this.duel && !this.land.walker && controls.take('system') > 0) {
      this.openSystem(false);
    }

    // The rendered moment trails the latest sim step by (1 - alpha) of a step. While a
    // duel or a menu pauses the sea, the waves keep going on their own clock.
    const paused = this.duel !== null || this.overlay.kind !== null;
    if (paused) this.pausedTime += frameSeconds;
    const behind = paused ? 0 : (1 - alpha) * this.loop.step;
    const time = sea.time - behind + this.pausedTime;
    this.handleEvents(sea.takeEvents(), time);
    this.notify(this.economy.takeNotices());
    this.fleet.update(sea, paused ? 1 : alpha, time, frameSeconds);

    const pose = this.fleet.pose(player.id)!;
    const fx = Math.sin(pose.heading);
    const fz = Math.cos(pose.heading);
    const lead = Math.min(12, Math.abs(player.ship.surge) * LOOK_AHEAD) * Math.sign(player.ship.surge);
    this.cameraTarget.set(pose.x + fx * lead, WATER_LEVEL, pose.z + fz * lead);
    const threat = this.nearestThreat(pose.x, pose.z);
    if (threat) {
      const shift = threat.sub(this.cameraTarget).multiplyScalar(FRAME_SHARE);
      this.cameraTarget.add(shift.clampLength(0, FRAME_MAX_SHIFT));
    }
    let focus = rig.focus;
    const signs = this.land.walker ? this.shore.render(paused ? 1 : alpha, frameSeconds, time, rig.camera) : [];
    const walker = this.land.walker;
    if (walker) this.cameraTarget.copy(this.shore.focus);
    // Ashore, cut away what's between the camera and the captain, and fade your own ship beside you.
    if (walker) {
      const cam = rig.camera.position;
      const dx = cam.x - this.shore.focus.x;
      const dz = cam.z - this.shore.focus.z;
      const run = Math.hypot(dx, dz) || 1;
      this.terrain.setCutaway(this.shore.focus.x, this.shore.focus.y - 1.2, this.shore.focus.z, 4.5, dx / run, dz / run, run / Math.max(1, cam.y - this.shore.focus.y));
    } else {
      this.terrain.setCutaway(0, 0, 0, 0);
    }
    const near = walker ? Math.hypot(pose.x - walker.x, pose.z - walker.z) : Infinity;
    this.fleet.view(player.id)?.setFade(near < 16 ? 0.3 + 0.7 * Math.max(0, (near - 10) / 6) : 1);
    if (this.duel) {
      const verdict = this.duel.render(frameSeconds, time);
      focus = this.duel.focus;
      if (verdict) this.endDuel(verdict === 'won');
    } else {
      rig.update(this.cameraTarget, frameSeconds);
    }

    // Squalls darken the sky and the light.
    const overhead = this.weather.windAt(focus.x, focus.z, time);
    this.sky.lerpColors(SKY_COLOR, STORM_COLOR, overhead.squall);
    this.sun.setOvercast(overhead.squall);
    this.sun.follow(focus, this.duel ? 25 : rig.distance);
    this.fog.near = rig.distance * 1.4;
    this.fog.far = rig.distance * 3.5;

    this.terrain.update(REMESH_BUDGET, focus);
    this.wakes.update(time);
    this.ocean.update(time, rig.focus);
    this.streaks.update(rig.focus, rig.distance * 0.9, time, frameSeconds);
    this.shots.update(sea.shots, behind);
    this.barrels.update(sea.barrels, time);
    this.arcs.update(player);
    this.arcs.mesh.visible &&= !this.duel;
    this.effects.update(frameSeconds);
    this.handleLand(time);

    this.renderer.render(this.scene, rig.camera);
    this.signs.update(paused ? [] : signs, rig.camera, this.container.clientWidth, this.container.clientHeight);
    if (!paused && !this.land.walker) {
      const wind = this.weather.windAt(pose.x, pose.z, time);
      this.hud.setGamepadConnected(controls.gamepadConnected);
      this.hud.setNav(this.navReadout(wind, fx, fz, pose.x, pose.z));
      this.hud.setCombat(this.combatReadout());
      this.labels.update(this.shipLabels(), rig.camera, this.container.clientWidth, this.container.clientHeight);
    }
    this.hud.frame(frameSeconds, () => ({
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      chunks: this.terrain.meshCount,
    }));
    this.input.endFrame();
  }

  /** Turns what happened in the sim into smoke, splashes and news. */
  private handleEvents(events: SeaEvent[], time: number): void {
    const fx = this.effects;
    for (const e of events) {
      switch (e.kind) {
        case 'fire':
          fx.emit('smoke', e.x + e.dirX, e.y, e.z + e.dirZ, e.dirX, e.dirZ);
          fx.emit('flash', e.x + e.dirX * 1.2, e.y, e.z + e.dirZ * 1.2, e.dirX, e.dirZ);
          break;
        case 'hit':
          fx.emit('splinters', e.x, e.y, e.z, 0, 0, e.ammo === 'grape' ? 0.5 : 1);
          break;
        case 'splash':
          fx.emit('splash', e.x, WATER_LEVEL, e.z, 0, 0, e.ammo === 'grape' ? 0.45 : 1);
          this.wakes.burst(time, e.x, e.z, e.ammo === 'grape' ? 0.4 : 0.8);
          break;
        case 'thud':
          fx.emit('dust', e.x, e.y, e.z);
          break;
        case 'barrel':
          fx.emit('splash', e.x, WATER_LEVEL, e.z, 0, 0, 0.4);
          break;
        case 'explosion':
          fx.emit('fire', e.x, WATER_LEVEL + 0.5, e.z);
          fx.emit('blackSmoke', e.x, WATER_LEVEL + 1, e.z);
          fx.emit('splash', e.x, WATER_LEVEL, e.z, 0, 0, 2);
          this.wakes.burst(time, e.x, e.z, 1);
          break;
        case 'spawned': {
          const v = this.sea.vessel(e.vessel);
          if (v?.ai?.leader === null) this.hud.toast(`Sail ho! ${article(e.name)} ${e.name}${escorted(this.sea, v.group)}.`);
          break;
        }
        case 'struck':
          this.hud.toast(`The ${e.name} strikes her colours! Come alongside and board her.`, 'good');
          break;
        case 'sinking':
          if (e.vessel === this.sea.player.id) this.hud.toast('Your ship is going down!', 'bad');
          else this.hud.toast(`The ${e.name} is sinking.`, 'good');
          break;
        case 'captured': {
          const loot = [e.gold > 0 && `${e.gold} gold`, e.goods > 0 && `${e.goods} goods`].filter(Boolean).join(' and ');
          const hands = e.joined > 0 ? `${e.joined} of her crew sign on.` : 'No room aboard for any of her crew.';
          this.hud.toast(`The ${e.name} is ours!${loot ? ` Plunder: ${loot}.` : ''} ${hands}`, 'good');
          break;
        }
        case 'boardingFight':
          this.startDuel(e.vessel);
          break;
        case 'jailed':
          this.hud.toast(
            `Thrown in irons! Your freedom costs ${e.fine} gold${e.goods > 0 ? `, and your ${e.goods} goods are seized` : ''}. You are released at ${e.port}.`,
            'bad',
          );
          this.rig.snapTo(this.cameraTarget.set(this.ship.x, WATER_LEVEL, this.ship.z));
          break;
        case 'overrun':
          this.hud.toast('Your last hands have fallen and the enemy swarms aboard!', 'bad');
          break;
        case 'respawn':
          this.hud.toast(`You wash ashore at ${e.port}${e.goods > 0 ? `; your ${e.goods} goods went down with her` : ''}. A new sloop is found for you.`, 'info');
          this.rig.snapTo(this.cameraTarget.set(this.ship.x, WATER_LEVEL, this.ship.z));
          break;
        case 'standing':
          for (const news of standingNews(e)) this.hud.toast(news, e.to > e.from ? 'good' : 'bad');
          break;
        case 'bounty': {
          const [one, many] = BOUNTY_NOUNS[e.target];
          const job = this.sea.captain.contracts.find((c) => c.id === e.contract);
          const where = job ? this.ports[job.issuer].name : 'port';
          this.hud.toast(
            e.progress < e.count ? `Bounty: ${e.progress} of ${e.count} ${many}.` : `Bounty complete (${e.count === 1 ? `a ${one}` : `${e.count} ${many}`}): collect at ${where}.`,
            'good',
          );
          break;
        }
        case 'refused':
          this.hud.toast(REFUSALS[e.reason](this.ports[e.port].name), 'bad');
          break;
      }
    }
  }

  private notify(notices: Notice[]): void {
    for (const n of notices) this.hud.toast(n.text, n.tone);
  }

  // ---- Menus: ports and the chart ----

  private chartProps(): Omit<ChartProps, 'economy' | 'sea'> {
    return {
      world: this.world,
      islands: this.islands,
      camps: this.land.buildings.filter((b) => b.kind === 'campfire').map((b) => ({ x: b.x0 + 1.5, z: b.z0 + 1.5 })),
      course: this.course,
      setCourse: (port) => {
        this.course = port;
        this.screen?.();
      },
    };
  }

  /** Alongside: customs, the price book, fresh jobs, then the port's menus. */
  /** Alongside in port: customs and the price book, then the captain steps off onto the pier. */
  private stepAshore(port: Port): void {
    this.notify(this.economy.arrive(port));
    if (this.course === port) this.course = null;
    this.land.landAtPort();
    this.toFoot(`Ashore at ${port.name}. Walk up to a door to go in.`);
    this.autosave();
  }

  /** Walked up to a door in port: that place's menu. */
  private openPort(place: PortPlace): void {
    const port = this.sea.docked;
    if (!port) return;
    const tab: Tab = place.kind;
    this.openMenu(() =>
      this.overlay.show(
        'port',
        createElement(PortScreen, {
          key: `${port.id}-${place.kind}`,
          port,
          economy: this.economy,
          sea: this.sea,
          arrival: [],
          tab,
          leave: this.setSail,
          close: this.closeScreen,
          nav: this.overlay.handlers,
          chart: this.chartProps(),
        }),
      ),
    );
  }

  /** "Set sail" from a port menu: straight back aboard. */
  private readonly setSail = () => {
    this.closeMenu();
    this.toSea(this.land.goAboard().message);
  };

  private openBuildMenu(): void {
    this.openMenu(() =>
      this.overlay.show(
        'build',
        createElement(BuildMenu, {
          land: this.land,
          nav: this.overlay.handlers,
          close: this.closeScreen,
          choose: (kind) => {
            this.closeMenu();
            this.shore.place(kind);
          },
        }),
      ),
    );
  }

  private openStore(building: Building): void {
    this.openMenu(() =>
      this.overlay.show('store', createElement(StoreScreen, { land: this.land, building, close: this.closeScreen, nav: this.overlay.handlers })),
    );
  }

  private readonly closeScreen = () => this.closeMenu();

  /** The captain steps ashore: on-foot controls, camera and HUD. */
  private toFoot(message: string): void {
    this.controls.setMode('foot');
    this.rig.setRange(12, 60, 26);
    this.landView.setVisible(true);
    this.showPanels();
    if (message) this.hud.toast(message);
  }

  /** Back aboard: sailing controls, camera and HUD. */
  private toSea(message: string): void {
    this.controls.setMode('sea');
    this.rig.setRange(25, 150, 90);
    this.landView.setVisible(false);
    this.orders.sails = 0;
    this.showPanels();
    if (message) this.hud.toast(message);
  }

  /** The HUD for wherever the captain is: the sailing panels, or the on-foot hotbar. */
  private showPanels(): void {
    const ashore = this.land.walker !== null;
    this.hud.setPanels(!ashore);
    this.footHud.setVisible(ashore);
    this.labels.setVisible(!ashore);
  }

  /** Tool work and building on land, as dust and messages. */
  private handleLand(_time: number): void {
    for (const e of this.land.takeEvents()) {
      if (e.kind === 'work') this.effects.emit(e.action === 'fell' ? 'splinters' : 'dust', e.x + 0.5, e.y + 0.5, e.z + 0.5, 0, 0, 0.4);
      if (e.kind === 'built' || e.kind === 'razed') this.effects.emit('dust', e.x + 0.5, e.y + 0.5, e.z + 0.5, 0, 0, 1);
    }
  }

  private openChart(): void {
    this.openMenu(() =>
      this.overlay.show(
        'chart',
        createElement(ChartScreen, { ...this.chartProps(), economy: this.economy, sea: this.sea, close: this.closeChart, nav: this.overlay.handlers }),
      ),
    );
  }

  private readonly closeChart = () => this.closeMenu();

  private openMenu(show: () => void): void {
    this.screen = show;
    show();
    this.controls.setMode('menu');
    this.hud.setVisible(false);
    this.labels.setVisible(false);
    this.footHud.setVisible(false);
  }

  private closeMenu(): void {
    this.screen = null;
    this.overlay.hide();
    this.controls.setMode(this.land.walker ? 'foot' : 'sea');
    this.hud.setVisible(true);
    this.showPanels();
  }

  /** Boarders away: the captains meet on the prize's deck. */
  private startDuel(vesselId: number): void {
    const enemy = this.sea.vessel(vesselId);
    const ship = this.fleet.view(vesselId);
    if (!enemy || !ship) {
      this.sea.finishBoarding(false);
      return;
    }
    const player = this.sea.player;
    const [side] = toLocal(enemy, player.ship.x, player.ship.z);
    const cast: DuelCast = {
      player: this.captains.get('player')!,
      enemy: this.captains.get(enemy.faction === 'player' ? 'pirate' : enemy.faction)!,
    };
    const seed = Math.floor(this.sea.random() * 2 ** 31);
    this.duel = new DuelScene(player, enemy, ship, side, cast, seed, this.duelHud, this.effects, this.rig, this.container);
    this.controls.setMode('duel');
    this.hud.setVisible(false);
    this.labels.setVisible(false);
  }

  private endDuel(won: boolean): void {
    this.duel?.dispose();
    this.duel = null;
    this.sea.finishBoarding(won);
    this.controls.setMode('sea');
    this.hud.setVisible(true);
    this.labels.setVisible(true);
  }

  private duelIntent(): DuelIntent {
    const c = this.controls;
    const attack = c.take('light') ? 'light' : c.take('heavy') ? 'heavy' : c.take('thrust') ? 'thrust' : c.take('kick') ? 'kick' : null;
    return { move: c.rudder, block: c.block, attack, roll: c.take('roll') > 0 };
  }

  /** The closest other ship still in the fight, if one is near enough to frame. */
  private nearestThreat(x: number, z: number): Vector3 | null {
    let best: Vector3 | null = null;
    let bestDistance = FRAME_RANGE;
    for (const v of this.sea.vessels) {
      if (v.faction === 'player' || v.status === 'sinking' || v.status === 'captured') continue;
      const pose = this.fleet.pose(v.id);
      if (!pose) continue;
      const d = Math.hypot(pose.x - x, pose.z - z);
      if (d < bestDistance) {
        bestDistance = d;
        best = this.threat.set(pose.x, WATER_LEVEL, pose.z);
      }
    }
    return best;
  }

  private combatReadout(): CombatReadout {
    const p = this.sea.player;
    const type = p.cls.type;
    const loaded = (side: Side) => 1 - p.reload[side] / reloadTime(p);
    return {
      hull: p.hull,
      sails: p.sails,
      crew: p.crew,
      hullFraction: p.hull / type.hull,
      sailsFraction: p.sails / type.sails,
      crewFraction: p.crew / type.crew,
      ammo: p.ammo,
      port: loaded('port'),
      starboard: loaded('starboard'),
      boardable: this.sea.boardingTarget()?.name ?? null,
      sinking: p.status === 'sinking' || p.status === 'captured',
      gold: this.sea.captain.gold,
      cargo: cargoCount(p.cargo),
      hold: type.hold,
      dock: this.dockPrompt(),
      standing: this.sea.captain.standing,
    };
  }

  /** What the harbour you're in says about going alongside. */
  private dockPrompt(): string | null {
    const port = this.sea.harbour();
    if (!port || this.sea.player.status !== 'afloat') return null;
    const problem = this.sea.dockProblem(port);
    if (problem === 'closed') return `${port.name} is closed to you`;
    if (problem === 'fast') return `Take in sail to go alongside at ${port.name}`;
    if (problem === 'enemies') return 'Enemies close: shake them off to dock';
    return `B / 🎮 B: go ashore at ${port.name}`;
  }

  private shipLabels(): ShipLabel[] {
    const player = this.sea.player.ship;
    const labels: ShipLabel[] = [];
    for (const v of this.sea.vessels) {
      if (v.faction === 'player' || v.status === 'captured') continue;
      const pose = this.fleet.pose(v.id);
      if (!pose || Math.hypot(pose.x - player.x, pose.z - player.z) > LABEL_RANGE) continue;
      const mode = v.status === 'struck' ? 'struck her colours' : v.status === 'sinking' ? 'sinking' : v.ai?.mode;
      const note = { flee: 'fleeing', engage: 'engaging', escort: 'escorting', cruise: 'under way' }[mode as string] ?? mode ?? '';
      labels.push({
        id: v.id,
        x: pose.x,
        y: WATER_LEVEL + v.cls.body.top + 2,
        z: pose.z,
        name: v.name,
        faction: v.faction,
        hull: v.hull / v.cls.type.hull,
        note,
      });
    }
    return labels;
  }

  private navReadout(wind: Wind, fx: number, fz: number, x: number, z: number): NavReadout {
    const s = Math.sin(this.rig.yaw);
    const c = Math.cos(this.rig.yaw);
    // Screen angle, clockwise from up, of a world direction.
    const onScreen = (dx: number, dz: number) => Math.atan2(dx * c - dz * s, -dx * s - dz * c);
    const fromBearing = Math.atan2(-wind.dirX, wind.dirZ); // clockwise from north (-z)
    const point = Math.round((((fromBearing / (Math.PI * 2)) * 16) % 16) + 16) % 16;
    const ship = this.sea.player.ship;
    return {
      windAngle: onScreen(wind.dirX, wind.dirZ),
      headingAngle: onScreen(fx, fz),
      northAngle: onScreen(0, -1),
      windKnots: wind.strength * 15,
      windFrom: COMPASS_POINTS[point],
      conditions: conditions(wind),
      speedKnots: Math.abs(ship.surge),
      pointOfSail: pointOfSailName(angleOffWind(fx, fz, wind)),
      sails: this.orders.sails,
      grounded: ship.grounded,
      region: REGION_NAMES[regionTier(x, z)],
      ...this.portPointer(x, z, onScreen),
    };
  }

  /** The compass's gold pointer: to the port on the chart's course, or else the nearest. */
  private portPointer(x: number, z: number, onScreen: (dx: number, dz: number) => number): Pick<NavReadout, 'portAngle' | 'portText'> {
    const nearest = this.ports.reduce((a, b) => (Math.hypot(b.x - x, b.z - z) < Math.hypot(a.x - x, a.z - z) ? b : a));
    const port = this.course ?? nearest;
    const dx = port.x - x;
    const dz = port.z - z;
    const distance = Math.hypot(dx, dz);
    if (distance < 60 && !this.course) return { portAngle: null, portText: `In ${port.name}'s waters` };
    const point = COMPASS_POINTS[Math.round((((Math.atan2(dx, -dz) / (Math.PI * 2)) * 16) % 16) + 16) % 16];
    return { portAngle: onScreen(dx, dz), portText: `${this.course ? 'Course for' : 'Nearest port:'} ${port.name} · ${Math.round(distance)} ${point}` };
  }

  private readonly onResize = () => {
    const { clientWidth: width, clientHeight: height } = this.container;
    this.renderer.setSize(width, height);
    this.rig.setAspect(width / height);
  };
}

async function load(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't load ${url} (${response.status})`);
  return response.arrayBuffer();
}

const nextAmmo = (ammo: Ammo): Ammo => AMMO_TYPES[(AMMO_TYPES.indexOf(ammo) + 1) % AMMO_TYPES.length];

const article = (name: string) => (/^[AEIOU]/i.test(name) ? 'An' : 'A');

function escorted(sea: Sea, group: number): string {
  const escorts = sea.vessels.filter((v) => v.group === group && v.ai?.leader !== null).length;
  return escorts > 0 ? `, with ${escorts} escort${escorts > 1 ? 's' : ''}` : '';
}

function conditions(wind: Wind): string {
  if (wind.squall > 0.5) return 'Squall: strong, shifting wind';
  if (wind.squall > 0.2) return 'Squally';
  if (wind.calm > 0.5) return 'Becalmed';
  if (wind.calm > 0.2) return 'Light airs';
  if (wind.strength < 0.6) return 'Light breeze';
  return wind.strength < 1.05 ? 'Trade wind' : 'Fresh wind';
}

