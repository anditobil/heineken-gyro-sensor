import { EventEmitter } from '../core/EventEmitter.js';
import { clamp } from '../core/MathUtils.js';
import { JoyConManager } from './JoyConManager.js';
import { GyroCalibration } from './GyroCalibration.js';
import { SensorProcessor } from './SensorProcessor.js';
import { TiltTracker, tiltToCommand } from './TiltTracker.js';
import { PhoneMotion, isTouchDevice } from './PhoneMotion.js';
import { KeyboardController } from './KeyboardController.js';
import { TouchControls } from './TouchControls.js';

const PAUSE_BUTTONS = new Set(['plus', 'minus', 'home', 'capture']);

/**
 * Merges Joy-Con, phone motion, keyboard and touch into one move value ∈ [−1, 1].
 * Keyboard / touch win while held; otherwise the live motion command is used.
 * When no motion source is live, the motion command is exactly 0 (no fake data).
 */
export class InputManager extends EventEmitter {
  constructor(settings, uiRoot) {
    super();
    this.settings = settings;
    this.keyboard = new KeyboardController();
    this.joycons = new JoyConManager();
    this.calibration = new GyroCalibration();
    this.sensor = new SensorProcessor(settings, this.calibration);
    this.tilt = new TiltTracker();
    this.phone = new PhoneMotion(settings);
    this.touch = new TouchControls(uiRoot);
    this.isTouchDevice = isTouchDevice;
    this.motionSource = 'none'; // 'joycon' | 'phone' | 'none'
    this.activeSource = 'keyboard';
    this.lastMove = 0;
    this.lastMotion = 0;

    this.sensor.on('processed', () => {
      this.tilt.process(this.sensor.corrected, this.sensor.raw.accel, this.sensor.lastPacketAt);
    });

    this.joycons.on('imu', (detail, info, now) => {
      const primary = this.joycons.primary;
      if (primary && primary.key !== info.key) return; // only the primary drives motion
      this._lastJoyImu = now;
      if (this.motionSource !== 'joycon') {
        this.motionSource = 'joycon';
        this.sensor.resetFilters();
      }
      this.sensor.process(detail, now);
    });

    this.phone.on('imu', (detail, now) => {
      // A connected Joy-Con always wins.
      if (this.joycons.connectedCount > 0 || now - (this._lastJoyImu ?? -1e9) < 300) return;
      if (!this.settings.get('mobile').useMotion) return;
      if (this.motionSource !== 'phone') {
        this.motionSource = 'phone';
        this.sensor.resetFilters();
        this.tilt.recenter();
      }
      this.sensor.process(detail, now);
    });
    this.phone.on('state', () => this.emit('device-change'));

    this.joycons.on('connected', () => {
      this.sensor.resetFilters();
      // Silent bias capture on connect; rejected automatically if the roll is moving.
      setTimeout(() => {
        if (this.calibration.mode === 'idle') this.calibration.startStill({ durationMs: 1500, auto: true });
      }, 600);
      this.emit('device-change');
    });
    this.joycons.on('disconnected', () => {
      this.sensor.resetFilters();
      this.emit('device-change');
    });
    this.joycons.on('change', () => this.emit('device-change'));
    this.joycons.on('button', (name) => {
      if (PAUSE_BUTTONS.has(name)) this.emit('pause');
    });

    this.calibration.on('done', (result) => {
      if (result.type === 'axis') {
        // Axis detection measures with invert off, so reset invert to keep forward = right.
        settings.set('gyro', 'axis', result.axis);
        settings.set('gyro', 'axisSign', result.sign);
        settings.set('gyro', 'axisDetected', true);
        settings.set('gyro', 'invert', false);
      }
      this.sensor.resetFilters();
    });

    this.keyboard.on('pause', () => this.emit('pause'));
    this.keyboard.on('restart', () => this.emit('restart'));
    this.keyboard.on('mute', () => this.emit('mute'));
  }

  get joyConConnected() {
    return this.joycons.connectedCount > 0;
  }

  /** Any motion source is delivering fresh packets. */
  get motionLive() {
    return this.motionSource !== 'none' && this.sensor.isLive(performance.now());
  }

  get phoneLive() {
    return this.motionSource === 'phone' && this.sensor.isLive(performance.now());
  }

  /** Silent bias capture (level start / countdown) when a Joy-Con is connected. */
  autoBias() {
    if (this.joyConConnected && this.calibration.mode === 'idle') {
      this.calibration.startStill({ durationMs: 1500, auto: true });
    }
  }

  /** Phone: the current pose becomes "level". Called at GO. */
  recenterTilt() {
    this.tilt.recenter();
  }

  /** Phone tilt → command (right edge down = positive). */
  tiltCommand() {
    const t = this.settings.get('tilt');
    const deg = this.tilt.delta();
    const c = tiltToCommand(deg, t.deadZone, t.fullTilt) * (t.invert ? -1 : 1);
    return clamp(c, -1, 1);
  }

  /** Motion command from the live source, 0 if none is live. */
  motionCommand(now) {
    if (!this.sensor.isLive(now)) return 0;
    return this.motionSource === 'phone' ? this.tiltCommand() : this.sensor.getCommand(now);
  }

  /** Final move value. Called once per physics step. */
  sampleMove(now) {
    const kb = this.keyboard.lateral;
    const touch = this.touch.state.x;
    const motion = this.motionCommand(now);
    this.lastMotion = motion;
    let move;
    if (kb !== 0) {
      move = kb;
      this._setSource('keyboard');
    } else if (touch !== 0) {
      move = touch;
      this._setSource('touch');
    } else {
      move = motion;
      if (Math.abs(motion) > 0.02) this._setSource(this.motionSource === 'phone' ? 'phone' : 'joycon');
    }
    this.lastMove = clamp(move, -1, 1);
    return this.lastMove;
  }

  _setSource(src) {
    if (src !== this.activeSource) {
      this.activeSource = src;
      this.emit('source', src);
    }
  }

  /** Default badge before any input: the live motion source, else keyboard/touch. */
  resetSource() {
    const src = this.motionLive ? this.motionSource : this.isTouchDevice ? 'touch' : 'keyboard';
    this.activeSource = src;
    this.emit('source', src);
  }
}
