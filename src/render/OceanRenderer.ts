import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  RedFormat,
  UnsignedByteType,
  Vector4,
  type Vector3,
} from 'three';
import type { SeabedMap } from '../ocean/SeabedMap';
import { glslFloat, WATER_LEVEL, WAVE_AMPLITUDE, WAVE_GLSL, wavePhases } from '../ocean/waves';
import { WAKE_LIFETIME, WAKE_POINTS } from './Wake';

export const OCEAN_COLORS = {
  shallow: 0x86e8d8,
  mid: 0x25b5c6,
  deep: 0x0e5f94,
  foam: 0xf2fbff,
};

/**
 * The sea: a grid of 1×1 voxel water columns centred on the camera focus, animated in
 * the vertex shader, plus a flat plane beyond it out to the horizon. No water voxels
 * are stored, so the open sea costs nothing in memory and the map can be any size.
 */
export class OceanRenderer {
  readonly group = new Group();
  private readonly seabedTexture: DataTexture;
  private seabedVersion: number;
  private readonly uniforms;

  constructor(
    private readonly seabed: SeabedMap,
    /** Ship wake points (see Wake); shared objects, so the ocean always sees the latest. */
    wake: Vector4[],
    gridSize = 160,
  ) {
    this.group.name = 'ocean';
    this.seabedTexture = new DataTexture(seabed.heights, seabed.size, seabed.size, RedFormat, UnsignedByteType);
    this.seabedTexture.needsUpdate = true;
    this.seabedVersion = seabed.version;

    this.uniforms = {
      uWavePhase: { value: wavePhases(0) },
      uTime: { value: 0 },
      uSeabed: { value: this.seabedTexture },
      uSeabedRect: { value: new Vector4(seabed.originX, seabed.originZ, seabed.size, seabed.size) },
      uShallow: { value: new Color(OCEAN_COLORS.shallow) },
      uMid: { value: new Color(OCEAN_COLORS.mid) },
      uDeep: { value: new Color(OCEAN_COLORS.deep) },
      uFoam: { value: new Color(OCEAN_COLORS.foam) },
      uWake: { value: wake },
    };

    // Unit column whose top face sits at local y = 0; the shader lifts it by the wave height.
    const column = new BoxGeometry(1, 1, 1).translate(0, -0.5, 0);
    const water = new InstancedMesh(column, this.createWaterMaterial(), gridSize * gridSize);
    const matrix = new Matrix4();
    for (let row = 0, i = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++, i++) {
        water.setMatrixAt(i, matrix.makeTranslation(col - gridSize / 2 + 0.5, 0, row - gridSize / 2 + 0.5));
      }
    }
    water.frustumCulled = false; // always on screen; skips a per-frame bounds check
    water.receiveShadow = true;

    const openSea = new Mesh(
      squareFrameGeometry(gridSize / 2, 4000),
      new MeshStandardMaterial({ color: OCEAN_COLORS.deep, roughness: 0.3 }),
    );
    // Below the lowest wave, so looking across the grid's edge never shows a sliver of sky.
    openSea.position.y = -WAVE_AMPLITUDE - 0.05;
    openSea.receiveShadow = true;

    this.group.add(water, openSea);
    this.group.position.y = WATER_LEVEL;
  }

  update(time: number, focus: Vector3): void {
    // Move in whole cells so water columns stay aligned with the terrain voxel grid.
    this.group.position.x = Math.floor(focus.x);
    this.group.position.z = Math.floor(focus.z);
    wavePhases(time, this.uniforms.uWavePhase.value);
    this.uniforms.uTime.value = time;
    if (this.seabed.version !== this.seabedVersion) {
      this.seabedVersion = this.seabed.version;
      this.seabedTexture.needsUpdate = true;
    }
  }

  private createWaterMaterial(): MeshStandardMaterial {
    const material = new MeshStandardMaterial({ roughness: 0.3, metalness: 0, transparent: true });
    // Inject into the standard material rather than writing a ShaderMaterial, so lighting, shadows and fog still apply.
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
${WAVE_GLSL}
uniform sampler2D uSeabed;
uniform vec4 uSeabedRect;
varying float vDepth;
varying float vWave;
varying vec2 vCell;`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
vec3 cellCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vec2 seabedUv = (cellCenter.xz - uSeabedRect.xy) / uSeabedRect.zw;
float seabed = 0.0;
if (all(greaterThanEqual(seabedUv, vec2(0.0))) && all(lessThan(seabedUv, vec2(1.0)))) {
  seabed = texture2D(uSeabed, seabedUv).r * 255.0;
}
float wave = waveOffset(cellCenter.xz);
vDepth = cellCenter.y + wave - seabed;
vWave = wave;
vCell = cellCenter.xz;
// Columns over dry land collapse to a point, so they never poke through or z-fight the terrain.
transformed = seabed > cellCenter.y + ${glslFloat(WAVE_AMPLITUDE)} ? vec3(0.0) : transformed + vec3(0.0, wave, 0.0);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform float uTime;
uniform vec4 uWake[${WAKE_POINTS}];
varying float vDepth;
varying float vWave;
varying vec2 vCell;`,
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
vec3 water = mix(uShallow, uMid, smoothstep(0.6, 2.5, vDepth));
water = mix(water, uDeep, smoothstep(2.5, 7.0, vDepth));
// Higher wave steps catch a little more light, which gives the swell some relief.
water *= 1.0 + vWave * ${glslFloat(0.08 / WAVE_AMPLITUDE)};
// Surf flickering on the cells that touch the beach.
float flicker = fract(sin(dot(floor(vCell) + mod(floor(uTime * 1.5), 64.0), vec2(12.9898, 78.233))) * 43758.5453);
float surf = (1.0 - smoothstep(0.5, 1.2, vDepth)) * step(0.45, flicker);
// Wake: dithered foam cells along the ship's recent track, spreading and thinning with age.
float wake = 0.0;
for (int i = 0; i < ${WAKE_POINTS}; i++) {
  vec4 w = uWake[i];
  if (w.w <= 0.0) continue;
  float radius = 1.0 + w.z * 0.7;
  float inside = 1.0 - smoothstep(radius - 0.8, radius, distance(vCell, w.xy));
  wake = max(wake, inside * w.w * (1.0 - w.z / ${glslFloat(WAKE_LIFETIME)}));
}
float grain = fract(sin(dot(floor(vCell), vec2(39.34, 11.13)) + mod(floor(uTime * 4.0), 97.0)) * 24634.6345);
// Strictly greater: fract() can return exactly 0.0 at this magnitude, and step(0.0, 0.0) is 1.
float foam = max(surf * 0.85, wake * 0.95 > grain ? 0.8 : 0.0);
diffuseColor.rgb = mix(water, uFoam, foam);
// Shallows are see-through so the sand shows; deep water is opaque.
diffuseColor.a = mix(0.6, 1.0, smoothstep(0.8, 4.5, vDepth));`,
        );
    };
    material.customProgramCacheKey = () => 'havens-end-ocean';
    return material;
  }
}

/** Flat, upward-facing square with a square hole in the middle, built from four strips. */
function squareFrameGeometry(inner: number, outer: number): BufferGeometry {
  const strips = [
    [-outer, -outer, outer, -inner],
    [-outer, inner, outer, outer],
    [-outer, -inner, -inner, inner],
    [inner, -inner, outer, inner],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  strips.forEach(([x0, z0, x1, z1], i) => {
    positions.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x1, 0, z0);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    indices.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setIndex(indices);
  return geometry;
}
