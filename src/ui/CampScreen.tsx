import { useEffect, useReducer, useState } from 'react';
import { clockText } from '../core/clock';
import { PASSENGER_BERTHS } from '../economy/captain';
import { type Cargo, GOOD_INFO, type Good, GOODS } from '../economy/goods';
import { beds, campStores, campWorkshops, recipeOf, stock, storeRoom, type WorkshopState } from '../land/camps';
import type { Land } from '../land/Land';
import { foodDays, JOB_LABELS, type Job, type Settler } from '../land/settlers';
import { type Building, type Recipe, STORE_SIZE, STRUCTURES } from '../land/structures';
import { focusFirst } from './menuNav';
import type { NavHandlers } from './Overlay';

export type CampTab = 'settlers' | 'workshops' | 'stores';
const TABS: readonly CampTab[] = ['settlers', 'workshops', 'stores'];
const TAB_LABELS: Record<CampTab, string> = { settlers: 'Settlers', workshops: 'Workshops', stores: 'Stores' };

export interface CampScreenProps {
  land: Land;
  fire: Building;
  tab: CampTab;
  /** Evening or night: sleeping passes the night. */
  sleepy: boolean;
  rest: () => void;
  close: () => void;
  nav: NavHandlers;
}

/** A job a settler can be given: a trade, or a hand at one of the camp's workshops. */
interface JobChoice {
  job: Job;
  post: number | null;
  label: string;
}

const cost = (cargo: Cargo) =>
  (Object.entries(cargo) as Array<[Good, number]>).map(([g, n]) => `${n} ${GOOD_INFO[g].label.toLowerCase()}`).join(' + ');
const recipeText = (r: Recipe) => `${cost(r.inputs)} → ${cost(r.outputs)}`;

function stateText(state: WorkshopState, recipe: Recipe): string {
  switch (state) {
    case 'working':
      return `Making ${recipe.label.toLowerCase()}`;
    case 'no-worker':
      return 'No hand here: give a settler the job';
    case 'coming':
      return 'Their hand is on the way';
    case 'off-duty':
      return 'Shut for the night';
    case 'no-store':
      return 'Needs a storehouse in the camp';
    case 'short':
      return `Waiting for ${cost(recipe.inputs)} in the storehouse`;
    case 'full':
      return 'The storehouse is full';
  }
}

