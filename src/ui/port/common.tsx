import type { Sea } from '../../combat/sea';
import { BOUNTY_NOUNS, type Contract, contractTitle } from '../../economy/contracts';
import type { Economy, Notice, Outcome } from '../../economy/economy';
import { GOOD_INFO } from '../../economy/goods';
import { FACTION_NAMES, type Port, PORT_FACTIONS, type PortFaction } from '../../economy/ports';
import { CLOSED_AT, rankName } from '../../economy/reputation';
import type { Treasure } from '../../treasure/Treasure';

/** Everything a port screen tab needs to show and change the game. */
export interface TabProps {
  port: Port;
  economy: Economy;
  sea: Sea;
  /** Runs an order and reports how it went. */
  act: (outcome: Outcome) => void;
  /** A room above the tavern: sleep until morning, or until dusk. */
  sleep?: (until: 'morning' | 'dusk') => void;
  /** Buried treasure: the fixer's maps. */
  treasure?: Treasure;
}

export const Gold = ({ amount }: { amount: number }) => (
  <span className="gold">
    {amount.toLocaleString('en')}
    <small> g</small>
  </span>
);

/** m:ss from now until a sea-time deadline. */
export function timeLeft(deadline: number, now: number): string {
  const s = Math.max(0, Math.floor(deadline - now));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "3 min ago" for price notes. */
export function age(time: number, now: number): string {
  const minutes = Math.floor((now - time) / 60);
  return minutes < 1 ? 'just now' : `${minutes} min ago`;
}

export const factionTitle = (f: PortFaction) => FACTION_NAMES[f].replace(/^the /, '');

/** Standing with each flag, as a bar from -100 to 100 with its rank. */
export function StandingBars({ sea, highlight }: { sea: Sea; highlight?: PortFaction }) {
  return (
    <div className="standing-bars">
      {PORT_FACTIONS.map((f) => {
        const value = sea.captain.standing[f];
        const closed = value <= CLOSED_AT[f];
        return (
          <div key={f} className={`standing faction-${f}${f === highlight ? ' here' : ''}`}>
            <span className="standing-name">{factionTitle(f)}</span>
            <div className="standing-bar">
              <div className="standing-zero" />
              <div
                className={`standing-fill ${value < 0 ? 'neg' : 'pos'}`}
                style={value < 0 ? { right: '50%', width: `${-value / 2}%` } : { left: '50%', width: `${value / 2}%` }}
              />
            </div>
            <span className="standing-rank">
              {rankName(value)} <small>({value > 0 ? `+${value}` : value})</small>
              {closed && <em> · ports closed</em>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A job: what it is, what it pays, and a button (take it, or hand it in). */
export function ContractCard({
  contract,
  economy,
  sea,
  action,
}: {
  contract: Contract;
  economy: Economy;
  sea: Sea;
  action?: { label: string; disabled?: boolean; onClick: () => void };
}) {
  const c = contract;
  const ports = economy.ports;
  const from = ports[c.issuer];
  return (
    <div className={`contract${c.kind === 'delivery' && c.black ? ' black' : ''}`}>
      <div className="contract-body">
        <b>{contractTitle(c, ports)}</b>
        <div className="contract-terms">
          Pays <Gold amount={c.reward} />
          {c.standing > 0 && ` · +${c.standing} with ${FACTION_NAMES[c.faction]}`}
          {c.kind === 'delivery' && (
            <>
              {' '}
              · bond <Gold amount={c.bond} />
            </>
          )}{' '}
          · <span className="contract-time">{timeLeft(c.deadline, sea.time)}</span> to do it
        </div>
        <div className="contract-note">
          {c.kind === 'bounty'
            ? `${c.progress} of ${c.count} ${BOUNTY_NOUNS[c.target][1]} so far · collect at ${from.name}`
            : c.black
              ? `Muskets are contraband there: customs may search you. Hand over in the tavern.`
              : `${GOOD_INFO[c.good].label} from ${from.name}; loaded when you agree`}
        </div>
      </div>
      {action && (
        <button type="button" disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

export function MessageLog({ messages }: { messages: Notice[] }) {
  return (
    <div className="port-log" aria-live="polite">
      {messages.map((m, i) => (
        <div key={`${i}-${m.text}`} className={`log-${m.tone}`}>
          {m.text}
        </div>
      ))}
    </div>
  );
}
