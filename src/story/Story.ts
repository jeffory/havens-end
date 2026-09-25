import { createAi } from '../combat/ai';
import type { Sea } from '../combat/sea';
import { createVessel, syncCondition, type Vessel } from '../combat/vessel';
import { SEA_LEVEL } from '../config';
import { isNight } from '../core/clock';
import type { Notice, Outcome } from '../economy/economy';
import type { Port } from '../economy/ports';
import { adjust, standingNews } from '../economy/reputation';
import { type Upgrade, UPGRADES, withUpgrades } from '../economy/shipyard';
import { BRIG, FRIGATE, SLOOP } from '../sailing/ships';
import type { VoxelWorld } from '../voxel/VoxelWorld';
import { ADMIRAL, type Character, CHARACTERS, type Choice, ENTRIES, type Places, type Stage, STAGES, TALKS, type TalkSpec, WHERE } from './script';

/** Someone to talk to, now: who they are, what they say, and any answers that decide something. */
export interface Talk {
  id: string;
  who: Character;
  name: string;
  role: string;
  lines: string[];
  choices: Array<{ id: Choice; label: string }>;
}

export interface JournalEntry {
  stage: Stage;
  title: string;
  text: string;
  current: boolean;
  /** The day it began. */
  day: number;
  objectives: Array<{ text: string; done: boolean }>;
  /** What people have told you about it. */
  words: Array<{ who: string; lines: string[] }>;
}

export type StoryEvent =
  /** The main thread moved on: a new journal entry. */
  | { kind: 'stage'; stage: Stage; title: string }
  /** Harrow is finished: show the last picture. */
  | { kind: 'epilogue' };

export interface StorySnapshot {
  stage: Stage;
  heard: string[];
  choice: Choice | null;
  reached: Partial<Record<Stage, number>>;
  intro: boolean;
  ending: 'duel' | 'sunk' | null;
}

/** The Sovereign comes out to meet you from this far off her station; she and her company go home when you're beyond the second. */
const SPAWN_RANGE = 650;
const LEAVE_RANGE = 1100;
/** Where she lies off the capital (from the middle of its island, toward Haven), and the water she needs. */
const STATION_OFFSHORE = 260;
const STATION_DEPTH = 6;
/** Group numbers for the story's ships, clear of the encounter director's. */
const STORY_GROUP = 900_000;
const ESCORT_STATIONS: Array<[number, number]> = [
  [-22, -18],
  [22, -18],
];
const ALLY_STATIONS: Array<[number, number]> = [
  [-18, -16],
  [18, -16],
];
/** What each road rewards the captain with, on top of the Sovereign's course. */
const REFITS: Record<Choice, Upgrade> = { black: 'guns', colours: 'hull' };

/**
 * The main story: the Good Hope, the bosun, Blackwood's chart, the cipher, the black
 * flag and the Sovereign. Pure simulation beside the `Economy` and the `Treasure`: it
 * says who can be talked to where, moves the thread on as things are heard and found,
 * writes the journal, and sets the Sovereign on the sea when her time comes.
 */
export class Story {
  stage: Stage = 'nell';
  heard: string[] = [];
  choice: Choice | null = null;
  reached: Partial<Record<Stage, number>>;
  /** The intro has been shown (on a new game). */
  introSeen = false;
  /** How Harrow was finished: taken in a duel, or sent down with his ship. */
  ending: 'duel' | 'sunk' | null = null;
  /** Where the Sovereign keeps station, off the Crown's capital. */
  readonly station: { x: number; z: number };
  private readonly ports: Record<keyof Omit<Places, 'admiral'>, Port>;
  private sovereign: number | null = null;
  private allies: number[] = [];
  private notices: Notice[] = [];
  private events: StoryEvent[] = [];

  constructor(
    private readonly world: VoxelWorld,
    private readonly sea: Sea,
    ports: readonly Port[],
  ) {
    const haven = ports[0];
    const imperial = ports.filter((p) => p.faction === 'imperial').sort((a, b) => Math.hypot(a.x - haven.x, a.z - haven.z) - Math.hypot(b.x - haven.x, b.z - haven.z));
    const pirates = ports.find((p) => p.faction === 'pirate') ?? haven;
    this.ports = { haven, pirates, crown: imperial[0] ?? haven, capital: imperial[imperial.length - 1] ?? haven };
    this.station = this.findStation(this.ports.capital, haven);
    this.reached = { nell: sea.clock.day };
  }

