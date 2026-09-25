import { regionTier } from '../combat/encounters';
import { isNight } from '../core/clock';
import type { Sea } from '../combat/sea';
import { syncCondition } from '../combat/vessel';
import type { ShipType } from '../sailing/ships';
import { hasRelic } from '../treasure/relics';
import { mulberry32 } from '../worldgen/noise';
import { type Captain, PASSENGER_BERTHS } from './captain';
import { type Bounty, type Contract, contractTitle, type Delivery, FAILURE_PENALTY, MAX_CONTRACTS, turnInPort } from './contracts';
import { cargoCount, GOOD_INFO, type Good, isContraband, STAPLES, unload } from './goods';
import { note } from './logbook';
import { buyCost, findLine, type Line, type Market, planMarkets, sellValue, stepMarket, unitPrice } from './market';
import { FACTION_NAMES, type Port, type PortFaction } from './ports';
import { adjust, BRIBE_CEILING, BRIBE_STEP, bribeCost, priceFactor, rankName, type StandingChange, standingNews } from './reputation';
import { repairCosts, SHIP_LABELS, SHIP_PRICES, SHIPYARDS, tradeInValue, type Upgrade, upgradeCost, withUpgrades } from './shipyard';

export type Tone = 'info' | 'good' | 'bad';
export interface Notice {
  text: string;
  tone: Tone;
}
/** What came of an order given in port: whether it happened, and what to tell the player. */
export interface Outcome {
  ok: boolean;
  message: string;
}

interface Shock {
  port: number;
  good: Good;
  kind: 'shortage' | 'glut';
  until: number;
  heard: boolean;
}

export interface EconomySnapshot {
  ports: Array<{
    stock: number[];
    black: number[];
    office: Contract[];
    fixer: Contract[];
    postedAt: number | null;
    hands: number;
    settlers?: number;
    rumours: string[];
  }>;
  shocks: Shock[];
  shockIn: number;
  nextContract: number;
}

export interface PortState {
  market: Market;
  /** Jobs on the governor's board, and the fixer's. */
  office: Contract[];
  fixer: Contract[];
  postedAt: number;
  /** Sailors in the tavern looking for a berth (fractional: they drift in over time). */
  hands: number;
  /** Folk in the tavern who'd go out to a camp and work it. */
  settlers: number;
  /** Rumours heard this visit. */
  rumours: string[];
}

const HANDS: Record<PortFaction, { max: number; wage: number; every: number }> = {
  imperial: { max: 12, wage: 14, every: 30 },
  merchant: { max: 20, wage: 10, every: 20 },
  pirate: { max: 32, wage: 7, every: 12 },
};
/**
 * Settlers looking for work: how many a port's tavern holds at most, what each asks to
 * go out to a camp, and seconds between new arrivals. Free ports have the most.
 */
const SETTLERS: Record<PortFaction, { max: number; fee: number; every: number }> = {
  imperial: { max: 3, fee: 70, every: 150 },
  merchant: { max: 6, fee: 50, every: 90 },
  pirate: { max: 4, fee: 40, every: 120 },
};
/** A round for the house buys the tavern's gossip; after dark the place is livelier. */
export const ROUND_COST = 10;
const RUMOURS_PER_ROUND = 2;
const NIGHT_RUMOURS = 3;
/** Customs officers on the night watch search less often. */
const NIGHT_CUSTOMS = -0.2;
/** A room above the tavern for the night (or the day). */
export const ROOM_COST = 5;
/** Seconds before a port's jobs are taken down and new ones posted. */
const REPOST_AFTER = 300;
const SHOCK_EVERY = 150;
const SHOCK_SECONDS = 540;
const SHOCK_TARGET = { shortage: 0.3, glut: 2.6 } as const;
/** Chance customs search a hold in an Imperial port, and the fine per musket they find. */
const CUSTOMS_CHANCE = 0.4;
const CUSTOMS_FINE = 15;
const FIXERS = ['Silas Crane', 'Old Marta', 'One-Eyed Pell', 'Madame Vey', 'Tobias Rook', 'Scrimshaw Sal', 'Quiet Jonah', 'Lottie Fenn'];

