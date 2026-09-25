import { useState } from 'react';
import type { Outcome } from '../../economy/economy';
import type { Port } from '../../economy/ports';
import type { Story, Talk } from '../../story/Story';

/**
 * The story's people at this door, when they have something to say: Nell at Haven's
 * Guildhall, Quill and Red Mary in the pirate haven's tavern, Finch after dark in the
 * Crown's. Talking shows their words; some end in a choice.
 */
export function People({ port, place, story, act }: { port: Port; place: 'office' | 'tavern'; story?: Story; act: (outcome: Outcome) => void }) {
  const [shown, setShown] = useState<Talk | null>(null);
  if (!story) return null;
  // What was said goes in the port's log; the journal's news with it.
  const say = (outcome: Outcome) => {
    const message = [outcome.message, ...story.takeNotices().map((n) => n.text)].filter(Boolean).join(' ');
    if (message) act({ ok: outcome.ok, message });
  };
  if (shown) {
    return (
      <section className="talk" aria-label={shown.name}>
        <header>
          <b>{shown.name}</b>
          <small>{shown.role}</small>
        </header>
        {shown.lines.map((line, i) => (
          <p key={i}>“{line}”</p>
        ))}
        <div className="buttons">
          {shown.choices.map((c) => (
            <button
              key={c.id}
              type="button"
              className="primary"
              data-autofocus
              onClick={() => {
                say(story.talk(shown.id, c.id));
                setShown(null);
              }}
            >
              {c.label}
            </button>
          ))}
          <button type="button" data-autofocus={shown.choices.length === 0 ? true : undefined} onClick={() => setShown(null)}>
            {shown.choices.length ? 'Not yet' : 'Farewell'}
          </button>
        </div>
      </section>
    );
  }
  const talks = story.talksAt(port, place);
  if (talks.length === 0) return null;
  return (
    <>
      <h3>Someone to see</h3>
      {talks.map((talk) => (
        <div key={talk.id} className="yard-item person">
          <div>
            <b>{talk.name}</b>
            <small>{talk.role}</small>
          </div>
          <button
            type="button"
            className="primary"
            data-autofocus
            onClick={() => {
              setShown(talk);
              if (talk.choices.length === 0) say(story.talk(talk.id));
            }}
          >
            Talk
          </button>
        </div>
      ))}
    </>
  );
}
