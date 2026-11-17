import { isTouchDevice } from './PhoneMotion.js';

const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* already released */ } };

/**
 * On-screen ◀ ▶ stick for touch devices without a live motion sensor.
 * A floating horizontal stick appears where the thumb lands (bottom part of the screen);
 * `state.x` ∈ [−1, 1] is read by InputManager exactly like the keyboard axis.
 */
export class TouchControls {
  constructor(container) {
    this.available = isTouchDevice;
    this.state = { x: 0 };
    this.visible = false;
    if (!this.available) return;

    const root = document.createElement('div');
    root.className = 'touch-ui hidden';
    root.innerHTML = `
      <div class="touch-zone">
        <div class="touch-hint">◀ drag ▶</div>
        <div class="touch-stick"><span class="arrow l">◀</span><div class="touch-knob"></div><span class="arrow r">▶</span></div>
      </div>`;
    container.appendChild(root);
    this.root = root;
    this.zone = root.querySelector('.touch-zone');
    this.stick = root.querySelector('.touch-stick');
    this.knob = root.querySelector('.touch-knob');
    this._bind();
  }

  _bind() {
    let id = null, ox = 0;
    const R = 64;
    const move = (e) => {
      const dx = clampPx(e.clientX - ox, R);
      this.knob.style.transform = `translateX(${dx}px)`;
      const nx = dx / R;
      this.state.x = Math.abs(nx) < 0.12 ? 0 : nx;
    };
    this.zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId;
      capture(this.zone, id);
      ox = e.clientX;
      this.stick.style.left = `${ox}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.stick.classList.add('on');
      move(e);
    });
    this.zone.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.state.x = 0;
      this.knob.style.transform = '';
      this.stick.classList.remove('on');
    };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
  }

  show(v) {
    if (!this.available || v === this.visible) return;
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
    if (!v) this.state.x = 0;
  }

  get active() {
    return this.visible && this.state.x !== 0;
  }
}

function clampPx(v, r) {
  return v < -r ? -r : v > r ? r : v;
}
