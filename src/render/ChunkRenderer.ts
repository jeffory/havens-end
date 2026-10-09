import { Color, Group, Mesh, MeshDepthMaterial, MeshLambertMaterial, type WebGLProgramParametersWithUniforms, Vector4 } from 'three';
import { glslFloat, WATER_LEVEL } from '../ocean/waves';
import { BLOCK_PALETTE, type BlockId } from '../voxel/blocks';
import type { Chunk } from '../voxel/Chunk';
import { CHUNK_SIZE } from '../voxel/Chunk';
import { buildPaddedVolume, meshPaddedVolume, PADDED } from '../voxel/mesher';
import { FLAG_CUTAWAY } from '../voxel/palette';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { type Eye, LIFT_GLSL, type Lift, Lifts } from './lifts';
import { toGeometry } from './voxelGeometry';

/** The colour land is marked out in: a warm red, "not yours". */
const ZONE_COLOR = 0xe0583a;

/**
 * GLSL, the vertex shader's part of cutting away what's lifted: the block a vertex's face
 * belongs to, found a quarter block in from the vertex's corner of it (see the mesher's
 * corners), so every fragment of the face finds its own block, its edges too, never the
 * neighbour's; and whether the block may be cut away (flag 1).
 */
const CUT_VERTEX_PARS = 'attribute float flags;\nattribute float corner;\nvarying vec3 vCell;\nvarying float vCutaway;';
const CUT_VERTEX = /* glsl */ `
vec3 high = mod(floor(vec3(corner) / vec3(1.0, 2.0, 4.0)), 2.0);
vCell = (modelMatrix * vec4(transformed + 0.25 - 0.5 * high, 1.0)).xyz;
vCutaway = mod(flags, 2.0);`;
/**
 * GLSL, the fragment shader's part: roofs, upper storeys and canopies in the captain's way lift
 * away whole, block by block; only trees and buildings (the ground is solid inside, and would
 * show hollow).
 */
const CUT_FRAGMENT_PARS = `${LIFT_GLSL}\nvarying vec3 vCell;\nvarying float vCutaway;`;
const CUT_FRAGMENT = 'if (vCutaway > 0.5 && lifted(floor(vCell) + 0.5)) discard;';

