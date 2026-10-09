import { Box3, Color, type Group, type Mesh, MeshLambertMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Lift } from './lifts';
import { NightLife } from './NightLife';

const CAPTAIN = { x: 0, y: 20, z: 0 };
/** The camera off to the south-east and above, as the on-foot camera stands. */
const CAMERA = { x: 15, y: 48, z: 15 };
const bats = (life: NightLife) => life.group.children.filter((c) => c.type === 'Group') as Group[];
const meshes = (bat: Group) => {
  const out: Mesh[] = [];
  bat.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
};
/** A bat that shows: there, and not shrunk away. */
const shown = (bat: Group) => bat.visible && bat.scale.x > 0.5;

/** Runs the night on for a while (seconds), the captain still. */
function night(life: NightLife, seconds: number, lifts: readonly Lift[] = [], from = 0): void {
  for (let t = from; t < from + seconds; t += 1 / 30) life.update(CAPTAIN, 1, true, t, [], { lifts, camera: CAMERA });
}

describe('night life', () => {
  it('shades the bats and lights their wings’ edges, so they read as bats, not black chips', () => {
    const life = new NightLife([]);
    night(life, 0.1);
    for (const bat of bats(life)) {
      const parts = meshes(bat);
      for (const m of parts) expect(m.material).toBeInstanceOf(MeshLambertMaterial);
      const lightness = (m: Mesh) => (m.material as MeshLambertMaterial).color.getHSL({ h: 0, s: 0, l: 0 }).l;
      const [darkest, lightest] = [Math.min(...parts.map(lightness)), Math.max(...parts.map(lightness))];
      expect(lightest, 'a lit edge').toBeGreaterThan(darkest * 2);
      expect((parts[0].material as MeshLambertMaterial).color.equals(new Color(0x14141c)), 'not the old flat black').toBe(false);
    }
  });

  it('keeps the bats small: a hand’s span, wing tip to wing tip', () => {
    const life = new NightLife([]);
    night(life, 0.1);
    for (const bat of bats(life)) {
      bat.rotation.set(0, 0, 0);
      bat.updateMatrixWorld(true);
      const size = new Box3().setFromObject(bat).getSize(new Vector3());
      expect(size.x).toBeLessThan(0.5);
    }
  });

  it('keeps the bats out of a lifted room’s air, as the camera sees it, and lets them back when it’s not lifted', () => {
    // A room all round the captain, and well beyond, lifted; then nothing lifted.
    const room: Lift = { x0: -20, z0: -20, x1: 20, z1: 20, from: 21.5, room: { x0: -19, z0: -19, x1: 19, z1: 19, front: 20.5 } };
    const life = new NightLife([]);
    night(life, 2);
    expect(bats(life).some(shown), 'out in the open').toBe(true);
    night(life, 2, [room], 2);
    expect(bats(life).filter(shown), 'over the lifted room').toEqual([]);
    // A tree lifted isn't a room: the bats fly over it.
    night(life, 2, [{ ...room, room: undefined }], 4);
    expect(bats(life).some(shown), 'over a lifted tree').toBe(true);
  });

  it('keeps a bat away that only looks to be in the room, flying between it and the camera', () => {
    // A small room just beyond the captain, away from the camera; the bats circle the captain.
    const room: Lift = { x0: -12, z0: -12, x1: -2, z1: -2, from: 21.5, room: { x0: -11, z0: -11, x1: -3, z1: -3, front: 20.5 } };
    const life = new NightLife([]);
    const over: boolean[] = [];
    for (let t = 0; t < 30; t += 1 / 30) {
      life.update(CAPTAIN, 1, true, t, [], { lifts: [room], camera: CAMERA });
      for (const bat of bats(life)) {
        if (!shown(bat)) continue;
        // Where the camera's line through the bat comes down to the room's floor.
        const p = bat.position;
        const k = (p.y - (CAPTAIN.y - 1)) / (CAMERA.y - p.y);
        const [gx, gz] = [p.x + (p.x - CAMERA.x) * k, p.z + (p.z - CAMERA.z) * k];
        over.push(gx > room.room!.x0 && gx < room.room!.x1 && gz > room.room!.z0 && gz < room.room!.z1);
      }
    }
    expect(over.length).toBeGreaterThan(0);
    expect(over.filter(Boolean)).toEqual([]);
  });
});