/**
 * Trade and politics ashore: every port's market, the jobs on offer, sailors for hire,
 * the tavern's gossip and its fixer. The captain (gold, standing, contracts, price book)
 * lives on the `Sea`, since jail and plunder change it too. Pure simulation with its
 * own seeded randomness; each order returns an `Outcome` for the menus to show.
 */
export class Economy {
  readonly states: PortState[];
  /** The shady character in each port's tavern. */
  readonly fixers: string[];
  /** Other talk a round can turn up (treasure), each asked in turn; they return a rumour or null. */
  readonly rumourSources: Array<(port: Port) => string | null> = [];
  private readonly random: () => number;
  private readonly shocks: Shock[] = [];
  private shockIn = SHOCK_EVERY;
  private nextContract = 1;
  private notices: Notice[] = [];

  constructor(
    private readonly sea: Sea,
    readonly ports: readonly Port[],
    seed: number,
  ) {
    this.random = mulberry32(seed ^ 0xec0c);
    const markets = planMarkets(ports, this.random, seed ^ 0x6c0d);
    this.states = ports.map((port, i) => ({
      market: markets[i],
      office: [],
      fixer: [],
      postedAt: -Infinity,
      hands: HANDS[port.faction].max,
      settlers: SETTLERS[port.faction].max,
      rumours: [],
    }));
    const names = [...FIXERS];
    this.fixers = ports.map(() => names.splice(Math.floor(this.random() * names.length), 1)[0]);
  }

  get captain(): Captain {
    return this.sea.captain;
  }

  /** The markets and boards as they stand, for a save. */
  snapshot(): EconomySnapshot {
    return {
      ports: this.states.map((s) => ({
        stock: s.market.lines.map((l) => l.stock),
        black: s.market.black.map((l) => l.stock),
        office: structuredClone(s.office),
        fixer: structuredClone(s.fixer),
        postedAt: Number.isFinite(s.postedAt) ? s.postedAt : null,
        hands: s.hands,
        settlers: s.settlers,
        rumours: [...s.rumours],
      })),
      shocks: structuredClone(this.shocks),
      shockIn: this.shockIn,
      nextContract: this.nextContract,
    };
  }

  restore(d: EconomySnapshot): void {
    d.ports.forEach((p, i) => {
      const s = this.states[i];
      if (!s) return;
      s.market.lines.forEach((l, j) => (l.stock = p.stock[j] ?? l.stock));
      s.market.black.forEach((l, j) => (l.stock = p.black[j] ?? l.stock));
      s.office = structuredClone(p.office);
      s.fixer = structuredClone(p.fixer);
      s.postedAt = p.postedAt ?? -Infinity;
      s.hands = p.hands;
      s.settlers = p.settlers ?? s.settlers;
      s.rumours = [...p.rumours];
    });
    this.shocks.length = 0;
    this.shocks.push(...structuredClone(d.shocks));
    this.shockIn = d.shockIn;
    this.nextContract = d.nextContract;
  }

  /** Hands the notices since the last call (failed jobs, news) to the presentation layer. */
  takeNotices(): Notice[] {
    const n = this.notices;
    this.notices = [];
    return n;
  }

