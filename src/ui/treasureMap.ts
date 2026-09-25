import { SEA_LEVEL } from '../config';
import { MAP_STYLES, type TreasureMap } from '../treasure/Treasure';
import type { Landmark } from '../treasure/sites';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { type IslandPlan, islandName } from '../worldgen/archipelago';

const PAPER = '#e9dab0';
const INK = '#4a3320';
const FAINT = 'rgba(74, 51, 32, 0.35)';
const RED = '#a3261d';

/**
 * Draws a treasure map onto a canvas, as the hand that made it would have: a sketch
 * of the island's real coastline (with an X, near home), or just the riddle, on
 * stained and torn parchment.
 */
export function drawTreasureMap(canvas: HTMLCanvasElement, world: VoxelWorld, islands: readonly IslandPlan[], map: TreasureMap): void {
  const size = canvas.width;
  const g = canvas.getContext('2d')!;
  const u = size / 600; // one unit at the default size
  const random = seeded(map.id * 7919);
  g.clearRect(0, 0, size, size);
  parchment(g, size, u, random);

  const plan = islands[map.site.island];
  const style = MAP_STYLES[map.tier];
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.font = `italic 600 ${30 * u}px Georgia, 'Times New Roman', serif`;
  g.fillText(style === 'riddle' ? (map.tier === 'legend' ? 'Blackwood’s Chart' : 'A Riddle') : islandName(plan), size / 2, 64 * u);

  if (style === 'riddle') {
    doodle(g, size, u, map.tier);
    writeClue(g, map.clue, size / 2, 200 * u, 440 * u, 30 * u, 22 * u);
    return;
  }
  // The island, from the world itself, north up.
  const reach = plan.radius * 1.35;
  const box = { x: 80 * u, y: 90 * u, w: 440 * u, h: 360 * u };
  const scale = Math.min(box.w, box.h) / (reach * 2);
  const ox = box.x + box.w / 2 - plan.centerX * scale;
  const oz = box.y + box.h / 2 - plan.centerZ * scale;
  const cell = Math.max(1, Math.ceil(scale));
  const land = (x: number, z: number) => world.surfaceHeight(Math.floor(x), Math.floor(z)) >= SEA_LEVEL;
  for (let z = Math.floor(plan.centerZ - reach); z < plan.centerZ + reach; z++) {
    for (let x = Math.floor(plan.centerX - reach); x < plan.centerX + reach; x++) {
      if (!land(x, z)) continue;
      const h = world.surfaceHeight(x, z);
      const shore = !land(x + 1, z) || !land(x - 1, z) || !land(x, z + 1) || !land(x, z - 1);
      g.fillStyle = shore ? INK : h >= SEA_LEVEL + 8 ? 'rgba(74, 51, 32, 0.45)' : h >= SEA_LEVEL + 4 ? 'rgba(74, 51, 32, 0.28)' : 'rgba(74, 51, 32, 0.14)';
      g.fillRect(ox + x * scale, oz + z * scale, cell, cell);
    }
  }
  // Waves offshore.
  g.strokeStyle = FAINT;
  g.lineWidth = 1.5 * u;
  for (let i = 0; i < 14; i++) {
    const wx = box.x + random() * box.w;
    const wz = box.y + random() * box.h;
    const px = (wx - ox) / scale;
    const pz = (wz - oz) / scale;
    if (land(px, pz) || land(px + 3, pz) || land(px - 3, pz)) continue;
    wave(g, wx, wz, 8 * u);
  }
  mark(g, map.site.landmark, ox, oz, scale, u);
  if (style === 'chart') {
    const x = ox + (map.site.x + 0.5) * scale;
    const y = oz + (map.site.z + 0.5) * scale;
    g.strokeStyle = RED;
    g.lineWidth = 5 * u;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x - 9 * u, y - 9 * u);
    g.lineTo(x + 9 * u, y + 9 * u);
    g.moveTo(x + 9 * u, y - 9 * u);
    g.lineTo(x - 9 * u, y + 9 * u);
    g.stroke();
  }
  compass(g, 540 * u, 110 * u, u);
  writeClue(g, map.clue, size / 2, 490 * u, 480 * u, 24 * u, 18 * u);
}

/** Old paper: a warm ground, stains, a darker edge, and a ragged border. */
function parchment(g: CanvasRenderingContext2D, size: number, u: number, random: () => number): void {
  g.save();
  g.beginPath();
  const steps = 48;
  for (let i = 0; i <= steps * 4; i++) {
    const side = Math.floor(i / steps) % 4;
    const t = (i % steps) / steps;
    const tear = 6 * u + random() * 10 * u;
    const [x, y] = [
      [t * size, tear],
      [size - tear, t * size],
      [size - t * size, size - tear],
      [tear, size - t * size],
    ][side];
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.clip();
  g.fillStyle = PAPER;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 7; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = (30 + random() * 70) * u;
    const stain = g.createRadialGradient(x, y, 0, x, y, r);
    stain.addColorStop(0, 'rgba(150, 110, 60, 0.16)');
    stain.addColorStop(1, 'rgba(150, 110, 60, 0)');
    g.fillStyle = stain;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const edge = g.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.75);
  edge.addColorStop(0, 'rgba(120, 80, 40, 0)');
  edge.addColorStop(1, 'rgba(120, 80, 40, 0.45)');
  g.fillStyle = edge;
  g.fillRect(0, 0, size, size);
  g.restore();
}

