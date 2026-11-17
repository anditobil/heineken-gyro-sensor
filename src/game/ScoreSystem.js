export const MAX_LIVES = 5;
const LIFE_BONUS = 300;
const STAR_BONUS = 200;

/** Run statistics + score. */
export class ScoreSystem {
  constructor() {
    this.reset(60);
  }

  reset(parTime) {
    this.time = 0;
    this.hits = 0;
    this.lives = MAX_LIVES;
    this.starsCollected = 0;
    this.starsTotal = 0;
    this.parTime = parTime;
  }

  tick(dt) {
    this.time += dt;
  }

  /**
   * lives = livesLeft × 300
   * time  = completed ? max(0, round((par × 1.6 − time) × 40)) : 0
   * clean = completed && hits == 0 ? 1000 : 0
   * stars = collected stars × 200 (also on game over)
   * stars: 1 on clear; 2 if time ≤ par × 1.25 and hits ≤ 2; 3 if time ≤ par and hits == 0
   */
  compute(completed) {
    const lives = completed ? this.lives * LIFE_BONUS : 0;
    const time = completed ? Math.max(0, Math.round((this.parTime * 1.6 - this.time) * 40)) : 0;
    const clean = completed && this.hits === 0 ? 1000 : 0;
    const starBonus = this.starsCollected * STAR_BONUS;
    const total = lives + time + clean + starBonus;
    let stars = 0;
    if (completed) {
      stars = 1;
      if (this.time <= this.parTime * 1.25 && this.hits <= 2) stars = 2;
      if (this.time <= this.parTime && this.hits === 0) stars = 3;
    }
    return { total, lives, time, clean, starBonus, depth: 0, stars };
  }
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
