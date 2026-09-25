import { describe, expect, it } from 'vitest';
import { Sea } from '../combat/sea';
import { shipClass } from '../combat/vessel';
import { phaseOf } from '../core/clock';
import type { Port } from '../economy/ports';
import { footprintSamples } from '../sailing/hull';
import { BRIG, FRIGATE, MERCHANT_BRIG, MERCHANT_SLOOP, SLOOP } from '../sailing/ships';
import { Weather } from '../sailing/weather';
import { VoxelWorld } from '../voxel/VoxelWorld';
import { ADMIRAL } from './script';
import { Story } from './Story';

const CLASSES = new Map(
  [SLOOP, BRIG, MERCHANT_SLOOP, MERCHANT_BRIG, FRIGATE].map((type) => {
    const cells: Array<[number, number]> = [];
    for (let x = 0; x < 5; x++) for (let z = 0; z < 15; z++) cells.push([x - 2.5, z - 7.5]);
    return [type, shipClass(type, footprintSamples(cells), 2.5, 16)] as const;
  }),
);

const port = (id: number, name: string, faction: Port['faction'], x: number, z: number): Port => ({
  id,
  name,
  faction,
  x,
  z,
  heading: 0,
  islandX: x,
  islandZ: z - 40,
  pier: { x, y: 13, z },
  places: [],
  lamps: [],
});
/** Haven, a pirate haven, an Imperial outpost and the capital beyond it. The sea is all deep water. */
const PORTS = [port(0, 'Haven', 'merchant', 0, 0), port(1, "Rook's Nest", 'pirate', 800, 0), port(2, 'Fort Aldmar', 'imperial', 0, 1000), port(3, 'Kingsreach', 'imperial', 0, 1800)];

function setup() {
  const world = new VoxelWorld();
  const sea = new Sea(world, new Weather({ cells: [] }), CLASSES, SLOOP, PORTS, 1, false);
  const story = new Story(world, sea, PORTS);
  return { world, sea, story };
}

/** Hears out whoever's at this door with a talk to give. */
function hear(story: Story, at: Port, place: 'office' | 'tavern') {
  const [talk] = story.talksAt(at, place);
  expect(talk, `someone at ${at.name}'s ${place}`).toBeDefined();
  expect(story.talk(talk.id).ok).toBe(true);
  return talk;
}

/** Plays the thread up to the choice. */
function toTheChoice(t: ReturnType<typeof setup>) {
  hear(t.story, PORTS[0], 'office');
  hear(t.story, PORTS[1], 'tavern');
  t.sea.captain.letter = true;
  t.story.step();
  t.sea.clock.phase = phaseOf(23);
  hear(t.story, PORTS[2], 'tavern');
}

