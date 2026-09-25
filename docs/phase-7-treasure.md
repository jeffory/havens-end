# Phase 7: Treasure hunting

Treasure maps lead to chests buried on the islets: you read the map, find the spot,
and dig. This file is the Phase 7 design, drawn from the player's answers
(2026-09-25). ARCHITECTURE.md §11 describes what was built.

## The player's answers

1. **Maps come from** the fixer at night, captured ships, and tavern rumours.
2. **What a map looks like:** near home, a sketch of the real coastline with an X.
   Further out, the sketch loses its X and gains a riddle. Far out, there's only the
   riddle.
3. **What's buried:** gold and goods, unique items, and pieces of one legendary hoard.
4. **Danger:** the cursed islets stay eerie, and a spectral guardian defends each
   cursed hoard at night. You fight the guardian in the existing duel.
5. **Rival treasure hunters:** not now.

## Design

**Islets get names** ("Gull Cay", "Dead Man's Cay"), so riddles and the chart can
name them. Treasure is only ever buried on the islets, never in a port.

**A site** is where a chest is buried, chosen when a map is made:
- The chest lies two blocks down, in dry ground.
- Near it stands a landmark, built into the world when the map is made: a skull rock,
  a cairn or a dead tree.
- The X is a leg or two of paces from the landmark: one pace is one block, and north
  is −z, as on the chart.

**How hard a map is** depends on how far the islet is from Haven:

| Tier | Where | The map shows | Buried |
|---|---|---|---|
| near | home waters (< 700) | the coastline with an X | 80–200 gold, a few goods |
| mid | contested waters (< 1500) | the coastline, plus "7 paces north of the cairn" | more gold and goods, a unique item 30% of the time |
| far | beyond | a riddle naming the islet, with sun words for directions | more still, a unique item 60% of the time |
| cursed | the three cursed islets | a riddle; the hoard is guarded | a lot of gold, a unique item, and a piece of the legendary chart |

**Directions in riddles** use the sun: "toward the sunrise" is east (the sun rises
at +x), the sunset is west, the noonday sun is south, and the pole star is north. A
compass on the on-foot HUD shows north.

**Where maps come from:**
- **The fixer**, after dark, offers two maps a night in each port. One may lead to a
  cursed islet, always at a pirate haven. They cost 80 to 700 gold, by tier.
- **Captured ships** sometimes carry one: 40% of pirates, 25% of merchants and 15% of
  the Crown's ships.
- **A round in the tavern** sometimes turns up a treasure rumour, which is written
  down as a riddle map for free. That's at most once per port per day.
- **The map case holds 8.**

**Digging it up:**
- **Where:** the shovel finds the chest within one block of the X, at chest depth.
  Digging within three blocks of it turns up "loose earth", a sign you're close.
- **What happens:** a chest is left in the hole. Goods pop out as dropped items; gold
  and unique items go straight to the captain.
- **The map** is used up.

**Cursed hoards:**
- **By day** the ground won't give.
- **At night**, striking the chest raises a ghostly guardian, and you fight it in the
  duel, staged on the ground where you stand.
- **Win,** and the hoard is yours.
- **Lose,** and you wake on the beach at dawn a tenth of your gold lighter, with the
  map kept to try again.
- **The ghost lights** gather over any cursed hoard you hold a map for.

**Unique items:** each one can be found only once.

| Item | Effect |
|---|---|
| The Admiral's Spyglass | ship names show from further away, by day and night |
| Blackwood's Cutlass | +25% damage in duels |
| The Lodestone | within 20 paces of a buried chest you have a map for, it tugs toward it |
| The Smuggler's Ledger | customs never find your muskets |
| The Lucky Doubloon | captured ships give up a quarter more gold |

**The legendary hoard:**
- **The pieces.** Captain Ezra Blackwood tore his chart in three. One piece lies in
  each cursed hoard.
- **The map.** With all three, they join into a map to Blackwood's hoard, buried on the
  islet furthest from Haven.
- **What's in it:** a fortune, and a sealed letter in the Crown's cipher, the hook for
  the Phase 8 story.

**Where it lives in the code:**
- `treasure/` holds the pure simulation: sites and landmarks, riddles, maps, loot and
  unique items, and the `Treasure` class with its offers, digging and snapshot.
- Maps, unique items and pieces belong to the captain, so they survive losing a ship.
- The chart gets a Maps tab, with each map drawn on parchment.
