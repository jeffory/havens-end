import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from './CameraRig';
import { FIGHT_DISTANCE, fightDistance } from './fightFrame';
import { ROOM_ZOOM, roomDistance, roomShift, roomZoom } from './roomFrame';

const room = (w: number, d: number) => ({ x0: 0, z0: 0, x1: w, z1: d });

describe('framing a room on foot', () => {
  it('doesn’t shift or close in the view with no room to frame', () => {
    expect(roomShift({ x: 3, z: 4 }, null)).toEqual({ x: 0, y: 0, z: 0 });
    expect(roomZoom(null)).toBe(1);
  });

  it('shifts toward the room’s middle, most of the way, never too far from the captain, and looks a little lower', () => {
    const near = roomShift({ x: 3.5, z: -0.5 }, room(7, 5));
    expect(near.x).toBeCloseTo(0);
    expect(near.z).toBeGreaterThan(2);
    expect(near.z).toBeLessThan(3);
    expect(near.y).toBeLessThan(0);
    const far = roomShift({ x: 0, z: 0 }, { x0: 30, z0: 40, x1: 30, z1: 40 });
    expect(Math.hypot(far.x, far.z)).toBeLessThanOrEqual(6);
    expect(far.x / far.z).toBeCloseTo(30 / 40);
  });

  it('eases in from the player’s own zoom, less for a bigger room, never further than the zoom nor closer than the closest they can zoom', () => {
    expect(roomDistance(36, roomZoom(room(7, 7)))).toBeCloseTo(26);
    expect(roomDistance(36, roomZoom(room(3, 3)))).toBeCloseTo(26);
    const shipyard = roomDistance(36, roomZoom(room(9, 6)));
    expect(shipyard).toBeGreaterThan(26);
    expect(shipyard).toBeLessThan(36);
    expect(roomZoom(room(40, 40))).toBe(1);
    expect(roomDistance(36, 1)).toBe(36);
    expect(roomDistance(54, ROOM_ZOOM)).toBeCloseTo(54 * ROOM_ZOOM);
    expect(roomDistance(12, ROOM_ZOOM)).toBe(12);
    expect(roomDistance(14, ROOM_ZOOM)).toBe(12);
  });

  it('gives way to a fight’s framing: the fight stands the camera back as far as it needs', () => {
    expect(fightDistance(roomDistance(36, roomZoom(room(7, 7))), 1)).toBe(FIGHT_DISTANCE);
    expect(fightDistance(roomDistance(36, roomZoom(room(7, 7))), 0)).toBeCloseTo(26);
  });

  it('frames the room mid-screen, clear of the hotbar, the captain in view, from every side of it and inside, the view turned each way', () => {
    // The on-foot camera at its usual zoom, on the critic's 1280 × 800 screen.
    const rig = new CameraRig(1280 / 800);
    rig.setRange(12, 70, 36);
    const FLOOR = 13;
    const project = (x: number, y: number, z: number) => new Vector3(x, y, z).project(rig.camera);
    const clearOfHud = (s: Vector3) => Math.abs(s.x) < 0.95 && s.y < 0.95 && s.y > -0.6; // the bottom fifth is the prompt, pack and hotbar
    // A three-wide house, a tavern, an office, a shipyard.
    for (const [w, d] of [[3, 3], [6, 7], [7, 7], [9, 6]]) {
      const [cx, cz] = [w / 2, d / 2];
      // At the door on each side (a step out from the wall), and in the middle.
      const spots = [
        { x: cx, z: -1 },
        { x: cx, z: d + 1 },
        { x: -1, z: cz },
        { x: w + 1, z: cz },
        { x: cx, z: cz },
      ];
      for (let turn = 0; turn < 4; turn++) {
        for (const captain of spots) {
          const shift = roomShift(captain, room(w, d));
          rig.update(new Vector3(captain.x + shift.x, FLOOR + 1.2 + shift.y, captain.z + shift.z), 100, roomDistance(36, roomZoom(room(w, d))));
          rig.camera.updateMatrixWorld();
          const where = `${w}×${d}, the captain at ${captain.x}, ${captain.z}, view turned ${turn}`;
          // The walls' corners: at the floor, and at head height, the far walls' tops.
          for (const [x, z] of [[0, 0], [w, 0], [0, d], [w, d]]) {
            for (const y of [FLOOR, FLOOR + 2]) expect(clearOfHud(project(x, y, z)), `the room’s corner ${x}, ${y - FLOOR}, ${z}: ${where}`).toBe(true);
          }
          for (const y of [FLOOR, FLOOR + 1.8]) expect(clearOfHud(project(captain.x, y, captain.z)), `the captain at ${y - FLOOR}: ${where}`).toBe(true);
          // Mid-screen: near the middle of what's clear of the hotbar.
          const middle = project(cx, FLOOR, cz);
          expect(Math.hypot(middle.x, middle.y - 0.175), `the room’s middle mid-screen: ${where}`).toBeLessThan(0.2);
        }
        rig.rotate(1);
      }
    }
  });
});
