# Phase 7: Treasure hunting (not started)

Parked while Phase 6 is playtested. This is where Phase 7 picks up.

## The idea (from the roadmap)

Hand-drawn-style maps of real terrain, riddles generated from landmarks, and dig
sites.

## Hooks already in the game (Phase 6)

- **Cursed islets.** Three islets carry `cursed: true` in the archipelago plan
  (`worldgen/archipelago.ts`). They're chosen by their own seeds, so the rest of the
  world doesn't move.
- **Ghost lights.** They hang over those islets at night and show from 700 away,
  through the fog (`render/NightLife.ts`). Nothing happens there yet.
- **Night trade.** The fixer only does business after dark, and could sell maps.
- **Somewhere to find maps.** Captured ships already yield gold and cargo.
- **Digging.** The shovel already digs.
- **The coastline.** The chart already draws the real coastline into a canvas
  (`ui/ChartView.tsx`), which a map could reuse.

## Open questions for the player (asked at the end of Phase 6, not answered yet)

1. **Where do treasure maps come from?** Bought from the fixer at night, found on
   ships you capture, turned up by settlers digging, or all of these?
2. **What should a map look like?** A hand-drawn scrap of the real coastline with an
   X, riddle clues built from landmarks ("three palms north of the white rock"), or
   both, getting harder further from home?
3. **What's buried?** Gold and cargo, unique items (a famous cutlass, ship upgrades),
   or pieces of a map to one legendary hoard that ties into the story (Phase 8)?
4. **The cursed islets:** should something guard them at night? That would need
   fighting on foot, a big new feature. Or keep them eerie puzzles for now?
5. **Rival treasure hunters** racing you to the same site: yes, or later?
