/**
 * The story's words: who's in it, what they say, and what the journal records. The
 * logic that moves it along is in `Story.ts`; everything here is text, easy to edit.
 */

/** The main thread, in order. */
export type Stage = 'nell' | 'quill' | 'chart' | 'cipher' | 'flag' | 'sovereign' | 'done';
export const STAGES: readonly Stage[] = ['nell', 'quill', 'chart', 'cipher', 'flag', 'sovereign', 'done'];

/** How the captain goes after the admiral. */
export type Choice = 'black' | 'colours';

export type Character = 'nell' | 'quill' | 'finch' | 'mary';
export const CHARACTERS: Record<Character, { name: string; role: string }> = {
  nell: { name: 'Nell Brandt', role: 'Haven’s harbourmaster, and Thorne’s oldest friend' },
  quill: { name: 'Jonas Quill', role: 'once bosun of the Good Hope' },
  finch: { name: 'Tobias Finch', role: 'a Crown code clerk, turned out for drink' },
  mary: { name: 'Red Mary Kincaid', role: 'a captain of the Brethren' },
};

/** The admiral, once the letter names him. */
export const ADMIRAL = 'Lord Admiral Harrow';

/** Names the script needs, filled in for this world. */
export interface Places {
  haven: string;
  /** The pirate haven: Quill, and the Brethren. */
  pirates: string;
  /** The Imperial port where Finch drinks. */
  crown: string;
  /** The Crown's capital, where the Sovereign lies. */
  capital: string;
  /** "the admiral", until the letter is read. */
  admiral: string;
}

/** Where a character can be found: which port (by role), and which door. */
export const WHERE: Record<Character, { port: keyof Omit<Places, 'admiral'>; place: 'office' | 'tavern'; night?: boolean }> = {
  nell: { port: 'haven', place: 'office' },
  quill: { port: 'pirates', place: 'tavern' },
  finch: { port: 'crown', place: 'tavern', night: true },
  mary: { port: 'pirates', place: 'tavern' },
};

export interface TalkSpec {
  id: string;
  who: Character;
  /** The stages it can be had in. */
  stages: readonly Stage[];
  /** Another talk that must come first. */
  after?: string;
  /** Only with Blackwood's letter in hand. */
  letter?: boolean;
  /** Only once this choice is made (or before any is, with `null`). */
  choice?: Choice | null;
  /** The journal entry its words are filed under. */
  entry: Stage;
  lines: (p: Places) => string[];
  /** Answers that decide something; "Not yet" leaves it open. */
  choices?: Array<{ id: Choice; label: string }>;
  /** Hearing it moves the main thread on to this stage. */
  advance?: Stage;
}