describe('the story', () => {
  it('begins with Nell in Haven’s Guildhall, and sends you to Quill in the pirate haven', () => {
    const { story } = setup();
    expect(story.stage).toBe('nell');
    expect(story.talksAt(PORTS[1], 'tavern')).toEqual([]);
    const nell = hear(story, PORTS[0], 'office');
    expect(nell.name).toBe('Nell Brandt');
    expect(nell.lines.join(' ')).toMatch(/Rook's Nest/);
    expect(story.stage).toBe('quill');
    expect(story.takeNotices().map((n) => n.text)).toContain('New in your journal: The bosun’s tale (J).');
    expect(story.takeEvents()).toEqual([{ kind: 'stage', stage: 'quill', title: 'The bosun’s tale' }]);
    const quill = hear(story, PORTS[1], 'tavern');
    expect(quill.lines.join(' ')).toMatch(/Blackwood/);
    expect(story.stage).toBe('chart');
  });

  it('keeps the admiral nameless until Finch reads Blackwood’s letter, by night, in the Crown’s port', () => {
    const t = setup();
    hear(t.story, PORTS[0], 'office');
    hear(t.story, PORTS[1], 'tavern');
    expect(t.story.places.admiral).toBe('the admiral');
    t.story.step();
    expect(t.story.stage).toBe('chart');
    t.sea.captain.letter = true;
    t.story.step();
    expect(t.story.stage).toBe('cipher');
    t.sea.clock.phase = phaseOf(12);
    expect(t.story.talksAt(PORTS[2], 'tavern')).toEqual([]); // Finch drinks after dark
    t.sea.clock.phase = phaseOf(23);
    const finch = hear(t.story, PORTS[2], 'tavern');
    expect(finch.lines.join(' ')).toMatch(new RegExp(ADMIRAL));
    expect(t.story.stage).toBe('flag');
    expect(t.story.places.admiral).toBe(ADMIRAL);
  });

  it('offers two roads, and taking one closes the other', () => {
    const t = setup();
    toTheChoice(t);
    const mary = t.story.talksAt(PORTS[1], 'tavern').find((talk) => talk.who === 'mary')!;
    const nell = t.story.talksAt(PORTS[0], 'office').find((talk) => talk.who === 'nell')!;
    expect(mary.choices.map((c) => c.id)).toEqual(['black']);
    expect(nell.choices.map((c) => c.id)).toEqual(['colours']);
    expect(t.story.talk(mary.id).ok).toBe(true); // heard, but not decided
    expect(t.story.stage).toBe('flag');
    expect(t.story.talk(mary.id, 'black').ok).toBe(true);
    expect(t.story.stage).toBe('sovereign');
    expect(t.story.choice).toBe('black');
    expect(t.story.talksAt(PORTS[0], 'office').some((talk) => talk.id === 'nell-flag')).toBe(false);
    expect(t.story.talksAt(PORTS[1], 'tavern').find((talk) => talk.who === 'mary')?.id).toBe('mary-after');
  });

  it('under the black flag, the Brethren take you in and the Crown outlaws you', () => {
    const t = setup();
    toTheChoice(t);
    t.story.talk('mary-flag', 'black');
    const s = t.sea.captain.standing;
    expect(s.pirate).toBeGreaterThanOrEqual(50);
    expect(s.imperial).toBeLessThanOrEqual(-40);
    expect(t.sea.player.upgrades).toContain('guns');
  });

  it('with the letter of marque, the Guild backs you and the Crown’s regard holds', () => {
    const t = setup();
    toTheChoice(t);
    const imperial = t.sea.captain.standing.imperial;
    t.story.talk('nell-flag', 'colours');
    expect(t.sea.captain.standing.imperial).toBe(imperial);
    expect(t.sea.player.upgrades).toContain('hull');
    expect(t.sea.player.hull).toBe(t.sea.player.cls.type.hull);
  });
});

describe('the Sovereign', () => {
  function toTheSovereign(choice: 'black' | 'colours') {
    const t = setup();
    toTheChoice(t);
    t.story.talk(choice === 'black' ? 'mary-flag' : 'nell-flag', choice);
    t.story.takeNotices();
    return t;
  }

  it('comes out with two brigs when you sail near her station, and the Brethren’s ships fall in with you', () => {
    const t = toTheSovereign('black');
    t.story.step();
    expect(t.sea.vessels).toHaveLength(1); // too far yet
    Object.assign(t.sea.player.ship, { x: t.story.station.x, z: t.story.station.z - 400 });
    t.story.step();
    const flagship = t.sea.vessels.find((v) => v.name === 'Sovereign')!;
    expect(flagship.cls.design).toBe(FRIGATE);
    expect(flagship.admiral).toBe(true);
    expect(flagship.ai?.alerted).toBe(true);
    expect(t.story.isSovereign(flagship.id)).toBe(true);
    expect(t.sea.vessels.filter((v) => v.faction === 'imperial')).toHaveLength(3);
    expect(t.sea.vessels.filter((v) => v.ai?.ally).map((v) => v.name)).toEqual(['Revenge', 'Gull']);
    expect(t.story.takeNotices()[0].text).toMatch(/Sail ho! The Sovereign/);
    t.story.step();
    expect(t.sea.vessels).toHaveLength(6); // only once
  });

  it('sails without allies for a captain who kept their colours, and goes home when you leave', () => {
    const t = toTheSovereign('colours');
    Object.assign(t.sea.player.ship, { x: t.story.station.x, z: t.story.station.z - 400 });
    t.story.step();
    expect(t.sea.vessels.some((v) => v.ai?.ally)).toBe(false);
    expect(t.sea.vessels).toHaveLength(4);
    Object.assign(t.sea.player.ship, { x: 0, z: 0 });
    t.story.step();
    expect(t.sea.vessels).toHaveLength(1);
  });

  it('taken, ends the story with the epilogue; sunk, likewise', () => {
    for (const [status, ending] of [['captured', 'duel'], ['sinking', 'sunk']] as const) {
      const t = toTheSovereign('black');
      Object.assign(t.sea.player.ship, { x: t.story.station.x, z: t.story.station.z - 400 });
      t.story.step();
      t.story.takeEvents();
      t.sea.vessels.find((v) => v.name === 'Sovereign')!.status = status;
      t.story.step();
      expect(t.story.stage).toBe('done');
      expect(t.story.ending).toBe(ending);
      expect(t.story.takeEvents()).toContainEqual({ kind: 'epilogue' });
      expect(t.sea.vessels.filter((v) => v.ai?.ally)).toHaveLength(0);
    }
  });
});

describe('the journal', () => {
  it('keeps an entry for each step, what people said, and what’s left to do', () => {
    const t = setup();
    hear(t.story, PORTS[0], 'office');
    hear(t.story, PORTS[1], 'tavern');
    t.sea.captain.pieces = 2;
    const journal = t.story.journal();
    expect(journal.map((e) => e.title)).toEqual(['Ashes of the Good Hope', 'The bosun’s tale', 'Blackwood’s chart']);
    expect(journal[0].current).toBe(false);
    expect(journal[0].objectives.every((o) => o.done)).toBe(true);
    expect(journal[1].words[0].who).toBe('Jonas Quill');
    const now = journal[2];
    expect(now.current).toBe(true);
    expect(now.objectives).toEqual([
      { text: 'Find the pieces of Blackwood’s chart in the cursed hoards: 2 of 3', done: false },
      { text: 'Dig up Blackwood’s hoard', done: false },
    ]);
    expect(now.text).toMatch(/the admiral’s pennant/);
  });

  it('comes back from a save as it was', () => {
    const t = setup();
    toTheChoice(t);
    t.story.talk('nell-flag', 'colours');
    t.story.introSeen = true;
    const saved = JSON.parse(JSON.stringify(t.story.snapshot()));
    const u = setup();
    u.story.restore(saved);
    expect(u.story.stage).toBe('sovereign');
    expect(u.story.choice).toBe('colours');
    expect(u.story.introSeen).toBe(true);
    expect(u.story.journal().map((e) => e.title)).toEqual(t.story.journal().map((e) => e.title));
  });
});
