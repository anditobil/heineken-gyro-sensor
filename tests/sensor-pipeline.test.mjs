// Offline tests of the motion pipeline with hand-written, deterministic sample sequences
// shaped like joy-con-webhid 0x30 "hidinput" packets (gyroscopes[3][3].dps,
// accelerometers[3].{x,y,z}.acc). This checks the math only. It is NOT a substitute for
// testing with a real Joy-Con or phone ("verified with synthetic data only").
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { settings, CONSTANTS } = await import('../src/core/Config.js');
const { applyDeadZone } = await import('../src/core/MathUtils.js');
const { GyroCalibration } = await import('../src/controller/GyroCalibration.js');
const { SensorProcessor } = await import('../src/controller/SensorProcessor.js');
const { TiltTracker, tiltToCommand } = await import('../src/controller/TiltTracker.js');

const BIAS = { x: 2.4, y: -1.1, z: 0.7 }; // typical Joy-Con zero-rate offset (°/s)
const REPORT_MS = 1000 / 66; // Joy-Con 0x30 report rate
// Deterministic "noise": a fixed repeating pattern, ±0.5 °/s.
const PATTERN = [0.3, -0.2, 0.5, -0.4, 0.1, -0.5, 0.2, 0.4, -0.3, 0.0];

let t = 1000;
let k = 0;
function packet(spin = { x: 0, y: 0, z: 0 }, acc = { x: 0, y: 0, z: 1 }, bias = BIAS) {
  const gyroscopes = [], accelerometers = [];
  for (let i = 0; i < 3; i++) {
    const n = PATTERN[k++ % PATTERN.length];
    gyroscopes.push([{ dps: bias.x + spin.x + n }, { dps: bias.y + spin.y - n }, { dps: bias.z + spin.z + n * 0.5 }]);
    accelerometers.push({ x: { acc: acc.x }, y: { acc: acc.y }, z: { acc: acc.z } });
  }
  return { gyroscopes, accelerometers };
}

function fresh() {
  settings.resetGroup('gyro');
  const cal = new GyroCalibration();
  const sp = new SensorProcessor(settings, cal);
  return { cal, sp };
}

