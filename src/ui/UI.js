import { gsap } from 'gsap';
import { initBrandSlots } from './Brand.js';
import { ControllerVisual } from './ControllerVisual.js';

const SCREENS = ['menu', 'setup', 'pause', 'success', 'fail'];

const TUT_HINTS = {
  joycon: 'Roll the roll forward = right · backward = left',
  phone: 'Tilt the right edge down = right · left edge down = left',
  keyboard: '← / A = left · → / D = right',
  touch: 'Drag left / right at the bottom of the screen',
};
const $ = (id) => document.getElementById(id);

/** Deterministic neon lines for the background (left and right edges, like the key visual). */
const LINES = [
  // [left %, height %, dim?] – thin lines rising from the bottom on both sides (key visual)
  [1.5, 31, 0], [5, 36, 0], [9.5, 26, 0], [13.5, 34, 1], [18, 23, 1], [22.5, 24, 0], [26.5, 29, 0],
  [74, 30, 1], [78.5, 37, 1], [82.5, 39, 1], [86, 29, 0], [90, 39, 0], [94.5, 21, 1], [98.5, 32, 0],
];

/**
 * DOM layer: home (menu), tutorial / game layout (game box + controller visual + caption),
 * results, pause and the controller setup. All entrances are animated with GSAP.
 */