/** Everything anyone says, in the order they'd say it. */
export const TALKS: readonly TalkSpec[] = [
  {
    id: 'nell-1',
    who: 'nell',
    stages: ['nell'],
    entry: 'nell',
    advance: 'quill',
    lines: (p) => [
      'So you’re on your feet. Good. Elias would want that sloop in your hands, not rotting at my pier.',
      'Thirty years I knew him. He never ran from anyone, least of all the Crown. Whatever they said he was carrying, it’s a lie.',
      `The Guild had word: one other soul came off the Good Hope alive. Jonas Quill, her bosun. Last seen drinking himself stupid in ${p.pirates}.`,
      'Find Quill. If anyone saw whose flag gave the order, he did.',
    ],
  },
  {
    id: 'quill-1',
    who: 'quill',
    stages: ['quill'],
    entry: 'quill',
    advance: 'chart',
    lines: (p) => [
      'Thorne’s foundling? Sit down, before I fall down.',
      'Three of them came out of the dawn, crimson and gold. The biggest flew an admiral’s pennant, black and gold, long as a street. The Sovereign. I see her every time I shut my eyes.',
      'The admiral? Never saw his face. Nobody does. But the captain knew something. He’d been asking after Blackwood, the pirate king they hanged.',
      'The night before, he told me: “Blackwood knew who was buying. The proof’s in what he buried.” Blackwood’s hoard. His chart was torn in three, and the pieces lie in the hoards on the cursed isles. The dead guard them.',
      `And if you ever dig it up and it’s in the Crown’s cipher, there’s a clerk in ${p.crown} they turned out for drinking. Tobias Finch. After dark he’s in the tavern, and he can read anything.`,
    ],
  },
  {
    id: 'nell-thorne',
    who: 'nell',
    stages: ['quill', 'chart', 'cipher'],
    after: 'nell-1',
    entry: 'nell',
    lines: () => [
      'He found you on the quay in a storm, you know. Soaked through, and you bit him when he tried to lift you.',
      'He said the sea keeps honest books. Every debt gets paid in the end. I hope he was right.',
    ],
  },
  {
    id: 'quill-2',
    who: 'quill',
    stages: ['chart', 'cipher', 'flag', 'sovereign'],
    after: 'quill-1',
    entry: 'quill',
    lines: (p) => [
      'The fixers sell maps to the cursed isles, after dark. Here they always have one. Folk who go digging there at night come back white-haired, if they come back.',
      `And the Sovereign never sails alone: two brigs ride with her. ${p.admiral === ADMIRAL ? 'Harrow' : 'Whoever he is, he'} doesn’t trust his luck.`,
    ],
  },
  {
    id: 'finch-1',
    who: 'finch',
    stages: ['cipher'],
    letter: true,
    entry: 'cipher',
    advance: 'flag',
    lines: () => [
      'That seal. Put it away before someone sees it. …Here, let me look.',
      'The admiralty’s own cipher. I wrote a thousand of these before they turned me out.',
      `It’s to Blackwood. “Silver as agreed, forty chests. The Guild’s brig to be dealt with before she makes port.” And it’s signed… ${ADMIRAL}.`,
      'Harrow sold the Crown’s silver to the pirate king, and when your captain found out, he sent the Sovereign to put the Good Hope on the bottom.',
      'You’ll never touch him in a court, not with half the Admiralty in his pocket. So what will you do?',
    ],
  },
  {
    id: 'finch-2',
    who: 'finch',
    stages: ['flag', 'sovereign'],
    after: 'finch-1',
    entry: 'cipher',
    lines: () => [
      'Harrow keeps to his flagship. Says the land makes him ill. The truth is, on his own quarterdeck no one can reach him.',
      'They say he’s never lost a duel. They also say he’s never fought one fairly.',
    ],
  },
  {
    id: 'mary-flag',
    who: 'mary',
    stages: ['flag'],
    choice: null,
    entry: 'flag',
    lines: (p) => [
      'So you’re the one who dug up Blackwood’s hoard. The Brethren have been watching you.',
      `${ADMIRAL} has hanged forty of ours. You want his head; we want his flag.`,
      `Sail under ours, and the Brethren’s eyes are yours: we know where the Sovereign lies. Two of my ships will sail with you when you go for her. ${p.pirates} will be your home, and the Crown will call you a pirate.`,
    ],
    choices: [{ id: 'black', label: 'Raise the black flag' }],
  },
  {
    id: 'nell-flag',
    who: 'nell',
    stages: ['flag'],
    choice: null,
    entry: 'flag',
    lines: () => [
      `Harrow. God help us. Elias died for that name.`,
      'Don’t go raising black flags on my account. The Guild has friends in the Governor’s office who hate Harrow as much as we do.',
      'Take this letter of marque. It names you the Crown’s own officer, sent to bring him in. Our shipwrights will stiffen your hull, and our clerks will find his course.',
    ],
    choices: [{ id: 'colours', label: 'Take the letter of marque' }],
  },
  {
    id: 'mary-after',
    who: 'mary',
    stages: ['sovereign'],
    choice: 'black',
    entry: 'sovereign',
    lines: (p) => [
      `The Sovereign rides at anchor off ${p.capital}, with her two brigs. My Revenge and the little Gull will sail with you when you go for her.`,
      'Take him alive if you can. The Brethren want to see him dance.',
    ],
  },
  {
    id: 'nell-after',
    who: 'nell',
    stages: ['sovereign'],
    choice: 'colours',
    entry: 'sovereign',
    lines: (p) => [
      `Our clerks have it: the Sovereign keeps station off ${p.capital}, with two brigs in company. He never leaves her.`,
      'Bring him in, and bring yourself home. That’s all I ask.',
    ],
  },
  {
    id: 'nell-end',
    who: 'nell',
    stages: ['done'],
    entry: 'done',
    lines: () => ['I heard. The whole harbour heard.', 'Elias would be proud. And he’d tell you to go and see what else the sea has for you.'],
  },
];

export interface EntrySpec {
  stage: Stage;
  title: string;
  text: (p: Places, choice: Choice | null) => string;
}