/** Feed `seconds` of packets; spin may be a function of the packet index. */
function feed(sp, seconds, spin, acc) {
  const n = Math.round((seconds * 1000) / REPORT_MS);
  for (let i = 0; i < n; i++) {
    t += REPORT_MS;
    sp.process(packet(typeof spin === 'function' ? spin(i) : spin, acc), t);
  }
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ───────────────────────── applyDeadZone ─────────────────────────
test('applyDeadZone: inside dead zone → 0', () => {
  assert.equal(applyDeadZone(0, 14, 420), 0);
  assert.equal(applyDeadZone(14, 14, 420), 0);
  assert.equal(applyDeadZone(-13.9, 14, 420), 0);
});
test('applyDeadZone: linear rescale and sign', () => {
  assert.equal(applyDeadZone(420, 14, 420), 1);
  assert.equal(applyDeadZone(-420, 14, 420), -1);
  assert.ok(Math.abs(applyDeadZone(217, 14, 420) - 0.5) < 1e-9);
  assert.ok(Math.abs(applyDeadZone(-24, 14, 34) + 0.5) < 1e-9);
});
test('applyDeadZone: continuous at the edge (no jump)', () => {
  assert.ok(applyDeadZone(14.01, 14, 420) < 0.001);
});

// ───────────────────────── bias capture ─────────────────────────
test('bias capture: still roll → bias ≈ true bias', () => {
  const { cal, sp } = fresh();
  cal.startStill({ durationMs: 2000 });
  feed(sp, 2.3);
  assert.equal(cal.calibrated, true, cal.message);
  for (const a of ['x', 'y', 'z']) assert.ok(Math.abs(cal.bias[a] - BIAS[a]) < 0.15, `bias.${a}=${cal.bias[a]}`);
});
test('bias capture: rejected when the roll is wobbling (noise > 4 °/s)', () => {
  const { cal, sp } = fresh();
  let failed = null;
  cal.on('failed', (m) => { failed = m; });
  cal.startStill({ durationMs: 2000 });
  feed(sp, 2.3, (i) => ({ x: 0, y: i % 2 ? 25 : -25, z: 0 }));
  assert.equal(cal.calibrated, false);
  assert.match(failed || '', /motion/i);
});
test('bias capture: rejected when slowly turning (mean > 10 °/s)', () => {
  const { cal, sp } = fresh();
  let failed = null;
  cal.on('failed', (m) => { failed = m; });
  cal.startStill({ durationMs: 2000 });
  feed(sp, 2.3, { x: 30, y: 0, z: 0 });
  assert.equal(cal.calibrated, false);
  assert.match(failed || '', /turning/i);
});
test('bias capture: rejected early when clearly moving (> 120 °/s)', () => {
  const { cal, sp } = fresh();
  let failed = null;
  cal.on('failed', (m) => { failed = m; });
  cal.startStill({ durationMs: 2000 });
  feed(sp, 0.5, { x: 300, y: 0, z: 0 });
  assert.match(failed || '', /moved/i);
  assert.equal(cal.mode, 'idle');
});
test('bias capture (auto): silently ignored when moving, bias unchanged', () => {
  const { cal, sp } = fresh();
  let failed = false;
  cal.on('failed', () => { failed = true; });
  cal.startStill({ durationMs: 1500, auto: true });
  feed(sp, 1.8, (i) => ({ x: 0, y: i % 2 ? 25 : -25, z: 0 }));
  assert.equal(failed, false);
  assert.equal(cal.calibrated, false);
  assert.deepEqual(cal.bias, { x: 0, y: 0, z: 0 });
});

// ───────────────────────── spin-axis detection ─────────────────────────
function calibrated() {
  const env = fresh();
  env.cal.startStill({ durationMs: 2000 });
  feed(env.sp, 2.3);
  assert.equal(env.cal.calibrated, true);
  return env;
}
test('axis detection: roll forward around −Y → axis y, sign −1', () => {
  const { cal, sp } = calibrated();
  let r = null;
  cal.once('done', (x) => { r = x; });
  cal.startAxisDetect({ durationMs: 3000 });
  feed(sp, 3.2, { x: 0, y: -300, z: 0 });
  assert.ok(r, cal.message);
  assert.equal(r.axis, 'y');
  assert.equal(r.sign, -1);
});
test('axis detection: roll forward around +Z → axis z, sign +1', () => {
  const { cal, sp } = calibrated();
  let r = null;
  cal.once('done', (x) => { r = x; });
  cal.startAxisDetect({ durationMs: 3000 });
  feed(sp, 3.2, { x: 20, y: 0, z: 250 });
  assert.equal(r?.axis, 'z');
  assert.equal(r?.sign, 1);
});
test('axis detection: ambiguous rotation fails with a clear message', () => {
  const { cal, sp } = calibrated();
  let failed = null;
  cal.on('failed', (m) => { failed = m; });
  cal.startAxisDetect({ durationMs: 3000 });
  feed(sp, 3.2, { x: 200, y: 190, z: 0 });
  assert.match(failed || '', /ambiguous/i);
});
test('axis detection: too little rotation fails', () => {
  const { cal, sp } = calibrated();
  let failed = null;
  cal.on('failed', (m) => { failed = m; });
  cal.startAxisDetect({ durationMs: 3000 });
  feed(sp, 3.2, { x: 20, y: 0, z: 0 });
  assert.match(failed || '', /roll it further/i);
});

// ───────────────────────── command ─────────────────────────
test('command: resting → exactly 0 (still gate)', () => {
  const { sp } = calibrated();
  feed(sp, 1.0);
  assert.equal(sp.isStill, true);
  assert.equal(sp.command, 0);
});
test('command: forward spin → positive, proportional, reverse → negative', () => {
  const { cal, sp } = calibrated();
  cal.once('done', (r) => { settings.set('gyro', 'axis', r.axis); settings.set('gyro', 'axisSign', r.sign); });
  cal.startAxisDetect({ durationMs: 3000 });
  feed(sp, 3.2, { x: 0, y: -300, z: 0 });
  feed(sp, 1.0, { x: 0, y: -217, z: 0 });
  const half = sp.command;
  assert.ok(half > 0.4 && half < 0.6, `half=${half}`);
  feed(sp, 1.0, { x: 0, y: -600, z: 0 });
  assert.equal(sp.command, 1);
  feed(sp, 1.0, { x: 0, y: 300, z: 0 });
  assert.ok(sp.command < -0.6, `reverse=${sp.command}`);
  settings.set('gyro', 'invert', true);
  feed(sp, 1.0, { x: 0, y: 300, z: 0 });
  assert.ok(sp.command > 0.6, `inverted=${sp.command}`);
});
test('command: spin slower than the dead zone → 0', () => {
  const { sp } = calibrated();
  feed(sp, 1.0, { x: 10, y: 0, z: 0 });
  assert.equal(sp.command, 0);
});

// ───────────────────────── stale data ─────────────────────────
test(`stale data: no packet for > ${CONSTANTS.INPUT_STALE_MS} ms → command 0`, () => {
  const { sp } = calibrated();
  feed(sp, 1.0, { x: 300, y: 0, z: 0 });
  const last = sp.lastPacketAt;
  assert.ok(sp.command > 0.5);
  assert.equal(sp.getCommand(last + 100), sp.command);
  assert.equal(sp.getCommand(last + CONSTANTS.INPUT_STALE_MS), sp.command);
  assert.equal(sp.getCommand(last + CONSTANTS.INPUT_STALE_MS + 1), 0);
  assert.equal(sp.isLive(last + 1000), false);
});
test('stale data: never-connected processor → command 0', () => {
  const { sp } = fresh();
  assert.equal(sp.getCommand(5000), 0);
  assert.equal(sp.isLive(5000), false);
});

// ───────────────────────── drift compensation ─────────────────────────
test('drift compensation: bias follows a slow change while resting', () => {
  const { cal, sp } = calibrated();
  const drifted = { x: BIAS.x + 1.5, y: BIAS.y, z: BIAS.z };
  const n = Math.round(12000 / REPORT_MS);
  for (let i = 0; i < n; i++) {
    t += REPORT_MS;
    sp.process(packet(undefined, undefined, drifted), t);
  }
  assert.ok(Math.abs(cal.bias.x - drifted.x) < 0.4, `bias.x=${cal.bias.x}`);
  assert.equal(sp.command, 0);
});

// ───────────────────────── phone tilt ─────────────────────────
test('tilt → command: dead zone 3°, full at 25°', () => {
  assert.equal(tiltToCommand(0), 0);
  assert.equal(tiltToCommand(3), 0);
  assert.equal(tiltToCommand(-2.9), 0);
  assert.ok(Math.abs(tiltToCommand(14) - 0.5) < 1e-9);
  assert.equal(tiltToCommand(25), 1);
  assert.equal(tiltToCommand(-40), -1);
});
test('tilt tracker: right edge down → positive angle, relative to recenter pose', () => {
  const tr = new TiltTracker();
  let now = 0;
  const step = (acc) => { now += 16; tr.process({ x: 0, y: 0, z: 0 }, acc, now); };
  for (let i = 0; i < 200; i++) step({ x: 0, y: 0, z: 1 }); // flat
  tr.recenter();
  const a = (20 * Math.PI) / 180; // right edge 20° down: gravity "up" leans toward −x
  for (let i = 0; i < 200; i++) step({ x: -Math.sin(a), y: 0, z: Math.cos(a) });
  assert.ok(Math.abs(tr.delta() - 20) < 0.5, `delta=${tr.delta()}`);
  assert.ok(tiltToCommand(tr.delta()) > 0.7);
});

// ───────────────────────── run ─────────────────────────
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed (synthetic data only – not a hardware test)`);
process.exit(failed ? 1 : 0);