/** The landmark, drawn small where it stands. */
function mark(g: CanvasRenderingContext2D, l: Landmark, ox: number, oz: number, scale: number, u: number): void {
  const x = ox + (l.x + 0.5) * scale;
  const y = oz + (l.z + 0.5) * scale;
  g.save();
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineWidth = 2 * u;
  switch (l.kind) {
    case 'skull':
      g.beginPath();
      g.arc(x, y - 3 * u, 8 * u, 0, Math.PI * 2);
      g.stroke();
      g.fillRect(x - 5 * u, y - 5 * u, 3 * u, 3 * u);
      g.fillRect(x + 2 * u, y - 5 * u, 3 * u, 3 * u);
      g.strokeRect(x - 5 * u, y + 4 * u, 10 * u, 5 * u);
      break;
    case 'cairn':
      for (const [dy, w] of [[6, 14], [0, 10], [-6, 6]]) g.strokeRect(x - (w / 2) * u, y + dy * u - 3 * u, w * u, 6 * u);
      break;
    case 'deadTree':
      g.beginPath();
      g.moveTo(x, y + 9 * u);
      g.lineTo(x, y - 9 * u);
      g.moveTo(x, y - 2 * u);
      g.lineTo(x + 7 * u, y - 8 * u);
      g.moveTo(x, y + 2 * u);
      g.lineTo(x - 6 * u, y - 5 * u);
      g.stroke();
      break;
  }
  g.restore();
}

/** A skull and crossbones for the cursed, a compass rose for the rest. */
function doodle(g: CanvasRenderingContext2D, size: number, u: number, tier: TreasureMap['tier']): void {
  const x = size / 2;
  const y = 130 * u;
  g.save();
  g.strokeStyle = tier === 'cursed' ? RED : INK;
  g.fillStyle = g.strokeStyle;
  g.lineWidth = 3 * u;
  if (tier === 'cursed' || tier === 'legend') {
    g.beginPath();
    g.moveTo(x - 26 * u, y + 22 * u);
    g.lineTo(x + 26 * u, y - 10 * u);
    g.moveTo(x + 26 * u, y + 22 * u);
    g.lineTo(x - 26 * u, y - 10 * u);
    g.stroke();
    g.beginPath();
    g.arc(x, y - 4 * u, 16 * u, 0, Math.PI * 2);
    g.fillStyle = PAPER;
    g.fill();
    g.stroke();
    g.fillStyle = g.strokeStyle;
    g.fillRect(x - 9 * u, y - 9 * u, 6 * u, 6 * u);
    g.fillRect(x + 3 * u, y - 9 * u, 6 * u, 6 * u);
  } else {
    compass(g, x, y, u * 1.4);
  }
  g.restore();
}

function compass(g: CanvasRenderingContext2D, x: number, y: number, u: number): void {
  g.save();
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.lineWidth = 1.5 * u;
  g.beginPath();
  g.moveTo(x, y - 22 * u);
  g.lineTo(x + 6 * u, y);
  g.lineTo(x, y + 22 * u);
  g.lineTo(x - 6 * u, y);
  g.closePath();
  g.stroke();
  g.beginPath();
  g.moveTo(x, y - 22 * u);
  g.lineTo(x + 6 * u, y);
  g.lineTo(x - 6 * u, y);
  g.closePath();
  g.fill();
  g.font = `700 ${14 * u}px Georgia, serif`;
  g.textAlign = 'center';
  g.fillText('N', x, y - 27 * u);
  g.restore();
}

function wave(g: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  g.beginPath();
  g.moveTo(x - w, y);
  g.quadraticCurveTo(x - w / 2, y - w / 2, x, y);
  g.quadraticCurveTo(x + w / 2, y + w / 2, x + w, y);
  g.stroke();
}

/** Wraps the clue in a slanted hand, centred. */
function writeClue(g: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, line: number, px: number): void {
  g.save();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.font = `italic ${px}px Georgia, 'Times New Roman', serif`;
  const words = text.split(' ');
  let row = '';
  let at = y;
  for (const word of words) {
    const next = row ? `${row} ${word}` : word;
    if (g.measureText(next).width > width && row) {
      g.fillText(row, x, at);
      row = word;
      at += line;
    } else {
      row = next;
    }
  }
  if (row) g.fillText(row, x, at);
  g.restore();
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
