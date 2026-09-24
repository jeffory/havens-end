import { useEffect, useReducer, useState } from 'react';
import { PACK_SIZE } from '../economy/captain';
import { type Cargo, cargoCount, GOOD_INFO, GOODS } from '../economy/goods';
import { Land, SUPPLY_RANGE } from '../land/Land';
import { type Building, STORE_SIZE } from '../land/structures';
import type { NavHandlers } from './Overlay';

interface Container {
  label: string;
  cargo: Cargo;
  size: number;
}

/** The storehouse: move goods between it and your pack, or the ship's hold if she's anchored nearby. */
export function StoreScreen({ land, building, close, nav }: { land: Land; building: Building; close: () => void; nav: NavHandlers }) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const ship = land.sea.player;
  const w = land.walker;
  const shipNear = !!w && Math.hypot(ship.ship.x - w.x, ship.ship.z - w.z) < SUPPLY_RANGE;
  const [side, setSide] = useState<'pack' | 'hold'>('pack');
  useEffect(() => {
    nav.back = close;
    nav.tab = () => shipNear && setSide((s) => (s === 'pack' ? 'hold' : 'pack'));
  }, [nav, close, shipNear]);

  const store: Container = { label: 'Storehouse', cargo: building.store!, size: STORE_SIZE };
  const other: Container = side === 'pack' ? { label: 'Your pack', cargo: land.pack, size: PACK_SIZE } : { label: 'Ship’s hold', cargo: ship.cargo, size: ship.cls.type.hold };
  const move = (from: Container, to: Container, good: (typeof GOODS)[number], n: number) => {
    Land.transfer(from.cargo, to.cargo, good, n, to.size - cargoCount(to.cargo));
    redraw();
  };
  const goods = GOODS.filter((g) => (store.cargo[g] ?? 0) + (other.cargo[g] ?? 0) > 0);

  return (
    <div className="port-screen store-screen" role="dialog" aria-label="Storehouse">
      <header className="port-header">
        <div>
          <h2>Storehouse</h2>
          <span className="port-kind">
            {store.label} {cargoCount(store.cargo)}/{store.size} · {other.label} {cargoCount(other.cargo)}/{other.size}
          </span>
        </div>
        <button type="button" onClick={close}>
          Close
        </button>
      </header>
      <nav className="port-tabs">
        <button type="button" className={side === 'pack' ? 'active' : ''} onClick={() => setSide('pack')}>
          With your pack
        </button>
        <button type="button" className={side === 'hold' ? 'active' : ''} disabled={!shipNear} onClick={() => setSide('hold')}>
          With the ship’s hold{shipNear ? '' : ' (not in reach)'}
        </button>
      </nav>
      <div className="port-body">
        {goods.length === 0 ? (
          <p className="hint">Nothing to move.</p>
        ) : (
          <table className="market">
            <thead>
              <tr>
                <th>Good</th>
                <th className="num">{other.label}</th>
                <th />
                <th className="num">Storehouse</th>
              </tr>
            </thead>
            <tbody>
              {goods.map((g, i) => {
                const here = other.cargo[g] ?? 0;
                const there = store.cargo[g] ?? 0;
                return (
                  <tr key={g}>
                    <td>
                      <b>{GOOD_INFO[g].label}</b>
                    </td>
                    <td className="num">{here || '–'}</td>
                    <td className="actions">
                      <button type="button" data-autofocus={i === 0 ? true : undefined} disabled={here < 1} onClick={() => move(other, store, g, here)}>
                        Store all →
                      </button>
                      <button type="button" disabled={here < 1} onClick={() => move(other, store, g, 1)}>
                        1 →
                      </button>
                      <button type="button" className="sell" disabled={there < 1} onClick={() => move(store, other, g, 1)}>
                        ← 1
                      </button>
                      <button type="button" className="sell" disabled={there < 1} onClick={() => move(store, other, g, there)}>
                        ← Take all
                      </button>
                    </td>
                    <td className="num">{there || '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
