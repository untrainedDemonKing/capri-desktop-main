// Her two small forms, each on its own little canvas, drawn on twos and only while on screen, and
// only redrawn when the drawing would actually change: they're what's left of her while she sleeps
// or is put away, so they cost next to nothing (a timer, not the screen's refresh; a couple of
// drawings a second for the float, more only while she winks, stirs or wakes).
//
// Mask: asleep a while, her mane and her body come apart and what's left is what she is at
// heart in the show, her green mask with its eyes, floating where she was, eyes shut. Now and
// then she cracks one open (her wink). A pointer coming over it stirs her (app.js wakes her).
//
// Chip: put away (Ctrl+Alt+C), she folds herself into her biochip (the one she's stored on in
// the show) and all that shows of her is her mask in the bottom-left corner, eyes shut. They
// open, blinking, while Claude is waiting on you. Click it and she comes back out (app.js).

import { COLORS, drawMask } from './fx.js';
import { rand, reducedMotion } from './util.js';

const STEP = 1000 / 12;

// A small canvas of its own, w x h css px, placed by its top-left corner.
class Small {
  constructor(canvas, w, h) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = w;
    this.h = h;
    this.visible = false;
    this.pointer = null; // set while the pointer is over it
    this.shownAt = 0;
    this.timer = 0;
    this.drawn = null; // what's on the canvas now (key()), so the same drawing isn't redrawn
    this.x = 0;
    this.y = 0;
  }

  moveTo(x, y) {
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(this.w * dpr)) {
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.canvas.style.width = `${this.w}px`;
      this.canvas.style.height = `${this.h}px`;
    }
    this.x = x;
    this.y = y;
    this.canvas.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  contains(x, y, pad = 8) {
    return x >= this.x - pad && x <= this.x + this.w + pad && y >= this.y - pad && y <= this.y + this.h + pad;
  }

  show() {
    if (this.visible) return;
    this.visible = true;
    this.canvas.hidden = false;
    this.shownAt = performance.now();
    this.drawn = null;
    this.tick();
  }

  hide() {
    this.visible = false;
    this.canvas.hidden = true;
    this.pointer = null;
    clearTimeout(this.timer);
    this.timer = 0;
  }

  // One look a drawing (on twos while something's going on, on fours while it just floats); the
  // canvas is only touched when the drawing changed.
  tick() {
    clearTimeout(this.timer);
    if (!this.visible) return;
    const now = performance.now();
    const frame = Math.floor(now / STEP);
    const key = this.key(now, frame);
    if (key !== this.drawn) {
      this.drawn = key;
      const dpr = window.devicePixelRatio || 1;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.clearRect(0, 0, this.w, this.h);
      this.draw(now, frame);
    }
    this.timer = setTimeout(() => this.tick(), this.busy ? STEP : STEP * 2);
  }

  // What the drawing at `now` depends on (subclasses); a changing key means a redraw.
  key(now, frame) {
    return frame;
  }

  // something's moving that needs every drawing (a pointer, a wink, waking): on twos then
  get busy() {
    return Boolean(this.pointer) || this.landing;
  }

  // it lands as a white silhouette, one drawing, like her impact frames
  get landing() {
    return performance.now() - this.shownAt < STEP * 1.5 && !reducedMotion.matches;
  }
}

// ---------- her mask, asleep ----------

export class Mask extends Small {
  constructor(canvas) {
    super(canvas, 140, 170);
    this.k = 0.66;
    this.wokeAt = 0;
    this.nextPeek = 0;
    this.peek = null; // { eye, until }
  }

  // Floating with the middle of her face at (x, y), k = how big (her size on screen).
  place(x, y, k) {
    this.k = k;
    this.cx = 70;
    this.cy = 110;
    this.moveTo(x - this.cx, y - this.cy);
  }

  show() {
    this.wokeAt = 0;
    this.nextPeek = performance.now() + rand(5000, 9000);
    super.show();
  }

  // eyes snap open: she's coming back
  wake() {
    this.wokeAt = performance.now();
    this.tick();
  }

