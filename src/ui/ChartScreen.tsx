import { useEffect, useState } from 'react';
import { type ChartMode, type ChartProps, ChartView } from './ChartView';
import type { NavHandlers } from './Overlay';

/** The chart at sea: the game waits while you study it, or your treasure maps. */
export function ChartScreen({ close, nav, view: first = 'chart', ...chart }: ChartProps & { close: () => void; nav: NavHandlers; view?: ChartMode }) {
  const [view, setView] = useState<ChartMode>(first);
  useEffect(() => {
    nav.back = close;
    nav.chart = close;
    nav.tab = () => setView((v) => (v === 'chart' ? 'maps' : 'chart'));
  }, [nav, close]);
  return (
    <div className="port-screen chart-screen" role="dialog" aria-label="Sea chart">
      <header className="port-header">
        <div>
          <h2>{view === 'chart' ? 'Sea chart' : 'Treasure maps'}</h2>
          <span className="port-kind">
            {view === 'chart' ? 'Choose a port to steer for: the compass will point the way.' : 'Find the landmark, count your paces (a pace is a block), and dig there (F).'}
          </span>
        </div>
        <button type="button" onClick={close}>
          Close
        </button>
      </header>
      <div className="port-body">
        <ChartView {...chart} view={view} setView={setView} />
      </div>
      <footer className="port-footer">
        <span className="port-keys">
          <kbd>↑</kbd>
          <kbd>↓</kbd> choose · <kbd>Enter</kbd> / <kbd>A</kbd> {view === 'chart' ? 'set course' : 'read'} · <kbd>Q</kbd> <kbd>E</kbd> chart or maps · <kbd>M</kbd> / <kbd>Esc</kbd> close
        </span>
      </footer>
    </div>
  );
}
