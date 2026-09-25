import { useEffect, useState } from 'react';
import type { NavHandlers } from '../Overlay';

export interface Panel {
  image: string;
  text: string;
}

/**
 * Painted pictures with their words, one after another (the intro, the epilogue).
 * Next goes on; Skip (Esc, B) or the last Next closes.
 */
export function StoryPanels({ panels, done, nav, title }: { panels: readonly Panel[]; done: () => void; nav: NavHandlers; title?: string }) {
  const [index, setIndex] = useState(0);
  const panel = panels[index];
  const last = index === panels.length - 1;
  useEffect(() => {
    nav.back = done;
    nav.tab = (step) => setIndex((i) => Math.max(0, Math.min(panels.length - 1, i + step)));
  }, [nav, done, panels.length]);
  // Fetch the next picture while this one is read.
  useEffect(() => {
    const next = panels[index + 1];
    if (next) new Image().src = `${import.meta.env.BASE_URL}${next.image}`;
  }, [index, panels]);
  return (
    <div className="story-panels" role="dialog" aria-label={title ?? 'Story'}>
      <img key={panel.image} className="story-picture" src={`${import.meta.env.BASE_URL}${panel.image}`} alt="" />
      <div className="story-words">
        {title && index === 0 && <h2>{title}</h2>}
        <p>{panel.text}</p>
        <div className="buttons">
          {!last && (
            <button type="button" onClick={done}>
              Skip
            </button>
          )}
          <button type="button" className="primary" data-autofocus onClick={() => (last ? done() : setIndex(index + 1))}>
            {last ? 'Set sail' : 'Next'}
          </button>
        </div>
        <span className="story-dots">
          {panels.map((p, i) => (
            <i key={p.image} className={i === index ? 'on' : ''} />
          ))}
        </span>
      </div>
    </div>
  );
}
