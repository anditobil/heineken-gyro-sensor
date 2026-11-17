import { gsap } from 'gsap';
import { brandUrl } from './Brand.js';

const MAX_TILT = 10; // degrees of board tilt at full input
const CX = 740; // board centre (viewBox units)
const BOARD_HALF = 400; // how far the mini can can slide from the centre

const INK = '#0b5d1a'; // outline colour of the gloves
/** Glove lying flat on top of the board, fingers pointing +x, wrist at (0,0), arm toward −x. */
const HAND_TOP = `
  <path d="M-170,-30 L0,-30 C40,-36 92,-34 128,-24 C156,-16 180,-8 186,2 C190,12 178,18 150,16
           L70,18 C46,30 22,34 0,32 L-170,32 Z" fill="#fff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M0,-30 L0,32" stroke="${INK}" stroke-width="4"/>
  <path d="M120,-6 C140,-2 160,2 176,6 M112,6 C130,8 148,10 162,12" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`;
/** Glove gripping the front edge from below: palm underneath, fingers curling up. */
const HAND_GRIP = `
  <path d="M-190,-44 L0,-44 C46,-46 96,-44 126,-36 C146,-58 164,-74 184,-70 C200,-66 200,-48 190,-34
           C186,-12 176,14 150,28 C112,44 52,48 0,44 L-190,44 Z" fill="#fff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M0,-44 L0,44" stroke="${INK}" stroke-width="4"/>
  <path d="M150,-30 C168,-26 178,-16 180,-2 M132,-10 C152,-6 162,4 164,18 M108,8 C126,12 136,22 138,34"
        fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`;

/**
 * The hands holding the board, under the game box. It mirrors the controller:
 * the board tilts with the current move input (right = right side down), and the
 * little can on the board slides to the same relative spot as the can in the game.
 * Hands, board and can are generic vector art; an official image can replace the mini can
 * (public/brand/can-side.png / .svg).
 */
export class ControllerVisual {
  constructor(el) {
    this.el = el;
    el.innerHTML = `
      <svg viewBox="0 0 1410 380" class="cv-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <linearGradient id="cv-alu" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#0d4f1d"/><stop offset="0.35" stop-color="#2fa043"/>
            <stop offset="0.6" stop-color="#1b7a2e"/><stop offset="1" stop-color="#0a3f17"/>
          </linearGradient>
          <radialGradient id="cv-lid" cx="0.4" cy="0.35" r="0.7">
            <stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#cdd4dc"/><stop offset="1" stop-color="#8e98a4"/>
          </radialGradient>
        </defs>
        <g id="cv-rig">
          <!-- board: dark top face + neon front face -->
          <path d="M180,262 L1300,222 L1346,122 L330,166 Z" fill="#2a8a1c"/>
          <path d="M180,262 L1300,222 L1302,280 L182,322 Z" fill="#00e400"/>
          <path d="M180,262 L1300,222" stroke="#5cff3a" stroke-width="3"/>
          <!-- mini can lying on the board, lid toward the viewer (same pose as the can in the game) -->
          <g id="cv-can" transform="translate(${CX},0)">
            <g class="cv-can-generic" transform="translate(-60,0)">
              <ellipse cx="30" cy="222" rx="74" ry="10" fill="#14560f" opacity="0.5"/>
              <g transform="rotate(-28 0 180)">
                <path d="M-46,80 L-46,180 L46,180 L46,80 Q46,62 0,62 Q-46,62 -46,80 Z" fill="url(#cv-alu)" stroke="#0a3d17" stroke-width="2"/>
                <path d="M-46,92 Q0,104 46,92" fill="none" stroke="#e3e8ee" stroke-width="7"/>
                <path d="M-28,96 L-28,168" stroke="#9cf0a8" stroke-width="7" stroke-linecap="round" opacity="0.5"/>
              </g>
              <circle cx="0" cy="180" r="48" fill="#1f9a3c" stroke="#0a3d17" stroke-width="2.5"/>
              <circle cx="0" cy="180" r="38" fill="url(#cv-lid)"/>
              <circle cx="0" cy="180" r="30" fill="none" stroke="#7d8894" stroke-width="2.5" opacity="0.7"/>
              <ellipse cx="0" cy="164" rx="11" ry="7" fill="none" stroke="#6f7a86" stroke-width="3.5"/>
              <ellipse cx="0" cy="190" rx="9" ry="6" fill="#2b3038" opacity="0.8"/>
            </g>
            <image class="cv-can-brand" x="-120" y="70" width="200" height="170" preserveAspectRatio="xMidYMid meet" style="display:none"/>
          </g>
          <!-- hands: one on top and one gripping from below, on each side -->
          <g transform="translate(205,170) rotate(6)">${HAND_TOP}</g>
          <g transform="translate(118,292) rotate(-6)">${HAND_GRIP}</g>
          <g transform="translate(1370,96) rotate(-10) scale(-1,1)">${HAND_TOP}</g>
          <g transform="translate(1335,250) rotate(4) scale(-1,1)">${HAND_GRIP}</g>
        </g>
      </svg>`;
    this.rig = el.querySelector('#cv-rig');
    this.can = el.querySelector('#cv-can');
    gsap.set(this.rig, { svgOrigin: `${CX} 240` });
    gsap.set(this.can, { x: CX });
    this._tilt = gsap.quickTo(this.rig, 'rotation', { duration: 0.35, ease: 'power3.out' });
    this._slide = gsap.quickTo(this.can, 'x', { duration: 0.25, ease: 'power2.out' });

    brandUrl('can-side').then((src) => {
      if (!src) return;
      const img = el.querySelector('.cv-can-brand');
      img.setAttribute('href', src);
      img.style.display = '';
      el.querySelector('.cv-can-generic').style.display = 'none';
    });
  }

  /**
   * @param move  −1..1 current input (right = +)
   * @param x     can x in the shaft (−6..6), mapped onto the board
   */
  update(move, x) {
    this._tilt(move * MAX_TILT);
    this._slide(CX + Math.max(-1, Math.min(1, x / 5.5)) * BOARD_HALF);
  }

  /** Back to level, centred (between runs). */
  reset() {
    gsap.set(this.rig, { rotation: 0 });
    gsap.set(this.can, { x: CX });
  }
}
