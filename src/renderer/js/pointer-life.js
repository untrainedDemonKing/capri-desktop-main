// Reading the pointer for her (heart.js): is it being shaken about, back and forth and fast?

const STROKE_PX = 45;   // a turn counts when the pointer came back this far from where it turned
const TURNS = 4;        // this many turns...
const WINDOW_MS = 1300; // ...this fast, and it is a shake

export class Shake {
  constructor({ stroke = STROKE_PX, turns = TURNS, window = WINDOW_MS } = {}) {
    this.stroke = stroke;
    this.need = turns;
    this.window = window;
    this.reset();
  }

  reset() {
    this.x = null;      // the last x seen
    this.dir = 0;       // the way it is going: -1 left, 1 right
    this.extreme = 0;   // the far end of the stroke it is on
    this.turns = [];    // when it turned
  }

  // The pointer is at `x` (any move, anywhere). True when that makes a shake (and then it starts counting over).
  move(x, now = performance.now()) {
    if (this.x === null) {
      this.x = this.extreme = x;
      return false;
    }
    const dx = x - this.x;
    this.x = x;
    if (dx === 0) return false;
    const dir = Math.sign(dx);
    if (!this.dir || dir === this.dir) {
      this.dir = dir;
      this.extreme = x; // still going the same way: the far end moves on
      return false;
    }
    if (Math.abs(x - this.extreme) < this.stroke) return false; // a twitch, not a turn
    this.dir = dir;
    this.extreme = x;
    this.turns = [...this.turns.filter((t) => now - t < this.window), now];
    if (this.turns.length < this.need) return false;
    this.turns = [];
    return true;
  }
}
