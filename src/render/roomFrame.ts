/**
 * On foot in town, a building lifted for being near the captain, who's at its door or in it,
 * is framed, much as a fight is (fightFrame.ts): the camera's focus shifts SHARE of the way
 * from the captain toward the room's middle (never more than MAX_SHIFT, so the captain stays
 * well in view) and looks DROP lower, so the room sits mid-screen, above the prompt and the
 * hotbar; and the camera eases in to ROOM_ZOOM of the distance the player has zoomed to (26
 * at the usual 36), a little less for a room too big to fit there, never closer than CLOSEST.
 */
const SHARE = 0.9;
const MAX_SHIFT = 6;
const DROP = 2.5;
export const ROOM_ZOOM = 26 / 36;
/** A room whose width and depth add up to this much fits on screen at ROOM_ZOOM; a bigger one wants the camera further back. */
const FITS = 14;
/** The closest the player can zoom on foot. */
const CLOSEST = 12;

interface Spot {
  x: number;
  z: number;
}

/** A room's walls' footprint, on the grid: from (x0, z0) up to (x1, z1). */
export interface Room {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** How far to shift the camera's focus off the captain to frame `room` (y, how much lower it looks): none, if there's none. */
export function roomShift(captain: Spot, room: Room | null): { x: number; y: number; z: number } {
  if (!room) return { x: 0, y: 0, z: 0 };
  const [dx, dz] = [(room.x0 + room.x1) / 2 - captain.x, (room.z0 + room.z1) / 2 - captain.z];
  const share = Math.min(SHARE, MAX_SHIFT / (Math.hypot(dx, dz) || 1));
  return { x: dx * share, y: -DROP, z: dz * share };
}

/** How much of the zoomed distance the camera stands back to frame `room`: all of it, if there's none. */
export function roomZoom(room: Room | null): number {
  if (!room) return 1;
  return Math.min(1, ROOM_ZOOM * Math.max(1, (room.x1 - room.x0 + room.z1 - room.z0) / FITS));
}

/** How far back the camera stands, from the distance it's zoomed to, at `zoom` of it (eased from 1 to a room's roomZoom and back). */
export function roomDistance(zoomed: number, zoom: number): number {
  return Math.max(Math.min(zoomed, CLOSEST), zoomed * zoom);
}
