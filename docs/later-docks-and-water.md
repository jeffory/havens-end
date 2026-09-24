# Later: docks and building over water (not started)

This came up in the Phase 6 playtest, "for much later". It isn't part of any phase
yet. This file records the idea and the questions to settle before building it.

## The idea

Build out over the water:
- jetties and docks from your own camps, so the ship can come alongside at home as
  she does at a port's pier;
- walkways, and perhaps huts on stilts, over the shallows.

## What's in the game already

- **Piers and docking.** Every port has a pier (`worldgen/harbour.ts`, with a lamp
  at its head). The ship comes alongside it (`Sea.docked`, `DOCK_SPEED`), and the
  captain steps off (`Land.landAtPort`). A camp jetty could reuse all of this.
- **Building one cell at a time.** Fences and paths are free-form pieces
  (`land/structures.ts`, `freeform`), placed through the build menu. The rules are in
  `Land.placement`, which refuses anything in the water ("Too wet").
- **Earth in water.** Earth can go down to one block below sea level, which is enough
  to fill a hole the shovel dug. Deeper is refused: "Earth won't stay put in the sea."
- **Wading.** The captain wades up to one voxel deep (`land/walker.ts`,
  `WADE_DEPTH`).
- **Grounding.** Ships run aground on terrain. Anything built in the water is
  voxels, so it's solid to ships too.

## Questions to settle first

1. **What goes over water?** Plank walkways and jetties only, or whole buildings on
   stilts?
2. **Mooring at home.** Should the ship moor at a camp jetty as she does at a port's
   pier? That would make carrying goods between the storehouses and the hold easy.
3. **Reclaiming land.** May earth be tipped into the sea to make new land, or does
   only timber go out over the water?
4. **Depth.** How deep can a jetty stand? Should a jetty that's too long or too
   shallow keep ships off (they'd run aground on it)?

## A sketch

- **New pieces.** A free-form `jetty` piece: a plank deck at sea level, with posts
  down to the seabed. It goes on water up to some depth, joined to the shore or to
  another jetty piece.
- **Mooring.** A mooring post at the end of a jetty. Pressing B near it moors the ship
  there, as at a pier. That needs a berth heading, and water deep enough for her
  draught.
- **Stilts.** Stilt huts would be the ordinary huts on a deck of jetty pieces.
