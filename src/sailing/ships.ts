/** Handling and art for a class of ship. Collision shape comes from the model itself. */
export interface ShipType {
  name: string;
  /** MagicaVoxel model, relative to the site root (files live in public/). */
  model: string;
  /** Keel depth below the waterline, in voxels. Also decides where the model sits in the water. */
  draft: number;
  topSpeed: number;
  acceleration: number;
  turnRate: number;
}

export const SLOOP: ShipType = {
  name: 'Sloop',
  model: 'models/ships/sloop.vox',
  draft: 1.5,
  topSpeed: 11,
  acceleration: 2.4,
  turnRate: 0.5,
};
