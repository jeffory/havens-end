import { type BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshDepthMaterial, MeshLambertMaterial, type WebGLProgramParametersWithUniforms } from 'three';
import { placementMatrix } from '../props/place';
import type { PropKind, PropModel, PropPlacement } from '../props/types';
import { LIFT_GLSL, type Lifts } from './lifts';
import { meshCells } from './voxelGeometry';

/** The anchor of a prop that never lifts: under anything a lift reaches. */
const NEVER_LIFTED = -1e6;

/**
 * Props within this of a town's first share its meshes: one a kind a town, so a town that's
 * off screen isn't drawn (ports lie hundreds apart; a town is about a hundred across).
 */
const TOWN_REACH = 150;

/** Puts into a props material's shaders that one hung on a building that's lifted away goes with it, the lifts' uniforms shared. */
function goWithLifts(shader: WebGLProgramParametersWithUniforms, lifts: Lifts): void {
  Object.assign(shader.uniforms, lifts.uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 anchor;\nvarying vec3 vAnchor;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAnchor = anchor;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${LIFT_GLSL}\nvarying vec3 vAnchor;`)
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (lifted(vAnchor)) discard;');
}

/**
 * The towns' props: one instanced mesh a kind a town (one mesh a kind a town, so a town off
 * screen isn't drawn). They're lit like the terrain, their lantern glass glows after dark,
 * and one hung on a building goes with it when it's lifted away on foot.
 */
export class PropsView {
  readonly group = new Group();
  /** Each kind's meshes, one a town (none for a kind no town uses). */
  readonly meshes = new Map<PropKind, InstancedMesh[]>();
  private readonly glow = { value: 0.2 };
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  /** The props as the sun sees them, for shadows: one lifted away casts none. */
  private readonly depthMaterial = new MeshDepthMaterial();

  constructor(placements: readonly PropPlacement[], catalog: Readonly<Record<PropKind, PropModel>>, lifts: Lifts) {
    this.group.name = 'props';
    this.material.onBeforeCompile = (shader) => {
      goWithLifts(shader, lifts);
      shader.uniforms.uGlow = this.glow;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float flags;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = step(1.5, flags);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGlow;\nvarying float vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * uGlow;');
    };
    this.material.customProgramCacheKey = () => 'havens-end-props';
    this.depthMaterial.onBeforeCompile = (shader) => goWithLifts(shader, lifts);
    this.depthMaterial.customProgramCacheKey = () => 'havens-end-props-depth';

    // Each town's props of a kind together: a town's first prop marks it, and the rest within reach join it.
    const towns: Array<{ x: number; z: number }> = [];
    const townOf = (p: PropPlacement): number => {
      const i = towns.findIndex((t) => Math.hypot(t.x - p.x, t.z - p.z) < TOWN_REACH);
      return i >= 0 ? i : towns.push({ x: p.x, z: p.z }) - 1;
    };
    const groups = new Map<string, PropPlacement[]>();
    for (const p of placements) {
      const key = `${p.kind}@${townOf(p)}`;
      const list = groups.get(key);
      if (list) list.push(p);
      else groups.set(key, [p]);
    }
    const shapes = new Map<PropKind, BufferGeometry>();
    const matrix = new Matrix4();
    for (const list of groups.values()) {
      const kind = list[0].kind;
      const model = catalog[kind];
      let shape = shapes.get(kind);
      if (!shape) {
        shape = meshCells(model.cells, model.palette);
        shapes.set(kind, shape);
      }
      // Its own copy, for its own instances' anchors.
      const geometry = shape.clone();
      const anchors = new Float32Array(list.length * 3);
      list.forEach((p, i) => anchors.set(p.anchor ? [p.anchor.x + 0.5, p.anchor.y + 0.5, p.anchor.z + 0.5] : [0, NEVER_LIFTED, 0], i * 3));
      geometry.setAttribute('anchor', new InstancedBufferAttribute(anchors, 3));
      const mesh = new InstancedMesh(geometry, this.material, list.length);
      mesh.customDepthMaterial = this.depthMaterial;
      list.forEach((p, i) => mesh.setMatrixAt(i, placementMatrix(p, model, matrix)));
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `props:${kind}`;
      this.meshes.set(kind, [...(this.meshes.get(kind) ?? []), mesh]);
      this.group.add(mesh);
    }
  }

  /** How brightly lantern glass glows: the same as the terrain's glowing blocks. */
  setGlow(amount: number): void {
    this.glow.value = amount;
  }
}
