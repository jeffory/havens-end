# Music: how it's made

The game's music is generated on Comfy Cloud from text:
**MiniMax Music 3** for songs with sung lyrics (the shanties) and **Sonilo** for
instrumentals. Both run from Comfy Cloud templates through the `comfy-cloud` MCP tools
in Claude Code, not through `npm run asset`. The exact inputs of every track are below,
so any of them can be rerun or tweaked.

| Track | Plays | Model | Length | File |
| --- | --- | --- | --- | --- |
| Haul Away to Haven | At sea, when the crew sings (N) | MiniMax Music 3 | 2:10 | `shanties/haul-away-to-haven.mp3` |
| Run Out the Guns | At sea, when the crew sings (N) | MiniMax Music 3 | 2:30 | `shanties/run-out-the-guns.mp3` |
| Ashore | On foot, with 30 s of quiet between plays | Sonilo | 3:00 | `ashore.mp3` |
| Broadsides | In a fight at sea or a duel, looped | Sonilo | 2:30 | `broadsides.mp3` |

The files are in `src/assets/music/`; `src/audio/Soundtrack.ts` decides which plays.

The sound to aim for is a real acoustic folk band: concertina, fiddle, bodhrán,
bouzouki, upright bass and tin whistle. "Haul Away to Haven" is a deliberate exception:
its band is an N64-style console soundfont, chosen over an all-acoustic take of the same
song. Sims-style gibberish vocals were tried and dropped for real English lyrics.

## Songs: MiniMax Music 3

One run of the template `audio_minimax_music_3` makes one song. It costs GPU time
only, no API credits: 40–100 s on Comfy Cloud's RTX Pro 6000 for a 1–3 minute song,
after a queue of up to about 2 minutes.

```json
{
  "name": "audio_minimax_music_3",
  "input_overrides": {
    "37:13": { "max_duration": 150, "caption": "Global Metadata: ...", "lyrics": "[Intro]\n..." }
  }
}
```

- Put the song on the interior node `37:13` with `input_overrides`. The
  `slot_overrides` addresses that `get_template_schema` lists (`37.caption` and so on)
  fail with "no proxyWidget mapping".
- Everything else stays at the template's defaults: 30 steps, cfg 1.7, euler/simple,
  seed `197122968890040`. The seed was never changed, so identical inputs should give
  the same song again (untested).
- `max_duration` is a ceiling in seconds. The model may finish sooner: "Haul Away to
  Haven" asked for 150 and came out at 130.

**The caption** is three labelled paragraphs, and MiniMax follows the shape well:

- `Global Metadata:` genre, BPM, key, rhythm feel, mood, the scene, how the recording
  should sound.
- `Vocal Details:` "English lyrics, sung clearly", the lead voice, the crew's
  call-and-response, harmonies and shouts.
- `Arrangement:` the instruments, then a plan for each section (intro, verses,
  chorus, instrumental break, final chorus, outro).

**The lyrics** use section tags: `[Intro]`, `[Verse]`, `[Chorus]`, `[Instrumental]`,
`[Bridge]`, `[Outro]`. An empty tag asks for a band-only section. The crew's answers go
in parentheses on their own line, e.g. `(Way, hey, haul away!)`. Write the chorus out
in full every time it comes round. MiniMax may still shorten or merge sections,
especially the instrumental breaks.

## Instrumentals: Sonilo

Sonilo is a paid partner API. It makes instrumental music only, up to 6 minutes, from a
text prompt. It has no lyrics input.

```json
{
  "name": "api_sonilo_t2m",
  "input_overrides": { "726": { "prompt": "...", "duration": 180 } }
}
```

- Node `726` is the Sonilo node: `prompt`, and `duration` in seconds (1–360). Node `728`
  saves an MP3 (V0).
- **It bills by length: about 0.475 credits a second (28.5 a minute).** A 60 s track
  cost 28.49, 150 s cost 71.21 and 180 s cost 85.46. `estimate_credits` quotes a flat
  32 whatever the duration, so work the price out from the length instead.
- The seed is ignored by the service. Every run differs and none can be remade, so keep
  every take you like.
- Several cues at once: `submit_batch` with one `run_template` item each.
- Write the prompt as prose, like a brief to a composer: genre, instruments, tempo,
  key, mood, where it plays in the game, whether it must loop.

Sonilo is also a core ComfyUI partner node (`SoniloTextToMusic`), so it should run on
your own ComfyUI server with `COMFY_API_KEY` from `.env`, like the art tooling. That is
untested.

## The inputs, track by track

### Haul Away to Haven (MiniMax, `max_duration` 150)

