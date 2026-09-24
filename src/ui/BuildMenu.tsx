import { useEffect } from 'react';
import { GOOD_INFO, type Good } from '../economy/goods';
import type { Land } from '../land/Land';
import { STRUCTURE_LIST, STRUCTURES, type Structure } from '../land/structures';
import type { NavHandlers } from './Overlay';

/** What to build: each structure with its cost against what's to hand (pack, storehouses, the ship at anchor). */
export function BuildMenu({ land, choose, close, nav }: { land: Land; choose: (kind: Structure) => void; close: () => void; nav: NavHandlers }) {
  useEffect(() => {
    nav.back = close;
  }, [nav, close]);
  const w = land.walker;
  const claimed = w ? land.claimed(w.x, w.z) : false;
  return (
    <div className="port-screen build-menu" role="dialog" aria-label="Build">
      <header className="port-header">
        <div>
          <h2>Build</h2>
          <span className="port-kind">
            {claimed ? 'Your camp. Materials come from your pack, storehouses and the ship at anchor.' : 'Light a campfire to claim this land before building anything else.'}
          </span>
        </div>
        <button type="button" onClick={close}>
          Close
        </button>
      </header>
      <div className="port-body">
        <div className="yard-list">
          {STRUCTURE_LIST.map((kind, i) => {
            const spec = STRUCTURES[kind];
            const short = land.shortfall(spec.cost);
            const locked = kind !== 'campfire' && !claimed;
            return (
              <div key={kind} className="yard-item">
                <div>
                  <b>{spec.label}</b>
                  <small>{spec.detail}</small>
                  <small className={short ? 'warn' : ''}>
                    {(Object.entries(spec.cost) as Array<[Good, number]>)
                      .map(([good, n]) => `${n} ${GOOD_INFO[good].label.toLowerCase()} (have ${land.available(good)})`)
                      .join(' · ')}
                    {spec.freeform ? ' · each' : ''}
                  </small>
                </div>
                <button type="button" data-autofocus={i === 0 ? true : undefined} disabled={locked || short !== null} onClick={() => choose(kind)}>
                  {locked ? 'Needs a campfire' : 'Place'}
                </button>
              </div>
            );
          })}
        </div>
        <p className="hint">
          Buildings sit on the grid (turn them with Q / R or LB / RB); fences, paths and torches go down one at a time until you press Esc. Take a
          fence, path or torch up with the axe or pickaxe; farm plots are tilled with the hoe anywhere in your camp.
        </p>
      </div>
    </div>
  );
}