/** The journal: one entry for each step of the main thread. */
export const ENTRIES: readonly EntrySpec[] = [
  {
    stage: 'nell',
    title: 'Ashes of the Good Hope',
    text: () =>
      'The Good Hope is gone, and Captain Elias Thorne with her: run down at dawn by an Imperial squadron flying an admiral’s pennant. Someone gave that order. Nell Brandt, Haven’s harbourmaster, knew Thorne better than anyone.',
  },
  {
    stage: 'quill',
    title: 'The bosun’s tale',
    text: (p) => `Nell says one other soul came off the Good Hope alive: her bosun, Jonas Quill. He was last seen drinking in ${p.pirates}.`,
  },
  {
    stage: 'chart',
    title: 'Blackwood’s chart',
    text: (p) =>
      `Quill saw the squadron: three crimson warships, the flagship Sovereign flying ${p.admiral}’s pennant. The night before, Thorne told him the proof lay in what Blackwood buried. The pirate king’s chart was torn in three, and a piece lies in each hoard on the cursed isles, guarded by the dead. The fixers sell maps to them after dark.`,
  },
  {
    stage: 'cipher',
    title: 'The Crown’s cipher',
    text: (p) =>
      `Blackwood’s hoard held a letter in the Crown’s cipher, sealed with an admiral’s crest. It takes someone who knows the admiralty’s codes to read it. Quill swore a turned-out code clerk, Tobias Finch, drinks in ${p.crown} after dark.`,
  },
  {
    stage: 'flag',
    title: 'The black flag',
    text: () =>
      `The letter names him: ${ADMIRAL}. He sold the Crown’s silver to Blackwood, and when Thorne found out, he sent the Sovereign to sink the Good Hope. No court will touch him. There are two ways to go after him, and you must choose one.`,
  },
  {
    stage: 'sovereign',
    title: 'The Sovereign',
    text: (p, choice) =>
      choice === 'black'
        ? `You sail under the black flag now. The Brethren know the Sovereign’s haunts: she lies off ${p.capital} with two brigs in company, and their ships will sail with you when you go for her. Take her, and face Harrow on his own deck.`
        : `You sail with the Guild’s letter of marque, the Crown’s own officer. The Guild’s clerks have found the Sovereign’s station: off ${p.capital}, with two brigs in company. Take her, and face Harrow on his own deck.`,
  },
  {
    stage: 'done',
    title: 'Thorne’s due',
    text: (_p, choice) =>
      choice === 'black'
        ? 'Harrow is beaten, and the black flag flies over the Sovereign. The Brethren sing of it in every haven. Elias Thorne’s debt is paid, and the sea is yours.'
        : 'Harrow is beaten, and in irons. The Guild carries his letter to the Governor, and the Crown will hang him quietly. Elias Thorne’s debt is paid, and the sea is yours.',
  },
];

/** The intro's panels: a picture and its words. */
export const INTRO: ReadonlyArray<{ image: string; text: string }> = [
  { image: 'story/intro-1-foundling.webp', text: 'A storm night on Haven’s quay. Captain Elias Thorne of the merchant brig Good Hope found a foundling among the barrels, and took you home.' },
  { image: 'story/intro-2-aboard.webp', text: 'You grew up aboard the Good Hope. Thorne taught you the stars, the charts and the winds, and the sea became your home.' },
  { image: 'story/intro-3-attack.webp', text: 'Then one dawn, three Imperial warships came out of the grey, flying an admiral’s pennant of black and gold. They didn’t hail. They fired.' },
  { image: 'story/intro-4-burning.webp', text: 'The Good Hope burned. Thorne held on to you in the wreckage long enough to whisper: “Blackwood knew… find what he buried.”' },
  { image: 'story/intro-5-haven.webp', text: 'You woke on the beach at Haven. Nell Brandt, the harbourmaster, gave you Thorne’s old sloop, and one charge: find out who gave the order.' },
];

/** The last picture, and its words for each way it can end. */
export const EPILOGUE = {
  image: 'story/epilogue.webp',
  text: (choice: Choice | null, sunk: boolean) =>
    sunk
      ? 'The Sovereign goes down with Harrow on her quarterdeck, still shouting orders nobody obeys. Elias Thorne’s debt is paid. The sea is yours.'
      : choice === 'black'
        ? 'Harrow’s sword rings on the deck. By sunset the black flag flies over the Sovereign, and the Brethren cheer you from every rail. Elias Thorne’s debt is paid. The sea is yours.'
        : 'Harrow’s sword rings on the deck, and he goes below in irons. The letter goes to the Governor, and the Crown will hang him quietly. Elias Thorne’s debt is paid. The sea is yours.',
};
