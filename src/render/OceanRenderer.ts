import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DepthTexture,
  Group,
  HalfFloatType,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
  RedFormat,
  type Scene,
  UnsignedByteType,
  Vector2,
  Vector4,
  type Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { SeabedMap } from '../ocean/SeabedMap';
import { smoothstep } from '../util/math';
import { glslFloat, WATER_LEVEL, WAVE_AMPLITUDE, WAVE_GLSL, wavePhases } from '../ocean/waves';
import { WAKE_LIFETIME, type WakePool } from './Wake';

export const OCEAN_COLORS = {
  mid: 0x25b5c6,
  deep: 0x0e5f94,
  foam: 0xf2fbff,
};

/** How far a cell's slope shifts what's seen through it: the seabed wobbles under the swell. */
const REFRACTION = 2.0;
/** How quickly the view into the water clouds over, per unit of water the light passes through. */
const MURK = 0.24;
/** How much of each colour the water soaks up per unit: red goes first, so things below turn teal before they fade. */
const ABSORB = [0.4, 0.08, 0.05];
/** How far each cell tilts with the swell, so light glints off the sea in blocks. */
const TILT = 0.6;
/**
 * Lamp reflections: how wide (across the screen) and how long (down it) each lamp's
 * streak on the water is, in world units at the lamp, and how bright.
 */
const STREAK_WIDTH = 0.7;
const STREAK_LENGTH = 4.5;
const STREAK_GAIN = 0.08;
/** How much sky the water reflects, looking straight down (it rises toward the horizon). More than real water, so it shows. */
const SKY_REFLECTION = 0.06;
/** Height of the cloud layer the water reflects, above the sea. */
const CLOUD_HEIGHT = 120;
/** How the clouds drift, in units a second. */
const CLOUD_DRIFT = [2.4, 0.9];

/**
 * The sea: a grid of 1×1 voxel water columns centred on the camera focus, animated in
 * the vertex shader, plus a flat plane beyond it out to the horizon. No water voxels
 * are stored, so the open sea costs nothing in memory and the map can be any size.
 *
 * The water is see-through: each frame everything but the sea is first drawn into
 * `below` (`renderBelow`), and the water shader looks into it, fading what it sees by
 * how much water lies in the way. So the seabed, hulls and waders show through, and
 * the water foams wherever something breaks its surface.
 */
