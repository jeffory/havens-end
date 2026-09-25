import { useEffect, useRef, useState } from 'react';
import type { Sea } from '../combat/sea';
import { RELICS } from '../treasure/relics';
import { MAP_CASE, PIECES, type TreasureMap } from '../treasure/Treasure';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { type IslandPlan, islandName } from '../worldgen/archipelago';
import { drawTreasureMap } from './treasureMap';

const TIER_LABELS: Record<TreasureMap['tier'], string> = {
  near: 'home waters',
  mid: 'the contested seas',
  far: 'the far islands',
  cursed: 'a cursed isle',
  legend: 'Blackwood’s hoard',
};

export interface MapsProps {
  world: VoxelWorld;
  islands: readonly IslandPlan[];
  sea: Sea;
}

/** The captain's map case: each map on parchment, and what's been found so far. */
export function MapsView({ world, islands, sea }: MapsProps) {
  const maps = sea.captain.maps;
  const [selected, setSelected] = useState<number | null>(maps[0]?.id ?? null);
  const map = maps.find((m) => m.id === selected) ?? maps[0];
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !map) return;
    el.width = el.height = Math.round(el.clientWidth * Math.min(2, window.devicePixelRatio || 1));
    drawTreasureMap(el, world, islands, map);
  }, [map, world, islands]);

  const captain = sea.captain;
  return (
    <div className="chart treasure-maps">
      {map ? <canvas ref={canvas} className="chart-map treasure-map" /> : <p className="treasure-empty">Your map case is empty. Fixers sell maps after dark, prizes carry them, and sailors talk of treasure over a round.</p>}
      <div className="chart-side">
        <h4>
          Maps · {maps.length} / {MAP_CASE}
        </h4>
        <div className="chart-ports">
          {maps.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className={`chart-port${m === map ? ' selected' : ''}${m.tier === 'cursed' || m.tier === 'legend' ? ' cursed' : ''}`}
              data-autofocus={i === 0 ? true : undefined}
              onFocus={() => setSelected(m.id)}
              onClick={() => setSelected(m.id)}
            >
              <span className="dot" />
              {islandName(islands[m.site.island])}
              <small> · {TIER_LABELS[m.tier]}</small>
            </button>
          ))}
        </div>
        {map && (
          <div className="chart-info">
            <small>{map.from}.</small>
            {map.tier === 'cursed' && <p className="warn">Its guardian rises only at night, and must be beaten for the hoard.</p>}
          </div>
        )}
        <h4>Finds</h4>
        <ul className="finds">
          {captain.relics.map((r) => (
            <li key={r}>
              <b>{RELICS[r].name}</b>
              <small>{RELICS[r].detail}</small>
            </li>
          ))}
          <li>
            <b>Blackwood’s chart</b>
            <small>
              {captain.pieces} of {PIECES} pieces{captain.pieces >= PIECES ? ': joined into a map to his hoard' : ', one in each cursed hoard'}.
            </small>
          </li>
          {captain.letter && (
            <li>
              <b>A sealed letter</b>
              <small>In the Crown’s cipher, sealed with an admiral’s crest. You can’t read it… yet.</small>
            </li>
          )}
          {captain.relics.length === 0 && <li className="hint">No unique finds yet: they’re buried with the richer hoards.</li>}
        </ul>
      </div>
    </div>
  );
}
