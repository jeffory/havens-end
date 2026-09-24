/** Handling, strength and art for a class of ship. Collision shape comes from the model itself. */
export interface ShipType {
  name: string;
  /** MagicaVoxel model, relative to the site root (files live in public/). */
  model: string;
  /** Keel depth below the waterline, in voxels. Also decides where the model sits in the water. */
  draft: number;
  topSpeed: number;
  acceleration: number;
  turnRate: number;
  /** Structure points; the ship sinks at zero. */
  hull: number;
  /** Canvas and rigging points; less of it means less drive. */
  sails: number;
  crew: number;
  gunsPerSide: number;
  /** Seconds to reload a broadside with a full crew. */
  reload: number;
  /** Explosive barrels carried, dropped astern to shake off pursuers. */
  barrels: number;
  /** Cargo capacity, in units of goods. */
  hold: number;
}

/** Quick and handy: the player's first ship, and the light warships of every flag. */
export const SLOOP: ShipType = {
  name: 'sloop',
  model: 'models/ships/sloop.vox',
  draft: 1.5,
  topSpeed: 11,
  acceleration: 2.4,
  turnRate: 0.5,
  hull: 100,
  sails: 100,
  crew: 30,
  gunsPerSide: 4,
  reload: 5.5,
  barrels: 0,
  hold: 30,
};

/** A proper warship: slower and heavier, with a broadside that hurts. */
export const BRIG: ShipType = {
  name: 'brig',
  model: 'models/ships/brig.vox',
  draft: 2,
  topSpeed: 9.5,
  acceleration: 1.9,
  turnRate: 0.38,
  hull: 180,
  sails: 140,
  crew: 55,
  gunsPerSide: 7,
  reload: 6.5,
  barrels: 0,
  hold: 60,
};

export const MERCHANT_SLOOP: ShipType = { ...SLOOP, name: 'merchant sloop', hull: 80, crew: 14, gunsPerSide: 0, barrels: 2, hold: 40 };

export const MERCHANT_BRIG: ShipType = {
  ...BRIG,
  name: 'merchant brig',
  topSpeed: 9,
  hull: 150,
  crew: 22,
  gunsPerSide: 2,
  barrels: 4,
  hold: 80,
};

export const SHIP_TYPES: readonly ShipType[] = [SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG];
