/**
 * Fully procedural audio (Web Audio API) – no asset files needed.
 *  - music: tiny lookahead sequencer (bass + arpeggio + soft hat)
 *  - rolling: looped low noise + tonal hum, gain/pitch follow can speed (silent in the air)
 *  - drink pour: looped band-passed noise, gain follows the trail unroll rate
 *  - one-shots: hit, click, land, countdown, victory, game over
 * The AudioContext is created on the first user gesture (browser autoplay policy).
 */
export class AudioManager {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.musicOn = false;
    this._nextNote = 0;
    this._step = 0;
    this._timer = null;
    settings.on('change', (group) => {
      if (group === 'audio' || group === '*') this._applyVolumes();
    });
    const unlock = () => {
      this.init();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.musicBus = c.createGain();
    this.sfxBus = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.master.connect(comp).connect(c.destination);
    this._applyVolumes();

    // Shared noise buffer
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Rolling loop
    this.rollSrc = c.createBufferSource();
    this.rollSrc.buffer = this.noise;
    this.rollSrc.loop = true;
    this.rollFilter = c.createBiquadFilter();
    this.rollFilter.type = 'lowpass';
    this.rollFilter.frequency.value = 200;
    this.rollGain = c.createGain();
    this.rollGain.gain.value = 0;
    this.rollSrc.connect(this.rollFilter).connect(this.rollGain).connect(this.sfxBus);
    this.rollSrc.start();
    // Tonal hum of the rolling can: pitch and volume follow speed.
    this.humOsc = c.createOscillator();
    this.humOsc.type = 'triangle';
    this.humOsc.frequency.value = 70;
    this.humGain = c.createGain();
    this.humGain.gain.value = 0;
    this.humOsc.connect(this.humGain).connect(this.sfxBus);
    this.humOsc.start();

    // Drink pour loop (follows the trail unroll rate)
    this.paperSrc = c.createBufferSource();
    this.paperSrc.buffer = this.noise;
    this.paperSrc.loop = true;
    this.paperSrc.playbackRate.value = 0.7;
    this.paperFilter = c.createBiquadFilter();
    this.paperFilter.type = 'bandpass';
    this.paperFilter.frequency.value = 3200;
    this.paperFilter.Q.value = 0.9;
    this.paperGain = c.createGain();
    this.paperGain.gain.value = 0;
    this.paperSrc.connect(this.paperFilter).connect(this.paperGain).connect(this.sfxBus);
    this.paperSrc.start();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const a = this.settings.get('audio');
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(a.muted ? 0 : a.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(a.music * 0.5, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(a.sfx, t, 0.05);
  }

  toggleMute() {
    const a = this.settings.get('audio');
    this.settings.set('audio', 'muted', !a.muted);
    return !a.muted;
  }

  // ───────────────────────── continuous ─────────────────────────

  /** speed01 = |speed| / max, unroll = m/s of paper being laid. */
  setMotion(speed01, unroll, grounded) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = grounded ? Math.min(1, speed01) : 0;
    this.rollGain.gain.setTargetAtTime(g * 0.5, t, 0.05);
    this.rollFilter.frequency.setTargetAtTime(140 + g * 520, t, 0.05);
    this.humGain.gain.setTargetAtTime(g * 0.08, t, 0.06);
    this.humOsc.frequency.setTargetAtTime(70 + g * 110, t, 0.08);
    const p = grounded ? Math.min(1, unroll / 10) : Math.min(1, unroll / 10) * 0.4;
    this.paperGain.gain.setTargetAtTime(p * 0.35, t, 0.04);
    this.paperFilter.frequency.setTargetAtTime(2200 + p * 2600 + Math.random() * 400, t, 0.03);
  }

  silenceMotion() {
    this.setMotion(0, 0, false);
  }

  // ───────────────────────── one-shots ─────────────────────────

  _tone(freq, dur, { type = 'sine', vol = 0.3, when = 0, slide = 0, bus = this.sfxBus } = {}) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noiseBurst(dur, { freq = 1200, q = 1, vol = 0.4, type = 'bandpass', when = 0 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  click() { this._tone(880, 0.07, { type: 'triangle', vol: 0.18, slide: 300 }); }
  hover() { this._tone(1320, 0.04, { type: 'sine', vol: 0.06 }); }
  jump() { this._tone(380, 0.18, { type: 'square', vol: 0.08, slide: 420 }); }
  land() { this._noiseBurst(0.12, { freq: 300, vol: 0.25, type: 'lowpass' }); }

  hit() {
    this._tone(160, 0.28, { type: 'sawtooth', vol: 0.25, slide: -100 });
    this._noiseBurst(0.35, { freq: 2600, q: 0.6, vol: 0.5 }); // splash
    this._noiseBurst(0.15, { freq: 180, vol: 0.5, type: 'lowpass' });
  }

  fall() { this._tone(700, 0.8, { type: 'triangle', vol: 0.2, slide: -560 }); }

  checkpoint() {
    [784, 988, 1175].forEach((f, i) => this._tone(f, 0.18, { type: 'triangle', vol: 0.16, when: i * 0.07 }));
  }

  countdown(final) { this._tone(final ? 1046 : 523, final ? 0.35 : 0.15, { type: 'square', vol: 0.12 }); }

  victory() {
    const seq = [523, 659, 784, 1046, 784, 1046, 1318];
    seq.forEach((f, i) => this._tone(f, 0.25, { type: 'square', vol: 0.12, when: i * 0.11 }));
    seq.forEach((f, i) => this._tone(f / 2, 0.25, { type: 'triangle', vol: 0.12, when: i * 0.11 }));
  }

  gameOver() {
    [523, 466, 415, 349].forEach((f, i) => this._tone(f, 0.4, { type: 'triangle', vol: 0.2, when: i * 0.22, slide: -20 }));
  }

  // ───────────────────────── music ─────────────────────────

  startMusic() {
    this.init();
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this._nextNote = this.ctx.currentTime + 0.1;
    this._step = 0;
    this._timer = setInterval(() => this._schedule(), 50);
  }

  stopMusic() {
    this.musicOn = false;
    clearInterval(this._timer);
    this._timer = null;
  }

  _schedule() {
    if (!this.ctx) return;
    const bpm = 112;
    const stepDur = 60 / bpm / 2; // eighth notes
    // C – Am – F – G progression, pentatonic-ish arpeggio
    const roots = [130.81, 110.0, 87.31, 98.0];
    const arp = [
      [523.25, 659.25, 783.99, 659.25],
      [440.0, 523.25, 659.25, 523.25],
      [349.23, 440.0, 523.25, 440.0],
      [392.0, 493.88, 587.33, 493.88],
    ];
    while (this._nextNote < this.ctx.currentTime + 0.2) {
      const bar = Math.floor(this._step / 8) % 4;
      const beat = this._step % 8;
      const when = this._nextNote - this.ctx.currentTime;
      if (beat % 2 === 0) this._tone(roots[bar], stepDur * 1.8, { type: 'triangle', vol: 0.32, when, bus: this.musicBus });
      if (beat !== 7) this._tone(arp[bar][beat % 4] * (beat >= 4 ? 2 : 1) / 2, stepDur * 0.9, { type: 'square', vol: 0.05, when, bus: this.musicBus });
      if (beat % 2 === 1) this._musicHat(when);
      this._nextNote += stepDur;
      this._step++;
    }
  }

  _musicHat(when) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = c.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(this.musicBus);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }
}