  /** Markets recover, sailors drift into the taverns, prices get shocked, and jobs run out of time. */
  step(dt: number): void {
    const time = this.sea.time;
    this.states.forEach((state, i) => {
      stepMarket(state.market, dt, (good) => this.shockFactor(i, good, time));
      const hands = HANDS[this.ports[i].faction];
      state.hands = Math.min(hands.max, state.hands + dt / hands.every);
      const settlers = SETTLERS[this.ports[i].faction];
      state.settlers = Math.min(settlers.max, state.settlers + dt / settlers.every);
    });

    this.shockIn -= dt;
    if (this.shockIn <= 0) {
      this.shockIn = SHOCK_EVERY;
      for (let i = this.shocks.length - 1; i >= 0; i--) if (this.shocks[i].until < time) this.shocks.splice(i, 1);
      if (this.random() < 0.6) {
        const port = Math.floor(this.random() * this.ports.length);
        const good = STAPLES[Math.floor(this.random() * STAPLES.length)];
        if (!this.shocks.some((s) => s.port === port && s.good === good)) {
          this.shocks.push({ port, good, kind: this.random() < 0.5 ? 'shortage' : 'glut', until: time + SHOCK_SECONDS, heard: false });
        }
      }
    }

    const captain = this.captain;
    for (const c of [...captain.contracts]) {
      if (time <= c.deadline) continue;
      captain.contracts.splice(captain.contracts.indexOf(c), 1);
      const lost = c.kind === 'delivery' ? ` Your bond of ${c.bond} gold is forfeit.` : '';
      this.notices.push({ text: `Out of time: ${contractTitle(c, this.ports)}.${lost}`, tone: 'bad' }, ...this.standing(c.faction, -FAILURE_PENALTY));
    }
  }

  private shockFactor(port: number, good: Good, time: number): number {
    const shock = this.shocks.find((s) => s.port === port && s.good === good && s.until >= time);
    return shock ? SHOCK_TARGET[shock.kind] : 1;
  }

  /** Coming ashore: customs (in the Crown's ports), fresh jobs, and the price book brought up to date. */
  arrive(port: Port): Notice[] {
    const notes: Notice[] = [];
    const state = this.states[port.id];
    const cargo = this.sea.player.cargo;
    const standing = this.captain.standing;
    const muskets = cargo.muskets ?? 0;
    if (port.faction === 'imperial' && muskets > 0) {
      const night = isNight(this.sea.clock.phase) ? NIGHT_CUSTOMS : 0;
      // The smuggler's ledger: a hold with false bottoms fools every search.
      const ledger = hasRelic(this.captain, 'ledger') ? -Infinity : 0;
      const chance = CUSTOMS_CHANCE + (standing.imperial < 0 ? 0.2 : 0) - (standing.imperial >= 50 ? 0.2 : 0) + night + ledger;
      if (this.random() < chance) {
        unload(cargo, 'muskets', muskets);
        const fine = Math.min(this.captain.gold, muskets * CUSTOMS_FINE);
        this.captain.gold -= fine;
        notes.push({ text: `Customs officers search your hold and find ${muskets} muskets! They're seized, and you're fined ${fine} gold.`, tone: 'bad' });
        notes.push(...this.standing('imperial', -8));
      } else {
        notes.push({ text: `Customs officers poke about your hold, but miss the ${muskets} muskets under the sailcloth.`, tone: 'good' });
      }
    }
    if (this.sea.time - state.postedAt > REPOST_AFTER) this.post(port);
    state.rumours = [];
    for (const line of state.market.lines) this.notePrice(port, line);
    const due = this.captain.contracts.filter((c) => turnInPort(c) === port.id && this.ready(port, c));
    if (due.length > 0) notes.push({ text: `Work to hand in here: ${due.map((c) => contractTitle(c, this.ports)).join('; ')}.`, tone: 'good' });
    return notes;
  }

  // ---- The market ----

  factor(port: Port): number {
    return priceFactor(this.captain.standing, port.faction);
  }

  lines(port: Port, black = false): Line[] {
    const market = this.states[port.id].market;
    return black ? market.black : market.lines;
  }

  /** Unit prices for the next unit bought and sold, as the player sees them. */
  quote(port: Port, line: Line, black = false): { buy: number; sell: number } {
    const f = black ? 1 : this.factor(port);
    return { buy: buyCost(line, 1, f), sell: sellValue(line, 1, f) };
  }

  holdSpace(): number {
    const v = this.sea.player;
    return v.cls.type.hold - cargoCount(v.cargo);
  }

