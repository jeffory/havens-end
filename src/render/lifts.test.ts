import { describe, expect, it } from 'vitest';
import { Lifts } from './lifts';
import { MAX_LIFTS } from './RoofLifter';

describe('lifts', () => {
  it('hold the voxels in a lifted box above its height, and nothing else', () => {
    const lifts = new Lifts();
    expect(lifts.holds(5, 20, 5)).toBe(false);
    lifts.set([{ x0: 0, z0: 0, x1: 10, z1: 10, from: 14.5 }]);
    expect(lifts.holds(5, 15, 5)).toBe(true);
    expect(lifts.holds(5, 14, 5)).toBe(false); // below the cut
    expect(lifts.holds(10, 15, 5)).toBe(false); // x1 is outside
    expect(lifts.uniforms.uLiftBox.value[0].toArray()).toEqual([0, 0, 10, 10]);
    lifts.set([]);
    expect(lifts.holds(5, 15, 5)).toBe(false);
  });

  it('keep no more boxes than the shader has room for', () => {
    const lifts = new Lifts();
    lifts.set(Array.from({ length: MAX_LIFTS + 3 }, (_, k) => ({ x0: k * 10, z0: 0, x1: k * 10 + 5, z1: 5, from: 0 })));
    expect(lifts.uniforms.uLiftFrom.value).toHaveLength(MAX_LIFTS);
    expect(lifts.holds(MAX_LIFTS * 10 + 1, 1, 1)).toBe(false);
    expect(lifts.holds(1, 1, 1)).toBe(true);
  });
});
