# Town shops and interiors

Asked for after Phase 10.2 (GitHub issues #1–#4). The port towns already have shops, houses and townsfolk. This work fills them: shopkeepers behind the counters, a market that reads as a market, shop roofs that lift like house roofs do, and rooms dressed well enough to look at.

The player asked for it in these words: "shopkeepers", "fix the small little cart looking things in front of the shops", "the roofs, I don't believe disappear to show what's inside like the houses", and "run a visual critic over the inside of the houses — you can create assets to decorate the houses. So you can put textures on the boxes or subdivide them up or anything like that." They asked for the work to go ahead on best judgement, so the choices below were made without a review round.

## What's there now (2026-10-09)

- **Shops.** All of these are built in `worldgen/town.ts`:
  - The market is an open-sided hall with stalls inside (`buildMarketHall`). It has no door: the player's spot is a point on its open front.
  - The tavern and the harbourmaster's office are houses (`buildHouse`). Each has a porch, a sign and `furnish`.
  - The shipyard is a three-sided shed (`buildShed`) beside a hull on the stocks.
- **In front of the shops.** Two 3×3 block stalls flank the market's front (`buildStall`: crates, a plank counter, goods, posts and an awning). A block cart (`buildCart`: two wheel blocks under a plank bed) stands in a corner of the square.
  - At play zoom, both read as "small cart-looking things".
- **Interiors.** `furnish` places whole blocks:
  - a house gets a bed (canvas and a red blanket), a hearth and a table;
  - the tavern gets a bar and barrels;
  - the office gets shelves of books and a desk.
- **Roofs.** `render/RoofLifter.ts` lifts what's in the line of sight, and the roofed building within 2 of the captain in town. It sees only blocks flagged cutaway. Props (lanterns, signs, porch posts, the hull) are separate meshes.
- **Props.** `src/props` builds multi-voxel props from `.vox` files at 0.25 of a block a voxel. Only props drawn a block a voxel reserve their cells for people to walk round (`Blocker`).
- **Townsfolk.** `land/townsfolk.ts` handles them. Crown guards stand at fixed posts (the `guard` task), and that's the pattern a shopkeeper can reuse.

## What to build

### 1. Shop roofs lift (#2)

Find out in the browser why a shop's roof doesn't lift when a house's does. Stand at each shop's spot and inside it (market hall, tavern, office, shipyard shed) in Haven, a free port and a Crown port. Then fix the cause in `RoofLifter` or in how the shop is built. The likely causes:
- The market and shed have no door, so the captain's spot is more than 2 from their roofed blocks.
- Porch canopies and signs are props, which don't lift with the roof.

**Acceptance:**
- From each shop's spot, and anywhere inside it, its roof is lifted and the room shows, as with a house.
- Props that hang above the cut inside a lifted box (porch canopy, hanging sign, wall lanterns) go with it.
- `RoofLifter` tests cover an open-sided hall and a three-sided shed.

### 2. Stalls and carts that read (#3)

Replace the block stalls and the block cart with props drawn finer, at 0.25 or 0.125 of a block a voxel:
- **A market stall:** a counter with crates and baskets of goods, posts, and a striped awning that overhangs.
- **A hand cart:** two spoked wheels, a bed, shafts, and a load.

Each prop reserves the block cells it stands on, so people walk round it. They keep at least 2 clear of any door's step, and a stall sits beside the market's front, not in it. Faction colours carry over: the awning is red or blue by the port's dress.

Props are authored in code as cell lists, the way the gun models are. That costs nothing and keeps the style, so no paid generation.

### 3. Interiors dressed (#4)

A set of furniture props, at the same finer scale:
- a bed with frame, mattress, pillow and blanket;
- a table, stools and chairs;
- shelves with crockery or books;
- a chest;
- a hearth with a pot over the fire;
- a rug, a thin layer on the floor;
- barrels and crates;
- for the tavern, a bar counter with mugs and bottles;
- for the office, a desk with papers, an inkwell and a candle.

`furnish` lays them out by the room's role and size:
- **A house:** a bed in a back corner, a hearth on an end wall, a table with stools in the middle, a shelf, a chest and a rug.
- **The tavern:** the bar along the back, tables with stools, barrels, and bottles on a shelf.
- **The office:** the desk facing the door, shelves of ledgers, and a chest.
- **The market hall:** stalls inside.

Nothing blocks a door or the way from the door to the middle of the room.

"Textures on the boxes" is answered with finer voxels, not image textures. The game draws flat-coloured voxels, so texture images on blocks would need an atlas in the mesher and would clash with the style. Subdividing into finer voxels gives the detail and keeps the look. Recorded as a decision; revisit only if the critic still finds rooms bare.

Then a **visual critic loop** over the interiors, with roofs lifted:
- a house by day and by night;
- the tavern by day and by night;
- the office;
- the market hall;
- the shipyard;
- each in Haven, a free port and a Crown port.

The gate is the usual one: overall ≥ 8 and every screen ≥ 7, at most 5 passes, stopping when the score is flat.

### 4. Shopkeepers (#1)

Each shop gets a keeper standing behind its counter and facing the room's front, dressed for the port:
- a stallholder in the market;
- the tavern keeper behind the bar;
- a clerk at the office desk (the Crown's guards stay outside);
- a shipwright at the yard, holding a hammer.

By day they're all there. At night only the tavern keeper stays, and the others are gone.

They're townsfolk with a fixed task (like the guards). They don't wander, they never block the player's spot, and they come back when the captain lands. The shop's E spot and its screens stay as they are: keepers are there to be seen.

## Out of scope

- Talking to keepers, keepers' own dialogue, and opening hours that close a shop.
- Image textures on blocks.
- Paid asset generation.
- New shop kinds.
- Changing the town layout beyond moving stalls and carts clear of doors.

## Saves

All of this is world generation (props and blocks placed before `trackEdits`) and townsfolk (not saved), so the save format doesn't change.

Towns in older saves still show their old blocks wherever the save's own edits cover them. That's the same rule as the town rebuild ("towns in older saves" in ARCHITECTURE).