  /** The most of a good the player could buy right now: limited by stock, hold space and purse. */
  maxBuy(port: Port, good: Good, black = false): number {
    const line = findLine(this.lines(port, black), good);
    if (!line) return 0;
    const f = black ? 1 : this.factor(port);
    let n = Math.max(0, Math.min(Math.floor(line.stock), this.holdSpace()));
    while (n > 0 && buyCost(line, n, f) > this.captain.gold) n--;
    return n;
  }

  buy(port: Port, good: Good, amount: number, black = false): Outcome {
    const label = GOOD_INFO[good].label.toLowerCase();
    if (black && !this.afterDark()) return fail(BACK_ROOM_SHUT);
    const line = findLine(this.lines(port, black), good);
    if (!line) return fail(`No one here sells ${label}.`);
    if (this.holdSpace() <= 0) return fail('Your hold is full.');
    if (line.stock < 1) return fail(`There's no ${label} left to buy.`);
    const n = Math.min(amount, this.maxBuy(port, good, black));
    if (n <= 0) return fail(`You can't afford any ${label}.`);
    const cost = buyCost(line, n, black ? 1 : this.factor(port));
    this.captain.gold -= cost;
    line.stock -= n;
    const cargo = this.sea.player.cargo;
    cargo[good] = (cargo[good] ?? 0) + n;
    if (!black) this.notePrice(port, line);
    return done(`Bought ${n} ${label} for ${cost} gold.`);
  }

  sell(port: Port, good: Good, amount: number, black = false): Outcome {
    const label = GOOD_INFO[good].label.toLowerCase();
    if (black && !this.afterDark()) return fail(BACK_ROOM_SHUT);
    if (!black && isContraband(good, port.faction)) return fail(`Only the black market will touch ${label} here.`);
    const line = findLine(this.lines(port, black), good);
    if (!line) return fail(`No one here buys ${label}.`);
    const cargo = this.sea.player.cargo;
    const n = Math.min(amount, cargo[good] ?? 0);
    if (n <= 0) return fail(`You have no ${label} to sell.`);
    const value = sellValue(line, n, black ? 1 : this.factor(port));
    unload(cargo, good, n);
    line.stock += n;
    this.captain.gold += value;
    if (!black) this.notePrice(port, line);
    return done(`Sold ${n} ${label} for ${value} gold.`);
  }

  private notePrice(port: Port, line: Line): void {
    const { buy, sell } = this.quote(port, line);
    note(this.captain.logbook, port.id, line.good, buy, sell, this.sea.time);
  }

  // ---- The shipyard ----

  repair(part: 'hull' | 'sails'): Outcome {
    const v = this.sea.player;
    const cost = repairCosts(v)[part];
    if (cost <= 0) return fail(part === 'hull' ? 'Her hull is sound.' : 'Her canvas is whole.');
    const full = v.cls.type[part];
    const missing = full - v[part];
    // Mend what the purse allows.
    const share = Math.min(1, this.captain.gold / cost);
    if (share <= 0) return fail("You can't afford the shipwrights.");
    const paid = Math.min(this.captain.gold, Math.ceil(cost * share));
    v[part] = Math.min(full, v[part] + missing * share);
    this.captain.gold -= paid;
    syncCondition(v);
    const what = part === 'hull' ? 'Hull' : 'Sails';
    return done(share < 1 ? `${what} partly repaired for ${paid} gold.` : `${what} repaired for ${paid} gold.`);
  }

  upgrade(upgrade: Upgrade): Outcome {
    const v = this.sea.player;
    if (v.upgrades.includes(upgrade)) return fail('She already has that.');
    const cost = upgradeCost(upgrade, v.cls.design);
    if (cost > this.captain.gold) return fail(`That costs ${cost} gold.`);
    this.captain.gold -= cost;
    v.upgrades.push(upgrade);
    const oldHull = v.cls.type.hull;
    v.cls = withUpgrades(this.sea.classFor(v.cls.design), v.upgrades);
    v.hull += v.cls.type.hull - oldHull; // the new timbers are sound
    syncCondition(v);
    return done(`The yard fits ${upgradeLabel(upgrade)} for ${cost} gold.`);
  }

