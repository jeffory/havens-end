import { useEffect, useRef, useState } from 'react';
import { REGION_NAMES } from '../combat/encounters';
import type { Sea } from '../combat/sea';
import { SEA_LEVEL } from '../config';
import { contractTitle, turnInPort } from '../economy/contracts';
import type { Economy } from '../economy/economy';
import { GOOD_INFO, GOODS } from '../economy/goods';
import { FACTION_NAMES, type Port, PORT_KINDS } from '../economy/ports';
import { portOpen, rankName } from '../economy/reputation';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import type { IslandPlan } from '../worldgen/archipelago';
import { age } from './port/common';
import { RouteList } from './port/PortScreen';

const RESOLUTION = 1024;
const FACTION_COLORS = { imperial: '#a51d24', merchant: '#2b5da8', pirate: '#2a1a14' } as const;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Map projection: world (x, z) to chart pixels, north (−z) up. */
interface Frame {
  minX: number;
  minZ: number;
  span: number;
}

/**
 * The archipelago's coastlines, drawn once from the voxel world into an offscreen
 * canvas: sea, shallows, beaches and hills, with the danger regions ringed.
 */
function drawBase(world: VoxelWorld, islands: readonly IslandPlan[], frame: Frame): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = RESOLUTION;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#9ec6c8';
  g.fillRect(0, 0, RESOLUTION, RESOLUTION);
  const units = frame.span / RESOLUTION;
  const image = g.getImageData(0, 0, RESOLUTION, RESOLUTION);
  for (const island of islands) {
    const reach = island.radius * 1.7;
    const x0 = Math.floor((island.centerX - reach - frame.minX) / units);
    const y0 = Math.floor((island.centerZ - reach - frame.minZ) / units);
    const n = Math.ceil((reach * 2) / units);
    for (let py = Math.max(0, y0); py < Math.min(RESOLUTION, y0 + n); py++) {
      for (let px = Math.max(0, x0); px < Math.min(RESOLUTION, x0 + n); px++) {
        const h = world.surfaceHeight(Math.floor(frame.minX + (px + 0.5) * units), Math.floor(frame.minZ + (py + 0.5) * units));
        const color = h >= SEA_LEVEL + 12 ? [128, 138, 112] : h >= SEA_LEVEL + 2 ? [132, 172, 98] : h >= SEA_LEVEL ? [230, 212, 160] : h >= SEA_LEVEL - 4 ? [184, 222, 212] : null;
        if (!color) continue;
        const i = (py * RESOLUTION + px) * 4;
        image.data.set(color, i);
      }
    }
  }
  g.putImageData(image, 0, 0);

  // Danger regions around home, each labelled where it won't sit on a port.
  g.save();
  g.setLineDash([10, 10]);
  g.strokeStyle = 'rgba(40, 60, 80, 0.35)';
  g.fillStyle = 'rgba(40, 60, 80, 0.55)';
  g.lineWidth = 2;
  g.font = 'italic 20px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const [cx, cy] = [(0 - frame.minX) / units, (0 - frame.minZ) / units];
  const ports = islands.filter((i) => i.port);
  const clearest = (radius: number) => {
    let best = 0;
    let bestGap = -1;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const gap = Math.min(...ports.map((p) => Math.hypot(p.centerX - Math.sin(a) * radius, p.centerZ + Math.cos(a) * radius)));
      if (gap > bestGap) [best, bestGap] = [a, gap];
    }
    return best;
  };
  [700, 1500].forEach((r) => {
    g.beginPath();
    g.arc(cx, cy, r / units, 0, Math.PI * 2);
    g.stroke();
  });
  [
    [REGION_NAMES[0], 700 - 90],
    [REGION_NAMES[1], 1500 - 110],
    [REGION_NAMES[2], 1500 + 110],
  ].forEach(([name, r]) => {
    const a = clearest(Number(r));
    g.fillText(String(name), cx + (Math.sin(a) * Number(r)) / units, cy - (Math.cos(a) * Number(r)) / units);
  });
  g.restore();
  return canvas;
}

