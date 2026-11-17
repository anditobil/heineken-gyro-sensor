import { EventEmitter } from '../core/EventEmitter.js';

const RIGHT = new Set(['ArrowRight', 'KeyD', 'KeyW']);
const LEFT = new Set(['ArrowLeft', 'KeyA', 'KeyS']);
const GAME_KEYS = new Set([...RIGHT, ...LEFT, 'Space']);

/**
 * Keyboard: → / D / W = right, ← / A / S = left.
 * Esc / P = pause, R = restart, M = mute. There is no jump in CAN DROP.
 */
export class KeyboardController extends EventEmitter {
  constructor() {
    super();
    this.down = new Set();
    this.captureGameKeys = false;

    window.addEventListener('keydown', (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (this.captureGameKeys && GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      if (e.code === 'Escape' || e.code === 'KeyP') this.emit('pause');
      if (e.code === 'KeyR') this.emit('restart');
      if (e.code === 'KeyM') this.emit('mute');
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  _any(set) {
    for (const k of set) if (this.down.has(k)) return true;
    return false;
  }

  /** −1 / 0 / +1 */
  get lateral() {
    return (this._any(RIGHT) ? 1 : 0) - (this._any(LEFT) ? 1 : 0);
  }
}