  /** What a ship would cost here after part-exchanging the player's. */
  shipPrice(type: ShipType): { price: number; tradeIn: number; net: number } {
    const price = SHIP_PRICES.get(type) ?? 0;
    const tradeIn = tradeInValue(this.sea.player);
    return { price, tradeIn, net: Math.max(0, price - tradeIn) };
  }

  buyShip(port: Port, type: ShipType): Outcome {
    const v = this.sea.player;
    if (!SHIPYARDS[port.faction].includes(type)) return fail("This yard doesn't build those.");
    if (v.cls.design === type) return fail('You already sail one.');
    const { net } = this.shipPrice(type);
    if (net > this.captain.gold) return fail(`You need ${net} gold, after part-exchange.`);
    const cargo = cargoCount(v.cargo);
    if (cargo > type.hold) return fail(`She holds only ${type.hold}: sell ${cargo - type.hold} goods first.`);
    const label = SHIP_LABELS.get(type) ?? type.name;
    const left = Math.max(0, Math.floor(v.crew) - type.crew);
    this.captain.gold -= net;
    this.sea.refit(this.sea.classFor(type), `Your ${label.toLowerCase()}`);
    return done(`She's yours: a ${label.toLowerCase()}, for ${net} gold after part-exchange.${left > 0 ? ` ${left} hands had to be let go.` : ''}`);
  }

  // ---- The tavern ----

  handsFor(port: Port): { available: number; wage: number; room: number } {
    const v = this.sea.player;
    return {
      available: Math.floor(this.states[port.id].hands),
      wage: Math.round(HANDS[port.faction].wage * this.factor(port)),
      room: Math.max(0, v.cls.type.crew - Math.floor(v.crew)),
    };
  }

  hire(port: Port, amount: number): Outcome {
    const { available, wage, room } = this.handsFor(port);
    if (room <= 0) return fail('Your crew is complete.');
    if (available <= 0) return fail('No one here is looking for a berth.');
    const n = Math.min(amount, available, room, Math.floor(this.captain.gold / wage));
    if (n <= 0) return fail(`Each hand wants ${wage} gold to sign on.`);
    const v = this.sea.player;
    v.crew = Math.floor(v.crew) + n;
    syncCondition(v);
    this.states[port.id].hands -= n;
    this.captain.gold -= n * wage;
    return done(`${n} hand${n > 1 ? 's' : ''} sign${n > 1 ? '' : 's'} on for ${n * wage} gold.`);
  }

  /** Settlers in this tavern who'd go out to a camp, what each asks, and berths aboard for them. */
  settlersFor(port: Port): { available: number; fee: number; room: number } {
    return {
      available: Math.floor(this.states[port.id].settlers),
      fee: Math.round(SETTLERS[port.faction].fee * this.factor(port)),
      room: Math.max(0, PASSENGER_BERTHS - this.captain.passengers),
    };
  }

  /** Signs settlers on: they come aboard as passengers until they're settled at a camp. */
  hireSettlers(port: Port, amount: number): Outcome {
    const { available, fee, room } = this.settlersFor(port);
    if (room <= 0) return fail(`Your ship has berths for only ${PASSENGER_BERTHS} settlers.`);
    if (available <= 0) return fail('Nobody here wants to try their luck on an island just now.');
    const n = Math.min(amount, available, room, Math.floor(this.captain.gold / fee));
    if (n <= 0) return fail(`Each settler wants ${fee} gold to go out to a camp.`);
    this.captain.passengers += n;
    this.states[port.id].settlers -= n;
    this.captain.gold -= n * fee;
    return done(`${n} settler${n > 1 ? 's' : ''} come${n > 1 ? '' : 's'} aboard for ${n * fee} gold. Take them to a camp with a hut to sleep in.`);
  }

  /** A room above the tavern, to sleep in. */
  takeRoom(): Outcome {
    if (this.captain.gold < ROOM_COST) return fail(`A room is ${ROOM_COST} gold.`);
    this.captain.gold -= ROOM_COST;
    return done('You take a room upstairs.');
  }