let cachedBase: { key: readonly IslandPlan[]; canvas: HTMLCanvasElement; frame: Frame } | null = null;

function baseFor(world: VoxelWorld, islands: readonly IslandPlan[]) {
  if (cachedBase?.key === islands) return cachedBase;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const i of islands) {
    minX = Math.min(minX, i.centerX - i.radius);
    minZ = Math.min(minZ, i.centerZ - i.radius);
    maxX = Math.max(maxX, i.centerX + i.radius);
    maxZ = Math.max(maxZ, i.centerZ + i.radius);
  }
  const span = Math.max(maxX - minX, maxZ - minZ) + 300;
  const frame = { minX: (minX + maxX) / 2 - span / 2, minZ: (minZ + maxZ) / 2 - span / 2, span };
  cachedBase = { key: islands, canvas: drawBase(world, islands, frame), frame };
  return cachedBase;
}

export interface ChartProps {
  world: VoxelWorld;
  islands: readonly IslandPlan[];
  economy: Economy;
  sea: Sea;
  course: Port | null;
  setCourse: (port: Port | null) => void;
}

/** The sea chart: where everything is, who'll have you, and what your price book knows. */
export function ChartView({ world, islands, economy, sea, course, setCourse }: ChartProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<Port>(course ?? sea.docked ?? economy.ports[0]);
  const ship = sea.player.ship;
  const jobs = new Set(sea.captain.contracts.map(turnInPort));

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const { canvas: base, frame } = baseFor(world, islands);
    const size = el.clientWidth * Math.min(2, window.devicePixelRatio || 1);
    el.width = el.height = size;
    const g = el.getContext('2d')!;
    const k = size / frame.span;
    const toX = (x: number) => (x - frame.minX) * k;
    const toY = (z: number) => (z - frame.minZ) * k;
    g.imageSmoothingEnabled = true;
    g.drawImage(base, 0, 0, size, size);
    const px = size / 640; // one "chart pixel" at the default size

    // Course line.
    if (course) {
      g.save();
      g.strokeStyle = '#b8860b';
      g.lineWidth = 2.5 * px;
      g.setLineDash([8 * px, 6 * px]);
      g.beginPath();
      g.moveTo(toX(ship.x), toY(ship.z));
      g.lineTo(toX(course.x), toY(course.z));
      g.stroke();
      g.restore();
    }

    // Ports.
    g.font = `600 ${13 * px}px Georgia, serif`;
    g.textAlign = 'center';
    for (const port of economy.ports) {
      const x = toX(port.islandX);
      const y = toY(port.islandZ);
      const open = portOpen(sea.captain.standing, port.faction);
      if (port === selected) {
        g.strokeStyle = '#3b2a1f';
        g.lineWidth = 2 * px;
        g.beginPath();
        g.arc(x, y, 16 * px, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = FACTION_COLORS[port.faction];
      g.strokeStyle = '#f6ecd2';
      g.lineWidth = 2 * px;
      g.beginPath();
      g.arc(x, y, 7 * px, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (!open) {
        g.strokeStyle = '#d0342c';
        g.lineWidth = 3 * px;
        g.beginPath();
        g.moveTo(x - 9 * px, y - 9 * px);
        g.lineTo(x + 9 * px, y + 9 * px);
        g.moveTo(x + 9 * px, y - 9 * px);
        g.lineTo(x - 9 * px, y + 9 * px);
        g.stroke();
      }
      g.fillStyle = '#2b1e14';
      g.strokeStyle = 'rgba(246, 236, 210, 0.85)';
      g.lineWidth = 4 * px;
      const label = jobs.has(port.id) ? `★ ${port.name}` : port.name;
      g.strokeText(label, x, y + 24 * px);
      g.fillText(label, x, y + 24 * px);
    }

    // The player's ship.
    g.save();
    g.translate(toX(ship.x), toY(ship.z));
    g.rotate(Math.PI - ship.heading);
    g.fillStyle = '#1b1b1b';
    g.strokeStyle = '#f6ecd2';
    g.lineWidth = 1.5 * px;
    g.beginPath();
    g.moveTo(0, -11 * px);
    g.lineTo(7 * px, 8 * px);
    g.lineTo(0, 4 * px);
    g.lineTo(-7 * px, 8 * px);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    // Compass rose.
    g.save();
    g.translate(size - 44 * px, 44 * px);
    g.fillStyle = '#3b2a1f';
    g.font = `700 ${14 * px}px Georgia, serif`;
    g.fillText('N', 0, -18 * px);
    g.beginPath();
    g.moveTo(0, -12 * px);
    g.lineTo(5 * px, 8 * px);
    g.lineTo(0, 3 * px);
    g.lineTo(-5 * px, 8 * px);
    g.fill();
    g.restore();
  });

  const standing = sea.captain.standing[selected.faction];
  const open = portOpen(sea.captain.standing, selected.faction);
  const dx = selected.x - ship.x;
  const dz = selected.z - ship.z;
  const bearing = COMPASS[Math.round(((Math.atan2(dx, -dz) / (Math.PI * 2)) * 8 + 8) % 8) % 8];
  const notes = sea.captain.logbook[selected.id] ?? {};
  const theirJobs = sea.captain.contracts.filter((c) => turnInPort(c) === selected.id);
  const here = sea.docked === selected;

  return (
    <div className="chart">
      <canvas ref={canvas} className="chart-map" />
      <div className="chart-side">
        <div className="chart-ports">
          {economy.ports.map((port) => (
            <button
              key={port.id}
              type="button"
              className={`chart-port faction-${port.faction}${port === selected ? ' selected' : ''}${port === course ? ' course' : ''}`}
              data-autofocus={port === selected ? true : undefined}
              onFocus={() => setSelected(port)}
              onClick={() => {
                setSelected(port);
                setCourse(port === course ? null : port);
              }}
            >
              <span className="dot" />
              {port.name}
              {port === course && <small> · course set</small>}
            </button>
          ))}
        </div>
        <div className="chart-info">
          <h3>{selected.name}</h3>
          <div className="chart-kind">
            {PORT_KINDS[selected.faction]} · your name with {FACTION_NAMES[selected.faction]}: {rankName(standing)}
            {!open && <b className="warn"> · closed to you</b>}
          </div>
          {!here && (
            <div>
              {Math.round(Math.hypot(dx, dz))} away, to the {bearing}
            </div>
          )}
          {theirJobs.map((c) => (
            <div key={c.id} className="chart-job">
              ★ {contractTitle(c, economy.ports)}
            </div>
          ))}
          <table className="chart-prices">
            <thead>
              <tr>
                <th>Price book</th>
                <th>Buy</th>
                <th>Sell</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {GOODS.filter((g) => notes[g]).map((g) => (
                <tr key={g}>
                  <td>{GOOD_INFO[g].label}</td>
                  <td className="num">{notes[g]!.buy}</td>
                  <td className="num">{notes[g]!.sell}</td>
                  <td>
                    <small>{age(notes[g]!.time, sea.time)}</small>
                  </td>
                </tr>
              ))}
              {Object.keys(notes).length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <small>No prices known. Visit, or buy a round in a tavern.</small>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <button type="button" className="primary" onClick={() => setCourse(course === selected ? null : selected)}>
            {course === selected ? 'Clear course' : `Set course for ${selected.name}`}
          </button>
        </div>
        <div className="chart-routes">
          <h4>Best known runs</h4>
          <RouteList economy={economy} sea={sea} />
        </div>
      </div>
    </div>
  );
}
