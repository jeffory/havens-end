import { describe, expect, it } from 'vitest';
import { cutsProp, type Lift, liftedBy, Lifts, MAX_LIFTS } from './lifts';

/** Far from everything, so no room's walls face it. */
const NOWHERE = { x: 0, z: 0 };

describe('lifts', () => {
  it('hold the voxels in a lifted box above its height, and nothing else', () => {
    const lifts = new Lifts();
    expect(lifts.holds(5, 20, 5)).toBe(false);
    lifts.set([{ x0: 0, z0: 0, x1: 10, z1: 10, from: 14.5 }], NOWHERE);
    expect(lifts.holds(5, 15, 5)).toBe(true);
    expect(lifts.holds(5, 14, 5)).toBe(false); // below the cut
    expect(lifts.holds(10, 15, 5)).toBe(false); // x1 is outside
    expect(lifts.uniforms.uLiftBox.value[0].toArray()).toEqual([0, 0, 10, 10]);
    lifts.set([], NOWHERE);
    expect(lifts.holds(5, 15, 5)).toBe(false);
  });

  it('keep no more boxes than the shader has room for', () => {
    const lifts = new Lifts();
    lifts.set(
      Array.from({ length: MAX_LIFTS + 3 }, (_, k) => ({ x0: k * 10, z0: 0, x1: k * 10 + 5, z1: 5, from: 0 })),
      NOWHERE,
    );
    expect(lifts.uniforms.uLiftFrom.value).toHaveLength(MAX_LIFTS);
    expect(lifts.holds(MAX_LIFTS * 10 + 1, 1, 1)).toBe(false);
    expect(lifts.holds(1, 1, 1)).toBe(true);
  });

  it('light a lifted room warmly after dark, and not at all by day', () => {
    const lifts = new Lifts();
    lifts.setRoomLight(0);
    expect(lifts.uniforms.uRoomLight.value.toArray()).toEqual([0, 0, 0]);
    lifts.setRoomLight(1);
    const [r, g, b] = lifts.uniforms.uRoomLight.value.toArray();
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0);
  });

  describe('a building’s room', () => {
    // Walls round x 1 to 8 and z 1 to 6, the floor at y 10; the box takes in the roof's
    // overhang (a block all round) and a porch two deep beyond the south wall.
    const FLOOR = 10;
    const house: Lift = { x0: 0, z0: 0, x1: 10, z1: 10, from: FLOOR + 1.5, room: { x0: 1, z0: 1, x1: 9, z1: 7, front: FLOOR + 0.5 } };
    const WALLS = { west: [1, 3], east: [8, 3], north: [4, 1], south: [4, 6] } as const;
    // The camera off each corner in turn, as the four quarter turns put it, well back from the house.
    const QUARTERS = [
      { name: 'south-east', eye: { x: 40, z: 40 }, near: ['east', 'south'] },
      { name: 'north-east', eye: { x: 40, z: -30 }, near: ['east', 'north'] },
      { name: 'north-west', eye: { x: -30, z: -30 }, near: ['west', 'north'] },
      { name: 'south-west', eye: { x: -30, z: 40 }, near: ['west', 'south'] },
    ] as const;

    it('cuts the walls facing the camera to one course, and the far walls at head height, from every quarter', () => {
      for (const { name, eye, near } of QUARTERS) {
        for (const [wall, [x, z]] of Object.entries(WALLS)) {
          const facing = (near as readonly string[]).includes(wall);
          expect(liftedBy(house, eye, x, FLOOR, z), `${name}: the ${wall} wall’s first course`).toBe(false);
          expect(liftedBy(house, eye, x, FLOOR + 1, z), `${name}: the ${wall} wall’s second course`).toBe(facing);
          expect(liftedBy(house, eye, x, FLOOR + 2, z), `${name}: the ${wall} wall above head height`).toBe(true);
        }
        // The room's floor, and what stands on it, stay.
        expect(liftedBy(house, eye, 4, FLOOR - 1, 3), `${name}: the floor`).toBe(false);
      }
    });

    it('cuts what stands in front of the walls facing the camera as low as they are, and the corner they share with a far wall', () => {
      const eye = { x: 40, z: 40 }; // south-east
      expect(liftedBy(house, eye, 4, FLOOR + 1, 8), 'a porch post before the south wall').toBe(true);
      expect(liftedBy(house, eye, 4, FLOOR, 8), 'the porch deck').toBe(false);
      expect(liftedBy(house, eye, 8, FLOOR + 1, 1), 'the north wall’s east end, in the east wall').toBe(true);
      expect(liftedBy(house, eye, 7, FLOOR + 1, 1), 'the north wall beside it').toBe(false);
    });

    it('cuts furniture against the walls facing the camera as low as those walls, from every quarter, so it hides nobody behind it', () => {
      // A shelf two high, a block in from each wall; a table in the middle; a post on the porch.
      const SHELVES = { west: [2.5, 3.5], east: [7.5, 3.5], north: [4.5, 2.5], south: [4.5, 5.5] } as const;
      for (const { name, eye, near } of QUARTERS) {
        for (const [wall, [x, z]] of Object.entries(SHELVES)) {
          const facing = (near as readonly string[]).includes(wall);
          expect(cutsProp(house, eye, x, FLOOR + 0.5, z), `${name}: the shelf by the ${wall} wall, its first course`).toBe(false);
          expect(cutsProp(house, eye, x, FLOOR + 1, z), `${name}: the shelf by the ${wall} wall, level with the cut`).toBe(false);
          expect(cutsProp(house, eye, x, FLOOR + 1.5, z), `${name}: the shelf by the ${wall} wall, above the cut`).toBe(facing);
        }
        expect(cutsProp(house, eye, 4.5, FLOOR + 1.5, 3.5), `${name}: the table in the middle`).toBe(false);
        expect(cutsProp(house, eye, 4.5, FLOOR + 1.5, 8.5), `${name}: the porch, outside the room`).toBe(false);
      }
      // As low as the walls, if the line of sight cuts the whole box lower.
      expect(cutsProp({ ...house, from: FLOOR - 0.5 }, { x: 40, z: 40 }, 7.5, FLOOR + 0.5, 3.5)).toBe(true);
      // And nothing, out of a room.
      expect(cutsProp({ x0: 0, z0: 0, x1: 10, z1: 10, from: 14.5 }, { x: 40, z: 40 }, 8.5, 20, 3.5)).toBe(false);
    });

    it('cuts no wall lower for a camera straight over the room', () => {
      const eye = { x: 4.5, z: 3.5 };
      for (const [x, z] of Object.values(WALLS)) expect(liftedBy(house, eye, x, FLOOR + 1, z)).toBe(false);
    });

    it('cuts the walls facing the camera lower still when the whole box is cut lower', () => {
      const low = { ...house, from: FLOOR - 0.5 };
      expect(liftedBy(low, { x: 40, z: 40 }, 8, FLOOR, 3)).toBe(true);
    });

    it('are cut as the shader cuts them: the camera and each room go to the shader too', () => {
      const lifts = new Lifts();
      lifts.set([house], { x: 40, z: 40 });
      expect(lifts.holds(8, FLOOR + 1, 3), 'the east wall').toBe(true);
      expect(lifts.holds(1, FLOOR + 1, 3), 'the west wall').toBe(false);
      expect(lifts.uniforms.uLiftEye.value.toArray()).toEqual([40, 40]);
      expect(lifts.uniforms.uLiftRoom.value[0].toArray()).toEqual([1, 1, 9, 7]);
      expect(lifts.uniforms.uLiftFrom.value[0].toArray()).toEqual([FLOOR + 1.5, FLOOR + 0.5]);
      lifts.set([{ x0: 0, z0: 0, x1: 10, z1: 10, from: 14.5 }], { x: 40, z: 40 });
      expect(lifts.uniforms.uLiftFrom.value[0].toArray(), 'no room: cut level').toEqual([14.5, 14.5]);
    });
  });
});
