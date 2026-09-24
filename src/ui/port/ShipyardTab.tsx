import { repairCosts, SHIP_LABELS, SHIPYARDS, UPGRADE_LIST, UPGRADES, upgradeCost } from '../../economy/shipyard';
import type { ShipType } from '../../sailing/ships';
import { Gold, type TabProps } from './common';

const stats = (t: ShipType) => `${t.gunsPerSide} guns a side · hull ${t.hull} · hold ${t.hold} · crew ${t.crew} · ${t.topSpeed.toFixed(1)} kn`;

/** Repairs, refits, and ships for sale in part-exchange. */
export function ShipyardTab({ port, economy, sea, act }: TabProps) {
  const v = sea.player;
  const type = v.cls.type;
  const repairs = repairCosts(v);
  const gold = sea.captain.gold;
  return (
    <section className="tab-shipyard">
      <h3>{SHIP_LABELS.get(v.cls.design)} · {v.name}</h3>
      <div className="yard-rows">
        <div className="yard-row">
          <span>Hull</span>
          <b className="num">
            {Math.ceil(v.hull)} / {type.hull}
          </b>
          <button type="button" data-autofocus disabled={repairs.hull <= 0} onClick={() => act(economy.repair('hull'))}>
            {repairs.hull > 0 ? (
              <>
                Repair · <Gold amount={repairs.hull} />
              </>
            ) : (
              'Sound'
            )}
          </button>
        </div>
        <div className="yard-row">
          <span>Sails</span>
          <b className="num">
            {Math.ceil(v.sails)} / {type.sails}
          </b>
          <button type="button" disabled={repairs.sails <= 0} onClick={() => act(economy.repair('sails'))}>
            {repairs.sails > 0 ? (
              <>
                Mend · <Gold amount={repairs.sails} />
              </>
            ) : (
              'Whole'
            )}
          </button>
        </div>
        <div className="yard-row">
          <span>Crew</span>
          <b className="num">
            {Math.floor(v.crew)} / {type.crew}
          </b>
          <small>Hire hands in the tavern.</small>
        </div>
        <div className="yard-row">
          <span>Guns</span>
          <b className="num">{type.gunsPerSide} a side</b>
          <small>
            hold {type.hold} · {type.topSpeed.toFixed(1)} kn
          </small>
        </div>
      </div>

      <h3>Refits</h3>
      <div className="yard-list">
        {UPGRADE_LIST.map((u) => {
          const has = v.upgrades.includes(u);
          const cost = upgradeCost(u, v.cls.design);
          return (
            <div key={u} className={`yard-item${has ? ' owned' : ''}`}>
              <div>
                <b>{UPGRADES[u].label}</b>
                <small>{UPGRADES[u].detail}</small>
              </div>
              <button type="button" disabled={has || cost > gold} onClick={() => act(economy.upgrade(u))}>
                {has ? 'Fitted' : <Gold amount={cost} />}
              </button>
            </div>
          );
        })}
      </div>

      <h3>Ships for sale</h3>
      <div className="yard-list">
        {SHIPYARDS[port.faction].map((t) => {
          const mine = v.cls.design === t;
          const { price, tradeIn, net } = economy.shipPrice(t);
          return (
            <div key={t.name} className={`yard-item${mine ? ' owned' : ''}`}>
              <div>
                <b>{SHIP_LABELS.get(t)}</b>
                <small>{stats(t)}</small>
                {!mine && (
                  <small>
                    <Gold amount={price} /> less <Gold amount={tradeIn} /> for yours
                  </small>
                )}
              </div>
              <button type="button" disabled={mine || net > gold} onClick={() => act(economy.buyShip(port, t))}>
                {mine ? 'Yours' : <Gold amount={net} />}
              </button>
            </div>
          );
        })}
      </div>
      <p className="hint">A new ship comes without refits. Your crew and cargo come across if she has room for them.</p>
    </section>
  );
}
