import { settings } from './Config.js';
import { SceneManager } from './SceneManager.js';
import { GameLoop } from './GameLoop.js';
import { DropMode } from '../game/DropMode.js';
import { CameraController } from '../game/CameraController.js';
import { ScoreSystem, MAX_LIVES } from '../game/ScoreSystem.js';
import { Tutorial, TUTORIAL_LEVEL } from '../game/Tutorial.js';
import { InputManager } from '../controller/InputManager.js';
import { AudioManager } from '../audio/AudioManager.js';
import { HUD } from '../ui/HUD.js';
import { UI } from '../ui/UI.js';
import stageBackdrop from '../assets/images/stage-backdrop.webp';

/**
 * State machine: menu → tutorial → tutorialDone → countdown → playing ⇄ paused → complete / gameover.
 * Physics runs in a fixed 120 Hz step; visuals, camera and HUD once per frame.
 */
export class Game {
  constructor(container, uiRoot) {
    this.settings = settings;
    this.sceneMgr = new SceneManager(container, settings);
    this.cameraCtl = new CameraController(this.sceneMgr.camera);
    this.drop = new DropMode(this.sceneMgr.scene, settings);
    this.drop.overlay = this.sceneMgr.overlay; // logo layer drawn after ambient occlusion
    this.sceneMgr.setBackdrop(stageBackdrop); // stage lights + haze behind the tower
    this.input = new InputManager(settings, uiRoot);
    this.audio = new AudioManager(settings);
    this.score = new ScoreSystem();
    this.hud = new HUD();
    this.tutorial = new Tutorial();
    this.state = 'menu';
    this.levelIndex = 0;
    this.countdown = 0;
    this._resultTimer = 0;
    this.ui = new UI(this);

    this.input.on('pause', () => this.togglePause());
    this.input.on('restart', () => {
      // No retry from the result screen: it only leads back to home.
      if (['playing', 'paused', 'countdown'].includes(this.state)) this.restart();
    });
    this.input.on('mute', () => this.audio.toggleMute());
    this.input.on('source', (src) => {
      if (this.state === 'tutorial') this.ui.setTutorialHint(src);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.state === 'playing' || this.state === 'countdown')) this.pause();
    });

    this._loadLevel(0);
    this.cameraCtl.snap(this.drop.update(0));

    this.loop = new GameLoop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      update: (dt) => this.update(dt),
      render: () => {
        if (!this.ui.isHome) this.sceneMgr.render(); // no 3D backdrop behind the home screens
      },
    });
    this.loop.start();
    this.ui.show('menu');

    // Debug / smoke-test hook (read-only view of state + level jump).
    window.__candrop = this;
  }

  _loadLevel(index) {
    const cfg = this.drop.load(index);
    this.levelIndex = index;
    this.sceneMgr.setTheme(this.drop.theme);
    return cfg;
  }

  // ───────────────────────── flow ─────────────────────────

  /** Playable tutorial: grab the caps at both ends of one board, then the game starts. */
  startTutorial() {
    clearTimeout(this._resultTimer);
    const cfg = this.drop.loadConfig(TUTORIAL_LEVEL);
    this.levelIndex = -1;
    this.sceneMgr.setTheme(this.drop.theme);
    this.drop.time = 0;
    this.tutorial.begin(this.drop);
    this.cameraCtl.wide = true; // whole board with both end caps in view
    this.cameraCtl.snap(this.drop.update(0));
    this.ui.hideAll();
    this.hud.show(false);
    this.ui.showTutorial(this.tutorial);
    this.input.resetSource();
    this.input.keyboard.captureGameKeys = true;
    this.input.recenterTilt(); // phone: the pose when the tutorial opens is "level"
    this.state = 'tutorial';
    this.audio.init();
    this.audio.startMusic();
  }

  _onTutorialItem() {
    const t = this.tutorial;
    this.audio.checkpoint();
    this.input.joycons.rumble(0.5, 100);
    this.ui.updateTutorial(t);
    if (t.done) {
      this.state = 'tutorialDone';
      this.audio.silenceMotion();
      this.ui.tutorialComplete();
      this._resultTimer = setTimeout(() => {
        this.ui.hideTutorial();
        this.startLevel(0);
      }, 1300);
    }
  }

  startLevel(index) {
    clearTimeout(this._resultTimer);
    if (index < 0 || index >= this.drop.count) return;
    const cfg = index === this.levelIndex && this.drop.current ? this.drop.current : this._loadLevel(index);
    this.drop.reset();
    this.drop.time = 0;
    this.cameraCtl.wide = false;
    this.cameraCtl.snap(this.drop.update(0));
    this.score.reset(cfg.parTime);
    this.ui.hideAll();
    this.ui.setMode('game');
    this.hud.show(true);
    this.score.starsTotal = this.drop.stars.total;
    this.hud.reset(this.score.lives, MAX_LIVES);
    this.hud.setStars(0, this.score.starsTotal);
    this.hud.update(0);
    this.input.resetSource();
    this.input.keyboard.captureGameKeys = true;
    this.input.autoBias(); // silent bias capture during the countdown
    this.state = 'countdown';
    this.countdown = 3;
    this.hud.center('3');
    this.audio.init();
    this.audio.countdown(false);
    this.audio.startMusic();
  }

  restart() {
    this.startLevel(this.levelIndex);
  }

  toMenu() {
    clearTimeout(this._resultTimer);
    this.state = 'menu';
    if (this.levelIndex < 0) this._loadLevel(0); // leaving the tutorial board
    this.drop.reset();
    this.cameraCtl.wide = false;
    this.cameraCtl.snap(this.drop.update(0));
    this.ui.hideTutorial();
    this.hud.show(false);
    this.input.keyboard.captureGameKeys = false;
    this.audio.silenceMotion();
    this.ui.show('menu');
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this._pausedFrom = this.state;
    this.state = 'paused';
    this.audio.silenceMotion();
    this.hud.clearCenter();
    this.ui.show('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.ui.hideAll();
    this.state = this._pausedFrom || 'playing';
    if (this.state === 'countdown') this.hud.center(String(Math.ceil(this.countdown)));
  }

  togglePause() {
    if (this.state === 'tutorial') {
      this.toMenu(); // Esc in the tutorial = back to home
    } else if (this.state === 'paused') {
      if (this.ui.current === 'pause') this.resume();
    } else {
      this.pause();
    }
  }

  /** Phones: start DeviceMotion (iOS asks for permission – must run inside a tap). */
  enablePhoneMotion(force = false) {
    const p = this.input.phone;
    if (!p.supported || !this.input.isTouchDevice) return;
    if (!force && !settings.get('mobile').useMotion) return;
    p.enable().then(() => this.ui.renderDevices());
  }

  _tickCountdown(dt) {
    const prev = Math.ceil(this.countdown);
    this.countdown -= dt;
    const now = Math.ceil(this.countdown);
    if (this.countdown <= 0) {
      this.state = 'playing';
      this.hud.center('GO!', 700);
      this.audio.countdown(true);
      this.input.recenterTilt(); // phone: the pose at GO is "level"
    } else if (now !== prev) {
      this.hud.center(String(now));
      this.audio.countdown(false);
    }
  }

  _complete() {
    this.state = 'complete';
    const cfg = this.drop.current;
    this.audio.silenceMotion();
    this.audio.victory();
    this.input.joycons.rumble(0.6, 300);
    this.hud.clearCenter(); // no "GOAL!" text pop
    const score = this.score.compute(true);
    const newBest = this._saveProgress(cfg, score);
    const result = {
      completed: true, score, newBest,
      time: this.score.time, lives: this.score.lives, hits: this.score.hits,
      stars: this.score.starsCollected, starsTotal: this.score.starsTotal,
    };
    this._resultTimer = setTimeout(() => this._showResult(result), 1400);
  }

  _gameOver(reason) {
    this.state = 'gameover';
    this.audio.silenceMotion();
    this.audio.gameOver();
    this.hud.clearCenter(); // no "OUCH!" text pop
    const score = this.score.compute(false);
    score.depth = Math.round(this.drop.progress * 5);
    score.total += score.depth;
    const result = {
      completed: false, reason, score, newBest: false,
      time: this.score.time, lives: this.score.lives, hits: this.score.hits,
      stars: this.score.starsCollected, starsTotal: this.score.starsTotal,
    };
    this._resultTimer = setTimeout(() => this._showResult(result), 1200);
  }

  _showResult(result) {
    this.hud.show(false);
    this.input.keyboard.captureGameKeys = false;
    this.ui.showResult(result);
  }

  _saveProgress(cfg, score) {
    const prog = structuredClone(settings.get('progressDrop'));
    const prev = prog.best[cfg.id];
    const newBest = !prev || score.total > prev.score;
    if (newBest) {
      prog.best[cfg.id] = { score: score.total, time: this.score.time, stars: Math.max(score.stars, prev?.stars || 0) };
    } else if (score.stars > prev.stars) {
      prev.stars = score.stars;
    }
    prog.unlockedLevel = Math.min(this.drop.count, Math.max(prog.unlockedLevel, cfg.id + 1));
    settings.setGroup('progressDrop', prog);
    return newBest;
  }

  _onStar() {
    const s = this.score;
    s.starsCollected++;
    this.hud.setStars(s.starsCollected, s.starsTotal);
    this.audio.checkpoint();
    this.input.joycons.rumble(0.5, 100);
  }

  _onHit() {
    this.score.hits++;
    this.score.lives = Math.max(0, this.score.lives - 1);
    this.hud.setLives(this.score.lives, MAX_LIVES);
    this.cameraCtl.shake(0.6);
    this.audio.hit();
    this.input.joycons.rumble(0.9, 180);
    const left = this.score.lives;
    this.hud.toast(left ? `💥 Saw! –1 life (${left} left)` : '💥 Saw! No lives left', 'bad');
  }

  // ───────────────────────── loop ─────────────────────────

  fixedUpdate(dt) {
    const d = this.drop;
    if (this.state === 'paused') return;
    if (this.state === 'countdown') {
      this._tickCountdown(dt);
      d.step(dt, 0, false);
      return;
    }
    if (this.state === 'tutorial') {
      d.step(dt, this.input.sampleMove(performance.now()), true);
      if (this.tutorial.check(d)) this._onTutorialItem();
      return;
    }
    if (this.state !== 'playing') {
      d.step(dt, 0, false);
      return;
    }
    const move = this.input.sampleMove(performance.now());
    const ev = d.step(dt, move, true);
    if (d.justLanded) this.audio.land();
    this.score.tick(dt);
    if (ev.hit) this._onHit();
    if (ev.star) this._onStar();
    if (this.score.lives <= 0) {
      this._gameOver('You ran out of lives!');
      return;
    }
    if (ev.finished) this._complete();
  }

  update(dt) {
    const paused = this.state === 'paused';
    const d = this.drop;
    const focus = d.update(paused ? 0 : dt);
    this.cameraCtl.update(paused ? 0 : dt, focus);
    this.sceneMgr.setFocus(focus);
    if (this.levelIndex < 0) this.tutorial.animate(dt);
    const moving = this.state === 'playing' || this.state === 'tutorial';
    this.ui.updateController(moving ? this.input.lastMove : 0, d.x);
    if (this.state === 'playing' || this.state === 'tutorial') {
      this.audio.setMotion(Math.abs(d.vx) / d.maxSpeed, d.unrollRate, d.grounded);
    } else {
      // Every other state (tutorialDone, countdown, result, menu…) must be silent, otherwise
      // the rolling hum freezes at its last volume after the final tutorial cap.
      this.audio.silenceMotion();
    }
    if (this.state !== 'menu') this.hud.update(this.score.time);
    const touchOn = ['playing', 'countdown', 'tutorial'].includes(this.state) && !this.input.motionLive;
    this.input.touch.show(touchOn);
    this.ui.updateSetup();
  }
}