  /** The fixer and the back room only do business after dark. */
  afterDark(): boolean {
    return isNight(this.sea.clock.phase);
  }

  /** Stands the house a round; loosened tongues give up news of prices elsewhere. */
  buyRound(port: Port): Outcome {
    if (this.captain.gold < ROUND_COST) return fail('Not even the price of a round.');
    this.captain.gold -= ROUND_COST;
    const state = this.states[port.id];
    const heard: string[] = [];
    const want = this.afterDark() ? NIGHT_RUMOURS : RUMOURS_PER_ROUND;
    for (const source of this.rumourSources) {
      const rumour = source(port);
      if (rumour) heard.push(rumour);
    }
    for (let tries = 0; tries < 8 && heard.length < want; tries++) {
      const rumour = this.rumour(port);
      if (rumour && !state.rumours.includes(rumour) && !heard.includes(rumour)) heard.push(rumour);
    }
    state.rumours.push(...heard);
    return done(heard.length ? 'The drink loosens tongues.' : 'Nobody has any news worth the name.');
  }

  private rumour(here: Port): string | null {
    const time = this.sea.time;
    const shock = this.shocks.find((s) => !s.heard && s.until >= time && s.port !== here.id);
    if (shock && this.random() < 0.7) {
      shock.heard = true;
      const port = this.ports[shock.port];
      const good = GOOD_INFO[shock.good].label.toLowerCase();
      this.notePrice(port, findLine(this.states[port.id].market.lines, shock.good)!);
      return shock.kind === 'shortage'
        ? `There's a shortage of ${good} in ${port.name}: they'll pay handsomely for it.`
        : `${port.name} is awash with ${good}: it's going for next to nothing.`;
    }
    const others = this.ports.filter((p) => p.id !== here.id);
    const port = others[Math.floor(this.random() * others.length)];
    // The talk is of whatever's most out of the ordinary there: one of the three oddest prices.
    const oddness = (l: Line) => Math.abs(Math.log(unitPrice(l) / goodPrice(l)));
    const lines = this.states[port.id].market.lines.filter((l) => STAPLES.includes(l.good) || l.good === 'muskets').sort((a, b) => oddness(b) - oddness(a));
    const line = lines[Math.floor(this.random() * Math.min(3, lines.length))];
    this.notePrice(port, line);
    const { buy, sell } = this.quote(port, line);
    const good = GOOD_INFO[line.good].label.toLowerCase();
    return unitPrice(line) > goodPrice(line)
      ? `Word is ${good} fetches ${sell} gold a unit in ${port.name}.`
      : `They say ${good} goes for just ${buy} gold in ${port.name}.`;
  }

  /** The fixer's price to put in a word with a faction, or null if a bribe can do no more. */
  bribeCost(faction: PortFaction): number | null {
    return bribeCost(this.captain.standing[faction]);
  }

  bribe(port: Port, faction: PortFaction): Outcome {
    const cost = this.bribeCost(faction);
    const fixer = this.fixers[port.id];
    if (!this.afterDark()) return fail(`${fixer} only does business after dark.`);
    if (cost === null) return fail(`"Your name's as good with ${FACTION_NAMES[faction]} as gold can make it," says ${fixer}.`);
    if (cost > this.captain.gold) return fail(`"That'll be ${cost} gold, and I don't give credit," says ${fixer}.`);
    this.captain.gold -= cost;
    const before = this.captain.standing[faction];
    this.notices.push(...this.standing(faction, Math.min(BRIBE_STEP, BRIBE_CEILING - before)));
    return done(`${fixer} pockets ${cost} gold. "Consider it done." Your name with ${FACTION_NAMES[faction]}: ${rankName(this.captain.standing[faction])}.`);
  }

  // ---- Jobs ----

  offers(port: Port, board: 'office' | 'fixer'): Contract[] {
    return this.states[port.id][board];
  }

