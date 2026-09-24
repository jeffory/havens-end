import { Color, Fog, NeutralToneMapping, PCFShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
import { SIM_HZ } from './config';
import { Controls } from './core/Controls';
import { GameLoop } from './core/GameLoop';
import { Input } from './core/Input';
import { SeabedMap } from './ocean/SeabedMap';
import { WATER_LEVEL } from './ocean/waves';
import { CameraRig } from './render/CameraRig';
import { ChunkRenderer } from './render/ChunkRenderer';
import { OceanRenderer } from './render/OceanRenderer';
import { type ShipPose, ShipView } from './render/ShipView';
import { Sun } from './render/Sun';
import { Wake } from './render/Wake';
import { WindStreaks } from './render/WindStreaks';
import { angleOffWind, pointOfSailName } from './sailing/pointOfSail';
import { createShip, hullContacts, type ShipSpec, type ShipState, stepShip } from './sailing/ship';
import { buildShipModel, type ShipModel } from './sailing/shipModel';
import { SLOOP, type ShipType } from './sailing/ships';
import { Weather, type Wind } from './sailing/weather';
import { TerrainTool } from './tools/TerrainTool';
import { Hud } from './ui/Hud';
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
const COMPASS_POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/**
 * Composition root: builds the world, wires simulation to rendering, runs the loop.
 *
 * What goes where: state that must be saved, replayed or kept deterministic lives in
 * `sim` and changes only in update(). Everything render() touches is derived from it
 * and could be thrown away and rebuilt.
 */
export class Game {
  readonly world = new VoxelWorld();
  readonly weather = new Weather({ seed: WORLD_SEED });
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
  private readonly wake = new Wake();
  private readonly streaks: WindStreaks;
  private readonly shipView: ShipView;
  private readonly tool: TerrainTool;
  private readonly hud: Hud;
  private readonly loop: GameLoop;
  private readonly spec: ShipSpec;

  /** Simulation state, advanced only in fixed steps. */
  private readonly sim: {
    time: number;
    ship: ShipState;
    /** Pose at the previous step, for render interpolation. */
    prev: ShipPose;
    /** Canvas the helm has ordered: 0, 0.5 or 1. */
    sails: number;
  };
  private readonly pose: ShipPose = { x: 0, z: 0, heading: 0 };
  private readonly cameraTarget = new Vector3();

  /** Loads the ship art, then builds the game. */
  static async create(container: HTMLElement, type: ShipType = SLOOP): Promise<Game> {
    const url = `${import.meta.env.BASE_URL}${type.model}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Couldn't load ${url} (${response.status})`);
    return new Game(container, type, buildShipModel(parseVox(await response.arrayBuffer()), type.draft));
  }

  private constructor(
    private readonly container: HTMLElement,
    type: ShipType,
    model: ShipModel,
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

    this.spec = { ...type, outline: model.outline };
    const ship = createShip(START.x, START.z, START.heading);
    this.moveToOpenWater(ship);
    this.sim = { time: 0, ship, prev: { x: ship.x, z: ship.z, heading: ship.heading }, sails: 0 };

    this.input = new Input(this.renderer.domElement);
    this.controls = new Controls(this.input);
    this.rig = new CameraRig(container.clientWidth / container.clientHeight);
    this.sun = new Sun(this.scene);
    this.terrain = new ChunkRenderer(this.world);
    this.ocean = new OceanRenderer(seabed, this.wake.points);
    this.streaks = new WindStreaks(this.weather);
    this.shipView = new ShipView(model);
    this.tool = new TerrainTool(this.world, this.rig.camera);
    this.hud = new Hud(container);
    this.scene.add(this.terrain.group, this.ocean.group, this.shipView.root, this.streaks.mesh, this.tool.highlight);

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

  get ship(): Readonly<ShipState> {
    return this.sim.ship;
  }

  start(): void {
    this.terrain.update(Infinity); // mesh the whole island before the first frame
    this.rig.snapTo(this.cameraTarget.set(this.sim.ship.x, WATER_LEVEL, this.sim.ship.z));
    this.loop.start();
  }

  private update(dt: number): void {
    const { sim, controls } = this;
    const ship = sim.ship;
    sim.time += dt;
    sim.prev.x = ship.x;
    sim.prev.z = ship.z;
    sim.prev.heading = ship.heading;

    const sailSteps = controls.take('sailUp') - controls.take('sailDown');
    sim.sails = Math.min(1, Math.max(0, sim.sails + sailSteps * 0.5));
    const wind = this.weather.windAt(ship.x, ship.z, sim.time);
    stepShip(ship, this.spec, { rudder: controls.rudder, sails: sim.sails }, wind, this.world, dt);
  }

  private render(alpha: number, frameSeconds: number): void {
    const { controls, rig, sim, pose } = this;
    const ship = sim.ship;

    // Camera controls are presentation only, so they run per frame rather than per sim step.
    for (let n = controls.take('rotateLeft'); n > 0; n--) rig.rotate(-1);
    for (let n = controls.take('rotateRight'); n > 0; n--) rig.rotate(1);
    rig.zoom(controls.takeZoom(frameSeconds));

    // Interpolate between the last two sim steps so motion is smooth at any refresh rate.
    const time = sim.time - (1 - alpha) * this.loop.step;
    pose.x = sim.prev.x + (ship.x - sim.prev.x) * alpha;
    pose.z = sim.prev.z + (ship.z - sim.prev.z) * alpha;
    pose.heading = sim.prev.heading + wrapAngle(ship.heading - sim.prev.heading) * alpha;
    const wind = this.weather.windAt(pose.x, pose.z, time);
    this.shipView.update(pose, ship, wind, time, frameSeconds);

    const fx = Math.sin(pose.heading);
    const fz = Math.cos(pose.heading);
    const lead = Math.min(12, Math.abs(ship.surge) * LOOK_AHEAD) * Math.sign(ship.surge);
    rig.update(this.cameraTarget.set(pose.x + fx * lead, WATER_LEVEL, pose.z + fz * lead), frameSeconds);

    // Squalls darken the sky and the light.
    const overhead = this.weather.windAt(rig.focus.x, rig.focus.z, time);
    this.sky.lerpColors(SKY_COLOR, STORM_COLOR, overhead.squall);
    this.sun.setOvercast(overhead.squall);
    this.sun.follow(rig.focus, rig.distance);
    this.fog.near = rig.distance * 1.4;
    this.fog.far = rig.distance * 3.5;

    this.terrain.update(REMESH_BUDGET);
    const stern = this.shipView.model.stern;
    const wakeStrength = ship.surge > 1 ? 0.45 + (0.55 * ship.surge) / this.spec.topSpeed : 0;
    this.wake.update(time, pose.x + fx * stern, pose.z + fz * stern, wakeStrength);
    this.ocean.update(time, rig.focus);
    this.streaks.update(rig.focus, rig.distance * 0.9, time, frameSeconds);
    this.tool.update(this.input);

    this.renderer.render(this.scene, rig.camera);
    this.hud.setGamepadConnected(controls.gamepadConnected);
    this.hud.setNav(this.navReadout(wind, fx, fz));
    this.hud.frame(frameSeconds, () => ({
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      chunks: this.terrain.meshCount,
    }));
    this.input.endFrame();
  }

  private navReadout(wind: Wind, fx: number, fz: number) {
    const s = Math.sin(this.rig.yaw);
    const c = Math.cos(this.rig.yaw);
    // Screen angle, clockwise from up, of a world direction.
    const onScreen = (dx: number, dz: number) => Math.atan2(dx * c - dz * s, -dx * s - dz * c);
    const fromBearing = Math.atan2(-wind.dirX, wind.dirZ); // clockwise from north (-z)
    const point = Math.round((((fromBearing / (Math.PI * 2)) * 16) % 16) + 16) % 16;
    return {
      windAngle: onScreen(wind.dirX, wind.dirZ),
      headingAngle: onScreen(fx, fz),
      northAngle: onScreen(0, -1),
      windKnots: wind.strength * 15,
      windFrom: COMPASS_POINTS[point],
      conditions: conditions(wind),
      speedKnots: Math.abs(this.sim.ship.surge),
      pointOfSail: pointOfSailName(angleOffWind(fx, fz, wind)),
      sails: this.sim.sails,
      grounded: this.sim.ship.grounded,
    };
  }

  /** Nudges a ship away from the island until its hull (with a little sea room) touches nothing. */
  private moveToOpenWater(ship: ShipState): void {
    const length = Math.hypot(ship.x, ship.z) || 1;
    const clear = () =>
      [-2, 0, 2].every((d) => hullContacts(this.world, this.spec, ship.x + (d * ship.x) / length, ship.z + (d * ship.z) / length, ship.heading) === 0);
    for (let i = 0; i < 100 && !clear(); i++) {
      ship.x += ship.x / length;
      ship.z += ship.z / length;
    }
  }

  private readonly onResize = () => {
    const { clientWidth: width, clientHeight: height } = this.container;
    this.renderer.setSize(width, height);
    this.rig.setAspect(width / height);
  };
}

function conditions(wind: Wind): string {
  if (wind.squall > 0.5) return 'Squall: strong, shifting wind';
  if (wind.squall > 0.2) return 'Squally';
  if (wind.calm > 0.5) return 'Becalmed';
  if (wind.calm > 0.2) return 'Light airs';
  if (wind.strength < 0.6) return 'Light breeze';
  return wind.strength < 1.05 ? 'Trade wind' : 'Fresh wind';
}

const wrapAngle = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
