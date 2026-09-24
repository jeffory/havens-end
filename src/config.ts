/**
 * Game-wide constants. Scale: 1 voxel = 1 world unit (read it as roughly one metre).
 */

/** Cells with y < SEA_LEVEL are below the waterline. A solid cell at y = SEA_LEVEL - 1 is dry beach. */
export const SEA_LEVEL = 12;

/** Fixed simulation rate. Sailing, ballistics, AI and the economy all advance in steps of 1 / SIM_HZ seconds. */
export const SIM_HZ = 60;

/** Terrain column scans (surface height, seabed depth) start from here and go down. */
export const MAX_TERRAIN_HEIGHT = 64;
