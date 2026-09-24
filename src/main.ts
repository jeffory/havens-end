import './style.css';
import { Game } from './Game';
import { AUTOSAVE, readSave } from './save/storage';

const container = document.getElementById('app')!;

async function main(): Promise<void> {
  const game = await Game.create(container);
  // ?load=<slot> comes from the game menu's Load; ?new from New game. Anything else offers the autosave.
  const params = new URLSearchParams(location.search);
  const slot = params.get('load');
  let title = false;
  if (slot !== null) {
    try {
      const record = await readSave(slot);
      if (record) game.restore(record.data);
    } catch (error) {
      console.error(error);
      alert(`That save couldn't be loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (!params.has('new')) {
    title = await readSave(AUTOSAVE).then(Boolean, () => false);
  }
  if (location.search) history.replaceState(null, '', location.pathname);
  game.start(title);
  // Poke at the running game from the browser console, e.g. game.ship or game.world.setVoxel(0, 40, 0, 5).
  if (import.meta.env.DEV) Object.assign(window, { game });
}

main().catch((error: unknown) => {
  console.error(error);
  const message = document.createElement('pre');
  message.className = 'fatal';
  message.textContent = `Haven's End failed to start:\n${error instanceof Error ? error.message : String(error)}`;
  container.append(message);
});