  accept(port: Port, id: number): Outcome {
    const state = this.states[port.id];
    const board = state.office.some((c) => c.id === id) ? state.office : state.fixer;
    const c = board.find((o) => o.id === id);
    if (!c) return fail('That job has gone.');
    if (board === state.fixer && !this.afterDark()) return fail(`${this.fixers[port.id]} only does business after dark.`);
    if (this.captain.contracts.length >= MAX_CONTRACTS) return fail(`You can take on only ${MAX_CONTRACTS} jobs at once.`);
    if (c.kind === 'delivery') {
      if (this.holdSpace() < c.amount) return fail(`You need room for ${c.amount} in the hold.`);
      if (this.captain.gold < c.bond) return fail(`The bond is ${c.bond} gold.`);
      this.captain.gold -= c.bond;
      const cargo = this.sea.player.cargo;
      cargo[c.good] = (cargo[c.good] ?? 0) + c.amount;
    }
    board.splice(board.indexOf(c), 1);
    this.captain.contracts.push(c);
    const loaded = c.kind === 'delivery' ? ` The cargo is loaded against your bond of ${c.bond} gold.` : '';
    return done(`Agreed: ${contractTitle(c, this.ports)}.${loaded}`);
  }

  /** Can this job be handed in here, now? */
  ready(port: Port, c: Contract): boolean {
    if (turnInPort(c) !== port.id) return false;
    if (c.kind === 'bounty') return c.progress >= c.count;
    return (this.sea.player.cargo[c.good] ?? 0) >= c.amount;
  }

  turnIn(port: Port, id: number): Outcome {
    const c = this.captain.contracts.find((o) => o.id === id);
    if (!c) return fail('No such job.');
    if (turnInPort(c) !== port.id) return fail(`That's to be handed in at ${this.ports[turnInPort(c)].name}.`);
    if (c.kind === 'delivery' && c.black && !this.afterDark()) return fail(BACK_ROOM_SHUT);
    if (!this.ready(port, c)) {
      return fail(c.kind === 'bounty' ? `${c.progress} of ${c.count} done so far.` : `You need ${c.amount} ${GOOD_INFO[c.good].label.toLowerCase()} in the hold.`);
    }
    this.captain.contracts.splice(this.captain.contracts.indexOf(c), 1);
    let paid = c.reward;
    if (c.kind === 'delivery') {
      unload(this.sea.player.cargo, c.good, c.amount);
      paid += c.bond;
    }
    this.captain.gold += paid;
    this.notices.push(...this.standing(c.faction, c.standing));
    return done(`Job done: ${contractTitle(c, this.ports)}. You're paid ${paid} gold${c.kind === 'delivery' ? ', bond included' : ''}.`);
  }

  /** Puts up new jobs: freight and a bounty on the governor's board, and a smuggling run from the fixer. */
  private post(port: Port): void {
    const state = this.states[port.id];
    state.postedAt = this.sea.time;
    const jobs = (list: Array<Contract | null>) => list.filter((c): c is Contract => c !== null);
    state.office = jobs([this.freight(port), this.freight(port), this.bounty(port)]);
    state.fixer = port.faction === 'imperial' ? [] : jobs([this.smuggling(port)]);
  }

  private freight(port: Port): Delivery | null {
    // Friendly ports only: the Crown won't ship to pirate havens, and pirates don't run freight for the Crown.
    const partners = this.ports.filter((p) => p.id !== port.id && (p.faction === port.faction || p.faction === 'merchant' || port.faction === 'merchant'));
    if (partners.length === 0) return null;
    const dest = partners[Math.floor(this.random() * partners.length)];
    // What this port makes cheaply, bound for somewhere that deals in it.
    const lines = this.states[port.id].market.lines.filter((l) => l.role !== 'demands' && !isContraband(l.good, dest.faction));
    const line = lines[Math.floor(this.random() * lines.length)];
    const amount = this.loadSize(line, [5, 10, 15, 20, 25]);
    const distance = Math.hypot(dest.x - port.x, dest.z - port.z);
    return {
      id: this.nextContract++,
      kind: 'delivery',
      issuer: port.id,
      faction: port.faction,
      port: dest.id,
      good: line.good,
      amount,
      bond: roundTo(unitPrice(line) * amount, 10),
      black: false,
      reward: roundTo(amount * GOOD_INFO[line.good].price * 0.25 + distance * 0.3 + 40, 10),
      standing: 3 + Math.round(amount / 10),
      deadline: this.sea.time + 240 + distance / 3,
    };
  }

