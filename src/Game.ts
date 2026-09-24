import { Color, Fog, NeutralToneMapping, PCFShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
import { SIM_HZ } from './config';
import { GameLoop } from './core/GameLoop';
import { Input } from './core/Input';
import { SeabedMap } from './ocean/SeabedMap';
import { waterSurfaceY } from './ocean/waves';
import { createBuoy } from './render/buoy';
import { CameraRig } from './render/CameraRig';
import { ChunkRenderer } from './render/ChunkRenderer';
import { OceanRenderer } from './render/OceanRenderer';
import { Sun } from './render/Sun';
import { TerrainTool } from './tools/TerrainTool';
import { Hud } from './ui/Hud';
import { VoxelWorld } from './voxel/VoxelWorld';
import { generateIsland } from './worldgen/island';

const SKY_COLOR = 0xa9d9ea;
/** Chunks remeshed per frame after startup (~2-3 ms each). */
const REMESH_BUDGET = 2;
/** Focus pan speed in voxels per second. */
const PAN_SPEED = 28;
/** Just offshore of the island's south-east beach. */
const START = new Vector3(44, 0, 50);

/**
 * Composition root: builds the world, wires simulation to rendering, runs the loop.
 *
 * What goes where: state that must be saved, replayed or kept deterministic lives in
 * `sim` and changes only in update(). Everything render() touches is derived from it
 * and could be thrown away and rebuilt.
 */
export class Game {
  readonly world = new VoxelWorld();
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly fog = new Fog(SKY_COLOR, 100, 300);
  private readonly input: Input;
  private readonly rig: CameraRig;
  private readonly sun: Sun;
  private readonly terrain: ChunkRenderer;
  private readonly ocean: OceanRenderer;
  private readonly buoy = createBuoy();
  private readonly tool: TerrainTool;
  private readonly hud: Hud;
  private readonly loop: GameLoop;

  /** Simulation state, advanced only in fixed steps. */
  private readonly sim = {
    time: 0,
    focus: START.clone(),
    prevFocus: START.clone(),
  };
  private readonly renderFocus = new Vector3();

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.toneMapping = NeutralToneMapping; // keeps the palette's hues, unlike ACES
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(SKY_COLOR);
    this.scene.fog = this.fog;

    generateIsland(this.world, { seed: 1717, centerX: 0, centerZ: 0, radius: 58, peak: 22 });
    const seabed = new SeabedMap(this.world, -128, -128, 256);

    this.input = new Input(this.renderer.domElement);
    this.rig = new CameraRig(container.clientWidth / container.clientHeight);
    this.sun = new Sun(this.scene);
    this.terrain = new ChunkRenderer(this.world);
    this.ocean = new OceanRenderer(seabed);
    this.tool = new TerrainTool(this.world, this.rig.camera);
    this.hud = new Hud(container);
    this.scene.add(this.terrain.group, this.ocean.group, this.buoy, this.tool.highlight);

    this.loop = new GameLoop({ update: (dt) => this.update(dt), render: (a, s) => this.render(a, s) }, SIM_HZ);
    window.addEventListener('resize', this.onResize);
  }

  start(): void {
    this.terrain.update(Infinity); // mesh the whole island before the first frame
    this.rig.snapTo(this.restingPoint(this.sim.focus, 0, this.renderFocus));
    this.loop.start();
  }

  private update(dt: number): void {
    const { sim, input } = this;
    sim.time += dt;
    sim.prevFocus.copy(sim.focus);

    // WASD is screen-relative, whichever way the camera faces.
    const forward = (input.isHeld('KeyW') ? 1 : 0) - (input.isHeld('KeyS') ? 1 : 0);
    const strafe = (input.isHeld('KeyD') ? 1 : 0) - (input.isHeld('KeyA') ? 1 : 0);
    if (forward || strafe) {
      const axes = this.rig.groundAxes();
      const boost = input.isHeld('ShiftLeft') || input.isHeld('ShiftRight') ? 2.5 : 1;
      const step = (PAN_SPEED * boost * dt) / Math.hypot(forward, strafe);
      sim.focus.x += (axes.forwardX * forward + axes.rightX * strafe) * step;
      sim.focus.z += (axes.forwardZ * forward + axes.rightZ * strafe) * step;
    }
  }

  private render(alpha: number, frameSeconds: number): void {
    const { input, rig, sim } = this;

    // Camera controls are presentation only, so they run per frame rather than per sim step.
    if (input.wasPressed('KeyQ')) rig.rotate(-1);
    if (input.wasPressed('KeyE')) rig.rotate(1);
    rig.zoom(input.takeWheel());

    // Interpolate between the last two sim steps so motion is smooth at any refresh rate.
    const time = sim.time - (1 - alpha) * this.loop.step;
    this.renderFocus.lerpVectors(sim.prevFocus, sim.focus, alpha);
    this.restingPoint(this.renderFocus, time, this.renderFocus);
    this.buoy.position.copy(this.renderFocus);

    rig.update(this.renderFocus, frameSeconds);
    this.sun.follow(rig.focus, rig.distance);
    this.fog.near = rig.distance * 1.4;
    this.fog.far = rig.distance * 3.5;

    this.terrain.update(REMESH_BUDGET);
    this.ocean.update(time, rig.focus);
    this.tool.update(input);

    this.renderer.render(this.scene, rig.camera);
    this.hud.frame(frameSeconds, () => ({
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      chunks: this.terrain.meshCount,
    }));
    input.endFrame();
  }

  /** Where something at (x, z) rests: on the water surface, or on the ground where that is higher. */
  private restingPoint(p: Vector3, time: number, out: Vector3): Vector3 {
    const ground = this.world.surfaceHeight(Math.floor(p.x), Math.floor(p.z));
    return out.set(p.x, Math.max(waterSurfaceY(p.x, p.z, time), ground), p.z);
  }

  private readonly onResize = () => {
    const { clientWidth: width, clientHeight: height } = this.container;
    this.renderer.setSize(width, height);
    this.rig.setAspect(width / height);
  };
}
