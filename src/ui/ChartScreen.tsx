import { useEffect } from 'react';
import { type ChartProps, ChartView } from './ChartView';
import type { NavHandlers } from './Overlay';

/** The chart at sea: the game waits while you study it. */
export function ChartScreen({ close, nav, ...chart }: ChartProps & { close: () => void; nav: NavHandlers }) {
  useEffect(() => {
    nav.back = close;
    nav.chart = close;
  }, [nav, close]);
  return (
    <div className="port-screen chart-screen" role="dialog" aria-label="Sea chart">
      <header className="port-header">
        <div>
          <h2>Sea chart</h2>
          <span className="port-kind">Choose a port to steer for: the compass will point the way.</span>
        </div>
        <button type="button" onClick={close}>
          Close
        </button>
      </header>
      <div className="port-body">
        <ChartView {...chart} />
      </div>
      <footer className="port-footer">
        <span className="port-keys">
          <kbd>↑</kbd>
          <kbd>↓</kbd> choose a port · <kbd>Enter</kbd> / <kbd>A</kbd> set course · <kbd>M</kbd> / <kbd>Esc</kbd> close
        </span>
      </footer>
    </div>
  );
}
