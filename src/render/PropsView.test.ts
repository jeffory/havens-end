import { describe, expect, it } from 'vitest';
import { Sketch } from '../props/sketch';
import { PROP_KINDS, type PropKind, type PropModel } from '../props/types';
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
    const lanterns = view.meshes.get('lantern')!;
    expect(lanterns.count).toBe(2);
    const anchors = lanterns.geometry.getAttribute('anchor');
    expect(anchors.getY(0)).toBeLessThan(-1000); // never lifts
    expect([anchors.getX(1), anchors.getY(1), anchors.getZ(1)]).toEqual([12.5, 16.5, 21.5]); // its block's centre
    expect(view.meshes.has('signTavern')).toBe(false);
  });
});
