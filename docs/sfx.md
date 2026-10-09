# Sound effects: how they're made

Every sound effect is generated from a text prompt. The prompts, lengths and number of
takes are in `src/audio/sfx/sounds.ts`; the table below lists them all. The files are in
`src/assets/sfx/`, named `<id>-<take>.mp3`, and the game picks a take at random.

| Sound | Kind | Length | Takes | Prompt |
| --- | --- | --- | --- | --- |
| `cannon` | one-shot | 2.5 s | 3 | A single 18th-century naval cannon firing from a wooden warship: a deep, heavy boom with a sharp crack and a rolling rumble tail over open sea. No music. |
| `hull-hit` | one-shot | 1.5 s | 3 | A cannonball smashing into a wooden ship's hull: a heavy splintering crack of oak planks with debris clattering. No music. |
| `splash` | one-shot | 1.5 s | 3 | A cannonball plunging into the sea close by: a deep heavy water splash with spray falling back. No music. |
| `sail-tear` | one-shot | 1.5 s | 2 | Chain shot ripping through a ship's canvas sails and rigging: a loud tearing of heavy cloth and snapping ropes. No music. |
| `barrel-blast` | one-shot | 3 s | 2 | A floating barrel of gunpowder exploding at sea: a big muffled blast, a burst of water and wooden debris raining down. No music. |
| `sinking` | one-shot | 6 s | 1 | A wooden sailing ship sinking: deep groaning timbers, rushing water flooding the hull, bubbling and a final gurgle. No music. |
| `sails-set` | one-shot | 2 s | 2 | Sailors setting the sails on a wooden ship: heavy canvas unfurling and snapping full of wind, ropes running through blocks. No music. |
| `step-sand` | one-shot | 0.6 s | 3 | A single footstep of a boot on soft dry beach sand, close up. One step only. |
| `step-grass` | one-shot | 0.6 s | 3 | A single footstep of a leather boot on grass and soft earth, close up. One step only. |
| `step-wood` | one-shot | 0.6 s | 3 | A single footstep of a heavy boot on old wooden planks, a hollow knock, close up. One step only. |
| `step-stone` | one-shot | 0.6 s | 3 | A single footstep of a boot on stone and gravel, a crunchy scuff, close up. One step only. |
| `axe-chop` | one-shot | 0.8 s | 3 | A single axe blow biting into a tree trunk: a solid woody chop. One chop only. No music. |
| `tree-fall` | one-shot | 3.5 s | 2 | A palm tree cracking and crashing to the ground: splitting wood, rustling leaves, a heavy thud. No music. |
| `pickaxe` | one-shot | 0.8 s | 3 | A single iron pickaxe strike on hard rock: a sharp metallic clink and a few chips of stone. One strike only. |
| `outcrop-break` | one-shot | 1.5 s | 2 | A rock outcrop breaking apart: stone cracking and chunks of rock tumbling to the ground. No music. |
| `dig` | one-shot | 0.8 s | 3 | A single shovel scoop into sandy earth: a dry scrape and the soil tipped aside. One scoop only. |
| `chest-found` | one-shot | 2.5 s | 1 | A spade striking a buried wooden treasure chest, then the lid creaking open over a jingle of gold coins. No music. |
| `pickup` | one-shot | 0.5 s | 2 | A small soft pickup sound: an item scooped up into a leather satchel. Short and quiet. |
| `pistol` | one-shot | 1.5 s | 2 | A single 18th-century flintlock pistol shot: the flint snap, a sharp bang and a puff of smoke. No music. |
| `rifle` | one-shot | 2 s | 2 | A single long flintlock rifle shot: a flint snap and a loud cracking report echoing off hills. No music. |
| `musket` | one-shot | 2 s | 3 | A single distant flintlock musket shot fired by a bandit: a dull boom with a short echo. No music. |
| `reload` | one-shot | 1.5 s | 2 | Reloading a flintlock gun: a ramrod rattling down the barrel, then the hammer cocked with a click. No music. |
| `bullet-hit` | one-shot | 0.5 s | 3 | A lead musket ball striking earth and wood: a short thwack with a spray of dirt. One impact only. |
| `goat` | one-shot | 1 s | 2 | A startled wild goat bleating once in alarm. |
| `boar` | one-shot | 1 s | 2 | A wild boar snorting and squealing once, angry and startled. |
| `bandit-shout` | one-shot | 1.5 s | 2 | A rough pirate bandit shouting an alarm in the distance, a gruff wordless yell to arms. |
| `captain-hurt` | one-shot | 0.6 s | 2 | A man grunting in pain as he is struck, short and gruff. |
| `blade-clash` | one-shot | 0.8 s | 3 | Two steel cutlasses clashing hard: a ringing metallic clang. One clash only. |
| `parry` | one-shot | 0.8 s | 2 | A swift sword parry: a bright high steel ring as one blade turns another aside. One parry only. |
| `block` | one-shot | 0.6 s | 2 | A sword blow blocked: a short dull metallic clank of blades. One block only. |
| `kick` | one-shot | 0.5 s | 2 | A heavy boot kick landing on a man's body: a dull thump. One kick only. |
| `swing` | one-shot | 0.5 s | 3 | A cutlass swung fast through the air: a short sharp whoosh. One swing only. |
| `grunt` | one-shot | 0.6 s | 3 | A sword fighter grunting with effort as he is hit, short and gruff. |
| `guardian-wail` | one-shot | 4 s | 1 | A ghostly pirate captain rising from a cursed grave: an eerie hollow wail echoing in the night wind. No music. |
| `saw` | one-shot | 2.5 s | 2 | A two-man pit saw cutting through a log: a few rhythmic rasping strokes. No music. |
| `forge-hammer` | one-shot | 2 s | 2 | A blacksmith hammering hot iron on an anvil: three ringing strikes. No music. |
| `click` | one-shot | 0.5 s | 2 | A soft wooden click of a button, like a small tap on a ship's chart table. Short. |
| `coins` | one-shot | 0.8 s | 2 | A handful of gold coins clinking into a purse. Short. |
| `page` | one-shot | 0.8 s | 2 | A single page of an old parchment book being turned. Short. |
| `cant` | one-shot | 0.5 s | 1 | A short dull wooden knock, a gentle "no" sound for an action that can't be done. |
| `waves` | loop | 20 s | 1 | Calm open-sea waves lapping against a wooden ship's hull as she sails, steady and seamless, no wind, no music. |
| `timbers` | loop | 20 s | 1 | The creaking timbers and ropes of an old wooden sailing ship rolling gently at sea, slow groans and creaks, no music. |
| `rigging` | loop | 20 s | 1 | Steady wind blowing through a sailing ship's rigging and sails, a whistling breeze with canvas fluttering, no music. |
| `surf` | loop | 20 s | 1 | Gentle surf breaking on a tropical sandy beach, small waves rolling in and washing back, no music. |
| `gulls` | loop | 20 s | 1 | Seagulls calling over a harbour, distant and occasional, with a soft sea breeze, no music. |
| `harbour` | loop | 20 s | 1 | The bustle of an 18th-century harbour town: distant murmuring voices, carts, footsteps and a dog far off, no music. |
| `campfire` | loop | 20 s | 1 | A campfire crackling and popping steadily at night, close up, no music. |

## How they were made

- The model is ElevenLabs `elevenlabs/sound-generation`, run through Comfy Cloud's
  `partner_generate` tool, with `params.duration` set to the sound's length and `client_os`.
- Each download is saved as `sfx-raw/<id>-<take>.mp3` (`.flac`, `.wav` and `.ogg` also work).
  `sfx-raw/` is not committed.
- `npm run sfx -- process` turns every raw take into a small mono MP3 in `src/assets/sfx/`.
  One-shots are trimmed of silence at both ends and levelled; loops have their ends crossfaded
  (1.5 s) so they repeat seamlessly. Takes already newer than their raw file are skipped.
- To redo a take, regenerate it, save it over its raw file and run the process step again.
- `npm run sfx -- docs` rewrites this file from `sounds.ts`.
- The sound board, for listening to every take, is at `/?sounds`.
