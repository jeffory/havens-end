import { clockText } from '../../core/clock';
import { ROOM_COST, ROUND_COST } from '../../economy/economy';
import { GOOD_INFO } from '../../economy/goods';
import { PORT_FACTIONS } from '../../economy/ports';
import { rankName } from '../../economy/reputation';
import { MAP_CASE, type Offer } from '../../treasure/Treasure';
import { islandName } from '../../worldgen/archipelago';
import { ContractCard, factionTitle, Gold, type TabProps } from './common';
import { People } from './People';

const FAVOURS = {
  imperial: 'A pardon, of sorts, from a clerk in the Governor’s office',
  merchant: 'A word with the guild’s ledger-keepers',
  pirate: 'Drinks and a promise for the Brethren',
};

/** Sailors for hire, gossip for the price of a round, and the fixer in the corner. */
export function TavernTab({ port, economy, sea, act, sleep, treasure, story }: TabProps) {
  const hands = economy.handsFor(port);
  const settlers = economy.settlersFor(port);
  const night = economy.afterDark();
  const gold = sea.captain.gold;
  const state = economy.states[port.id];
  const fixer = economy.fixers[port.id];
  const black = economy.lines(port, true);
  const blackJobs = sea.captain.contracts.filter((c) => c.kind === 'delivery' && c.black && c.port === port.id);
  const runs = economy.offers(port, 'fixer');
  const maps = treasure?.offersFor(port) ?? [];
  const caseFull = sea.captain.maps.length >= MAP_CASE;
  return (
    <section className="tab-tavern">
      <People port={port} place="tavern" story={story} act={act} />
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

      <h3>Settlers looking for work</h3>
      <div className="yard-row">
        <span>
          {settlers.available} would go out to a camp, <Gold amount={settlers.fee} /> each. They sail as passengers until you settle them.
        </span>
        <b className="num">aboard {sea.captain.passengers}</b>
        <span className="buttons">
          <button
            type="button"
            disabled={settlers.room < 1 || settlers.available < 1 || gold < settlers.fee}
            onClick={() => act(economy.hireSettlers(port, 1))}
          >
            Hire 1
          </button>
          <button
            type="button"
            disabled={settlers.room < 1 || settlers.available < 1 || gold < settlers.fee}
            onClick={() => act(economy.hireSettlers(port, settlers.available))}
          >
            Hire all
          </button>
        </span>
      </div>

      <h3>A room for the night</h3>
      <div className="yard-row">
        <span>
          It’s {clockText(sea.clock.phase)}. {night ? 'Sleep till morning' : 'Sleep the day away till dusk, when the fixer comes in'}, for <Gold amount={ROOM_COST} />.
        </span>
        <button
          type="button"
          disabled={gold < ROOM_COST || !sleep}
          onClick={() => {
            const room = economy.takeRoom();
            act(room);
            if (room.ok) sleep?.(night ? 'morning' : 'dusk');
          }}
        >
          Take a room
        </button>
      </div>

      <h3>Gossip</h3>
      <div className="yard-row">
        <span>Sailors talk, given a drink: news of prices and shortages across the islands{night ? ', and there’s more of it after dark' : ''}.</span>
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

      <h3>{night ? `${fixer}, in the corner` : 'The corner table'}</h3>
      {!night && <p className="lede">Empty. {fixer} only does business after dark; so does the back room.</p>}
      {night && (
        <>
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
        </>
      )}

      {night && treasure && maps.length > 0 && (
        <>
          <h4>Treasure maps</h4>
          <p className="lede">“Charts, captain. Some honest, some less so. All of them lead somewhere.”</p>
          {maps.map((offer) => {
            const { title, detail } = describeOffer(offer, islandName(treasure.islands[offer.map.site.island]));
            return (
              <div key={offer.map.id} className="yard-item">
                <div>
                  <b>{title}</b>
                  <small>
                    {detail}
                    {caseFull && ' · your map case is full'}
                  </small>
                </div>
                <button type="button" disabled={gold < offer.price || caseFull} onClick={() => act(treasure.buy(port, offer.map.id))}>
                  <Gold amount={offer.price} />
                </button>
              </div>
            );
          })}
        </>
      )}

      {night && runs.length > 0 && (
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

      {night && black.length > 0 && (
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

/** How the fixer describes a map without giving the spot away. */
function describeOffer(offer: Offer, island: string): { title: string; detail: string } {
  switch (offer.map.tier) {
    case 'near':
      return { title: `A scrap of chart: ${island}, with an X`, detail: 'In home waters. Easy digging.' };
    case 'mid':
      return { title: `A sketch of ${island}`, detail: 'Paces from a landmark, out in the contested seas.' };
    case 'far':
      return { title: 'A riddle on sailcloth', detail: `It names ${island}, among the far islands.` };
    default:
      return { title: `A map to ${island}`, detail: 'Where the ghost lights hang. The dead guard what’s theirs.' };
  }
}
