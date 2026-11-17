/**
 * Coordinates are local to the shaft: x ∈ [-6, 6] (left → right), y = height (0 at top, negative down).
 * shelf: { x0, x1, y, move?: { amp, speed, phase? }, goal?: true }   (y = top surface)
 * saw:   { type: 'static', x, y, r }
 *        { type: 'line',   x, y, x2, y2, r, speed, phase? }   ping-pong between the two points
 *        { type: 'orbit',  x, y, radius, r, speed, phase? }   circles around (x, y)
 * sign:  { x, y, text }
 * paper = starting drink (m), hitLoss = drink lost per saw hit, parTime = seconds for 3 stars.
 */
export const SHAFT_WIDTH = 12;

export const DROP_LEVELS = [
  {
    id: 1, name: 'First Drop', subtitle: 'Roll, drop, repeat', paper: 110, hitLoss: 10, parTime: 24,
    start: { x: -4.5, y: 0 },
    theme: { wall: '#ffe9f4', grout: '#ffc6df', shelf: '#7fd0ff', shelfTop: '#e6f6ff', side: '#ff9fc8', skyTop: '#7ec8ff', skyBottom: '#ffe3f1', fog: '#ffe9f3' },
    shelves: [
      { x0: -6, x1: 2, y: 0 },
      { x0: -2, x1: 6, y: -5 },
      { x0: -6, x1: 3, y: -10 },
      { x0: -3, x1: 6, y: -15 },
      { x0: -6, x1: 2, y: -20 },
      { x0: -6, x1: 6, y: -26, goal: true },
    ],
    saws: [
      { type: 'line', x: 0.5, y: -10.4, x2: 0.5, y2: -7.3, r: 0.7, speed: 1.1 },
      { type: 'static', x: 5.2, y: -12.4, r: 0.7 },
    ],
    signs: [
      { x: -3, y: 2.3, text: 'Spin the roll\nto roll →' },
      { x: 3.2, y: -2.6, text: 'Drop through\nthe gaps!' },
      { x: -3, y: -7.6, text: 'Wait for the\nsaw to rise' },
      { x: 2.5, y: -12.6, text: 'Too fast =\nouch!' },
      { x: 0, y: -23.4, text: 'Almost there!' },
    ],
  },
  {
    id: 2, name: 'Saw Tower', subtitle: 'Timing and speed control', paper: 160, hitLoss: 12, parTime: 40,
    start: { x: -4.5, y: 0 },
    theme: { wall: '#fff3dc', grout: '#ffd79a', shelf: '#ff9f7a', shelfTop: '#fff0e2', side: '#b98cff', skyTop: '#9a8cff', skyBottom: '#ffd9c2', fog: '#ffe0cf' },
    shelves: [
      { x0: -6, x1: 1.5, y: 0 },
      { x0: -2, x1: 6, y: -5.5 },
      { x0: -6, x1: 2.5, y: -10.5 },
      { x0: -1.5, x1: 1.5, y: -15, move: { amp: 3, speed: 0.7 } },
      { x0: -6, x1: -1, y: -20 },
      { x0: 1, x1: 6, y: -20 },
      { x0: -6, x1: 3, y: -25.5 },
      { x0: -3, x1: 6, y: -31 },
      { x0: -6, x1: 6, y: -37, goal: true },
    ],
    saws: [
      { type: 'static', x: 4.4, y: -3.2, r: 0.8 },
      { type: 'line', x: -0.5, y: -10.9, x2: -0.5, y2: -7.9, r: 0.7, speed: 1.4 },
      { type: 'orbit', x: 0, y: -19.0, radius: 1.7, r: 0.5, speed: 1.6 },
      { type: 'line', x: 1.4, y: -25.9, x2: 1.4, y2: -22.9, r: 0.7, speed: 1.8 },
      { type: 'line', x: 2, y: -31.4, x2: 2, y2: -28.4, r: 0.65, speed: 1.7 },
      { type: 'line', x: -1, y: -31.4, x2: -1, y2: -28.4, r: 0.65, speed: 1.7, phase: -0.8 },
    ],
    signs: [
      { x: -3, y: 2.3, text: 'Saw Tower' },
      { x: -3.2, y: -13, text: 'Ride the\nmoving shelf' },
    ],
    // Collectible red stars (added for Sync Challenge): x, y = star centre (shelf top + 0.65).
    stars: [
      { x: -1.5, y: 0.65 },
      { x: 0.5, y: -4.85 },
      { x: 1.5, y: -9.85 },
      { x: -3.5, y: -19.35 }, // only on the left shelf: a route choice
      { x: 0.5, y: -30.35 }, // between the two saws
    ],
  },
  {
    id: 3, name: 'Grand Descent', subtitle: 'Everything at once', paper: 220, hitLoss: 14, parTime: 58,
    start: { x: -4.5, y: 0 },
    theme: { wall: '#e4fff2', grout: '#a6ebcb', shelf: '#4fc59a', shelfTop: '#e9fff5', side: '#ff8fb8', skyTop: '#3d4bb8', skyBottom: '#ff9ec4', fog: '#f7a8c8' },
    shelves: [
      { x0: -6, x1: 0, y: 0 },
      { x0: -1, x1: 6, y: -5 },
      { x0: -6, x1: 1, y: -10 },
      { x0: -1, x1: 1, y: -14.5, move: { amp: 3.4, speed: 0.9 } },
      { x0: 4, x1: 6, y: -14.5 },
      { x0: -6, x1: -1.2, y: -19.5 },
      { x0: 1.2, x1: 6, y: -19.5 },
      { x0: -4, x1: 6, y: -25 },
      { x0: -6, x1: 2, y: -30.5 },
      { x0: -2.5, x1: 6, y: -35.5 },
      { x0: -6, x1: -0.5, y: -41 },
      { x0: 1.5, x1: 6, y: -41 },
      { x0: -3, x1: 6, y: -47 },
      { x0: -6, x1: 6, y: -53, goal: true },
    ],
    saws: [
      { type: 'static', x: 2.8, y: -2.4, r: 0.8 },
      { type: 'line', x: 3, y: -5.4, x2: 3, y2: -2.6, r: 0.7, speed: 1.6 },
      { type: 'orbit', x: -2.5, y: -9.2, radius: 1.3, r: 0.5, speed: 2 },
      { type: 'static', x: -3.8, y: -17.4, r: 0.7 },
      { type: 'static', x: 3.8, y: -17.4, r: 0.7 },
      { type: 'line', x: -1, y: -25.4, x2: -1, y2: -22.4, r: 0.65, speed: 2 },
      { type: 'line', x: 2.4, y: -25.4, x2: 2.4, y2: -22.4, r: 0.65, speed: 2, phase: 0.9 },
      { type: 'orbit', x: -0.5, y: -29.6, radius: 1.2, r: 0.5, speed: 2.2 },
      { type: 'line', x: 1, y: -35.9, x2: 1, y2: -32.9, r: 0.65, speed: 2 },
      { type: 'line', x: -1.2, y: -35.9, x2: -1.2, y2: -32.9, r: 0.65, speed: 2, phase: -0.9 },
      { type: 'orbit', x: 0.5, y: -40.2, radius: 1.5, r: 0.55, speed: 1.8 },
      { type: 'line', x: 0.5, y: -47.4, x2: 0.5, y2: -44.4, r: 0.7, speed: 2.2 },
    ],
    signs: [
      { x: -3, y: 2.3, text: 'Grand Descent' },
      { x: 0, y: -50.4, text: 'GOAL below!' },
    ],
  },
];