/** The camp, from its fire: who lives here and what they do, the workshops, and what's in store. */
export function CampScreen({ land, fire, tab: initial, sleepy, rest, close, nav }: CampScreenProps) {
  const [tab, setTab] = useState<CampTab>(initial);
  const [message, setMessage] = useState('');
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    nav.back = close;
    nav.tab = (step) => setTab((t) => TABS[(TABS.indexOf(t) + step + TABS.length) % TABS.length]);
  }, [nav, close]);
  useEffect(() => {
    const body = document.querySelector<HTMLElement>('.camp-screen .port-body');
    if (body) requestAnimationFrame(() => focusFirst(body));
  }, [tab]);
  const act = (outcome: { ok: boolean; message: string }) => {
    setMessage(outcome.message);
    redraw();
  };

  const settlers = land.settlersAt(fire);
  const workshops = campWorkshops(land.buildings, fire);
  const stores = campStores(land.buildings, fire);
  const aboard = land.sea.captain.passengers;
  const bedCount = beds(land.buildings, fire);
  const choices: JobChoice[] = [
    ...(['idle', 'farmer', 'woodcutter', 'miner', 'fisher'] as const).map((job) => ({ job, post: null, label: JOB_LABELS[job] })),
    ...workshops.map((b) => ({ job: 'worker' as const, post: b.id, label: `${STRUCTURES[b.kind].label} hand` })),
  ];
  const choiceOf = (s: Settler) => Math.max(0, choices.findIndex((c) => c.job === s.job && c.post === s.post));
  const cycle = (s: Settler, step: number) => {
    const next = choices[(choiceOf(s) + step + choices.length) % choices.length];
    act(land.assign(s.id, next.job, next.post));
  };
  const clock = land.sea.clock;

  return (
    <div className="port-screen camp-screen" role="dialog" aria-label="Your camp">
      <header className="port-header">
        <div>
          <h2>Your camp</h2>
          <span className="port-kind">
            Day {clock.day}, {clockText(clock.phase)} · {settlers.length} settler{settlers.length === 1 ? '' : 's'} · {bedCount} bed{bedCount === 1 ? '' : 's'}
          </span>
        </div>
        <span className="buttons">
          <button type="button" onClick={rest}>
            {sleepy ? 'Sleep till morning' : 'Rest'} (saves)
          </button>
          <button type="button" onClick={close}>
            Close
          </button>
        </span>
      </header>
      <nav className="port-tabs" aria-label="Camp">
        {TABS.map((t) => (
          <button key={t} type="button" className={t === tab ? 'active' : ''} aria-pressed={t === tab} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>
      <div className="port-body">
        {tab === 'settlers' && (
          <section>
            <div className="yard-row">
              <span>
                Aboard your ship: <b>{aboard}</b> settler{aboard === 1 ? '' : 's'} (berths for {PASSENGER_BERTHS}). Free beds here: <b>{Math.max(0, bedCount - settlers.length)}</b>.
              </span>
              <button type="button" data-autofocus disabled={aboard < 1} onClick={() => act(land.settle(fire, aboard))}>
                Bring them ashore
              </button>
            </div>
            {settlers.length === 0 ? (
              <p className="hint">
                Nobody lives here yet. Hire settlers in a tavern; they need a hut to sleep in (two to a hut) and food in the storehouse each morning.
              </p>
            ) : (
              settlers.map((s) => (
                <div key={s.id} className="settler-row">
                  <div>
                    <b>{s.name}</b>
                    <small className={s.hungry > 0 ? 'warn' : ''}>{s.doing}</small>
                  </div>
                  <span className="buttons">
                    <button type="button" aria-label="Previous job" onClick={() => cycle(s, -1)}>
                      ◂
                    </button>
                    <b className="job">{choices[choiceOf(s)].label}</b>
                    <button type="button" aria-label="Next job" onClick={() => cycle(s, 1)}>
                      ▸
                    </button>
                  </span>
                  <span className="buttons">
                    <button type="button" className="sell" onClick={() => act(land.sendAboard(s.id))}>
                      Send aboard
                    </button>
                  </span>
                </div>
              ))
            )}
            <p className="hint">
              Farmers harvest ripe crops and sow them again with seed from the storehouse. Woodcutters fell trees near the camp and plant saplings;
              fishers work the shore. A workshop needs a hand to make anything. Everyone sleeps at night.
            </p>
          </section>
        )}

        {tab === 'workshops' && (
          <section>
            {workshops.length === 0 ? (
              <p className="hint">No workshops yet. Build a sawpit, sugar mill, distillery, curing shed, smokehouse or forge from the build menu (B).</p>
            ) : (
              workshops.map((b, i) => {
                const spec = STRUCTURES[b.kind];
                const recipe = recipeOf(b);
                const hand = land.settlers.find((s) => s.post === b.id);
                const recipes = spec.recipes!;
                return (
                  <div key={b.id} className="workshop-row">
                    <div>
                      <b>{spec.label}</b>
                      <small>{hand ? hand.name : 'No hand'}</small>
                    </div>
                    <div>
                      <span>{recipeText(recipe)}</span>
                      <small>
                        {stateText(land.workshopState(b), recipe)} · {recipe.seconds}s a batch
                      </small>
                    </div>
                    <div className="progress" role="progressbar" aria-valuenow={Math.round((b.work?.progress ?? 0) * 100)}>
                      <div style={{ width: `${(b.work?.progress ?? 0) * 100}%` }} />
                    </div>
                    <span className="buttons">
                      {recipes.length > 1 && (
                        <button
                          type="button"
                          data-autofocus={i === 0 ? true : undefined}
                          disabled={(b.work?.progress ?? 0) > 0}
                          title={(b.work?.progress ?? 0) > 0 ? 'Finish the batch in hand first' : undefined}
                          onClick={() => {
                            b.work!.recipe = (b.work!.recipe + 1) % recipes.length;
                            redraw();
                          }}
                        >
                          Make {recipes[((b.work?.recipe ?? 0) + 1) % recipes.length].label.toLowerCase()} instead
                        </button>
                      )}
                    </span>
                  </div>
                );
              })
            )}
            <p className="hint">Workshops take what they need from the camp’s storehouses and put what they make back. They work while their hand is there, by day.</p>
          </section>
        )}

        {tab === 'stores' && <Stores land={land} fire={fire} stores={stores} />}
      </div>
      <footer className="port-footer">
        <span className="port-log">{message}</span>
        <span className="port-keys">
          <kbd>Q</kbd>
          <kbd>E</kbd> / <kbd>LB</kbd>
          <kbd>RB</kbd> tabs · <kbd>Esc</kbd> / <kbd>B</kbd> back
        </span>
      </footer>
    </div>
  );
}

function Stores({ land, fire, stores }: { land: Land; fire: Building; stores: Cargo[] }) {
  const total = stock(stores);
  const goods = GOODS.filter((g) => (total[g] ?? 0) > 0);
  const days = foodDays(land, fire);
  const capacity = stores.length * STORE_SIZE;
  return (
    <section>
      {stores.length === 0 ? (
        <p className="hint">This camp has no storehouse. Settlers and workshops need one to keep what they make, and food for the mornings.</p>
      ) : (
        <>
          <p className="lede">
            {stores.length} storehouse{stores.length === 1 ? '' : 's'}, {capacity - storeRoom(stores)} of {capacity} full.{' '}
            {Number.isFinite(days) ? (
              <span className={days < 2 ? 'warn' : 'good'}>
                Food for {days} day{days === 1 ? '' : 's'}.
              </span>
            ) : null}
          </p>
          {goods.length === 0 ? (
            <p className="hint">Empty.</p>
          ) : (
            <div className="stock-grid">
              {goods.map((g) => (
                <span key={g}>
                  {GOOD_INFO[g].label} <b className="num">{total[g]}</b>
                </span>
              ))}
            </div>
          )}
        </>
      )}
      <p className="hint">
        Settlers eat one food each at sunrise: provisions, fish, meat or maize. Move goods in and out at a storehouse door, or sell them in port.
      </p>
    </section>
  );
}
