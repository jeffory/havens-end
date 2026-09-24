import './style.css';
import { Game } from './Game';

const game = new Game(document.getElementById('app')!);
game.start();

// Poke at the running game from the browser console, e.g. game.world.setVoxel(0, 40, 0, 5).
if (import.meta.env.DEV) Object.assign(window, { game });
