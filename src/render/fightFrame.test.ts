import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from './CameraRig';
import { FIGHT_DISTANCE, fightDistance, fightShift } from './fightFrame';

describe('framing a fight on foot', () => {
  it('doesn’t shift the view with no one to frame', () => {
    expect(fightShift({ x: 3, z: 4 }, [])).toEqual({ x: 0, z: 0 });
  });

  it('shifts toward the nearest bandit, part of the way, and never too far from the captain', () => {
    const near = fightShift({ x: 0, z: 0 }, [{ x: 0, z: -14 }, { x: 8, z: 0 }]);
    expect(near.x).toBeCloseTo(4);
    expect(near.z).toBeCloseTo(0);
    const far = fightShift({ x: 10, z: 10 }, [{ x: 10 + 30, z: 10 + 40 }]);
    expect(Math.hypot(far.x, far.z)).toBeCloseTo(8);
    expect(far.x / far.z).toBeCloseTo(30 / 40);
  });

  it('stands back as far as a fight needs, easing there, and never closer than the zoom', () => {
    expect(fightDistance(36, 0)).toBe(36);
    expect(fightDistance(36, 0.5)).toBe(42);
    expect(fightDistance(36, 1)).toBe(FIGHT_DISTANCE);
    expect(fightDistance(60, 1)).toBe(60);
  });

  it('keeps the captain and a bandit 8 to 16 off both on screen, whichever side they’re on, clear of the hotbar', () => {
    // The on-foot camera at its usual zoom, on a wide screen, the view turned each way.
    const rig = new CameraRig(16 / 9);
    rig.setRange(12, 70, 36);
    const captain = new Vector3(0, 13, 0);
    const onScreen = (p: Vector3) => {
      const s = p.clone().project(rig.camera);
      return Math.abs(s.x) < 0.95 && s.y < 0.95 && s.y > -0.7; // the bottom of the screen is the hotbar's
    };
    for (let turn = 0; turn < 4; turn++) {
      for (let a = 0; a < 16; a++) {
        for (const off of [8, 12, 16]) {
          const bandit = new Vector3(Math.sin((a / 16) * Math.PI * 2) * off, 13, Math.cos((a / 16) * Math.PI * 2) * off);
          const shift = fightShift(captain, [bandit]);
          rig.update(new Vector3(captain.x + shift.x, captain.y + 1.2, captain.z + shift.z), 100, fightDistance(36, 1));
          rig.camera.updateMatrixWorld();
          for (const body of [captain, bandit]) {
            for (const height of [0, 1.7]) {
              const at = body.clone().setY(body.y + height);
              expect(onScreen(at), `${body === captain ? 'captain' : 'bandit'} ${off} off at ${(a * 22.5).toFixed(1)}°, view turned ${turn}`).toBe(true);
            }
          }
        }
      }
      rig.rotate(1);
    }
  });
});
