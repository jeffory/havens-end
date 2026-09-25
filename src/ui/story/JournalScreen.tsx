import { useEffect, useState } from 'react';
import { ADMIRAL } from '../../story/script';
import type { Story } from '../../story/Story';
import type { NavHandlers } from '../Overlay';

/** The captain's journal: the story so far, what's to be done, and what people have said. */
export function JournalScreen({ story, close, nav, replay }: { story: Story; close: () => void; nav: NavHandlers; replay: () => void }) {
  const entries = story.journal();
  const [selected, setSelected] = useState(entries.length - 1);
  const entry = entries[Math.min(selected, entries.length - 1)];
  useEffect(() => {
    nav.back = close;
    nav.journal = close;
    nav.tab = (step) => setSelected((i) => Math.max(0, Math.min(entries.length - 1, i + step)));
  }, [nav, close, entries.length]);
  return (
    <div className="port-screen journal-screen" role="dialog" aria-label="Journal">
      <header className="port-header">
        <div>
          <h2>Journal</h2>
          <span className="port-kind">The admiral: {story.admiralKnown ? ADMIRAL : 'name unknown'}</span>
        </div>
        <span className="buttons">
          <button type="button" onClick={replay}>
            The story so far
          </button>
          <button type="button" onClick={close}>
            Close
          </button>
        </span>
      </header>
      <div className="port-body journal">
        <nav className="journal-entries">
          {entries.map((e, i) => (
            <button
              key={e.stage}
              type="button"
              className={`${i === selected ? 'selected' : ''}${e.current ? ' current' : ''}`}
              data-autofocus={i === entries.length - 1 ? true : undefined}
              onFocus={() => setSelected(i)}
              onClick={() => setSelected(i)}
            >
              {e.title}
              <small>{e.current ? 'now' : `day ${e.day + 1}`}</small>
            </button>
          ))}
        </nav>
        <article className="journal-page">
          <h3>{entry.title}</h3>
          <p>{entry.text}</p>
          {entry.objectives.length > 0 && (
            <ul className="objectives">
              {entry.objectives.map((o) => (
                <li key={o.text} className={o.done ? 'done' : ''}>
                  {o.text}
                </li>
              ))}
            </ul>
          )}
          {entry.words.length > 0 && (
            <>
              <h4>What people have told you</h4>
              {entry.words.map((w, i) => (
                <blockquote key={i}>
                  {w.lines.map((line, j) => (
                    <p key={j}>“{line}”</p>
                  ))}
                  <cite>{w.who}</cite>
                </blockquote>
              ))}
            </>
          )}
        </article>
      </div>
      <footer className="port-footer">
        <span className="port-keys">
          <kbd>Q</kbd> <kbd>E</kbd> entries · <kbd>J</kbd> / <kbd>Esc</kbd> close
        </span>
      </footer>
    </div>
  );
}
