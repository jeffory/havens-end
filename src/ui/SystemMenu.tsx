import { useEffect, useState } from 'react';
import { DAY_MINUTE_CHOICES } from '../core/clock';
import { AUTOSAVE, listSaves, type SaveListing, type SaveSummary } from '../save/storage';
import type { Settings } from './settings';
import { focusFirst } from './menuNav';
import type { NavHandlers } from './Overlay';

export interface SystemMenuProps {
  /** Opened at startup: offer to carry on from the autosave. */
  title: boolean;
  summary: SaveSummary;
  resume: () => void;
  save: (name: string) => Promise<void>;
  load: (slot: string) => void;
  remove: (slot: string) => Promise<void>;
  newGame: () => void;
  /** The journal (for controllers: there's no journal button). */
  journal?: () => void;
  settings: Settings;
  changeSettings: (settings: Settings) => void;
  nav: NavHandlers;
}

type View = 'main' | 'save' | 'load' | 'new' | 'settings';

export const describe = (s: SaveSummary) => `${s.gold.toLocaleString('en')} g · ${s.ship} · ${s.place} · ${Math.floor(s.time / 60)} min at sea`;
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The game menu: carry on, save to a named slot, load, or start again. */
export function SystemMenu({ title, summary, resume, save, load, remove, newGame, journal, settings: initial, changeSettings, nav }: SystemMenuProps) {
  const [view, setView] = useState<View>('main');
  const [settings, setSettings] = useState(initial);
  const change = (next: Settings) => {
    setSettings(next);
    changeSettings(next);
  };
  const [saves, setSaves] = useState<SaveListing[] | null>(null);
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const refresh = () =>
    listSaves()
      .then(setSaves)
      .catch(() => {
        setSaves([]);
        setMessage('Saving isn’t available in this browser (private windows block it).');
      });

  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    nav.back = () => (view !== 'main' ? setView('main') : title ? undefined : resume());
  }, [nav, view, title, resume]);
  // Focus the view's first (or data-autofocus) button, again once the saves have loaded (Continue appears then).
  const loaded = saves !== null;
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.system-menu .port-body');
    if (el) requestAnimationFrame(() => focusFirst(el));
  }, [view, loaded]);

  const named = (saves ?? []).filter((s) => s.slot !== AUTOSAVE);
  const autosave = saves?.find((s) => s.slot === AUTOSAVE);
  useEffect(() => setName(`Captain’s log ${named.length + 1}`), [named.length]);

  const doSave = async (slot: string) => {
    try {
      await save(slot);
      setMessage(`Saved as “${slot}”.`);
      await refresh();
      setView('main');
    } catch (e) {
      setMessage(`Couldn’t save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="port-screen system-menu" role="dialog" aria-label="Game menu">
      <header className="port-header">
        <div>
          <h2>Haven’s End</h2>
          <span className="port-kind">{describe(summary)}</span>
        </div>
      </header>
      <div className="port-body">
        {view === 'main' && (
          <div className="system-buttons">
            {title && autosave && (
              <button type="button" className="primary" data-autofocus onClick={() => load(AUTOSAVE)}>
                Continue <small>{describe(autosave.summary)}</small>
              </button>
            )}
            {!title && (
              <button type="button" className="primary" data-autofocus onClick={resume}>
                Resume
              </button>
            )}
            {title && (
              <button type="button" onClick={resume}>
                New game
              </button>
            )}
            {!title && journal && (
              <button type="button" onClick={journal}>
                Journal
              </button>
            )}
            {!title && (
              <button type="button" onClick={() => setView('save')}>
                Save game…
              </button>
            )}
            <button type="button" disabled={!saves || saves.length === 0} onClick={() => setView('load')}>
              Load game…
            </button>
            {!title && (
              <button type="button" onClick={() => setView('new')}>
                New game…
              </button>
            )}
            <button type="button" onClick={() => setView('settings')}>
              Settings…
            </button>
          </div>
        )}

        {view === 'settings' && (
          <>
            <h3>Length of a day</h3>
            <div className="choice-row">
              {DAY_MINUTE_CHOICES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={m === settings.dayMinutes ? 'active' : ''}
                  aria-pressed={m === settings.dayMinutes}
                  data-autofocus={m === settings.dayMinutes ? true : undefined}
                  onClick={() => change({ ...settings, dayMinutes: m })}
                >
                  {m} min
                </button>
              ))}
            </div>
            <p className="hint">
              A whole day and night takes {settings.dayMinutes} minutes of play; about a third of it is night. Settlers work by day and sleep at night, when
              pirates prowl and creatures come out.
            </p>
          </>
        )}

        {view === 'save' && (
          <>
            <form
              className="save-form"
              onSubmit={(e) => {
                e.preventDefault();
                const slot = name.trim();
                if (slot && slot !== AUTOSAVE) void doSave(slot);
              }}
            >
              <label>
                Name <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
              </label>
              <button type="submit" className="primary" data-autofocus>
                Save
              </button>
            </form>
            {named.length > 0 && <h3>Or save over</h3>}
            <div className="yard-list">
              {named.map((s) => (
                <div key={s.slot} className="yard-item">
                  <div>
                    <b>{s.slot}</b>
                    <small>
                      {when(s.savedAt)} · {describe(s.summary)}
                    </small>
                  </div>
                  <button type="button" onClick={() => void doSave(s.slot)}>
                    Save over
                  </button>
                </div>
              ))}
            </div>
            <p className="hint">The game also saves itself every few minutes, when you dock, and when you rest at a fire or in a hut.</p>
          </>
        )}

        {view === 'load' && (
          <div className="yard-list">
            {(saves ?? []).map((s, i) => (
              <div key={s.slot} className="yard-item">
                <div>
                  <b>{s.slot === AUTOSAVE ? 'Autosave' : s.slot}</b>
                  <small>
                    {when(s.savedAt)} · {describe(s.summary)}
                  </small>
                </div>
                <span className="buttons">
                  <button type="button" data-autofocus={i === 0 ? true : undefined} onClick={() => load(s.slot)}>
                    Load
                  </button>
                  <button type="button" className="sell" onClick={() => void remove(s.slot).then(refresh)}>
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        {view === 'new' && (
          <div className="system-buttons">
            <p>Start again from Haven with a new sloop? Anything you haven’t saved is lost.</p>
            <button type="button" className="primary" data-autofocus onClick={newGame}>
              Start a new game
            </button>
            <button type="button" onClick={() => setView('main')}>
              Keep playing
            </button>
          </div>
        )}
      </div>
      <footer className="port-footer">
        <span className="port-log">{message}</span>
        <span className="port-keys">
          <kbd>Esc</kbd> / <kbd>B</kbd> back
        </span>
      </footer>
    </div>
  );
}
