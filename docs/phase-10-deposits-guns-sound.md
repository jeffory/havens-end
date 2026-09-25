# Phase 10: Deposits, guns and sound

This is the Phase 10 design, as the player approved it (2026-09-25). ARCHITECTURE.md will
describe what was built. It's built in three parts, each committed on its own: 10.1,
then 10.2, then 10.3, so the sound covers everything the first two add.

The roadmap called this phase "the Winrose economy". Winrose is only another game, given
as a picture of the idea: stone scattered about, copper, silver and gold in caves, and
resources that grow back where they were.

## The player's answers

1. **Ores before caves:** on the surface for now. Copper is fairly common, silver rarer,
   gold rare and mostly far from Haven. The caves in Phase 11 get the rich seams, and
   the surface thins out.
2. **The pickaxe:** works deposits only. The island's own rock can't be broken, which
   fits retiring the shovel: the land keeps its shape until the leveller (Phase 11).
3. **Deposits grow back** in the same spot after about three in-game days.
4. **Miners:** yes, a settler job. With nothing to mine, they cut wood until an outcrop
   grows back.
5. **The guns** are for the captain on foot, against beasts and people. They're bought
   in port, and they fire cartridges.
6. **The people** are bandits on wild islets, and only them: no landing parties, no
   camp raids (Phase 6's answer stands), no rival diggers (Phase 7's answer stands).
7. **Beaten by bandits:** you come to aboard, they take a share of your gold, and your
   pack lies where you fell.
8. **A "come to" card:** being sunk, jailed, beaten by bandits or beaten by a guardian
   all fade to black with a title and a line of what happened.
9. **Sound:** every group offered: the core set, the duel, sea ambience, ports and
   camps, menus and pickups. Made with ElevenLabs on Comfy Cloud, with no credit limit.

## 10.1 Deposits & ores

**Deposits** (new `land/deposits.ts`) are small outcrops of 3–5 blocks rising out of
the ground: about 2 × 2 across and 1–2 high, with ragged tops.