  takeNotices(): Notice[] {
    const n = this.notices;
    this.notices = [];
    return n;
  }

  takeEvents(): StoryEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  snapshot(): StorySnapshot {
    return { stage: this.stage, heard: [...this.heard], choice: this.choice, reached: { ...this.reached }, intro: this.introSeen, ending: this.ending };
  }

  restore(s: StorySnapshot): void {
    Object.assign(this, { stage: s.stage, heard: [...s.heard], choice: s.choice, reached: { ...s.reached }, introSeen: s.intro, ending: s.ending });
    this.sovereign = null;
    this.allies = [];
  }

  /** The names the script needs, as they stand now: the admiral is "the admiral" until the letter is read. */
  get places(): Places {
    const name = (k: keyof typeof this.ports) => this.ports[k].name;
    return { haven: name('haven'), pirates: name('pirates'), crown: name('crown'), capital: name('capital'), admiral: this.admiralKnown ? ADMIRAL : 'the admiral' };
  }

  get admiralKnown(): boolean {
    return STAGES.indexOf(this.stage) >= STAGES.indexOf('flag');
  }

  // ---- Talking ----

  /** Who there is to talk to at this door, now, and what they'd say. */
  talksAt(port: Port, place: 'office' | 'tavern'): Talk[] {
    const night = isNight(this.sea.clock.phase);
    const talks: Talk[] = [];
    for (const who of Object.keys(CHARACTERS) as Character[]) {
      const where = WHERE[who];
      if (this.ports[where.port].id !== port.id || where.place !== place || (where.night && !night)) continue;
      const spec = TALKS.find((t) => t.who === who && this.open(t));
      if (spec) talks.push(this.render(spec));
    }
    return talks;
  }

  /**
   * Hears someone out. With `answer`, takes the road they offer. A talk that offers a
   * choice, heard without an answer, stays open to come back to.
   */
  talk(id: string, answer?: Choice): Outcome {
    const spec = TALKS.find((t) => t.id === id);
    if (!spec || !this.open(spec)) return fail('There’s no one here by that name.');
    if (spec.choices?.length && !answer) return done('');
    if (answer && !spec.choices?.some((c) => c.id === answer)) return fail('That isn’t on offer.');
    if (!this.heard.includes(id)) this.heard.push(id);
    if (answer) this.choose(answer);
    if (spec.advance) this.advance(spec.advance);
    return done('');
  }

  private open(t: TalkSpec): boolean {
    if (!t.stages.includes(this.stage) || this.heard.includes(t.id)) return false;
    if (t.after && !this.heard.includes(t.after)) return false;
    if (t.letter && !this.sea.captain.letter) return false;
    if (t.choice !== undefined && t.choice !== this.choice) return false;
    return true;
  }

  private render(t: TalkSpec): Talk {
    const c = CHARACTERS[t.who];
    return { id: t.id, who: t.who, name: c.name, role: c.role, lines: t.lines(this.places), choices: t.choices ?? [] };
  }

  /** Takes a road: the black flag, or the Guild's letter of marque. */
  private choose(choice: Choice): void {
    this.choice = choice;
    const standing = this.sea.captain.standing;
    const changes = choice === 'black'
      ? [adjust(standing, 'pirate', Math.max(0, 50 - standing.pirate)), adjust(standing, 'imperial', Math.min(0, -40 - standing.imperial)), adjust(standing, 'merchant', -25)]
      : [adjust(standing, 'merchant', 20)];
    for (const change of changes) {
      if (!change) continue;
      const tone = change.to > change.from ? 'good' : 'bad';
      for (const text of standingNews(change)) this.notices.push({ text, tone });
    }
    // The road's gift: the Brethren's gunners drill yours, or the Guild's shipwrights stiffen her.
    const p = this.sea.player;
    const refit = REFITS[choice];
    if (!p.upgrades.includes(refit)) {
      p.upgrades.push(refit);
      const oldHull = p.cls.type.hull;
      p.cls = withUpgrades(this.sea.classFor(p.cls.design), p.upgrades);
      p.hull += p.cls.type.hull - oldHull;
    }
    p.crew = p.cls.type.crew;
    syncCondition(p);
    this.notices.push({
      text: choice === 'black'
        ? `You raise the black flag. The Brethren fill your crew, and their gunners drill yours: ${UPGRADES[refit].label.toLowerCase()}.`
        : `You carry the Guild’s letter of marque. Their shipwrights fit ${UPGRADES[refit].label.toLowerCase()}, and your crew is made up.`,
      tone: 'good',
    });
    this.advance('sovereign');
  }

