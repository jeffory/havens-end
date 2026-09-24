import { GOOD_INFO, cargoCount, isContraband } from '../../economy/goods';
import { bestSale } from '../../economy/logbook';
import type { Line } from '../../economy/market';
import { age, Gold, type TabProps } from './common';

const ROLE_NOTES: Record<Line['role'], string> = { produces: 'local produce', demands: 'in demand', trades: '' };

/** The goods table: buy and sell, with what the price book says you'd get elsewhere. */
export function MarketTab({ port, economy, sea, act }: TabProps) {
  const cargo = sea.player.cargo;
  const lines = economy.lines(port);
  const hold = sea.player.cls.type.hold;
  return (
    <section className="tab-market">
      <p className="lede">
        Hold <b>{cargoCount(cargo)}</b> / {hold} · purse <Gold amount={sea.captain.gold} />
        {economy.factor(port) > 1.001 && <span className="warn"> · Your poor name here costs you at the counter.</span>}
        {economy.factor(port) < 0.999 && <span className="good"> · Friends of the house get a better price.</span>}
      </p>
      <table className="market">
        <thead>
          <tr>
            <th>Good</th>
            <th className="num">Hold</th>
            <th className="num">Buy</th>
            <th className="num">Sell</th>
            <th>Best known elsewhere</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const { buy, sell } = economy.quote(port, line);
            const have = cargo[line.good] ?? 0;
            const max = economy.maxBuy(port, line.good);
            const best = bestSale(sea.captain.logbook, line.good, port.id);
            const profit = best ? best.price - buy : 0;
            return (
              <tr key={line.good}>
                <td>
                  <b>{GOOD_INFO[line.good].label}</b>
                  {ROLE_NOTES[line.role] && <small className={`role role-${line.role}`}>{ROLE_NOTES[line.role]}</small>}
                </td>
                <td className="num">{have || '–'}</td>
                <td className="num">{buy}</td>
                <td className="num">{sell}</td>
                <td className="elsewhere">
                  {best ? (
                    <>
                      <b className={profit > 0 ? 'good' : ''}>{best.price}</b> at {economy.ports[best.port].name}{' '}
                      <small>{age(best.time, sea.time)}</small>
                    </>
                  ) : (
                    <small>unknown</small>
                  )}
                </td>
                <td className="actions">
                  <button type="button" disabled={max < 1} onClick={() => act(economy.buy(port, line.good, 1))}>
                    Buy 1
                  </button>
                  <button type="button" disabled={max < 1} onClick={() => act(economy.buy(port, line.good, 10))}>
                    10
                  </button>
                  <button type="button" disabled={max < 1} onClick={() => act(economy.buy(port, line.good, max))}>
                    Max
                  </button>
                  <button type="button" className="sell" disabled={have < 1} onClick={() => act(economy.sell(port, line.good, 1))}>
                    Sell 1
                  </button>
                  <button type="button" className="sell" disabled={have < 1} onClick={() => act(economy.sell(port, line.good, have))}>
                    All
                  </button>
                </td>
              </tr>
            );
          })}
          {isContraband('muskets', port.faction) && (
            <tr className="contraband">
              <td>
                <b>{GOOD_INFO.muskets.label}</b>
                <small className="role">contraband</small>
              </td>
              <td className="num">{cargo.muskets || '–'}</td>
              <td colSpan={4}>
                <small>Arms are the Crown's monopoly here. There's talk of a buyer in the tavern's back room.</small>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="hint">Prices climb as you buy and fall as you sell, and recover over a few minutes. Your price book fills in as you visit ports and hear tavern gossip.</p>
    </section>
  );
}