| Kind | Block | Where | Blows | Yield |
|---|---|---|---|---|
| Stone | new `Boulder` (grey, unlike the island's rock) | every island, the commonest | 3 | 3–4 stone |
| Iron | `IronOre` | everywhere | 4 | 2–3 iron ore |
| Copper | new `CopperOre` | common | 4 | 2–3 copper ore |
| Silver | new `SilverOre` | contested waters and further | 5 | 1–2 silver ore |
| Gold | new `GoldOre` | rare, mostly Imperial waters | 6 | 1 gold ore |

- **Placement.** Seeded at world generation, per island, by its distance from Haven.
  They keep clear of town land, beaches, steep slopes, trees, treasure sites and
  landmarks. The iron veins in the terrain are no longer generated: iron comes from
  deposits. Old saves keep what they have in chunks they changed, and get deposits
  everywhere else, because a save is the seed plus the changed chunks.
- **Mining.** A pickaxe blow on any block of a deposit counts toward that deposit. The
  last blow breaks the whole outcrop into dropped items. Blows are counted like a tree's
  and aren't saved. On the island's own rock the pickaxe does nothing: "Only outcrops
  can be broken: look for stone and ore."
- **Growing back.** A worked-out deposit grows back 3 days (sea clock) after it was
  worked out, if its cells are clear: no building, captain, settler or beast in them.
  Otherwise it waits. Saved (save version 5): which deposits are worked out, and when.
- **Buildings** can't be placed over a deposit ("An outcrop is in the way: mine it
  first"). One built over a worked-out deposit's spot stops it growing back.

**New goods:**

| Good | Price | Free ports | Pirate haven | Imperial ports |
|---|---|---|---|---|
| Copper ore | ~10 | demands (foundries) | trades | trades |
| Silver ore | ~28 | trades | trades | demands (the mint) |
| Gold ore | ~60 | trades | demands | demands (the mint) |

They get pixel icons for when they're lying on the ground. Iron ore stays the `ore` good.

**Miners** (a settler job, in `land/settlers.ts`):
- A miner works the nearest deposit within the claim plus 16 blocks (woodcutters look 6
  past the claim; deposits are sparse). Each outcrop takes a while, like felling, and
  the yield goes to the camp's storehouses.
- With nothing to mine, they cut wood until something grows back. The camp screen says
  "No ore near the camp: cutting wood until it grows back (2 days)".

## 10.2 Guns, hunting and bandits

**The guns** (new `land/firearms.ts`):

| | Pistol | Rifle |
|---|---|---|
| Price | ~120 gold | ~350 gold |
| Range | ~12 blocks | ~30 blocks |
| Damage | 2 | 4 |
| Reload | 2.5 s | 5 s |
| Accuracy | good close in | clumsy close in, deadly far out |

- **Buying.** From a gunsmith's counter in the market of the free ports and the pirate
  haven. Imperial ports don't sell them: arms are the Crown's monopoly. A gun is bought
  once, kept by the captain (saved), and takes a hotbar slot.
- **Cartridges** are a good, about 2 gold each, sold in every market. The forge makes
  12 from 1 iron. Each shot uses one; with none, the gun won't fire.
- **Firing.** Space, click or X with a gun in hand. With keys or a pad it aims at the
  nearest target within a cone in front; with the mouse, toward the cursor.
  - The shot is an instant hit along the line of fire. A voxel raycast stops it at rock,
    trees and walls. The chance to hit falls off with range, by gun.
  - The gun reloads by itself, and its hotbar slot shows the reload.
  - Muzzle smoke, a faint streak, and a spurt of dust where the shot lands.
  - The tools still hit beasts as clubs.
- **Models.** Voxel pistol and rifle for the captain's hand (`render/toolModels.ts`).

**Hunting:**
- The night's crabs (1 hp) and boar (3 hp) can be shot.
- **Wild goats**, daytime game, graze in herds of 2–4 on grassy uplands, away from camps
  and firelight. They bolt when the captain comes within about 8 blocks. 2 hp; they
  drop 2 meat and 1 hide.
- **Hides** are a new good, about 8 gold, wanted in the free ports.

**The captain's health on foot:**
- 10 points, shown as a bar in the on-foot HUD. Only bandits' shots hurt; beasts don't
  bite.
- It comes back 1 point every 6 s once no bandit has fired for 15 s, and is full again
  whenever the captain goes aboard.

**Bandit camps** (new `land/bandits.ts`):
- **Where.** Seeded at world generation on about a third of the wild islets: never a
  port's island, never a cursed isle.
- **Your camps.** Bandits never come to them. A campfire can't be built within 60
  blocks of a manned camp ("Bandits hold this ground: clear their camp first"), and a
  cleared camp with a claim within 60 blocks stays empty for good.
- **The camp.** A lean-to and a fire built from blocks, 2–4 bandits, and a chest. There
  are more bandits, and better loot, further from Haven.
- **Bandits.** Ragged settler-style figures with muskets, walking with the settlers'
  walker and path-finding. 4 hp: one rifle shot or two pistol shots each.
- **Behaviour:**
  1. **At ease.** They loiter around camp. By day some wander the islet; at night
     they're all by the fire.
  2. **Alerted.** Seeing the captain within about 18 blocks, or hearing a shot within
     about 30, alerts the whole camp. At night they see only half as far.
  3. **Fighting.** They keep 8–16 blocks off, fire when loaded and in sight (2 damage,
     6 s reload, a chance to hit that falls off with range), and move between shots.
  4. **Fleeing.** At 1 hp a bandit runs, and is gone once out of sight.
- **Loot.** A fallen bandit drops a few gold and cartridges. The chest (E) holds 40–300
  gold and some goods, by distance from Haven.
- **Coming back.** A cleared camp is re-manned 5 days later. Saved: each camp's state,
  and when it was cleared.
- **What's simulated.** Only the camp on the islet the captain walks is stepped;
  elsewhere camps wait. Shooting bandits changes nobody's standing.

**Brought down by bandits:**
- The "come to" card (below): "Left for dead."
- They take 10% of the captain's gold, as a guardian does.
- The pack's goods drop where the captain fell, as one pile that lasts a full day
  instead of the usual ten minutes.
- The captain is put aboard: the ship is anchored off that island, because they rowed
  ashore from her. Health is full again.

## The "come to" card

One card replaces the toasts for going down. The screen fades to black and shows a
title and a line of what happened. It holds about 3 s (a key or click skips it), then
fades in wherever the captain came to. It grows out of the sleep fade.

| When | Title | Line |
|---|---|---|
| Sunk (after 5 s of watching her go) | Lost at sea | Your sloop went down, and 12 goods with her. You wash ashore at Haven, where the harbourmaster finds you another. |
| Jailed | In irons | Your freedom costs 300 gold, and your 12 goods are seized. You're released at Haven with a fresh sloop. |
| Bandits | Left for dead | Your crew carries you back aboard. The bandits took 45 gold, and your pack lies where you fell. |
| A guardian | The dead keep their gold | You come to at dawn beside the hole, 80 gold lighter. The hoard, and its guardian, are still there. |

## 10.3 Sound

**The engine** (new `audio/Sfx.ts`, Web Audio):
- One audio context, started by the first key press or click (as the music is). An
  "Effects volume" setting beside "Music volume", with Off.
- Each sound has variants: one is picked at random and played with a slight pitch
  shift.
- Sounds get quieter with distance from the camera's focus, and pan with where they are
  on screen.
- About 24 voices at once, with per-sound caps (footsteps 2, cannon 8); the oldest is cut.
- Ambience loops crossfade by where the captain is and what's happening; the wind in the
  rigging follows the wind's strength.
- A render-side `SoundDirector`, beside `Effects`, turns sea, land, duel and menu events
  into sounds, the same way they become smoke and splinters. Footsteps follow the walk
  cycle and the ground underfoot.

**The sounds (about 45):**

| Group | Sounds |
|---|---|
| Sea | cannon, hull hit, splash, sail tear, barrel blast, sinking, sails set |
| Ambience loops | waves on the hull, creaking timbers, wind in the rigging, surf ashore |
| On foot | footsteps on sand, grass, wood and stone; axe chop; tree falling; pickaxe on rock; outcrop breaking; digging; chest found; pickup |
| Guns and beasts | pistol, rifle, bandit's musket, reloading, bullet hitting, goat, boar, bandit's shout, captain hurt |
| Duel | blade clash, parry, block, kick, swing, grunt, the guardian's wail |
| Ports and camps | gulls, harbour bustle, saw, forge hammer, crackling campfire |
| Menus | click, coins, a page turning, "can't do that" |

**Making them:**
- ElevenLabs Sound Generation (`elevenlabs/sound-generation` through Comfy Cloud's
  `partner_generate`). 2–3 takes of each frequent sound, to use as variants.
- ffmpeg trims the silence, evens out the loudness and saves small mono files in
  `src/assets/sfx/`. Loops get their ends crossfaded so they repeat seamlessly.
- Every prompt goes in `docs/sfx.md`, like `docs/music.md`.
- **A dev-only sound board** (`/?sounds`) plays every effect, so the player can hear
  them and pick which to redo.

## Tests

- **10.1:** deposits placed by the rules; blows and yields by kind; the pickaxe refusing
  bare rock; growing back after 3 days, and waiting when blocked; buildings refused over
  deposits; miners working, and cutting wood when there's nothing to mine; saving.
- **10.2:** hit and miss by range and cover; cartridges used; reload timing; goats
  bolting; loot; bandits alerting, keeping range, needing line of sight, reloading and
  fleeing; being brought down (the gold, the pile, going aboard); camps coming back;
  the card's text; saving.
- **10.3:** picking variants; falloff and panning; voice caps; footsteps by ground; which
  event plays which sound.
- Each part is also played in the browser before it's committed.

## Not in this phase

- Caves, and the ground leveller (Phase 11).
- Landing parties, camp raids and rival treasure diggers.
- Smelting copper, silver or gold: they sell as ore.
- Beasts attacking the captain.

The numbers (prices, blows, ranges, days) are starting points to tune in play.