  private bounty(port: Port): Bounty {
    const targets: PortFaction[] = port.faction === 'pirate' ? ['merchant', 'imperial'] : ['pirate'];
    const target = targets[Math.floor(this.random() * targets.length)];
    const count = this.random() < 0.6 ? 1 : 2;
    const tier = regionTier(port.islandX, port.islandZ);
    return {
      id: this.nextContract++,
      kind: 'bounty',
      issuer: port.id,
      faction: port.faction,
      target,
      count,
      progress: 0,
      reward: roundTo(count * (260 + 120 * tier), 10),
      standing: 5 * count,
      deadline: this.sea.time + 600 + 300 * count,
    };
  }

  private smuggling(port: Port): Delivery | null {
    const targets = this.ports.filter((p) => p.faction === 'imperial');
    const line = findLine(this.states[port.id].market.lines, 'muskets');
    if (targets.length === 0 || !line) return null;
    const dest = targets[Math.floor(this.random() * targets.length)];
    const amount = this.loadSize(line, [4, 6, 8, 10, 12]);
    const distance = Math.hypot(dest.x - port.x, dest.z - port.z);
    return {
      id: this.nextContract++,
      kind: 'delivery',
      issuer: port.id,
      faction: port.faction,
      port: dest.id,
      good: 'muskets',
      amount,
      bond: roundTo(unitPrice(line) * amount, 10),
      black: true,
      reward: roundTo(amount * 60 + distance * 0.3, 10),
      standing: port.faction === 'pirate' ? 5 : 0,
      deadline: this.sea.time + 240 + distance / 3,
    };
  }

  /**
   * A load for a job, sized to the captain: merchant houses offer what the ship can
   * carry and the purse can bond (the smallest load if nothing fits).
   */
  private loadSize(line: Line, sizes: readonly number[]): number {
    const hold = this.sea.player.cls.type.hold;
    const fits = sizes.filter((n) => n <= hold && unitPrice(line) * n <= this.captain.gold * 0.8);
    return fits.length > 0 ? fits[Math.floor(this.random() * fits.length)] : sizes[0];
  }

  /** Can the captain take this job on right now (hold room, the bond, a free slot)? */
  canAccept(c: Contract): boolean {
    if (this.captain.contracts.length >= MAX_CONTRACTS) return false;
    return c.kind !== 'delivery' || (this.holdSpace() >= c.amount && this.captain.gold >= c.bond);
  }

  /** Changes standing with a faction: returns the change as notices, the first one a summary. */
  private standing(faction: PortFaction, amount: number): Notice[] {
    const change: StandingChange | null = adjust(this.captain.standing, faction, amount);
    if (!change) return [];
    const tone: Tone = change.to > change.from ? 'good' : 'bad';
    return [
      { text: `Standing with ${FACTION_NAMES[faction]}: ${change.from} → ${change.to}`, tone },
      ...standingNews(change).map((text) => ({ text, tone })),
    ];
  }
}

const BACK_ROOM_SHUT = 'The back room opens after dark.';
const done = (message: string): Outcome => ({ ok: true, message });
const fail = (message: string): Outcome => ({ ok: false, message });
const roundTo = (value: number, step: number) => Math.round(value / step) * step;
/** A good's usual price across the islands: rumours are about where it's far off that. */
const goodPrice = (line: Line) => GOOD_INFO[line.good].price;
const upgradeLabel = (u: Upgrade) =>
  ({ copper: 'copper sheathing', hull: 'a reinforced hull', hold: 'an expanded hold', guns: 'new gun carriages' })[u];
