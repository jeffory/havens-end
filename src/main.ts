import './style.css';
import { Game } from './Game';

const container = document.getElementById('app')!;

Game.create(container)
  .then((game) => {
    game.start();
    // Poke at the running game from the browser console, e.g. game.ship or game.world.setVoxel(0, 40, 0, 5).
    if (import.meta.env.DEV) Object.assign(window, { game });
  })
  .catch((error: unknown) => {
    console.error(error);
    const message = document.createElement('pre');
    message.className = 'fatal';
    message.textContent = `Haven's End failed to start:\n${error instanceof Error ? error.message : String(error)}`;
    container.append(message);
  });