export class OceanRenderer {
  readonly group = new Group();
  private readonly seabedTexture: DataTexture;
  private seabedVersion: number;
  /** Foam (wakes, splashes) per water cell, stamped on the CPU each frame and sampled by the shader. */
  private readonly foam: Uint8Array;
  private readonly foamTexture: DataTexture;
  /** The scene without the sea, colour and depth: what the water shows through itself. */
  private readonly below = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthTexture: new DepthTexture(1, 1) });
  private readonly bufferSize = new Vector2();
  private readonly uniforms;

  constructor(
    private readonly seabed: SeabedMap,
    private readonly wakes: WakePool,
    private readonly gridSize = 160,
  ) {
    this.group.name = 'ocean';
    this.seabedTexture = new DataTexture(seabed.heights, seabed.size, seabed.size, RedFormat, UnsignedByteType);
    this.seabedTexture.needsUpdate = true;
    this.seabedVersion = seabed.version;
    this.foam = new Uint8Array(gridSize * gridSize);
    this.foamTexture = new DataTexture(this.foam, gridSize, gridSize, RedFormat, UnsignedByteType);

    this.uniforms = {
      uWavePhase: { value: wavePhases(0) },
      uTime: { value: 0 },
      uSeabed: { value: this.seabedTexture },
      uSeabedRect: { value: new Vector4(seabed.originX, seabed.originZ, seabed.size, seabed.size) },
      uMid: { value: new Color(OCEAN_COLORS.mid) },
      uDeep: { value: new Color(OCEAN_COLORS.deep) },
      uFoam: { value: new Color(OCEAN_COLORS.foam) },
      uFoamMap: { value: this.foamTexture },
      /** World position of the foam map's corner, and its size in cells. */
      uFoamRect: { value: new Vector4(0, 0, gridSize, gridSize) },
      uBelow: { value: this.below.texture },
      uBelowDepth: { value: this.below.depthTexture },
      /** The drawing buffer's size in pixels, to turn gl_FragCoord into a lookup in `below`. */
      uResolution: { value: new Vector2(1, 1) },
      uNearFar: { value: new Vector2(1, 2000) },
      uSky: { value: new Color() },
      /** 1 by day, 0 at night: how brightly the clouds are lit. */
      uDaylight: { value: 1 },
      /** How much of the sky is cloud, 0 to 1. */
      uCloudCover: { value: 0.45 },
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
    this.stampFoam(this.group.position.x - this.gridSize / 2, this.group.position.z - this.gridSize / 2);
    wavePhases(time, this.uniforms.uWavePhase.value);
    this.uniforms.uTime.value = time;
    this.seabed.follow(focus.x, focus.z);
    if (this.seabed.version !== this.seabedVersion) {
      this.seabedVersion = this.seabed.version;
      this.seabedTexture.needsUpdate = true;
      this.uniforms.uSeabedRect.value.x = this.seabed.originX;
      this.uniforms.uSeabedRect.value.y = this.seabed.originZ;
    }
  }

  /** The sky the water reflects: its colour, 0 at night to 1 by day, and 0 clear to 1 in a squall. */
  setSky(color: Color, daylight: number, overcast: number): void {
    this.uniforms.uSky.value.copy(color);
    this.uniforms.uDaylight.value = daylight;
    this.uniforms.uCloudCover.value = 0.45 + 0.4 * overcast;
  }

  /**
   * Draws everything but the sea into `below`, for the water to look into. Call it just
   * before the frame's own render, with the same camera.
   */
  renderBelow(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void {
    renderer.getDrawingBufferSize(this.bufferSize);
    if (this.below.width !== this.bufferSize.x || this.below.height !== this.bufferSize.y) this.below.setSize(this.bufferSize.x, this.bufferSize.y);
    this.uniforms.uResolution.value.copy(this.bufferSize);
    this.uniforms.uNearFar.value.set(camera.near, camera.far);
    this.group.visible = false;
    renderer.setRenderTarget(this.below);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    this.group.visible = true;
  }

  /**
   * Paints every live wake point into the foam map as a disc that spreads and thins
   * with age. Cheap on the CPU (a few thousand writes), and it spares the shader from
   * looping over every point for every pixel.
   */
  private stampFoam(originX: number, originZ: number): void {
    const n = this.gridSize;
    const foam = this.foam;
    foam.fill(0);
    for (const p of this.wakes.points) {
      if (p.w <= 0) continue;
      const radius = 1 + p.z * 0.7;
      const strength = p.w * (1 - p.z / WAKE_LIFETIME) * 255;
      const cx = p.x - originX;
      const cz = p.y - originZ;
      const r = Math.ceil(radius);
      for (let row = Math.max(0, Math.floor(cz) - r); row <= Math.min(n - 1, Math.floor(cz) + r); row++) {
        for (let col = Math.max(0, Math.floor(cx) - r); col <= Math.min(n - 1, Math.floor(cx) + r); col++) {
          const d = Math.hypot(col + 0.5 - cx, row + 0.5 - cz);
          const inside = 1 - smoothstep(radius - 0.8, radius, d);
          const value = inside * strength;
          const i = row * n + col;
          if (value > foam[i]) foam[i] = value;
        }
      }
    }
    this.uniforms.uFoamRect.value.x = originX;
    this.uniforms.uFoamRect.value.y = originZ;
    this.foamTexture.needsUpdate = true;
  }

  private createWaterMaterial(): MeshStandardMaterial {
    // Opaque: it blends in what's below it itself, so nothing depends on draw order.
    const material = new MeshStandardMaterial({ roughness: 0.18, metalness: 0 });
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
uniform float uTime;
uniform vec3 uSky;
uniform float uDaylight;
uniform float uCloudCover;
varying float vDepth;
varying float vWave;
varying vec2 vCell;
varying vec2 vSlope;
varying float vTop;
/** The sky the cell reflects (rgb), and how much of it (a). */
varying vec4 vSky;
float cloudHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float cloudNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), f.x), mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
/** How cloudy the sky is at a point on the cloud layer, 0 to 1. */
float cloudAt(vec2 p) {
  float n = cloudNoise(p) * 0.55 + cloudNoise(p * 2.1 + 17.3) * 0.3 + cloudNoise(p * 4.3 + 41.9) * 0.15;
  return smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.2, n);
}
`,
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
vTop = step(0.5, objectNormal.y);
vSlope = vec2(0.0);
vSky = vec4(0.0);
// Only the top face needs these, and they're the same all over it: worked out here, once a
// corner, rather than for every pixel.
if (vTop > 0.5) {
  // The swell's slope across the cell, from its neighbours: it tilts the cell for glints and bends the view through it.
  vSlope = vec2(
    waveOffset(cellCenter.xz + vec2(1.0, 0.0)) - waveOffset(cellCenter.xz - vec2(1.0, 0.0)),
    waveOffset(cellCenter.xz + vec2(0.0, 1.0)) - waveOffset(cellCenter.xz - vec2(0.0, 1.0))
  );
  // The sky and its clouds, reflected: the cell looks up along its own tilt, so the clouds
  // drift across the sea in blocks. Clouds are white by day, a little lighter than the sky at night.
  vec3 cellTop = cellCenter + vec3(0.0, wave, 0.0);
  vec2 lean = vSlope * ${glslFloat(TILT)};
  vec3 bounce = reflect(normalize(cellTop - cameraPosition), normalize(vec3(-lean.x, 1.0, -lean.y)));
  vec2 onCloud = cellTop.xz + bounce.xz * (${glslFloat(CLOUD_HEIGHT)} / max(bounce.y, 0.15)) - vec2(${CLOUD_DRIFT.map(glslFloat).join(', ')}) * mod(uTime, 10000.0);
  vSky.rgb = mix(uSky, uSky * 1.2 + vec3(0.7) * uDaylight, cloudAt(onCloud / 70.0));
  vSky.a = ${glslFloat(SKY_REFLECTION)} + ${glslFloat(1 - SKY_REFLECTION)} * pow(1.0 - max(bounce.y, 0.0), 5.0);
}
// Columns over dry land collapse to a point, so they never poke through or z-fight the terrain.
transformed = seabed > cellCenter.y + ${glslFloat(WAVE_AMPLITUDE)} ? vec3(0.0) : transformed + vec3(0.0, wave, 0.0);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform float uTime;
uniform sampler2D uFoamMap;
uniform vec4 uFoamRect;
uniform sampler2D uBelow;
uniform sampler2D uBelowDepth;
uniform vec2 uResolution;
uniform vec2 uNearFar;
varying float vDepth;
varying float vWave;
varying vec2 vCell;
varying vec2 vSlope;
varying float vTop;
varying vec4 vSky;
/** What shows through the water, and how much of it does (0 none, 1 all). */
vec3 seenBelow;
float clarity;
/** Distance in front of the camera of a depth-buffer value. */
float eyeDistance(float depth) {
  return uNearFar.x * uNearFar.y / (uNearFar.y - (uNearFar.y - uNearFar.x) * depth);
}`,
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
// What's under the water, and how much water the view passes through to reach it.
vec2 screenUv = gl_FragCoord.xy / uResolution;
float surface = vViewPosition.z;
float alongRay = length(vViewPosition) / surface;
float thickness = (eyeDistance(texture2D(uBelowDepth, screenUv).r) - surface) * alongRay;
// Each cell bends the view by its slope, so the seabed wobbles in blocks, like the waves.
vec2 bentUv = screenUv + vSlope * vTop * min(thickness, 3.0) * ${glslFloat(REFRACTION)} / surface;
float bent = (eyeDistance(texture2D(uBelowDepth, bentUv).r) - surface) * alongRay;
// But never bend in something standing out of the water in front.
if (bent > 0.0) {
  screenUv = bentUv;
  thickness = bent;
}
thickness = max(thickness, 0.0);
// Light from what's seen goes down to it and back up to the eye.
float sink = thickness * max(0.0, dot(normalize(vViewPosition), (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
float path = thickness + sink;
// The water's own colour is the light it scatters back, bluer the more of it there is.
// The turquoise of the shallows is the sand seen through it (seenBelow).
vec3 water = mix(uMid, uDeep, smoothstep(3.0, 16.0, path));
// Higher wave steps catch a little more light, which gives the swell some relief.
water *= 1.0 + vWave * ${glslFloat(0.08 / WAVE_AMPLITUDE)};
// Surf flickering on the cells that touch the beach.
float flicker = fract(sin(dot(floor(vCell) + mod(floor(uTime * 1.5), 64.0), vec2(12.9898, 78.233))) * 43758.5453);
float surf = (1.0 - smoothstep(0.5, 1.2, vDepth)) * step(0.45, flicker);
// Wake and splash foam, dithered per cell so it stays blocky.
float wake = texture2D(uFoamMap, (vCell - uFoamRect.xy) / uFoamRect.zw).r;
float grain = fract(sin(dot(floor(vCell), vec2(39.34, 11.13)) + mod(floor(uTime * 4.0), 97.0)) * 24634.6345);
// Strictly greater: fract() can return exactly 0.0 at this magnitude, and step(0.0, 0.0) is 1.
float foam = max(surf * 0.85, wake * 0.95 > grain ? 0.8 : 0.0);
// A ring of foam wherever something breaks the surface out in open water: hulls, posts, a wader's legs.
float ring = (1.0 - smoothstep(0.08, 0.45, thickness)) * vTop * smoothstep(1.0, 2.0, vDepth);
foam = max(foam, ring > grain ? 0.7 : 0.0);
diffuseColor.rgb = mix(water, uFoam, foam);
seenBelow = texture2D(uBelow, screenUv).rgb * exp(-vec3(${ABSORB.map(glslFloat).join(', ')}) * path);
clarity = exp(-path * ${glslFloat(MURK)}) * (1.0 - foam);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
// Each cell tilts with the swell, and shivers a little, so sun, moon and lamps glint off the sea in blocks.
if (vTop > 0.5) {
  float beat = mod(floor(uTime * 3.0), 61.0);
  vec2 shiver = vec2(
    fract(sin(dot(floor(vCell), vec2(27.1, 61.7)) + beat) * 43758.5453),
    fract(sin(dot(floor(vCell), vec2(93.9, 17.3)) + beat) * 24634.6345)
  ) - 0.5;
  vec2 lean = vSlope * ${glslFloat(TILT)} + shiver * 0.12;
  normal = normalize((viewMatrix * vec4(normalize(vec3(-lean.x, 1.0, -lean.y)), 0.0)).xyz);
}`,
        )
        .replace(
          '#include <opaque_fragment>',
          /* glsl */ `// The water's own colour, lit, over whatever shows through it; glints on top.
outgoingLight = mix(totalDiffuse, seenBelow, clarity) + totalSpecular + totalEmissiveRadiance;
// The sky and clouds this cell reflects (worked out per cell, in the vertex shader).
outgoingLight = mix(outgoingLight, vSky.rgb, vSky.a * (1.0 - foam));
#if NUM_POINT_LIGHTS > 0
// Lamps and lanterns shine back off the water as broken streaks running down the screen,
// the way lights do on a rippled harbour. Each cell is lit or not as a whole, twinkling as
// the swell moves, so the streaks come out in blocks like everything else.
if (vTop > 0.5 && foam < 0.5) {
  vec3 up = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  vec3 level = (viewMatrix * vec4(0.0, ${glslFloat(WATER_LEVEL)}, 0.0, 1.0)).xyz;
  vec3 cell = (viewMatrix * vec4(vCell.x, ${glslFloat(WATER_LEVEL)} + vWave, vCell.y, 1.0)).xyz;
  float twinkle = fract(sin(dot(floor(vCell), vec2(51.7, 23.3)) + mod(floor(uTime * 5.0), 53.0)) * 31718.927);
  vec3 streaks = vec3(0.0);
  for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
    // The lamp's mirror image under the water, and how far the cell is from it across and down the screen.
    vec3 lamp = pointLights[i].position;
    vec3 image = lamp - 2.0 * dot(lamp - level, up) * up;
    vec2 off = (cell.xy / -cell.z - image.xy / -image.z) * length(image);
    streaks += pointLights[i].color * exp(-off.x * off.x / ${glslFloat(STREAK_WIDTH * STREAK_WIDTH)} - off.y * off.y / ${glslFloat(STREAK_LENGTH * STREAK_LENGTH)});
  }
  outgoingLight += streaks * step(0.35, twinkle) * ${glslFloat(STREAK_GAIN)};
}
#endif
#include <opaque_fragment>`,
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
