# Handover (2026-10-09)

This is where the work stood when the machine was reset, and what a new session needs to pick it up. Read `docs/ARCHITECTURE.md` first; it's the source of truth for how the game works, with the roadmap in §16. This file covers the state of play, the decisions made on the player's behalf, and what's next.

## Where things stand

- **`main`** has everything, pushed to GitHub (`origin`, https://github.com/jeffory/havens-end). Every push to `main` deploys the live game (Cloudflare Workers Builds).
  - Phases 1–9 and 10.1–10.2.
  - The town shops and interiors work.
- **Every local branch is merged into `main`.** The phase branches stay local only, but nothing on them is missing from `main`.
- **Tests:** 746 tests. `npx tsc --noEmit -p .` is clean. Vitest is capped at four workers in `vite.config.ts`, because an uncapped run on a loaded machine timed out slow world-building tests. When the machine is heavily loaded (a load average above about 20, or the game rendering in a browser), some slow tests still time out. In the final run that hit `combat.test.ts` (5 s budget), `archipelago`, `bandits` and `town`. They all pass when run alone. If it happens, rerun the failing files.

| Work | State |
|---|---|
| Phase 10.1, outcrops and ores | ✅ |
| Phase 10.2, guns, goats, bandit camps, captain's health, the come-to card | ✅ merged `482f0a0` (plan `docs/superpowers/plans/2026-09-30-phase-10-2-guns-bandits.md`) |
| Town shops and interiors (issues #1–#4) | ✅ built and merged; the interior visual-critic loop stopped at 5/10 by the player's choice; leftovers filed as issues (below) |
| Phase 10.3, sound | next: ElevenLabs SFX through the user's ComfyUI `partner_generate`, a Web Audio engine, and a dev sound board at `/?sounds` for review by ear. Design in `docs/phase-10-deposits-guns-sound.md` |
| Phase 11, terrain and UI | later: red dithered town border, ground leveller, caves with ores |
| Phase 12, farming | later: watering, growth cycles |

## How the work was run (so a new session can carry on the same way)

- **Workflow:**
  1. Write a spec (`docs/…`).
  2. Write an implementation plan with the superpowers writing-plans skill (`docs/superpowers/plans/…`).
  3. Execute it with superpowers subagent-driven-development: one implementer per task, a task review, a fix loop, then a final whole-branch review.
  - The per-plan ledgers live in `.superpowers/sdd/`, which is gitignored and so lost with the machine. The decisions that mattered are copied below.
- **The player's standing instructions:**
  - Work phase by phase on a branch.
  - Commit and merge when they say. During the `/loop` they said to "continue automatically, use your best judgement", so tasks committed as they went.
  - Pushing to `main` deploys the live game, so ask before pushing unless told to.
  - Stage by path. Never stage the player's source files (MP3s, art) or `.opencode/`.
  - Never write the ComfyUI address into tracked files. It lives only in the gitignored `.env` as `COMFY_URL`.
  - Check the diff and commit messages for secrets and hostnames before every push.
- **Browser checks:**
  - Use Playwright against the dev server (`npx vite`, port 5173). Screenshots go in `.playwright-mcp/`, which is gitignored.
  - `window.game` exposes everything.
  - `docs/superpowers/plans/2026-10-09-town-shops-and-interiors.md`, lines 75–110, explains how to stand at a shop or house. Use `/?new`, then Skip, then `b` to dock; `game.ports[i]` gives the ports.
  - After many reloads, WebGL may refuse to start. Close the browser and navigate again.
- **Visual critic loop:**
  - The `visual-critic` skill: a fresh critic sees only screenshots and a factual manifest.
  - The gate is overall ≥ 8 with every screen ≥ 7, over at most 5 passes. Stop and ask when an issue survives two passes.

## Back up before resetting

These aren't in git:
- `.env`: the ComfyUI URL and key (`COMFY_URL`). The asset and music pipelines need it. See `.env.example`.
- `.opencode/`: another tool's state (and an old `git stash` of it). Not this project's code.
- Claude's memory for this project (`~/.claude/projects/-home-keith-Projects-Haven-s-end/memory/`). Its useful facts are folded into this file and ARCHITECTURE.

## Decisions made on the player's behalf

The player can overturn any of these. Each was made because the player asked for the work to continue on best judgement.

### Phase 10.2
- **Planned rulings that stand:**
  - Bandits flee at 2 hp.
  - The captain carries a pouch of up to 24 cartridges.
  - A fallen bandit's gold goes straight to the purse.
  - A downed captain's pack lies as one pile for a day.
  - The come-to card names the real port.
  - The health bar shows only when hurt or fighting.
  - Guns go in the hotbar after the tools, with a 10th slot on 0.
- **Balance:** the first numbers were too deadly, so the musket's hit chance is now 0.5 − 0.3·d/24 and its reload 7 s.
  - There's a ~2 s warning ("Bandits! They’ve seen you.") before the first volley.
  - Wounded bandits limp at 0.8× walking pace, and are gone when they reach the water's edge.
  - Measured: 2 bandits bring down a captain who stands still in about 38 s; 3 bandits in about 19 s.
- **Camps:**
  - Camps sit on about a third of the wild islets, 4 on seed 1717.
  - The clearing rule was loosened. Only a 5×5 core has to be level; the lean-to is levelled as it's built, and trees in the way are felled whole.
  - An islet without room falls through to the next one in the hash order.
  - The lean-to's posts are planks, so the axe can't fell them.
- **The pouch:**
  - It takes no pack room.
  - It fills on wild islets, and on walking out of a port town. It goes back to the hold on walking back into town, so the market still sees every cartridge.
- **The fight camera:** it leans halfway toward the nearest bandit in a fight (capped at 8) and stands back to at least 48.
- **Chests:** a camp's chest can be opened while its bandits are still there (grab and run).
- **Goats:** they keep to their upland even when they bolt.
- **Being brought down:** the pack left behind lasts at least the usual drop time, even on the 6-minute day.
- **The come-to card:** it's modal. Holding a key can't skip it, and a key press can't open a menu under it.

### Town shops and interiors
- **Roofs:** every building is cut at head height (2 above its floor) instead of a storey up.
  - The walls facing the camera drop to one course, doll's-house style.
  - Every cut wall gets one timber cap.
  - A lifted room gets lamplight at night, and lifted roofs cast no shadow into the room.
- **Lines of sight:** a line of sight passes through up to three things it has already lifted.
  - A ray that starts inside a block is cast again from outside it, so a stall you walk into doesn't vanish.
  - A prop's blocker joins other structures only at a face.
- **Finer props:** props drawn at an eighth of a block a voxel (stalls, the hand cart, all the furniture) are authored in code, with no paid generation and no image textures.
  - They reserve invisible `Blocker` cells three high.
  - Furniture is anchored at the floor, so it never lifts.
- **The walker:**
  - Nobody (captain, townsfolk or bandits) can stand on a Blocker.
  - The air above a prop is walled down to the first solid cell (`BLOCKER_REACH` 64), so you can't drop onto a stall from a roof.
  - A walker already over one can step off it.
- **Keepers:**
  - Keepers' posts are hard-clear (0.8) of lingering places, by day and night.
  - Keepers take no random draws, but other townsfolk's lingering places can shift because of them.
  - Townsfolk keep clear of door steps and the well, and step aside from the captain.
- **The ship on the stocks:** she's now a framed hull drawn finer, and never lifts. Under her planked bottom she can hide the captain, though his ring still shows.
- **The player's own calls on critic pass 2:**
  - Rebuild the shipyard as an enclosed workshop: not done yet (#5).
  - Ease the camera in at buildings: done. At a door or inside, the camera eases in (26 at a zoom of 36) and frames the room clear of the hotbar. Big rooms frame a little further out. It frames only at a door or inside, not whenever a roof lifts, so the view doesn't swing from house to house in the street (`ROOM_REACH` in `Game.ts`). A fight's framing still wins.
  - Give the captain a brighter coat: done. A deep red coat with gold trim and a gold-edged brown hat, ashore and in duels. The red sash became a leather belt so it isn't lost against the coat.
  - One more pass, then move on: cut short at the reset. The pass's world-side fixes, the critic re-score and the final code review are issues #5 and #6.
- **Also in that pass:**
  - furniture against a near wall is cut as low as the wall (two-high shelves beside the keepers' posts had hidden them);
  - shaded, smaller bats, kept out of lifted rooms;
  - tricorns with a lighter crown and a brass cockade;
  - windows drawn as panes that glow amber at night;
  - wind streaks only over open water;
  - darker empty hotbar labels.

## Open issues to pick up

On GitHub:
- **#5, the rest of the interior pass:**
  - the enclosed shipyard workshop;
  - the dark sign slabs by shop doors;
  - room layouts varying by port;
  - no bed under the stairs;
  - office layout;
  - Haven's rug;
  - the shipwright's look;
  - the Kingsreach tower top.
- **#6, a final whole-branch code review of the town work.** It merged without one. Each of its tasks was reviewed, and each fix round re-reviewed.
- **#7, deferred minor findings from the reviews,** collected into one issue.
- #4 stays open until the interior critic passes its gate.
