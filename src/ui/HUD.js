import { gsap } from 'gsap';
import { formatTime } from '../game/ScoreSystem.js';

/** In-game HUD: timer + lives (in the caption box), toasts and the big centre text (in the game box). */
export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.root = $('hud');
    this.el = { time: $('hud-time'), lives: $('hud-lives'), stars: $('hud-stars'), starsN: $('hud-stars-n'), center: $('hud-center'), toasts: $('toasts') };
    this._lastTime = '';
    this._lives = -1;
    this._centerTl = null;
  }

  show(v) {
    this.root.classList.toggle('hidden', !v);
    if (!v) this.clearCenter();
  }

  reset(lives, max) {
    this.el.toasts.replaceChildren();
    this._lives = -1;
    this.setLives(lives, max);
  }

  setLives(lives, max) {
    if (lives === this._lives) return;
    const lost = this._lives > lives;
    this._lives = lives;
    const box = this.el.lives;
    box.replaceChildren();
    const hearts = [];
    for (let i = 0; i < max; i++) {
      const h = document.createElement('span');
      h.className = `heart${i < lives ? '' : ' empty'}`;
      h.textContent = '❤';
      box.appendChild(h);
      hearts.push(h);
    }
    if (lost) {
      gsap.fromTo(hearts[lives], { scale: 1.8, color: '#ff3b3b' }, { scale: 1, clearProps: 'color', duration: 0.5, ease: 'back.out(3)' });
      gsap.fromTo(box, { x: -6 }, { x: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' });
    }
  }

  /** Collected stars counter; hidden when the level has none. */
  setStars(n, total) {
    this.el.stars.classList.toggle('hidden', !total);
    this.el.starsN.textContent = `${n}/${total}`;
    if (n > 0) gsap.fromTo(this.el.stars, { scale: 1.6 }, { scale: 1, duration: 0.45, ease: 'back.out(3)' });
  }

  update(time) {
    const t = formatTime(time);
    if (t !== this._lastTime) {
      this.el.time.textContent = t;
      this._lastTime = t;
    }
  }

  /** Big pop-in text in the game box (countdown, GO!, GOAL!). */
  center(text, duration = 0) {
    const c = this.el.center;
    this._centerTl?.kill();
    c.textContent = text;
    const tl = gsap.timeline();
    tl.fromTo(c, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2.2)' });
    if (duration) tl.to(c, { opacity: 0, scale: 1.25, duration: 0.25, ease: 'power2.in' }, duration / 1000);
    this._centerTl = tl;
  }

  clearCenter() {
    this._centerTl?.kill();
    gsap.set(this.el.center, { opacity: 0 });
  }

  toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 2) this.el.toasts.firstChild.remove();
    gsap.timeline({ onComplete: () => t.remove() })
      .from(t, { y: -16, opacity: 0, scale: 0.8, duration: 0.25, ease: 'back.out(2)' })
      .to(t, { opacity: 0, y: -8, duration: 0.35 }, 1.6);
  }
}