export class UI {
  constructor(game) {
    this.game = game;
    this.settings = game.settings;
    this.input = game.input;
    this.current = 'menu';
    this.backTo = 'menu';
    this.mode = 'home';
    this.isHome = true;
    this.screens = Object.fromEntries(SCREENS.map((s) => [s, $(`screen-${s}`)]));
    this.box = $('game-box');
    this.cvEl = $('controller-visual');
    this.caption = $('caption');
    this.controller = new ControllerVisual(this.cvEl);
    this.gsap = gsap; // debug hook (window.__candrop.ui.gsap)

    initBrandSlots();
    this._buildLines();

    const click = (id, fn) => $(id).addEventListener('click', () => {
      game.audio.click();
      fn();
    });
    click('btn-play', () => {
      game.enablePhoneMotion(); // iOS motion permission must be requested from a tap
      game.startTutorial();
    });
    // Controller Setup is a hidden shortcut: F1 on the main menu.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F1' || this.current !== 'menu') return;
      e.preventDefault();
      game.audio.click();
      this.show('setup', 'menu');
    });
    click('btn-resume', () => game.resume());
    click('btn-restart', () => game.restart());
    click('btn-pause-setup', () => this.show('setup', 'pause'));
    click('btn-pause-menu', () => game.toMenu());
    click('btn-res-menu', () => game.toMenu());
    click('btn-try', () => game.restart());
    for (const b of document.querySelectorAll('[data-back]')) {
      b.addEventListener('click', () => {
        game.audio.click();
        this.show(this.backTo);
      });
    }

    this._bindSetup();
    this.input.on('device-change', () => this.renderDevices());
    this.input.calibration.on('update', () => this.renderCalibration());
    this.settings.on('change', (group) => {
      if (group === 'gyro') this.renderCalibration();
    });
    this.renderDevices();
    this.renderCalibration();
  }

  _buildLines() {
    const box = $('bg-lines');
    this.lines = LINES.map(([x, h, dim], i) => {
      const d = document.createElement('div');
      d.className = dim ? 'ln dim' : 'ln';
      d.style.left = `${x}%`;
      d.style.height = `${h}%`;
      d.style.opacity = String(0.75 + ((i * 37) % 25) / 100);
      box.appendChild(d);
      return d;
    });
    // Slow shimmer, forever.
    this.lines.forEach((d, i) => {
      gsap.to(d, { opacity: '-=0.25', duration: 1.4 + (i % 5) * 0.35, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: i * 0.13 });
    });
  }

  // ───────────────────────── layout modes ─────────────────────────

  /** 'home' | 'tutorial' | 'game' | 'result' */
  setMode(mode) {
    const prev = this.mode;
    this.mode = mode;
    const inBox = mode !== 'home';
    this.box.classList.toggle('hidden', !inBox);
    // Gameplay is full screen (no frame, no hands); the tutorial and results use the framed box.
    $('app').classList.toggle('game-full', mode === 'game');
    this.cvEl.classList.toggle('hidden', mode !== 'tutorial');
    this.caption.classList.toggle('hidden', !(mode === 'tutorial' || mode === 'game'));
    $('tut-caption').classList.toggle('hidden', mode !== 'tutorial');
    $('tut-hint').classList.toggle('hidden', mode !== 'tutorial');
    $('box-result').classList.toggle('hidden', mode !== 'result');
    this.isHome = !inBox;
    if (mode === 'tutorial') this.controller.reset();
    if (inBox && prev === 'home') {
      gsap.fromTo(this.box, { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: 0.55, ease: 'back.out(1.6)' });
    }
    if (mode === 'tutorial') {
      gsap.fromTo(this.cvEl, { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', delay: 0.15 });
      gsap.fromTo(this.caption, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', delay: 0.3 });
    } else if (mode === 'game') {
      gsap.fromTo(this.caption, { opacity: 0, y: -30 }, { opacity: 1, y: 0, duration: 0.45, ease: 'back.out(1.8)', delay: 0.2 });
    }
  }

  /** Hands + board follow the controller (called every frame while playing). */
  updateController(move, x) {
    if (this.mode === 'tutorial') this.controller.update(move, x);
  }

  show(name, backTo) {
    if (backTo) this.backTo = backTo;
    this.current = name;
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
    if (name === 'setup') this._syncSetupInputs();
    if (name === 'menu') {
      this.setMode('home');
      this._animateMenu();
    }
    const panel = this.screens[name]?.querySelector('.panel');
    if (panel) gsap.fromTo(panel, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.8)' });
  }

  hideAll() {
    this.current = null;
    for (const el of Object.values(this.screens)) el.classList.add('hidden');
  }

  _animateMenu() {
    const m = this.screens.menu;
    gsap.killTweensOf('#btn-play');
    const tl = gsap.timeline();
    tl.fromTo(this.lines, { scaleY: 0 }, { scaleY: 1, duration: 0.9, stagger: { each: 0.04, from: 'edges' }, ease: 'power3.out' }, 0)
      .fromTo(m.querySelector('.menu-logo'), { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }, 0.1)
      .fromTo(m.querySelectorAll('.ready-title .line'), { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.55, stagger: 0.14, ease: 'back.out(2.2)' }, 0.25)
      .fromTo(m.querySelector('.sync-logo'), { scale: 0.6, rotation: -8, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.6, ease: 'elastic.out(1, 0.55)' }, 0.6)
      .fromTo('#btn-play', { scale: 0, opacity: 0, xPercent: -50 }, { scale: 1, opacity: 1, xPercent: -50, duration: 0.5, ease: 'back.out(2.6)' }, 0.85)
      .fromTo('#menu-status', { opacity: 0 }, { opacity: 1, duration: 0.4 }, 1.1)
      .add(() => {
        gsap.to('#btn-play', { scale: 1.06, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
      });
  }

  // ───────────────────────── tutorial ─────────────────────────

  showTutorial(t) {
    this.setMode('tutorial');
    this.setTutorialHint(this.input.activeSource);
    this.updateTutorial(t);
  }

  hideTutorial() {}

  setTutorialHint(src) {
    $('tut-hint').textContent = TUT_HINTS[src] || TUT_HINTS.keyboard;
  }

  updateTutorial(t) {
    for (const it of t.items) {
      const el = $(it.side < 0 ? 'tut-star-l' : 'tut-star-r');
      if (it.taken && !el.classList.contains('got')) {
        el.classList.add('got');
        gsap.fromTo(el, { scale: 2.4, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.6, ease: 'back.out(2.5)' });
      } else if (!it.taken) {
        el.classList.remove('got');
      }
    }
  }

  tutorialComplete() {
    $('tut-hint').textContent = 'Great! Get ready…';
    gsap.fromTo('#tut-caption', { scale: 1 }, { scale: 1.06, duration: 0.25, yoyo: true, repeat: 1, ease: 'sine.inOut' });
  }

  // ───────────────────────── result ─────────────────────────

  showResult(r) {
    const ok = r.completed;
    this.setMode('result');
    const res = $('box-result');
    res.classList.toggle('fail', !ok);
    $('res-big').innerHTML = ok ? 'YOU MADE IT!' : 'NOT QUITE<br>IN SYNC!';
    $('res-small').textContent = ok ? 'PERFECTLY IN SYNC.' : '';
    $('res-stars').innerHTML = r.starsTotal
      ? Array.from({ length: r.starsTotal }, (_, i) => `<span class="${i < r.stars ? 'on' : 'off'}">★</span>`).join('')
      : '';
    this.show(ok ? 'success' : 'fail');

    // Start once the box has shrunk back from full-screen gameplay (CSS transition 0.5 s).
    const tl = gsap.timeline({ delay: 0.5 });
    gsap.set([res.querySelector('.res-glow'), res.querySelector('.res-can')], { xPercent: -50, yPercent: -50, x: 0, y: 0 });
    gsap.set([$('res-big'), $('res-small'), $('res-stars')], { opacity: 0 });
    tl.fromTo(res.querySelector('.res-glow'), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.9, ease: 'elastic.out(1, 0.6)' }, 0)
      .fromTo(res.querySelector('.res-can'), { opacity: 0, rotation: -60 }, { opacity: 1, rotation: -24, duration: 0.7, ease: 'back.out(1.8)' }, 0.15)
      .fromTo([$('res-big'), $('res-small'), $('res-stars')], { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, stagger: 0.12, ease: 'back.out(2)' }, 0.3);
    if (ok) {
      const s = this.screens.success;
      tl.fromTo(s.querySelector('.ch-to'), { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: 'power3.out' }, 0.5)
        .fromTo(s.querySelector('.ch-great'), { x: -90, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'back.out(1.8)' }, 0.6)
        .fromTo([s.querySelector('.ch-team'), s.querySelector('.ch-work')], { x: 90, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, stagger: 0.1, ease: 'back.out(1.8)' }, 0.65)
        .fromTo(s.querySelector('.cheers-art'), { y: 120, opacity: 0, rotation: 8 }, { y: 0, opacity: 1, rotation: 0, duration: 0.7, ease: 'back.out(1.6)' }, 0.75)
        .fromTo('#btn-res-menu', { scale: 0, xPercent: -50 }, { scale: 1, xPercent: -50, duration: 0.45, ease: 'back.out(2.6)' }, 1.1);
    } else {
      const s = this.screens.fail;
      tl.fromTo(s.querySelector('.so-close'), { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(2.4)' }, 0.5)
        .fromTo(s.querySelector('.so-close-sub'), { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'power3.out' }, 0.7)
        .fromTo('#btn-try', { scale: 0, xPercent: -50 }, { scale: 1, xPercent: -50, duration: 0.45, ease: 'back.out(2.6)' }, 0.9);
    }
  }

  // ───────────────────────── menu status ─────────────────────────

  renderDevices() {
    const jc = this.input.joycons;
    const list = jc.list();
    const menu = $('menu-status');
    const status = $('jc-status');
    if (list.length) {
      const names = list.map((d) => d.name).join(', ');
      menu.textContent = `🎮 ${names} connected`;
      menu.className = 'status-chip ok';
      status.textContent = `Connected: ${names}`;
      status.className = 'status-chip ok';
    } else {
      const phone = this.input.phone.state === 'on';
      menu.textContent = phone
        ? '📱 Phone tilt on'
        : this.input.isTouchDevice
          ? '👆 No motion controller – touch controls ready'
          : '⌨️ No Joy-Con connected – keyboard ready';
      menu.className = `status-chip${phone ? ' ok' : ' warn'}`;
      status.textContent = 'No Joy-Con connected';
      status.className = 'status-chip warn';
    }
    $('jc-list').innerHTML = '';
    for (const d of list) {
      const row = document.createElement('div');
      row.textContent = `${d.name} · battery ${d.battery} · ${d.reportRate ? d.reportRate.toFixed(0) : '—'} reports/s${d.vibration ? ' · rumble ✓' : ''}`;
      $('jc-list').appendChild(row);
    }
    const supported = jc.supported;
    $('btn-connect').classList.toggle('hidden', !supported);
    $('jc-unsupported').classList.toggle('hidden', supported);
    $('jc-unsupported').textContent = supported ? '' : `WebHID not available: ${jc.unsupportedReason}`;
    $('btn-cal-bias').disabled = !this.input.motionLive && !list.length;
    $('btn-cal-axis').disabled = !list.length;
    this._renderPhone();
  }

  _renderPhone() {
    const phone = this.input.phone;
    const show = phone.supported && this.input.isTouchDevice;
    $('phone-section').classList.toggle('hidden', !show);
    if (!show) return;
    const labels = {
      on: 'Phone motion on', off: 'Phone motion off', denied: 'Permission denied (allow motion access in browser settings)',
      unsupported: 'No motion sensor', insecure: 'Needs HTTPS',
    };
    $('phone-status').textContent = labels[phone.state] || phone.state;
    $('phone-status').className = `status-chip${phone.state === 'on' ? ' ok' : ' warn'}`;
    $('btn-phone').classList.toggle('hidden', phone.state === 'on');
  }

  renderCalibration() {
    const cal = this.input.calibration;
    const g = this.settings.get('gyro');
    $('cal-progress').style.width = `${(cal.mode === 'idle' ? (cal.calibrated ? 1 : 0) : cal.progress) * 100}%`;
    $('cal-msg').textContent = cal.message;
    $('cal-axis').textContent = `Spin axis: ${g.axis.toUpperCase()} (${g.axisSign > 0 ? '+' : '−'})${g.axisDetected ? ', detected' : ', not detected yet'}${g.invert ? ' · inverted' : ''}`;
  }

  // ───────────────────────── setup panel ─────────────────────────

  _bindSetup() {
    const s = this.settings;
    const input = this.input;
    $('btn-connect').addEventListener('click', async () => {
      this.game.audio.click();
      $('btn-connect').disabled = true;
      $('jc-status').textContent = 'Opening device chooser…';
      const res = await input.joycons.connect();
      $('btn-connect').disabled = false;
      this.renderDevices();
      if (!res.ok) {
        $('jc-status').textContent = res.message;
        $('jc-status').className = 'status-chip warn';
      }
    });
    $('btn-cal-bias').addEventListener('click', () => {
      if (!input.motionLive) {
        $('cal-msg').textContent = 'No sensor data – connect the Joy-Con and wake it up first.';
        return;
      }
      input.calibration.startStill({ durationMs: 2000 });
    });
    $('btn-cal-axis').addEventListener('click', () => {
      if (!input.joyConConnected || !input.motionLive) {
        $('cal-msg').textContent = 'No Joy-Con data – connect the Joy-Con first.';
        return;
      }
      input.calibration.startAxisDetect({ durationMs: 3000 });
    });
    $('btn-phone').addEventListener('click', () => this.game.enablePhoneMotion(true));

    const ranges = [
      ['set-sensitivity', 'gyro', 'sensitivity', (v) => v.toFixed(2)],
      ['set-deadZone', 'gyro', 'deadZone', (v) => v.toFixed(0)],
      ['set-maxRotationSpeed', 'gyro', 'maxRotationSpeed', (v) => v.toFixed(0)],
      ['set-smoothing', 'gyro', 'smoothing', (v) => v.toFixed(2)],
      ['set-master', 'audio', 'master', (v) => `${Math.round(v * 100)}`],
      ['set-music', 'audio', 'music', (v) => `${Math.round(v * 100)}`],
      ['set-sfx', 'audio', 'sfx', (v) => `${Math.round(v * 100)}`],
    ];
    this._ranges = ranges;
    for (const [id, group, key, fmt] of ranges) {
      const el = $(id);
      const out = el.parentElement.querySelector('output');
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        s.set(group, key, v);
        out.textContent = fmt(v);
      });
    }
    const checks = [
      ['set-invert', 'gyro', 'invert'],
      ['set-muted', 'audio', 'muted'],
      ['set-tilt-invert', 'tilt', 'invert'],
    ];
    this._checks = checks;
    for (const [id, group, key] of checks) {
      $(id).addEventListener('change', () => s.set(group, key, $(id).checked));
    }
  }

  _syncSetupInputs() {
    const s = this.settings;
    for (const [id, group, key, fmt] of this._ranges) {
      const v = s.get(group)[key];
      $(id).value = v;
      $(id).parentElement.querySelector('output').textContent = fmt(v);
    }
    for (const [id, group, key] of this._checks) $(id).checked = !!s.get(group)[key];
    this.renderDevices();
    this.renderCalibration();
  }

  /** Live readout; called every frame while the setup screen is open. */
  updateSetup() {
    if (this.current !== 'setup') return;
    const input = this.input;
    const sp = input.sensor;
    const live = input.motionLive;
    const f = (v) => (live ? v.toFixed(1) : '—');
    $('ro-gx').textContent = f(sp.corrected.x);
    $('ro-gy').textContent = f(sp.corrected.y);
    $('ro-gz').textContent = f(sp.corrected.z);
    $('ro-w').textContent = f(sp.omegaFiltered);
    $('ro-still').textContent = live ? (sp.isStill ? 'still' : 'moving') : 'no data';
    $('ro-src').textContent = live ? input.motionSource : 'none';
    const cmd = live ? input.motionCommand(performance.now()) : 0;
    $('ro-cmd').textContent = cmd.toFixed(2);
    const fill = $('ro-cmd-fill');
    fill.style.width = `${Math.abs(cmd) * 50}%`;
    fill.style.left = cmd >= 0 ? '50%' : `${50 - Math.abs(cmd) * 50}%`;
    if (input.phoneLive) $('ro-tilt').textContent = input.tilt.delta().toFixed(1);
    // Keep the calibration bar moving while a capture runs.
    if (input.calibration.mode !== 'idle') this.renderCalibration();
    this._devTick = (this._devTick || 0) + 1;
    if (this._devTick % 30 === 0) this.renderDevices();
  }
}
