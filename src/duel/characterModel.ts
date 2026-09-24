import type { ModelPart, Point3 } from '../sailing/shipModel';
import { instanceVoxels, mvToGame, type VoxFile } from '../vox/parseVox';

export const PART_NAMES = ['head', 'torso', 'arm_l', 'arm_r', 'leg_l', 'leg_r'] as const;
export type PartName = (typeof PART_NAMES)[number];

/** How tall a captain stands, in world units. The model's voxels are scaled to fit. */
export const CHARACTER_HEIGHT = 1.8;

export interface CharacterModel {
  /** Each part's voxels, with its joint as the pivot. Model space: game axes, integer cells, T-pose, facing +z. */
  parts: Record<PartName, ModelPart>;
  palette: Uint8Array;
  /** Point between the feet on the ground: the character's origin. */
  feet: Point3;
  /** Where the sword hand grips, at the end of the right arm. */
  hand: Point3;
  /** World units per voxel. */
  scale: number;
}

/**
 * Turns a character .vox into animatable parts. Authoring conventions (see
 * docs/ARCHITECTURE.md): T-pose, facing +Y in MagicaVoxel, one object per part named
 * head, torso, arm_l, arm_r, leg_l, leg_r (left and right are the character's own).
 * Joints come from the part bounds: shoulders at the inner end of each arm, hips at
 * the top of each leg, the neck under the head, the waist under the torso.
 */
export function buildCharacterModel(file: VoxFile): CharacterModel {
  const cells: Partial<Record<PartName, number[]>> = {};
  for (const instance of file.instances) {
    const name = instance.name.toLowerCase() as PartName;
    if (!PART_NAMES.includes(name)) continue;
    const list = (cells[name] ??= []);
    const voxels = instanceVoxels(file, instance);
    for (let i = 0; i < voxels.length; i += 4) list.push(...mvToGame(voxels[i], voxels[i + 1], voxels[i + 2]), voxels[i + 3]);
  }
  const missing = PART_NAMES.filter((n) => !cells[n]?.length);
  if (missing.length) throw new Error(`buildCharacterModel: missing parts ${missing.join(', ')}`);

  const box = Object.fromEntries(PART_NAMES.map((n) => [n, bounds(cells[n]!)])) as Record<PartName, Box>;
  const centre = (b: Box) => ({ x: (b.minX + b.maxX + 1) / 2, y: (b.minY + b.maxY + 1) / 2, z: (b.minZ + b.maxZ + 1) / 2 });

  // The character's right arm reaches toward -x, the left toward +x.
  const arm = (b: Box, inner: number) => ({ x: inner, y: centre(b).y, z: centre(b).z });
  const pivots: Record<PartName, Point3> = {
    torso: { ...centre(box.torso), y: box.torso.minY },
    head: { ...centre(box.head), y: box.head.minY },
    arm_r: arm(box.arm_r, box.arm_r.maxX + 1),
    arm_l: arm(box.arm_l, box.arm_l.minX),
    leg_r: { ...centre(box.leg_r), y: box.leg_r.maxY + 1 },
    leg_l: { ...centre(box.leg_l), y: box.leg_l.maxY + 1 },
  };
  const parts = Object.fromEntries(PART_NAMES.map((n) => [n, { cells: Int32Array.from(cells[n]!), pivot: pivots[n] }])) as Record<PartName, ModelPart>;

  const all = PART_NAMES.map((n) => box[n]);
  const minY = Math.min(...all.map((b) => b.minY));
  const maxY = Math.max(...all.map((b) => b.maxY));
  const legs = { minX: box.leg_r.minX, maxX: box.leg_l.maxX, minZ: Math.min(box.leg_r.minZ, box.leg_l.minZ), maxZ: Math.max(box.leg_r.maxZ, box.leg_l.maxZ) };
  return {
    parts,
    palette: file.palette,
    feet: { x: (legs.minX + legs.maxX + 1) / 2, y: minY, z: (legs.minZ + legs.maxZ + 1) / 2 },
    hand: { x: box.arm_r.minX + 0.5, y: centre(box.arm_r).y, z: centre(box.arm_r).z },
    scale: CHARACTER_HEIGHT / (maxY - minY + 1),
  };
}

/** A cutlass laid along -x from the grip at the origin, in character voxels: grip, gold guard, curved blade. */
export function cutlassCells(): { cells: Int32Array; palette: Uint8Array } {
  const palette = new Uint8Array(256 * 4);
  palette.set([92, 58, 34, 255], 1 * 4); // grip
  palette.set([214, 172, 72, 255], 2 * 4); // guard
  palette.set([214, 222, 230, 255], 3 * 4); // blade
  palette.set([160, 170, 182, 255], 4 * 4); // blade edge shadow
  const cells: number[] = [];
  for (let x = 1; x >= -1; x--) cells.push(x, 0, 0, 1);
  for (let y = -1; y <= 1; y++) cells.push(-2, y, 0, 2);
  for (let i = 0; i < 13; i++) {
    const x = -3 - i;
    const rise = Math.floor((i * i) / 60); // a gentle curve toward the tip
    cells.push(x, rise, 0, 3);
    if (i < 10) cells.push(x, rise + 1, 0, 4);
  }
  return { cells: Int32Array.from(cells), palette };
}

interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

function bounds(cells: number[]): Box {
  const box: Box = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (let i = 0; i < cells.length; i += 4) {
    box.minX = Math.min(box.minX, cells[i]);
    box.maxX = Math.max(box.maxX, cells[i]);
    box.minY = Math.min(box.minY, cells[i + 1]);
    box.maxY = Math.max(box.maxY, cells[i + 1]);
    box.minZ = Math.min(box.minZ, cells[i + 2]);
    box.maxZ = Math.max(box.maxZ, cells[i + 2]);
  }
  return box;
}