  private advance(stage: Stage): void {
    if (STAGES.indexOf(stage) <= STAGES.indexOf(this.stage)) return;
    this.stage = stage;
    this.reached[stage] = this.sea.clock.day;
    const entry = ENTRIES.find((e) => e.stage === stage)!;
    this.events.push({ kind: 'stage', stage, title: entry.title });
    this.notices.push({ text: `New in your journal: ${entry.title} (J).`, tone: 'info' });
  }

  // ---- The thread moving on by itself, and the Sovereign ----

  /** Checks what's been found (Blackwood's letter), and brings the Sovereign out when you come for her. */
  step(): void {
    if (this.stage === 'chart' && this.sea.captain.letter) this.advance('cipher');
    if (this.stage === 'sovereign') this.stepSovereign();
  }

  /** Is this the Sovereign? Harrow himself is aboard her. */
  isSovereign(vessel: number): boolean {
    return this.sovereign === vessel;
  }

  private stepSovereign(): void {
    const sea = this.sea;
    const p = sea.player;
    const flagship = this.sovereign === null ? undefined : sea.vessel(this.sovereign);
    const away = Math.hypot(p.ship.x - this.station.x, p.ship.z - this.station.z);
    if (flagship) {
      if (flagship.status === 'captured') return this.finish('duel');
      if (flagship.status === 'sinking') return this.finish('sunk');
      // Beaten off, jailed or gone elsewhere: she goes back to her station, to be met another day.
      if (away > LEAVE_RANGE || p.status !== 'afloat') this.standDown();
      return;
    }
    if (p.status !== 'afloat' || sea.ashore || away > SPAWN_RANGE) return;
    this.sally();
  }

  /** The Sovereign and her two brigs come out, and (under the black flag) the Brethren's ships join you. */
  private sally(): void {
    const sea = this.sea;
    const p = sea.player;
    const heading = Math.atan2(p.ship.x - this.station.x, p.ship.z - this.station.z);
    const s = Math.sin(heading);
    const c = Math.cos(heading);
    const at = (ox: number, oz: number, x = this.station.x, z = this.station.z) => ({ x: x + ox * c + oz * s, z: z - ox * s + oz * c });
    const group = STORY_GROUP + sea.clock.day;
    const add = (name: string, type: typeof BRIG, faction: 'imperial' | 'pirate', place: { x: number; z: number }, gold: number): Vessel => {
      const v = createVessel(sea.nextId++, name, faction, sea.classFor(type), place.x, place.z, heading, faction === 'imperial' ? group : group + 1);
      v.gold = gold;
      v.ai = createAi(p.ship.x, p.ship.z, heading);
      v.helm.sails = 1;
      v.ship.sail = 0.5;
      sea.add(v);
      return v;
    };
    const flagship = add('Sovereign', FRIGATE, 'imperial', at(0, 0), 2500);
    flagship.admiral = true;
    flagship.ai!.alerted = true;
    this.sovereign = flagship.id;
    ESCORT_STATIONS.forEach(([ox, oz], i) => {
      const escort = add(i === 0 ? 'Imperial brig Resolute' : 'Imperial brig Vigilant', BRIG, 'imperial', at(ox, oz), 200);
      escort.ai!.leader = flagship.id;
      [escort.ai!.stationX, escort.ai!.stationZ] = [ox, oz];
      escort.ai!.alerted = true;
    });
    this.allies = [];
    if (this.choice === 'black') {
      const pheading = p.ship.heading;
      const ps = Math.sin(pheading);
      const pc = Math.cos(pheading);
      ALLY_STATIONS.forEach(([ox, oz], i) => {
        const place = { x: p.ship.x + ox * pc + oz * ps, z: p.ship.z - ox * ps + oz * pc };
        const ally = add(i === 0 ? 'Revenge' : 'Gull', i === 0 ? BRIG : SLOOP, 'pirate', place, 0);
        ally.ai!.ally = true;
        [ally.ai!.stationX, ally.ai!.stationZ] = [ox, oz];
        this.allies.push(ally.id);
      });
    }
    this.notices.push({
      text: `Sail ho! The Sovereign, flying ${ADMIRAL}’s pennant, with two brigs in company.${this.choice === 'black' ? ' Red Mary’s Revenge and Gull fall in astern of you.' : ''}`,
      tone: 'bad',
    });
  }

