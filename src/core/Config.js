import { EventEmitter } from './EventEmitter.js';

/** Fixed constants (not user-tunable). */
export const CONSTANTS = {
  PHYSICS_HZ: 120,
  MAX_FRAME_DT: 0.1,
  INPUT_STALE_MS: 250, // sensor data older than this counts as "no input"
  STRIP_WIDTH: 0.54, // drink trail ribbon width (m)
  SHEET_LENGTH: 0.42, // texture repeat along the trail (m)
};

/** User-tunable defaults. Persisted in localStorage. */
export const DEFAULT_SETTINGS = {
  gyro: {
    sensitivity: 1.0,
    deadZone: 14, // °/s
    maxRotationSpeed: 420, // °/s of spin = full speed
    invert: false,
    axis: 'x', // spin axis ('x' | 'y' | 'z'), set by auto-detection
    axisSign: 1,
    axisDetected: false,
    smoothing: 0.6, // 0 = raw, 1 = very smooth (One-Euro minCutoff)
    responsiveness: 0.5, // One-Euro beta
    driftCompensation: true,
  },
  tilt: {
    deadZone: 3, // °
    fullTilt: 25, // ° for full speed
    invert: false,
  },
  movement: {
    maxSpeed: 9.5,
    acceleration: 16,
    friction: 7,
  },
  audio: {
    master: 0.8,
    music: 0.45,
    sfx: 0.8,
    muted: false,
  },
  graphics: {
    shadows: true,
    pixelRatioCap: 2,
    ambientOcclusion: true, // GTAO + vignette post-processing (set false on weak devices)
  },
  mobile: {
    useMotion: true,
    flip: false,
  },
  progressDrop: {
    unlockedLevel: 1,
    best: {},
  },
};

const STORAGE_KEY = 'candrop.settings.v1';

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!extra || typeof extra !== 'object') return out;
  for (const key of Object.keys(extra)) {
    const b = base?.[key];
    const e = extra[key];
    if (b && typeof b === 'object' && !Array.isArray(b) && e && typeof e === 'object') {
      out[key] = deepMerge(b, e);
    } else if (e !== undefined) {
      out[key] = e;
    }
  }
  return out;
}

class Settings extends EventEmitter {
  constructor() {
    super();
    this.data = deepMerge(DEFAULT_SETTINGS, this._load());
  }

  _load() {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  save() {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* private mode / blocked storage: settings just don't persist */
    }
  }

  get(group) {
    return this.data[group];
  }

  set(group, key, value) {
    this.data[group][key] = value;
    this.save();
    this.emit('change', group, key, value);
  }

  setGroup(group, value) {
    this.data[group] = value;
    this.save();
    this.emit('change', group, '*', value);
  }

  resetGroup(group) {
    this.data[group] = structuredClone(DEFAULT_SETTINGS[group]);
    this.save();
    this.emit('change', group, '*');
  }
}

export const settings = new Settings();
