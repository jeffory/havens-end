import { Line, LineBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { Tracers } from './Tracers';

describe('tracers: the faint streak of a shot', () => {
  it('draws a line from the muzzle to where the shot ended', () => {
    const tracers = new Tracers();
    tracers.add({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    expect(tracers.group.children).toHaveLength(1);
    const line = tracers.group.children[0] as Line;
    const position = line.geometry.getAttribute('position');
    expect(Array.from(position.array)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((line.material as LineBasicMaterial).opacity).toBeCloseTo(0.8);
  });

  it('fades over its life, then clears itself away', () => {
    const tracers = new Tracers();
    tracers.add({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    const line = tracers.group.children[0] as Line;
    tracers.update(0.08); // half its 0.16s life
    expect((line.material as LineBasicMaterial).opacity).toBeCloseTo(0.4, 1);
    tracers.update(0.08); // now spent
    expect(tracers.group.children).toHaveLength(0);
  });

  it('keeps several shots at once, each fading on its own clock', () => {
    const tracers = new Tracers();
    tracers.add({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    tracers.update(0.1);
    tracers.add({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
    expect(tracers.group.children).toHaveLength(2);
    tracers.update(0.07); // the first (age 0.17) is spent, the second (age 0.07) lives on
    expect(tracers.group.children).toHaveLength(1);
    const remaining = tracers.group.children[0] as Line;
    expect(Array.from(remaining.geometry.getAttribute('position').array)).toEqual([0, 0, 0, 2, 0, 0]);
  });
});
