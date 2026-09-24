import { Color, Fog, NeutralToneMapping, PCFShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
import { type Ammo, AMMO_TYPES } from './combat/ammo';
import { REGION_NAMES, regionTier } from './combat/encounters';
import { type PlayerOrders, Sea, type SeaEvent } from './combat/sea';
import { reloadTime, type ShipClass, shipClass, type Side } from './combat/vessel';
import { SIM_HZ } from './config';
import { Controls } from './core/Controls';
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
import { hullContacts } from './sailing/ship';
import { buildShipModel, type ShipModel } from './sailing/shipModel';
import { SHIP_TYPES, SLOOP, type ShipType } from './sailing/ships';
import { Weather, type Wind } from './sailing/weather';
import { TerrainTool } from './tools/TerrainTool';
import { type CombatReadout, Hud, type NavReadout } from './ui/Hud';
import { type ShipLabel, ShipLabels } from './ui/ShipLabels';
import { parseVox } from './vox/parseVox';
import { VoxelWorld } from './voxel/VoxelWorld';
import { generateIsland } from './worldgen/island';

const WORLD_SEED = 1717;
const SKY_COLOR = new Color(0xa9d9ea);
const STORM_COLOR = new Color(0x74879a);
/** Chunks remeshed per frame after startup (~2-3 ms each). */
const REMESH_BUDGET = 2;
/** Seconds of travel the camera looks ahead of the ship, so you see where you're going. */
const LOOK_AHEAD = 0.8;
/** Just offshore of the island's south-east beach, heading out on a reach. */
const START = { x: 44, z: 50, heading: Math.atan2(0.38, 0.92) };
const LABEL_RANGE = 220;
/**
 * In a fight the camera also frames the nearest enemy within FRAME_RANGE, shifting
 * FRAME_SHARE of the way toward her, but never more than FRAME_MAX_SHIFT so your
 * own ship stays well on screen.
 */
const FRAME_RANGE = 100;
const FRAME_SHARE = 0.4;
const FRAME_MAX_SHIFT = 22;
const COMPASS_POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

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
  readonly sea: Sea;
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
  private readonly wakes = new WakePool();
  private readonly streaks: WindStreaks;
  private readonly effects = new Effects();
  private readonly fleet: FleetView;
  private readonly shots = new ShotsView();
  private readonly barrels = new BarrelsView();
  private readonly arcs = new RangeArcs();
  private readonly tool: TerrainTool;
  private readonly hud: Hud;
  private readonly labels: ShipLabels;
  private readonly loop: GameLoop;

  /** Standing orders from the helm: canvas and shot type persist between key presses. */
  private readonly orders: PlayerOrders = { rudder: 0, sails: 0, ammo: 'round', fire: [], board: false };
  private readonly cameraTarget = new Vector3();
  private readonly threat = new Vector3();

  /** Loads the ship art, then builds the game. */
  static async create(container: HTMLElement): Promise<Game> {
    const models = new Map<ShipType, ShipModel>();
    const files = new Map<string, Promise<ArrayBuffer>>();
    for (const type of SHIP_TYPES) {
      if (!files.has(type.model)) files.set(type.model, load(`${import.meta.env.BASE_URL}${type.model}`));
      models.set(type, buildShipModel(parseVox(await files.get(type.model)!), type.draft));
    }
    return new Game(container, models);
  }

  private constructor(
    private readonly container: HTMLElement,
    models: Map<ShipType, ShipModel>,
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

    generateIsland(this.world, { seed: WORLD_SEED, centerX: 0, centerZ: 0, radius: 58, peak: 22 });
    const seabed = new SeabedMap(this.world, -128, -128, 256);

    const classes = new Map<ShipType, ShipClass>();
    for (const [type, model] of models) classes.set(type, shipClass(type, model.outline, model.deck, model.top));
    this.sea = new Sea(this.world, this.weather, classes, SLOOP, this.openWater(classes.get(SLOOP)!, START), WORLD_SEED);

    this.input = new Input(this.renderer.domElement);
    this.controls = new Controls(this.input);
    this.rig = new CameraRig(container.clientWidth / container.clientHeight);
    this.sun = new Sun(this.scene);
    this.terrain = new ChunkRenderer(this.world);
    this.ocean = new OceanRenderer(seabed, this.wakes);
    this.streaks = new WindStreaks(this.weather);
    this.fleet = new FleetView(models, this.wakes, this.effects, this.arcs);
    this.tool = new TerrainTool(this.world, this.rig.camera);
    this.hud = new Hud(container);
    this.labels = new ShipLabels(container);
    this.scene.add(
      this.terrain.group,
      this.ocean.group,
      this.fleet.group,
      this.shots.mesh,
      this.barrels.mesh,
      this.effects.mesh,
      this.streaks.mesh,
      this.tool.highlight,
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

  start(): void {
    this.terrain.update(Infinity); // mesh the whole island before the first frame
    this.rig.snapTo(this.cameraTarget.set(this.ship.x, WATER_LEVEL, this.ship.z));
    this.hud.toast('Raise sail with W and go find a prize.');
    this.loop.start();
  }

  private update(dt: number): void {
    const { controls, orders } = this;
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
    orders.board = controls.take('board') > 0;

    this.sea.step(dt, orders);
    if (this.sea.player.status !== 'afloat') orders.sails = 0;
  }

  private render(alpha: number, frameSeconds: number): void {
    const { controls, rig, sea } = this;
    const player = sea.player;

    // Camera controls are presentation only, so they run per frame rather than per sim step.
    for (let n = controls.take('rotateLeft'); n > 0; n--) rig.rotate(-1);
    for (let n = controls.take('rotateRight'); n > 0; n--) rig.rotate(1);
    rig.zoom(controls.takeZoom(frameSeconds));

    // The rendered moment trails the latest sim step by (1 - alpha) of a step.
    const behind = (1 - alpha) * this.loop.step;
    const time = sea.time - behind;
    this.handleEvents(sea.takeEvents(), time);
    this.fleet.update(sea, alpha, time, frameSeconds);

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
    rig.update(this.cameraTarget, frameSeconds);

    // Squalls darken the sky and the light.
    const overhead = this.weather.windAt(rig.focus.x, rig.focus.z, time);
    this.sky.lerpColors(SKY_COLOR, STORM_COLOR, overhead.squall);
    this.sun.setOvercast(overhead.squall);
    this.sun.follow(rig.focus, rig.distance);
    this.fog.near = rig.distance * 1.4;
    this.fog.far = rig.distance * 3.5;

    this.terrain.update(REMESH_BUDGET);
    this.wakes.update(time);
    this.ocean.update(time, rig.focus);
    this.streaks.update(rig.focus, rig.distance * 0.9, time, frameSeconds);
    this.shots.update(sea.shots, behind);
    this.barrels.update(sea.barrels, time);
    this.arcs.update(player);
    this.effects.update(frameSeconds);
    this.tool.update(this.input);

    this.renderer.render(this.scene, rig.camera);
    const wind = this.weather.windAt(pose.x, pose.z, time);
    this.hud.setGamepadConnected(controls.gamepadConnected);
    this.hud.setNav(this.navReadout(wind, fx, fz, pose.x, pose.z));
    this.hud.setCombat(this.combatReadout());
    this.labels.update(this.shipLabels(), rig.camera, this.container.clientWidth, this.container.clientHeight);
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
        case 'captured':
          this.hud.toast(`The ${e.name} is ours! ${e.joined > 0 ? `${e.joined} of her crew sign on.` : 'No room aboard for any of her crew.'}`, 'good');
          break;
        case 'repelled':
          this.hud.toast(`Boarders repelled by the ${e.name}: ${e.lost} of your crew lost.`, 'bad');
          break;
        case 'overrun':
          this.hud.toast('Your last hands have fallen and the enemy swarms aboard!', 'bad');
          break;
        case 'respawn':
          this.hud.toast('You wash ashore at home, and a new sloop is found for you.', 'info');
          this.rig.snapTo(this.cameraTarget.set(this.ship.x, WATER_LEVEL, this.ship.z));
          break;
      }
    }
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
    };
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
    };
  }

  /** Slides a spawn point away from the island until a ship of this class (with sea room) touches nothing. */
  private openWater(cls: ShipClass, start: typeof START): typeof START {
    const spot = { ...start };
    const length = Math.hypot(spot.x, spot.z) || 1;
    const clear = () =>
      [-2, 0, 2].every((d) => hullContacts(this.world, cls.spec, spot.x + (d * spot.x) / length, spot.z + (d * spot.z) / length, spot.heading) === 0);
    for (let i = 0; i < 100 && !clear(); i++) {
      spot.x += spot.x / length;
      spot.z += spot.z / length;
    }
    return spot;
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