  /** The Sovereign and her company leave the sea for now; the Brethren's ships go home. */
  private standDown(): void {
    const sea = this.sea;
    const flagship = this.sovereign === null ? undefined : sea.vessel(this.sovereign);
    sea.remove(sea.vessels.filter((v) => (flagship && v.group === flagship.group && v.status !== 'captured') || this.allies.includes(v.id)));
    this.sovereign = null;
    this.allies = [];
  }

  /** Harrow is finished: the thread ends, the Brethren sail home, and the last picture shows. */
  private finish(how: 'duel' | 'sunk'): void {
    this.ending = how;
    this.sovereign = null;
    for (const id of this.allies) {
      const ally = this.sea.vessel(id);
      if (!ally?.ai) continue;
      ally.ai.ally = false;
      ally.ai.destX = this.ports.pirates.x;
      ally.ai.destZ = this.ports.pirates.z;
    }
    this.allies = [];
    this.advance('done');
    this.events.push({ kind: 'epilogue' });
  }

  /** Deep, open water off the capital, on the side it faces home from: where she guards the way in. */
  private findStation(capital: Port, haven: Port): { x: number; z: number } {
    const out = Math.atan2(haven.x - capital.islandX, haven.z - capital.islandZ);
    for (let i = 0; i < 24; i++) {
      const angle = out + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.26;
      const x = capital.islandX + Math.sin(angle) * STATION_OFFSHORE;
      const z = capital.islandZ + Math.cos(angle) * STATION_OFFSHORE;
      let deep = true;
      for (let dx = -20; dx <= 20 && deep; dx += 20) for (let dz = -20; dz <= 20 && deep; dz += 20) deep = this.world.surfaceHeight(Math.floor(x + dx), Math.floor(z + dz)) < SEA_LEVEL - STATION_DEPTH;
      if (deep) return { x: Math.round(x), z: Math.round(z) };
    }
    return { x: Math.round(capital.islandX + Math.sin(out) * STATION_OFFSHORE * 1.5), z: Math.round(capital.islandZ + Math.cos(out) * STATION_OFFSHORE * 1.5) };
  }

  // ---- The journal ----

  /** The journal's entries, the current one last. */
  journal(): JournalEntry[] {
    const places = this.places;
    const now = STAGES.indexOf(this.stage);
    return ENTRIES.filter((e) => STAGES.indexOf(e.stage) <= now).map((e) => ({
      stage: e.stage,
      title: e.title,
      text: e.text(places, this.choice),
      current: e.stage === this.stage,
      day: this.reached[e.stage] ?? 0,
      objectives: this.objectives(e.stage, places, STAGES.indexOf(e.stage) < now),
      words: TALKS.filter((t) => t.entry === e.stage && this.heard.includes(t.id)).map((t) => ({ who: CHARACTERS[t.who].name, lines: t.lines(places) })),
    }));
  }

  private objectives(stage: Stage, p: Places, past: boolean): Array<{ text: string; done: boolean }> {
    const c = this.sea.captain;
    const list = (() => {
      switch (stage) {
        case 'nell':
          return [{ text: `Talk to Nell Brandt at the Guildhall in ${p.haven}`, done: false }];
        case 'quill':
          return [{ text: `Find Jonas Quill in the tavern at ${p.pirates}`, done: false }];
        case 'chart':
          return [
            { text: `Find the pieces of Blackwood’s chart in the cursed hoards: ${Math.min(3, c.pieces)} of 3`, done: c.pieces >= 3 },
            { text: 'Dig up Blackwood’s hoard', done: c.letter },
          ];
        case 'cipher':
          return [{ text: `Find Tobias Finch in the tavern at ${p.crown}, after dark`, done: false }];
        case 'flag':
          return [
            { text: `Raise the black flag with Red Mary Kincaid, in the tavern at ${p.pirates}`, done: this.choice === 'black' },
            { text: `Or keep your colours: take the Guild’s letter of marque from Nell Brandt, at ${p.haven}`, done: this.choice === 'colours' },
          ];
        case 'sovereign':
          return [
            { text: `Find the Sovereign off ${p.capital} (marked on your chart)`, done: this.sovereign !== null },
            { text: `Take her, and face ${ADMIRAL} on his own deck`, done: false },
          ];
        case 'done':
          return [];
      }
    })();
    return past ? list.map((o) => (stage === 'flag' ? o : { ...o, done: true })) : list;
  }
}

const done = (message: string): Outcome => ({ ok: true, message });
const fail = (message: string): Outcome => ({ ok: false, message });
