import { useEffect, useReducer, useRef, useState } from 'react';
import type { Sea } from '../../combat/sea';
import { contractTitle, turnInPort } from '../../economy/contracts';
import type { Economy, Notice, Outcome } from '../../economy/economy';
import { cargoCount, GOOD_INFO, GOODS } from '../../economy/goods';
import { knownRoutes } from '../../economy/logbook';
import { FACTION_NAMES, type Port, PORT_KINDS } from '../../economy/ports';
import { type ChartProps, ChartView } from '../ChartView';
import { focusFirst } from '../menuNav';
import type { NavHandlers } from '../Overlay';
import { age, Gold, MessageLog, StandingBars, timeLeft } from './common';
import { MarketTab } from './MarketTab';
import { OFFICE_NAMES, OfficeTab } from './OfficeTab';
import { ShipyardTab } from './ShipyardTab';
import { TavernTab } from './TavernTab';

type Tab = 'harbour' | 'market' | 'shipyard' | 'tavern' | 'office' | 'chart';
const TABS: readonly Tab[] = ['harbour', 'market', 'shipyard', 'tavern', 'office', 'chart'];

const WELCOMES = {
  imperial: 'Red-coated marines watch the quay from under the Crown’s flag.',
  merchant: 'Warehouses, chandlers and a harbour master who asks no awkward questions.',
  pirate: 'Rum, rope and cutthroats. Nobody here asks where your cargo came from.',
};

export interface PortScreenProps {
  port: Port;
  economy: Economy;
  sea: Sea;
  /** What happened coming ashore (customs, jobs to hand in). */
  arrival: Notice[];
  leave: () => void;
  nav: NavHandlers;
  /** The sea chart, for planning the next run from port. */
  chart: Omit<ChartProps, 'economy' | 'sea'>;
}

/** Ashore in a port: the harbour, market, shipyard, tavern and the port's masters, as tabs. */
export function PortScreen({ port, economy, sea, arrival, leave, nav, chart }: PortScreenProps) {
  const [tab, setTab] = useState<Tab>('harbour');
  const [log, setLog] = useState<Notice[]>(arrival);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const body = useRef<HTMLDivElement>(null);
  const setSail = useRef<HTMLButtonElement>(null);

  const act = (outcome: Outcome) => {
    const news = economy.takeNotices();
    setLog((l) => [...l, { text: outcome.message, tone: outcome.ok ? 'good' : 'bad' } as Notice, ...news].slice(-4));
    redraw();
  };

  useEffect(() => {
    nav.tab = (step) => setTab((t) => TABS[(TABS.indexOf(t) + step + TABS.length) % TABS.length]);
    nav.back = () => (tab === 'harbour' ? setSail.current?.focus() : setTab('harbour'));
    nav.chart = () => setTab((t) => (t === 'chart' ? 'harbour' : 'chart'));
  }, [nav, tab]);

  useEffect(() => {
    if (body.current) focusFirst(body.current);
  }, [tab]);

  const v = sea.player;
  const labels: Record<Tab, string> = {
    harbour: 'Harbour',
    market: 'Market',
    shipyard: 'Shipyard',
    tavern: 'Tavern',
    office: OFFICE_NAMES[port.faction],
    chart: 'Chart',
  };
  const props = { port, economy, sea, act };
  return (
    <div className={`port-screen faction-${port.faction}`} role="dialog" aria-label={port.name}>
      <header className="port-header">
        <div>
          <h2>{port.name}</h2>
          <span className="port-kind">
            {PORT_KINDS[port.faction]} · {FACTION_NAMES[port.faction]}
          </span>
        </div>
        <div className="port-purse">
          <span>
            <Gold amount={sea.captain.gold} />
          </span>
          <span>
            hold {cargoCount(v.cargo)}/{v.cls.type.hold}
          </span>
          <span>
            crew {Math.floor(v.crew)}/{v.cls.type.crew}
          </span>
          <span>
            hull {Math.ceil(v.hull)}/{v.cls.type.hull}
          </span>
        </div>
      </header>
      <nav className="port-tabs" aria-label="Places in port">
        {TABS.map((t) => (
          <button key={t} type="button" className={t === tab ? 'active' : ''} aria-pressed={t === tab} onClick={() => setTab(t)}>
            {labels[t]}
          </button>
        ))}
      </nav>
      <div className="port-body" ref={body}>
        {tab === 'harbour' && (
          <section className="tab-harbour">
            <p className="lede">{WELCOMES[port.faction]}</p>
            <StandingBars sea={sea} highlight={port.faction} />
            <h3>Your jobs</h3>
            {sea.captain.contracts.length === 0 ? (
              <p className="hint">None. Look for work with the {OFFICE_NAMES[port.faction].toLowerCase()}, or ask the fixer in the tavern.</p>
            ) : (
              <ul className="jobs">
                {sea.captain.contracts.map((c) => (
                  <li key={c.id}>
                    <b>{contractTitle(c, economy.ports)}</b> · {timeLeft(c.deadline, sea.time)} left · hand in at {economy.ports[turnInPort(c)].name}
                    {c.kind === 'bounty' && ` · ${c.progress}/${c.count}`}
                  </li>
                ))}
              </ul>
            )}
            <h3>Trade routes in your price book</h3>
            <RouteList economy={economy} sea={sea} />
            <div className="set-sail">
              <button type="button" ref={setSail} data-autofocus className="primary" onClick={leave}>
                Set sail
              </button>
            </div>
          </section>
        )}
        {tab === 'market' && <MarketTab {...props} />}
        {tab === 'shipyard' && <ShipyardTab {...props} />}
        {tab === 'tavern' && <TavernTab {...props} />}
        {tab === 'office' && <OfficeTab {...props} />}
        {tab === 'chart' && <ChartView {...chart} economy={economy} sea={sea} />}
      </div>
      <footer className="port-footer">
        <MessageLog messages={log} />
        <span className="port-keys">
          <kbd>Q</kbd>
          <kbd>E</kbd> / <kbd>LB</kbd>
          <kbd>RB</kbd> places · <kbd>Esc</kbd> / <kbd>B</kbd> back · <kbd>M</kbd> chart
        </span>
      </footer>
    </div>
  );
}

export function RouteList({ economy, sea }: { economy: Economy; sea: Sea }) {
  const routes = knownRoutes(sea.captain.logbook, GOODS);
  if (routes.length === 0) return <p className="hint">Visit more ports, or buy a round in a tavern, to learn where goods are cheap and where they’re dear.</p>;
  return (
    <ul className="routes">
      {routes.map((r) => (
        <li key={r.good}>
          <b>{GOOD_INFO[r.good].label}</b>: buy at {economy.ports[r.from.port].name} ({r.from.price}), sell at {economy.ports[r.to.port].name} ({r.to.price}){' '}
          <b className="good">+{r.margin}</b> a unit <small>· {age(Math.min(r.from.time, r.to.time), sea.time)}</small>
        </li>
      ))}
    </ul>
  );
}