/** Puts the cut into a terrain material's shaders, the lifts' uniforms shared. */
function cutAway(shader: WebGLProgramParametersWithUniforms, lifts: Lifts): void {
  Object.assign(shader.uniforms, lifts.uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${CUT_VERTEX_PARS}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${CUT_VERTEX}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${CUT_FRAGMENT_PARS}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${CUT_FRAGMENT}`);
}

/**
 * Keeps one Three.js mesh per non-empty chunk in sync with the voxel data. It never
 * owns game state: it only reacts to chunks the world has marked dirty.
 */
export class ChunkRenderer {
  readonly group = new Group();
  private readonly meshes = new Map<Chunk, Mesh>();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  /** The terrain as the sun sees it, for shadows: what's lifted away casts none. */
  private readonly depthMaterial = new MeshDepthMaterial();
  private readonly scratch = new Uint8Array(PADDED ** 3);
  /** What's lifted away on foot: shared with the props hung on buildings. */
  readonly lifts = new Lifts();
  /** How brightly embers, lanterns and windows glow: faintly by day, strongly at night. */
  private readonly glow = { value: 0.2 };
  /** Land marked out on the ground (a town's): centre x, z, radius, and how strongly it shows (0 = not at all). */
  private readonly zone = { value: new Vector4(0, 0, 0, 0) };
  private readonly zoneColor = { value: new Color(ZONE_COLOR) };
  /** Seconds, to move the caustics on the seabed. */
  private readonly time = { value: 0 };

  constructor(private readonly world: VoxelWorld) {
    this.group.name = 'terrain';
    this.material.onBeforeCompile = (shader) => {
      cutAway(shader, this.lifts);
      shader.uniforms.uGlow = this.glow;
      shader.uniforms.uZone = this.zone;
      shader.uniforms.uZoneColor = this.zoneColor;
      shader.uniforms.uTime = this.time;
      // Block flags (see voxel/palette.ts): 1 = may be cut away, 2 = glows.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;\nvarying float vGlow;\nvarying float vUp;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGlow = step(1.5, flags);\nvUp = normalize(mat3(modelMatrix) * objectNormal).y;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
uniform float uGlow;
uniform vec4 uZone;
uniform vec3 uZoneColor;
uniform float uTime;
varying vec3 vCutWorld;
varying float vGlow;
varying float vUp;
/** Light focused by the swell onto the seabed: a drifting web of bright lines, 0 to 1. */
float caustics(vec2 p, float t) {
  p = mod(p, 6.2831853) - 250.0;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float s = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(s - i.x) + sin(s + i.y), sin(s - i.y) + cos(s + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + s) / 0.005), p.y / (cos(i.y + s) / 0.005)));
  }
  c = 1.17 - pow(c / 4.0, 1.4);
  return pow(abs(c), 8.0);
}`,
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
// Marked-out land: stripes across the ground inside it, and a line along its edge.
float zoneEdge = 0.0;
if (uZone.w > 0.0) {
  float d = distance(vCutWorld.xz, uZone.xy);
  zoneEdge = (1.0 - smoothstep(0.0, 0.9, abs(d - uZone.z))) * uZone.w;
  float stripe = step(0.5, fract((vCutWorld.x + vCutWorld.z) * 0.2));
  float inside = step(d, uZone.z) * step(0.5, vUp) * (0.22 + 0.2 * stripe) * uZone.w;
  diffuseColor.rgb = mix(diffuseColor.rgb, uZoneColor, max(zoneEdge, inside));
}`,
        )
        .replace(
          '#include <lights_fragment_end>',
          /* glsl */ `#include <lights_fragment_end>
// Under the water, sunlight (and lamplight) dances on the seabed: brightest just under the surface,
// gone a few voxels down. In blocks, four to a voxel, to suit the rest of the world.
float under = ${glslFloat(WATER_LEVEL)} - vCutWorld.y;
if (under > 0.0) {
  vec2 spot = floor(vCutWorld.xz * 4.0) / 4.0;
  // Focused, not added: bright lines, dimmer between them, much the same light overall.
  float caustic = 3.5 * caustics(spot * 0.8, uTime * 0.6) - 0.35;
  reflectedLight.directDiffuse *= 1.0 + caustic * smoothstep(0.0, 0.5, under) * (1.0 - smoothstep(2.0, 8.0, under));
}`,
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * uGlow + uZoneColor * zoneEdge * 0.5;');
    };
    this.material.customProgramCacheKey = () => 'havens-end-terrain';
    this.depthMaterial.onBeforeCompile = (shader) => cutAway(shader, this.lifts);
    this.depthMaterial.customProgramCacheKey = () => 'havens-end-terrain-depth';
  }

  /** Marks out a circle of land on the ground (a town's), `amount` 0 to 1; null hides it. */
  setZone(zone: { x: number; z: number; radius: number; amount: number } | null): void {
    if (zone) this.zone.value.set(zone.x, zone.z, zone.radius, zone.amount);
    else this.zone.value.w = 0;
  }

  /** Moves the caustics on the seabed along. */
  setTime(seconds: number): void {
    // Wrapped so the shader's sines keep their precision; the pattern jumps once an hour, unnoticed.
    this.time.value = seconds % 3600;
  }

  /** How strongly glowing blocks light themselves: 0 not at all, ~2 on a dark night. */
  setGlow(amount: number): void {
    this.glow.value = amount;
  }

  /**
   * Lifts away the trees' and buildings' blocks in each box (on the grid, from x0, z0 up
   * to but not including x1, z1) from the height `from` up: roofs and canopies in the
   * captain's way, and a room's walls facing the camera (at `eye`) lower. An empty list
   * lifts nothing.
   */
  setLifts(lifts: ReadonlyArray<Lift>, eye: Eye): void {
    this.lifts.set(lifts, eye);
  }

  /** Is this voxel lifted away, so the mouse should pick through it? The shader's test, at the voxel's centre. */
  hides(x: number, y: number, z: number, id: BlockId): boolean {
    return ((BLOCK_PALETTE.flags?.[id] ?? 0) & FLAG_CUTAWAY) !== 0 && this.lifts.holds(x, y, z);
  }

  get meshCount(): number {
    return this.meshes.size;
  }

  /**
   * Rebuilds up to `budget` dirty chunks, nearest to `near` first when it's given. A
   * chunk costs ~2-3 ms to mesh, so a small per-frame budget keeps big edits (and the
   * far islands at startup) from stalling a frame.
   */
  update(budget: number, near?: { x: number; z: number }): number {
    const chunks = near ? this.world.takeDirtyNear(budget, near.x, near.z) : this.world.takeDirty(budget);
    for (const chunk of chunks) this.rebuild(chunk);
    return chunks.length;
  }

  private rebuild(chunk: Chunk): void {
    const { cx, cy, cz } = chunk;
    const data =
      chunk.filled > 0
        ? meshPaddedVolume(buildPaddedVolume(this.world, cx, cy, cz, this.scratch), cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE)
        : null;
    const existing = this.meshes.get(chunk);

    if (!data) {
      if (existing) {
        existing.geometry.dispose();
        this.group.remove(existing);
        this.meshes.delete(chunk);
      }
      return;
    }

    const geometry = toGeometry(data);

    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geometry;
      return;
    }
    const mesh = new Mesh(geometry, this.material);
    mesh.customDepthMaterial = this.depthMaterial;
    mesh.position.set(cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.meshes.set(chunk, mesh);
  }
}
