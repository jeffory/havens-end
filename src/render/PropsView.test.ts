import { describe, expect, it } from 'vitest';
import { Sketch } from '../props/sketch';
import { PROP_KINDS, type PropKind, type PropModel } from '../props/types';
import { FLAG_GLOW } from '../voxel/palette';
import { Lifts } from './lifts';
import { PropsView } from './PropsView';

const tiny = new Sketch().paint('a', 0xffffff).put(0, 0, 0, 'a').model({ x: 0.5, y: 0, z: 0.5 }, 0.25);
const catalog = Object.fromEntries(PROP_KINDS.map((k) => [k, tiny])) as Record<PropKind, PropModel>;

describe('props view', () => {
  it('draws each kind the towns use as one instanced mesh', () => {
    const view = new PropsView(
      [
        { kind: 'lantern', x: 10.5, y: 15, z: 20.5, facing: 0, anchor: null },
        { kind: 'lantern', x: 12.5, y: 15, z: 20.5, facing: 1, anchor: { x: 12, y: 16, z: 21 } },
        { kind: 'clock', x: 0, y: 0, z: 0, facing: 2, anchor: null },
      ],
      catalog,
      new Lifts(),
    );
    expect(view.group.children).toHaveLength(2);
    expect(view.meshes.get('lantern')).toHaveLength(1);
    const lanterns = view.meshes.get('lantern')![0];
    expect(lanterns.count).toBe(2);
    const anchors = lanterns.geometry.getAttribute('anchor');
    expect(anchors.getY(0)).toBeLessThan(-1000); // never lifts
    expect([anchors.getX(1), anchors.getY(1), anchors.getZ(1)]).toEqual([12.5, 16.5, 21.5]); // its block's centre
    expect(view.meshes.has('signTavern')).toBe(false);
  });

  it('marks the lantern glass to glow after dark, and nothing else', () => {
    // An iron base with a pane of glass on it: five faces of each show.
    const lantern = new Sketch().paint('iron', 0x2f3237).paint('glass', 0xffd27a, true).put(0, 0, 0, 'iron').put(0, 1, 0, 'glass').model({ x: 0.5, y: 0, z: 0.5 });
    const view = new PropsView([{ kind: 'lantern', x: 10.5, y: 15, z: 20.5, facing: 0, anchor: null }], { ...catalog, lantern }, new Lifts());
    const flags = view.meshes.get('lantern')![0].geometry.getAttribute('flags');
    expect(flags).toBeDefined();
    expect(flags.count).toBe(40);
    expect(Array.from(flags.array).filter((f) => f === FLAG_GLOW)).toHaveLength(20);
  });

  it('gives each town its own mesh of a kind, so a town that’s off screen isn’t drawn', () => {
    const view = new PropsView(
      [
        { kind: 'lantern', x: 0.5, y: 15, z: 0.5, facing: 0, anchor: null },
        { kind: 'lantern', x: 40.5, y: 15, z: 60.5, facing: 0, anchor: null },
        { kind: 'lantern', x: 500.5, y: 15, z: 0.5, facing: 0, anchor: null },
      ],
      catalog,
      new Lifts(),
    );
    const meshes = view.meshes.get('lantern')!;
    expect(meshes.map((m) => m.count)).toEqual([2, 1]);
    for (const m of meshes) {
      expect(m.frustumCulled).toBe(true);
      expect(m.boundingSphere!.radius).toBeLessThan(100);
    }
  });
});
