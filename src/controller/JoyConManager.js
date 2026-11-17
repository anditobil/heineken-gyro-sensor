// hidShim MUST be evaluated before joy-con-webhid (see file header).
import { hidSupported, hidUnsupportedReason } from './hidShim.js';
import * as JoyConLib from 'joy-con-webhid';
import { EventEmitter } from '../core/EventEmitter.js';

/**
 * Wraps joy-con-webhid v0.11.
 *
 * Verified library behaviour (read from node_modules/joy-con-webhid/dist):
 *  - `connectJoyCon()` → navigator.hid.requestDevice({vendorId: 0x057e}) then opens the
 *    device and enables Standard Full Mode (report 0x30) + IMU. Errors are caught and
 *    only logged with console.error, so the promise never rejects.
 *  - `connectedJoyCons` is a Map<number, JoyConLeft|JoyConRight|GeneralController>.
 *    The library adds entries on connect / page load (previously paired devices) and
 *    removes them on navigator.hid "disconnect".
 *  - Each instance is an EventTarget firing "hidinput" (CustomEvent, detail = packet).
 *    For report 0x30 the packet contains:
 *      gyroscopes:     [3 samples][3 axes] of { dps, rps }   (0.06103 dps/LSB, real deg/s)
 *      accelerometers: [3 samples] of { x:{acc}, y:{acc}, z:{acc} }  (0.000244 G/LSB, real G)
 *      buttonStatus:   { a, b, x, y, up, down, left, right, sl, sr, l, zl, r, zr, plus, minus, ... }
 *      batteryLevel:   { level: 'full' | 'medium' | 'low' | 'critical' | ... }
 *    NOTE: `actualGyroscope.dps` / `actualAccelerometer` are averages multiplied by 0.015
 *    inside the library – NOT deg/s or G – so we read the raw per-sample arrays instead.
 *  - productId 0x2006 = Joy-Con (L), 0x2007 = Joy-Con (R).
 */

const BUTTON_NAMES = [
  'a', 'b', 'x', 'y', 'up', 'down', 'left', 'right',
  'sl', 'sr', 'l', 'zl', 'r', 'zr', 'plus', 'minus', 'home', 'capture',
  'leftStick', 'rightStick',
];

let nextKey = 1;

function describeDevice(joyCon) {
  const d = joyCon.device;
  const side =
    d.productId === 0x2006 ? 'left' : d.productId === 0x2007 ? 'right' : 'other';
  return {
    side,
    name: d.productName || (side === 'left' ? 'Joy-Con (L)' : side === 'right' ? 'Joy-Con (R)' : 'HID controller'),
    productId: d.productId,
  };
}

export class JoyConManager extends EventEmitter {
  constructor() {
    super();
    this.supported = hidSupported;
    this.unsupportedReason = hidUnsupportedReason;
    /** @type {Map<object, any>} joyCon instance → info record */
    this.devices = new Map();
    this.primaryKey = null;
    this.lastError = '';

    if (this.supported) {
      // Poll the library map, exactly like the official README recommends: Joy-Cons can
      // appear after pairing, on page load, or when they wake from sleep.
      this._scanTimer = setInterval(() => this._scan(), 400);
      navigator.hid.addEventListener('disconnect', () => setTimeout(() => this._scan(), 50));
      navigator.hid.addEventListener('connect', () => setTimeout(() => this._scan(), 300));
      setTimeout(() => this._scan(), 100);
    }
  }

  /** Opens the browser device chooser. Resolves { ok, message }. Never throws. */
  async connect() {
    if (!this.supported) {
      return { ok: false, message: this.unsupportedReason };
    }
    const before = new Set(JoyConLib.connectedJoyCons.values());
    // connectJoyCon swallows errors and console.error's them; capture them so the
    // player gets a readable message instead of a silent failure.
    const captured = [];
    const origError = console.error;
    console.error = (...args) => {
      captured.push(args.map(String).join(' '));
      origError.apply(console, args);
    };
    try {
      await JoyConLib.connectJoyCon();
    } catch (err) {
      captured.push(String(err?.message || err));
    } finally {
      console.error = origError;
    }
    await this._scan();

    const added = [...JoyConLib.connectedJoyCons.values()].filter((j) => !before.has(j));
    if (added.length) return { ok: true, message: `${describeDevice(added[0]).name} connected.` };

    const text = captured.join(' ');
    let message;
    if (/NotAllowedError|SecurityError/i.test(text)) {
      message = 'Permission to access the controller was denied.';
    } else if (/NotFoundError|No device selected/i.test(text) || !text) {
      message =
        before.size > 0
          ? 'No new controller selected.'
          : 'No controller selected. Pair the Joy-Con with your PC via Bluetooth first (hold the small sync button until the lights run), then click Connect and pick it from the list.';
    } else if (/timeout|Timed out/i.test(text)) {
      message = 'The Joy-Con did not answer. Press a button on it to wake it up and try again.';
    } else {
      message = `Connection failed: ${text}`;
    }
    this.lastError = message;
    return { ok: false, message };
  }

  /** Close and stop listening to one controller. Safe to call at any time. */
  async disconnect(key) {
    const info = this._infoByKey(key);
    if (!info) return;
    const joyCon = info.joyCon;
    this._detach(joyCon, 'user');
    // Remove from the library map so the scanner doesn't re-attach it immediately.
    for (const [k, v] of JoyConLib.connectedJoyCons) {
      if (v === joyCon) JoyConLib.connectedJoyCons.delete(k);
    }
    try {
      if (joyCon.device.opened) await joyCon.device.close();
    } catch (err) {
      console.warn('[JoyCon] close failed', err);
    }
  }

