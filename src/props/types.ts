import type { VoxelPalette } from '../voxel/palette';

/** Every kind of prop the towns use. */
export type PropKind =
  | 'lantern'
  | 'wallLantern'
  | 'signTavern'
  | 'signOffice'
  | 'signpostMarket'
  | 'signpostShipyard'
  | 'clock'
  | 'porchPost'
  | 'porchRail'
  | 'hullOnStocks';

export const PROP_KINDS: readonly PropKind[] = ['lantern', 'wallLantern', 'signTavern', 'signOffice', 'signpostMarket', 'signpostShipyard', 'clock', 'porchPost', 'porchRail', 'hullOnStocks'];

export interface Point {
  x: number;
  y: number;
  z: number;
}

/** A prop set in the world by the town builder. Not saved: it comes from the seed, with the town. */
export interface PropPlacement {
  kind: PropKind;
  /** Where the model's origin goes, in world units. */
  x: number;
  y: number;
  z: number;
  /** A quarter turn, as FACING_DIRS: the way the model's +z (out from a wall, or its front) faces. */
  facing: number;
  /** The block it hangs on: while that's lifted away on foot, so is the prop. Null for one that never lifts. */
  anchor: Point | null;
}

/**
 * A small voxel model for decoration. `cells` are (x, y, z, colour index) quads in the
 * model's own voxels, and `origin` (in voxels) is the point that goes where it's placed:
 * the middle of its foot for one that stands, the middle of its back at its foot for one on
 * a wall. It's drawn `scale` world units a voxel.
 */
export interface PropModel {
  cells: Int32Array;
  palette: VoxelPalette;
  origin: Point;
  scale: number;
  /** Keep people out of the cells it fills (Block.Blocker): only for a prop drawn a block a voxel. */
  reserve?: boolean;
}