```text
Global Metadata: Rousing sea shanty for a pirate video game, in the style of a late-1990s Nintendo 64 adventure soundtrack. 118 BPM, D minor with a dorian flavour, bouncy 4/4 stomp. Jolly, rowdy and a little bittersweet, like a pirate crew singing in a tavern after a long voyage. Production: the band is sequenced MIDI played through a small, low-sample-rate console soundfont. Short looped instrument samples, dry and slightly crunchy, tightly quantized, cartoonish. The voices are real, clear and up front.

Vocal Details: English lyrics, sung clearly. A gravelly male lead shantyman sings each line; a big rowdy crew of mixed voices answers with the lines in parentheses, call-and-response, loud and slightly ragged in a fun way, with foot stomps and 'hup!' shouts. Choruses sung by everyone together in hearty unison with a high harmony on top.

Arrangement: Oom-pah tuba bass, squeezy accordion lead, plinky marimba and xylophone, pizzicato strings, tin whistle countermelody, woodblock and hand-clap percussion. Intro: accordion alone, then the tuba bounces in. Verses: tuba, accordion and marimba under the lead and crew. Chorus: full band. Instrumental break: tin whistle and accordion trade the tune. Final chorus: everyone louder. Outro: one last 'hup!' and a short brass sting.
```

```text
[Intro]
(Hup! Hup!)

[Verse]
Oh, I came aboard in a biscuit crate
(Way, hey, haul away!)
Old Thorne's Good Hope was my cradle and mate
(Haul away to Haven!)
He taught me the wind and he taught me the sheet
(Way, hey, haul away!)
Till the Admiral's guns sent her down to the deep
(Haul away to Haven!)

[Chorus]
So heave, me lads, and let her go
To Haven's End where the warm winds blow
There's sugar and rum and a fire on the sand
And a home for a rogue on Haven's land
(Hup!)

[Verse]
Now I've a sloop and a hold full of rum
(Way, hey, haul away!)
And a riddle to dig when the ghost lights come
(Haul away to Haven!)
Blackwood's gold on a cursed isle lies
(Way, hey, haul away!)
And Harrow's sails on the grey sunrise
(Haul away to Haven!)

[Chorus]
So heave, me lads, and let her go
To Haven's End where the warm winds blow
There's sugar and rum and a fire on the sand
And a home for a rogue on Haven's land
(Hup!)

[Instrumental]

[Chorus]
So heave, me lads, and let her go
To Haven's End where the warm winds blow
There's sugar and rum and a fire on the sand
And a home for a rogue on Haven's land

[Outro]
(Haul away to Haven!)
(Hup!)
```

The all-acoustic take used the same lyrics, `max_duration` 150 and this caption:

```text
Global Metadata: Authentic traditional sea shanty, folk, 110 BPM, D minor with a dorian flavour, driving 4/4 stomp. Rousing, hearty and a little bittersweet, a pirate crew singing together in a crowded harbour tavern after a long voyage. Production: warm, live acoustic recording in a wooden room, natural reverb, everything played by real musicians, rich full-bodied mix with the voices front and centre.

Vocal Details: English lyrics, sung clearly. A deep, gravelly male lead shantyman sings each line with swagger; a big crew of twenty mixed voices answers with the lines in parentheses, call-and-response, full-throated and a touch ragged in the best way. Choruses sung by everyone together with rich bass-baritone harmonies and a high tenor line on top. Foot stomps, table thumps, tankards clinking and 'hup!' shouts.

Arrangement: Concertina and fiddle carrying the tune, bodhrán and deep stomp-clap percussion, strummed bouzouki, upright bass, tin whistle countermelody. Intro: the lead sings the first line almost a cappella over stomps. Verses: stomps, bodhrán and concertina under the lead and crew. Chorus: the full band and every voice. Instrumental break: fiddle and tin whistle play the chorus tune as a lively reel. Final chorus: stripped back to voices and stomps for the first two lines, then the whole band crashes back in, louder than ever. Outro: one last 'hup!' and a big cheer.
```

### Run Out the Guns (MiniMax, `max_duration` 180)

```text
Global Metadata: High-energy traditional sea shanty with Celtic folk-rock drive, all acoustic. 146 BPM, E minor, relentless galloping 4/4 with a hard stomp on every beat. Wild, triumphant and rowdy, a pirate crew roaring through a sea battle. Production: loud, punchy live acoustic recording, big and close, every instrument clearly audible, the band as prominent as the singers.

Vocal Details: English lyrics, sung clearly. A deep, gravelly male lead shantyman barks each line with fire; a big crew of mixed voices shouts back the lines in parentheses, call-and-response, full-throated. Choruses sung by everyone together with rich harmonies. Shouts, whoops, 'hey!' and 'hup!' on the off-beats.

Arrangement: Instrument-forward. Fiddle, concertina, tenor banjo and mandolin playing fast interlocking reels; tin whistle soaring on top; bouzouki strumming hard; upright bass driving eighth notes; bodhrán, a booming ship's drum and heavy foot stomps and claps. The instruments answer every vocal line with quick fills and runs. Intro: a solo fiddle reel, then the whole band explodes in. Instrumental sections: long, fast fiddle and banjo solos trading licks, concertina and whistle doubling the melody, the drums pounding. Breakdown: only bodhrán and stomps with crew chanting, then the fiddle builds back up. Final chorus: key lift, faster, everyone flat out. Outro: the reel speeds up and slams to a hard stop on a single drum hit and a shout.
```