  get primary() {
    const info = this._infoByKey(this.primaryKey);
    return info || this.devices.values().next().value || null;
  }

  setPrimary(key) {
    if (this._infoByKey(key)) {
      this.primaryKey = key;
      this.emit('change');
    }
  }

  list() {
    return [...this.devices.values()];
  }

  get connectedCount() {
    return this.devices.size;
  }

  /** Short haptic pulse on every connected Joy-Con. Fire-and-forget. */
  rumble(amplitude = 0.6, ms = 120) {
    for (const info of this.devices.values()) {
      if (!info.vibration) continue;
      const jc = info.joyCon;
      jc.rumble(160, 320, amplitude).catch(() => {});
      setTimeout(() => jc.rumble(160, 320, 0).catch(() => {}), ms);
    }
  }

  // ───────────────────────── internals ─────────────────────────

  _infoByKey(key) {
    for (const info of this.devices.values()) if (info.key === key) return info;
    return null;
  }

  async _scan() {
    if (!this.supported) return;
    const live = new Set(JoyConLib.connectedJoyCons.values());
    for (const joyCon of live) {
      if (!this.devices.has(joyCon)) this._attach(joyCon);
    }
    for (const joyCon of [...this.devices.keys()]) {
      const stillThere = live.has(joyCon) && joyCon.device?.opened !== false;
      if (!stillThere) this._detach(joyCon, 'lost');
    }
  }

  _attach(joyCon) {
    const desc = describeDevice(joyCon);
    const info = {
      key: `jc${nextKey++}`,
      joyCon,
      ...desc,
      battery: '—',
      firmware: '',
      vibration: false,
      gyroOk: false,
      accelOk: false,
      lastReportAt: 0,
      reportCount: 0,
      reportRate: 0,
      _rateWindowStart: performance.now(),
      _rateWindowCount: 0,
      buttons: Object.fromEntries(BUTTON_NAMES.map((b) => [b, false])),
      listener: null,
    };
    info.listener = (event) => this._onPacket(info, event.detail);
    joyCon.addEventListener('hidinput', info.listener);
    this.devices.set(joyCon, info);
    if (!this.primaryKey || !this._infoByKey(this.primaryKey)) this.primaryKey = info.key;
    this.emit('connected', info);
    this.emit('change');

    // Best-effort extras; a failure here must never break input.
    (async () => {
      try {
        // The library already opened the device and enabled full + IMU mode in its
        // own connect path. Re-enabling IMU is idempotent and recovers controllers
        // that woke up from sleep with IMU off.
        await joyCon.enableIMUMode();
      } catch (err) {
        console.warn('[JoyCon] enableIMUMode failed', err);
      }
      try {
        await joyCon.enableVibration();
        info.vibration = true;
      } catch {
        info.vibration = false;
      }
      try {
        const devInfo = await Promise.race([
          joyCon.getRequestDeviceInfo(),
          new Promise((r) => setTimeout(() => r(null), 1500)),
        ]);
        if (devInfo?.firmwareVersion) {
          info.firmware = `${devInfo.firmwareVersion.major}.${devInfo.firmwareVersion.minor}`;
          if (devInfo.type) info.typeName = devInfo.type;
        }
      } catch {
        /* optional */
      }
      try {
        // Player LED 1 on to show which pad is linked; Right Joy-Con gets a home LED pulse.
        await joyCon.setLEDState(0x01);
      } catch {
        /* optional */
      }
      this.emit('change');
    })();
  }

  _detach(joyCon, reason) {
    const info = this.devices.get(joyCon);
    if (!info) return;
    try {
      joyCon.removeEventListener('hidinput', info.listener);
    } catch {
      /* ignore */
    }
    this.devices.delete(joyCon);
    if (this.primaryKey === info.key) {
      const next = this.devices.values().next().value;
      this.primaryKey = next ? next.key : null;
    }
    this.emit('disconnected', info, reason);
    this.emit('change');
  }

  _onPacket(info, detail) {
    if (!detail) return;
    const now = performance.now();
    // Battery level arrives in 0x21 and 0x30 reports.
    if (detail.batteryLevel?.level) info.battery = detail.batteryLevel.level;

    // Buttons (edge detection)
    const bs = detail.buttonStatus;
    if (bs && typeof bs === 'object') {
      for (const name of BUTTON_NAMES) {
        const pressed = bs[name] === true;
        if (pressed !== info.buttons[name]) {
          info.buttons[name] = pressed;
          if (pressed) this.emit('button', name, info);
        }
      }
    }

    // Only 0x30 reports carry IMU data.
    const hasImu = Array.isArray(detail.gyroscopes) && Array.isArray(detail.accelerometers);
    if (!hasImu) return;
    info.gyroOk = detail.gyroscopes.length > 0;
    info.accelOk = detail.accelerometers.length > 0;
    info.lastReportAt = now;
    info.reportCount++;
    info._rateWindowCount++;
    const elapsed = now - info._rateWindowStart;
    if (elapsed >= 1000) {
      info.reportRate = (info._rateWindowCount * 1000) / elapsed;
      info._rateWindowCount = 0;
      info._rateWindowStart = now;
    }
    this.emit('imu', detail, info, now);
  }
}
