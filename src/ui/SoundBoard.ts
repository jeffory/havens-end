/** The dev sound board at /?sounds: every effect, loop and take, to hear one by one. Dev only; main.ts loads it by dynamic import. */
import { Sfx } from '../audio/sfx/Sfx';
import { variantsOf } from '../audio/sfx/files';
import { LOOP_IDS, type LoopId, SOUNDS, type SfxName, type SoundId } from '../audio/sfx/sounds';

/** The sections, as the spec groups the sounds. */
const SECTIONS: readonly { title: string; ids: readonly SfxName[] }[] = [
  { title: 'Sea', ids: ['cannon', 'hull-hit', 'splash', 'sail-tear', 'barrel-blast', 'sinking', 'sails-set'] },
  { title: 'Ambience loops', ids: LOOP_IDS },
  { title: 'On foot', ids: ['step-sand', 'step-grass', 'step-wood', 'step-stone', 'axe-chop', 'tree-fall', 'pickaxe', 'outcrop-break', 'dig', 'chest-found', 'pickup'] },
  { title: 'Guns and beasts', ids: ['pistol', 'rifle', 'musket', 'reload', 'bullet-hit', 'goat', 'boar', 'bandit-shout', 'captain-hurt'] },
  { title: 'Duel', ids: ['blade-clash', 'parry', 'block', 'kick', 'swing', 'grunt', 'guardian-wail'] },
  { title: 'Ports and camps', ids: ['saw', 'forge-hammer'] },
  { title: 'Menus', ids: ['click', 'coins', 'page', 'cant'] },
];

const STYLE = `
.sound-board { position: fixed; inset: 0; overflow-y: auto; background: #f0e1bb; color: #3a2a1a; font: 14px/1.45 var(--ui-font); padding: 12px 16px 48px; }
.sound-board h1, .sound-board h2 { font-family: Georgia, 'Times New Roman', serif; margin: 0.6em 0 0.3em; }
.sound-board h1 { font-size: 24px; }
.sound-board h2 { font-size: 18px; border-bottom: 2px solid #6b4a2b; }
.sound-board .master { display: flex; align-items: center; gap: 10px; position: sticky; top: 0; padding: 8px 0; background: #f0e1bb; }
.sound-board .master input { flex: 1; max-width: 360px; }
.sound-board .row { padding: 8px 0; border-bottom: 1px solid rgb(107 74 43 / 0.25); }
.sound-board .id { font-weight: bold; margin-right: 8px; }
.sound-board .prompt { margin: 2px 0 6px; font-size: 12px; opacity: 0.75; }
.sound-board .buttons { display: flex; flex-wrap: wrap; gap: 6px; }
.sound-board button { font: inherit; padding: 6px 12px; min-height: 36px; border: 1px solid #6b4a2b; border-radius: 6px; background: #fbf3dc; color: inherit; cursor: pointer; }
.sound-board button:hover { background: #fff; }
.sound-board button[aria-pressed='true'] { background: #c8911c; }
.sound-board .none { opacity: 0.6; font-style: italic; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', undefined, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** Fill the container with the board, and expose its Sfx as window.sfx. */
export function mountSoundBoard(container: HTMLElement): void {
  const sfx = new Sfx();
  Object.assign(window, { sfx });
  const held = new Set<LoopId>();
  const holdLoops = () => sfx.setLoops(Object.fromEntries(LOOP_IDS.map((id) => [id, held.has(id) ? 1 : 0])) as Record<LoopId, number>);
  const unlock = () => sfx.unlock();

  const board = el('div', 'sound-board');
  board.append(el('style', undefined, STYLE), el('h1', undefined, 'Sound board'));

  const master = el('label', 'master', 'Effects volume');
  const slider = el('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.05';
  slider.value = '1';
  slider.addEventListener('input', () => {
    unlock();
    sfx.volume = Number(slider.value);
  });
  master.append(slider);
  board.append(master);

  for (const section of SECTIONS) {
    board.append(el('h2', undefined, section.title));
    for (const id of section.ids) {
      const row = el('div', 'row');
      row.append(el('span', 'id', id), el('div', 'prompt', SOUNDS[id].prompt));
      const buttons = el('div', 'buttons');
      const isLoop = (LOOP_IDS as readonly string[]).includes(id);
      if (isLoop) {
        const toggle = button('Hold at full', () => {
          unlock();
          const loop = id as LoopId;
          if (!held.delete(loop)) held.add(loop);
          toggle.setAttribute('aria-pressed', String(held.has(loop)));
          holdLoops();
        });
        toggle.setAttribute('aria-pressed', 'false');
        buttons.append(toggle);
      } else {
        buttons.append(
          button('▶ random', () => {
            unlock();
            sfx.play(id as SoundId);
          }),
        );
      }
      const takes = variantsOf(id).length;
      for (let take = 0; take < takes; take++) {
        buttons.append(
          button(`▶ ${take + 1}`, () => {
            unlock();
            sfx.playTake(id, take);
          }),
        );
      }
      if (takes === 0) buttons.append(el('span', 'none', 'no files'));
      row.append(buttons);
      board.append(row);
    }
  }
  container.append(board);
}