```text
[Intro]

[Verse]
There's a sail off the bow and she's flying the crown
(Run out the guns, boys!)
She's heavy with sugar and bound for the town
(Run 'em out and roar!)
So bring her about with the wind on the beam
(Run out the guns, boys!)
We'll rattle her timbers and split every seam
(Run 'em out and roar!)

[Chorus]
Round shot! Chain shot! Grapeshot too!
Fire to port and the smoke rolls through
Strike your colours or go to the deep
The Haven crew's got your gold to keep!

[Instrumental]

[Verse]
Now we're up on her rail with a cutlass in hand
(Run out the guns, boys!)
Her captain's a devil, the best in the land
(Run 'em out and roar!)
So block and then parry and kick at his guard
(Run out the guns, boys!)
Roll under his blade and then strike him down hard
(Run 'em out and roar!)

[Chorus]
Round shot! Chain shot! Grapeshot too!
Fire to port and the smoke rolls through
Strike your colours or go to the deep
The Haven crew's got your gold to keep!

[Instrumental]

[Bridge]
Hey! Ho! Heave and haul!
Hey! Ho! Heave and haul!
Hey! Ho! Heave and haul!
Run 'em out and take 'em all!

[Chorus]
Round shot! Chain shot! Grapeshot too!
Fire to port and the smoke rolls through
Strike your colours or go to the deep
The Haven crew's got your gold to keep!

[Outro]
```

### Ashore (Sonilo, `duration` 180)

Light, folksy and unhurried, for walking the islands, building and farming.

```text
Gentle, laid-back acoustic folk for wandering a sunny Caribbean island on foot in a pirate adventure game. A small band of real musicians in a warm wooden room: fingerpicked acoustic guitar and bouzouki carrying a simple, lilting melody, soft concertina chords breathing underneath, a mellow low whistle taking the tune now and then, light upright bass, and only soft hand percussion (a brushed bodhrán and a quiet shaker). Relaxed 6/8 lilt around 84 BPM in G major. Unhurried and content, a little wistful, like a lazy afternoon ashore with the ship at anchor, building a camp and tending crops. Calm and warm, never busy or dramatic: no big build-ups, no drum kit, no vocals. Instrumental background music that stays at an even level throughout and loops seamlessly, ending the way it began.
```

### Broadsides (Sonilo, `duration` 150)

Driving and loud, for cannon fights at sea.

```text
Fierce, driving instrumental sea-battle music for the cannon fights between sailing ships in a pirate adventure game. An all-acoustic Celtic folk band played hard by real musicians, big and close: fast fiddle and tenor banjo reels trading urgent runs, concertina stabs, tin whistle soaring over the top, bouzouki and guitar strumming hard, upright bass driving eighth notes, pounding bodhrán, booming war drums and a deep ship's drum, heavy foot stomps and claps. Relentless galloping 4/4 at 150 BPM in E minor. Tense, wild and triumphant, like broadsides roaring through smoke and spray while the crew hauls the guns. Keeps its intensity the whole way, with short breakdowns of just drums and stomps before the fiddle rips back in. No vocals. Loopable game battle music.
```

## Getting a track into the game

- **Download it straight away.** The output's signed link expires after 6 hours. The
  track stays in the Comfy Cloud history, so `get_output` with the job's `prompt_id`
  mints a fresh link later.
- **Strip the tags from a copy, and keep the original.** Comfy's MP3s carry the whole
  workflow, caption and lyrics in their tags. That is useful to keep, but not to
  publish: `ffmpeg -i in.mp3 -map_metadata -1 -c:a copy out.mp3`.
- **Shanties** go in `src/assets/music/shanties/`. They're found at build time, and the
  file name becomes the title (see the README).
- **Match the levels.** Measure with `ffmpeg -i in.mp3 -af ebur128 -f null -`. The
  shanties sit at −13.5 LUFS, Broadsides too, and Ashore at −15 as background. Sonilo
  comes out near −10.8 LUFS, so its tracks were turned down while stripping them:

  ```sh
  ffmpeg -i 7-sonilo-land-chill.mp3 -map 0:a -map_metadata -1 -id3v2_version 0 -af volume=-4.2dB -c:a libmp3lame -q:a 0 src/assets/music/ashore.mp3
  ffmpeg -i 8-sonilo-naval-battle.mp3 -map 0:a -map_metadata -1 -id3v2_version 0 -af volume=-2.8dB -c:a libmp3lame -q:a 0 src/assets/music/broadsides.mp3
  ```

- **Nothing loops by itself.** The MiniMax songs have a real intro and ending. Sonilo
  was asked for loops, but Ashore fades to silence at its end and Broadsides stops
  hard. So Ashore plays with a pause between, and Broadsides crossfades its last 2
  seconds into its start.
- **Size.** A V0 MP3 is about 4–5 MB for 2–3 minutes. Re-encoding to Opus at 96 kbps
  would cut that by more than half.
- **Licences are unchecked.** Nobody has yet read MiniMax Music 3's weights licence or
  Sonilo's terms for use in a public MIT repo and a published game.
