// hidShim MUST be evaluated before joy-con-webhid (imported via JoyConManager).
import './controller/hidShim.js';
import '../style.css';
import { Game } from './core/Game.js';

async function boot() {
  // Canvas textures (labels, signs) need the font loaded first; never wait more than 1.5 s.
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('700 62px "FuturaCond"'),
        document.fonts.load('400 16px "Myriad"'),
        document.fonts.load('400 16px "HeinekenSerif"'),
      ]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch {
    /* fall back to Arial Black */
  }
  new Game(document.getElementById('canvas-wrap'), document.getElementById('app'));
}

boot();