  get busy() {
    return super.busy || Boolean(this.wokeAt) || Boolean(this.peek);
  }

  // her float (a step every half second), her wink, the pointer stirring her, waking (shaking)
  key(now, frame) {
    if (now > this.nextPeek && !this.peek) {
      this.peek = { eye: Math.random() < 0.5 ? 0 : 1, until: now + rand(700, 1100) };
      this.nextPeek = now + rand(7000, 14000);
    }
    if (this.peek && now > this.peek.until) this.peek = null;
    if (this.landing || this.wokeAt) return frame; // every drawing
    const bob = reducedMotion.matches ? 0 : Math.floor(frame / 6) % 4;
    const p = this.pointer ? `${Math.round(this.pointer.x / 4)},${Math.round(this.pointer.y / 4)}` : '';
    return `${bob}|${this.peek ? this.peek.eye : '-'}|${p}`;
  }

  draw(now, frame) {
    const { ctx } = this;
    const calm = reducedMotion.matches;
    const bob = calm ? 0 : [0, -1.5, -3, -1.5][Math.floor(frame / 6) % 4]; // a slow float, on twos
    if (this.landing) {
      drawMask(ctx, this.cx, this.cy, this.k, { flat: COLORS.paper });
      return;
    }
    let eyes = [0, 0], look = null;
    if (this.peek) eyes[this.peek.eye] = 0.45; // one eye cracked open, the wink
    if (this.pointer) {
      eyes = [0.35, 0.35]; // stirring
      look = { x: this.pointer.x - this.x, y: this.pointer.y - this.y };
    }
    if (this.wokeAt) {
      eyes = [1, 1];
      look = null;
    }
    const shake = this.wokeAt && !calm ? rand(-2, 2) : 0;
    drawMask(ctx, this.cx + shake, this.cy + bob, this.k, { eyes, look });
  }
}

// ---------- put away ----------

// bottom-left: the bottom-right corner is where the clock and the tray are, the pointer goes there all the time
const MARGIN = { left: 26, bottom: 22 };
const K = 0.6;

export class Chip extends Mask {
  constructor(canvas) {
    super(canvas);
    this.mode = 'idle'; // hers: idle | work | alert | sleep
  }

  // Bottom-left corner of a w x h screen.
  place(w, h) {
    super.place(MARGIN.left + 50 * K, h - MARGIN.bottom - 54 * K, K);
    this.face = { x: MARGIN.left + 50 * K, y: h - MARGIN.bottom - 54 * K };
  }

  center() {
    return { ...this.face };
  }

  // just the mask, spike and fang included
  contains(x, y, pad = 8) {
    const { x: fx, y: fy } = this.face;
    return x >= fx - 50 * K - pad && x <= fx + 50 * K + pad && y >= fy - 100 * K - pad && y <= fy + 54 * K + pad;
  }

  setMode(mode) {
    this.mode = mode;
    if (this.visible) this.tick(); // her eyes open (or shut) right away
  }

  get busy() {
    return Boolean(this.pointer) || this.landing || this.mode === 'alert';
  }

  key(now, frame) {
    if (this.landing || this.pointer) return frame; // the pointer over her: she twitches every drawing
    const bob = reducedMotion.matches ? 0 : Math.floor(frame / 6) % 4;
    const open = this.mode === 'alert' && (reducedMotion.matches || frame % 8 < 6);
    return `${bob}|${open}`;
  }

  draw(now, frame) {
    const { ctx } = this;
    const calm = reducedMotion.matches;
    if (this.landing) {
      drawMask(ctx, this.cx, this.cy, this.k, { flat: COLORS.paper });
      return;
    }
    const bob = calm ? 0 : [0, -1.5, -3, -1.5][Math.floor(frame / 6) % 4];
    // eyes shut; open, blinking, while Claude is waiting on you
    const eyes = this.mode === 'alert' && (calm || frame % 8 < 6) ? [1, 1] : [0, 0];
    const shake = this.pointer && !calm ? rand(-1, 1) : 0; // the pointer over her: she twitches
    drawMask(ctx, this.cx + shake, this.cy + bob, this.k, { eyes });
  }
}
