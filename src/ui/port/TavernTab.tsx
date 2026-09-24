import { ROUND_COST } from '../../economy/economy';
import { GOOD_INFO } from '../../economy/goods';
import { PORT_FACTIONS } from '../../economy/ports';
import { rankName } from '../../economy/reputation';
import { ContractCard, factionTitle, Gold, type TabProps } from './common';

const FAVOURS = {
  imperial: 'A pardon, of sorts, from a clerk in the Governor’s office',
  merchant: 'A word with the guild’s ledger-keepers',
  pirate: 'Drinks and a promise for the Brethren',
};

/** Sailors for hire, gossip for the price of a round, and the fixer in the corner. */
export function TavernTab({ port, economy, sea, act }: TabProps) {
  const hands = economy.handsFor(port);
  const gold = sea.captain.gold;
  const state = economy.states[port.id];
  const fixer = economy.fixers[port.id];
  const black = economy.lines(port, true);
  const blackJobs = sea.captain.contracts.filter((c) => c.kind === 'delivery' && c.black && c.port === port.id);
  const runs = economy.offers(port, 'fixer');
  return (
    <section className="tab-tavern">
      <h3>Sailors for hire</h3>
      <div className="yard-row">
        <span>
          {hands.available} looking for a berth, <Gold amount={hands.wage} /> each to sign on
        </span>
        <b className="num">
          crew {Math.floor(sea.player.crew)} / {sea.player.cls.type.crew}
        </b>
        <span className="buttons">
          <button type="button" data-autofocus disabled={hands.room < 1 || hands.available < 1 || gold < hands.wage} onClick={() => act(economy.hire(port, 1))}>
            Hire 1
          </button>
          <button type="button" disabled={hands.room < 1 || hands.available < 1 || gold < hands.wage} onClick={() => act(economy.hire(port, hands.room))}>
            Fill the crew
          </button>
        </span>
      </div>

      <h3>Gossip</h3>
      <div className="yard-row">
        <span>Sailors talk, given a drink: news of prices and shortages across the islands.</span>
        <button type="button" disabled={gold < ROUND_COST} onClick={() => act(economy.buyRound(port))}>
          Buy a round · <Gold amount={ROUND_COST} />
        </button>
      </div>
      {state.rumours.length > 0 && (
        <ul className="rumours">
          {state.rumours.map((r) => (
            <li key={r}>“{r}”</li>
          ))}
        </ul>
      )}

      <h3>{fixer}, in the corner</h3>
      <p className="lede">
        “Trouble with the authorities, captain? Everyone’s trouble has a price.”
      </p>
      <div className="yard-list">
        {PORT_FACTIONS.map((f) => {
          const cost = economy.bribeCost(f);
          const value = sea.captain.standing[f];
          return (
            <div key={f} className="yard-item">
              <div>
                <b>{FAVOURS[f]}</b>
                <small>
                  {factionTitle(f)}: {rankName(value)} ({value > 0 ? `+${value}` : value}){cost !== null && ' · raises your standing by up to 15'}
                </small>
              </div>
              <button type="button" disabled={cost === null || cost > gold} onClick={() => act(economy.bribe(port, f))}>
                {cost === null ? 'Nothing to fix' : <Gold amount={cost} />}
              </button>
            </div>
          );
        })}
      </div>

      {runs.length > 0 && (
        <>
          <h4>{port.faction === 'pirate' ? 'A job for the Brethren' : 'A quiet job'}</h4>
          {runs.map((c) => (
            <ContractCard
              key={c.id}
              contract={c}
              economy={economy}
              sea={sea}
              action={{ label: 'Take the job', disabled: !economy.canAccept(c), onClick: () => act(economy.accept(port, c.id)) }}
            />
          ))}
        </>
      )}

      {black.length > 0 && (
        <>
          <h4>The back room</h4>
          {blackJobs.map((c) => (
            <ContractCard
              key={c.id}
              contract={c}
              economy={economy}
              sea={sea}
              action={{ label: 'Hand over', disabled: !economy.ready(port, c), onClick: () => act(economy.turnIn(port, c.id)) }}
            />
          ))}
          {black.map((line) => {
            const { buy, sell } = economy.quote(port, line, true);
            const have = sea.player.cargo[line.good] ?? 0;
            const max = economy.maxBuy(port, line.good, true);
            return (
              <div key={line.good} className="yard-item">
                <div>
                  <b>{GOOD_INFO[line.good].label}</b>
                  <small>
                    buys at {sell}, sells at {buy} · you have {have || 'none'}
                  </small>
                </div>
                <span className="buttons">
                  <button type="button" className="sell" disabled={have < 1} onClick={() => act(economy.sell(port, line.good, have, true))}>
                    Sell all
                  </button>
                  <button type="button" disabled={max < 1} onClick={() => act(economy.buy(port, line.good, 1, true))}>
                    Buy 1
                  </button>
                </span>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
