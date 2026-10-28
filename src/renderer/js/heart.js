// Where her feelings (mood.js) meet the rest of her: her body and her glow (capri.js), her face and
// the mood chip on her panel (panel.js), her blips (voice.js), her colours when they follow her
// mood (themes.js), and what her chat model is told. Also what the pointer does to her: poking
// her over and over makes her angry, sweeping it back and forth over her tickles her, and resting
// it on her head (a head pat) flusters her. And what she makes of it otherwise: where on her you clicked,
// two clicks in a row, the pointer shaken about or left to rest by her, her being carried and put down. With
// no AI to answer her yet, she says so (and offers the way to fix it) instead of staying silent.

import { Mood, FACE } from './mood.js';
import { lifeLines } from './lines-life.js';
import { pick, fmt } from './util.js';
import { Shake } from './pointer-life.js';
import * as marks from './fx-life.js';

const TICK_MS = 4000;
const TICKLE_PASSES = 6;      // the pointer in and out of her this many times...
const TICKLE_WINDOW = 1400;   // ...this fast, and it tickles
const PAT_MS = 1600;          // the pointer moving on her head this long: a head pat
const COOLDOWN = 8000;
const NEAR_PX = 230;          // "by her": the pointer within this of her head
const LINGER_MS = 9000;       // resting there this long, she remarks on it
const REMARK_GAP = 25000;     // between two remarks of hers about the pointer
const SAMPLE_MS = 12;         // the pointer is looked at this often at most (a mouse reports a thousand times a second)
const DOUBLE_MS = 380;        // two clicks this close are a double click
const CARRY_MS = 2200;        // carried about this long
const NOAI_FIRST = 4 * 60000; // with no AI: the first word about it, this long after she starts...
const NOAI_EVERY = 10 * 60000; // ...then this often...
const NOAI_MAX = 5;           // ...and no more than this many times a run

export class Heart {
  constructor({ capri, panel, voice, brain, host }) {
    this.capri = capri;
    this.panel = panel;
    this.voice = voice;
    this.brain = brain;
    this.host = host;
    this.mood = new Mood();
    this.enabled = true;     // her menu: Emotions
    this.onMood = null;      // (state) => void: app.js (her colours, her voice's mood, the tray)
    this.hover = { on: false, passes: [], patStart: 0, patLast: 0 };
    this.calmUntil = 0;      // no pointer reactions until then
    this.grudgeShown = false;
    this.aiReady = true;     // app.js: false while her chat has nothing to answer with
    this.onConnect = null;   // () => void: the "Connect" button of what she says then (her main menu)
    this.shake = new Shake();
    this.at = null;          // the pointer: { x, y, since, near, told } (moved())
    this.sampledAt = -Infinity;
    this.lastRemark = 0;
    this.lastTap = 0;
    this.noAiAt = performance.now() + NOAI_FIRST - NOAI_EVERY;
    this.noAiTold = 0;
  }

  get t() {
    return lifeLines(this.brain.lang).mood;
  }

  start() {
    this.mood.onChange((state) => this.show(state));
    this.show(this.mood.state());
    setInterval(() => {
      this.mood.tick();
      this.watch();
    }, TICK_MS);
  }

  configure(cfg) {
    const was = this.enabled;
    this.enabled = cfg.emotions !== false;
    if (was !== this.enabled) this.show(this.mood.state());
  }

  get state() {
    return this.enabled ? this.mood.state() : { mood: 'calm', level: 0, values: {}, affection: 0 };
  }

  // Her mood, shown everywhere it shows.
  show(state) {
    const { mood, level } = this.enabled ? state : { mood: 'calm', level: 0 };
    this.capri.setMood(mood, level);
    this.voice.mood = mood;
    this.panel.setMood?.(mood, mood === 'calm' ? '' : this.t.label[mood] || '');
    this.onMood?.({ ...state, mood, level });
  }

  // A message you sent her: her feelings move, and she shows it right away (before her answer).
  // Returns { tags, reaction, mood, level }.
  feel(text) {
    if (!this.enabled) return { tags: [], reaction: null, mood: 'calm', level: 0 };
    const felt = this.mood.feel(text);
    if (felt.reaction) this.capri.react(felt.reaction, this.towardPointer());
    if (felt.reaction === 'rage') this.zapLater();
    return felt;
  }

  // The mood her AI answered with ([[mood: x]]): her face for it, a nudge to her feelings, and her
  // body if it's something to act out. `already`: the reaction she had to your message (no double).
  answered(tag, { already = null } = {}) {
    const expr = this.enabled ? this.mood.answered(tag) : null;
    if (!expr) return null;
    const act = { laugh: 'laugh', shy: 'shy', surprised: 'startle', smug: 'smug', angry: 'huff', sad: 'hurt' }[expr];
    const same = already && ({ laugh: ['giggle', 'laugh'], shy: ['shy'], angry: ['rage', 'huff', 'pout'], sad: ['hurt'] }[expr] || []).includes(already);
    if (act && !same) this.capri.react(act, this.towardPointer());
    return expr;
  }

  face(expr) {
    return FACE[expr] || FACE[this.mood.mood] || 'look';
  }

  // What her chat model is told about how she feels.
  describe() {
    return this.enabled ? this.mood.describe() : '';
  }

  event(name) {
    if (this.enabled) this.mood.event(name);
  }

  // A line for clicking her with nothing going on, by mood (null: her usual idle lines).
  idleLine() {
    if (!this.enabled) return null;
    // still cross from last time: she says so, once
    if (this.mood.grudge && !this.grudgeShown) {
      this.grudgeShown = true;
      return { line: pick(this.t.grudge), face: 'look' };
    }
    const lines = this.t.idle[this.mood.mood];
    return lines && Math.random() < 0.75 ? { line: pick(lines), face: this.face(this.mood.mood) } : null;
  }

  // ---------- the pointer ----------

  // You clicked her. True if she did something about it (poked too many times), so nothing else
  // happens for that click.
  poke() {
    if (!this.enabled) return false;
    const reaction = this.mood.poke();
    if (!reaction) return false;
    this.capri.react(reaction, this.towardPointer());
    const line = pick(reaction === 'rage' ? this.t.pokeRage : this.t.poke);
    this.panel.say({ kind: reaction === 'rage' ? 'error' : 'info', face: reaction === 'rage' ? 'many' : 'look', line, hold: 2600 });
    if (reaction === 'rage') this.zapLater();
    return true;
  }

  // She was dragged and let go (`ms`: how long she was carried; `where`: 'window' if she was put down on one):
  // dizzy after a few in a row, otherwise now and then a word about it.
  dragged({ ms = 0, where = 'floor' } = {}) {
    if (!this.enabled) return;
    if (this.mood.dragged() === 'dizzy') {
      setTimeout(() => {
        this.capri.react('dizzy');
        this.panel.say({ kind: 'info', face: 'wide', line: pick(this.t.dizzy), hold: 3200 });
      }, 700);
      return;
    }
    if (Math.random() > 0.45) return;
    const m = this.t.mouse;
    const lines = ms > CARRY_MS ? m.carry : Math.random() < 0.35 ? m.grab : where === 'window' ? m.dropWindow : m.dropFloor;
    setTimeout(() => this.remark({ line: pick(lines), face: 'look' }), 800);
  }

  // ---------- what the pointer is up to (not just over her) ----------

  // Quiet enough for a word of hers about the pointer: nothing going on, nothing on show.
  calm(now = performance.now()) {
    const c = this.capri;
    return this.enabled && now >= this.calmUntil && now - this.lastRemark >= REMARK_GAP
      && c.mode === 'idle' && !c.busy && !c.dragging && !c.stowed && !c.dormant && !c.hidden && !c.sky && !c.pointing
      && (c.stance === 'stand' || c.stance === 'sit') && !this.panel.visible && !this.brain.busySessions?.length;
  }

  // Says it, if it is a good moment (or `force`). { line, face, hold, actions, onAction } -> whether she did.
  remark(msg, { force = false, now = performance.now() } = {}) {
    if (!force && !this.calm(now)) return false;
    this.lastRemark = now;
    return this.panel.say({ kind: 'info', face: 'look', hold: 3600, ...msg });
  }

  // The pointer moved anywhere on her screen (app.js): shaken about, or coming up to her.
  moved(x, y, now = performance.now()) {
    if (!this.enabled || now - this.sampledAt < SAMPLE_MS) return;
    this.sampledAt = now;
    const h = this.capri.head();
    const near = Math.hypot(x - h.x, y - h.y) < NEAR_PX;
    const was = this.at;
    if (!was || Math.abs(x - was.x) + Math.abs(y - was.y) > 6) {
      this.at = { x, y, since: now, near, told: false };
      if (near && was && !was.near && Math.random() < 0.2) this.remark({ line: pick(this.t.mouse.near), face: 'smug' }, { now });
    }
    if (this.shake.move(x, now) && Math.random() < 0.7) {
      if (this.remark({ line: pick(this.t.mouse.shake), face: 'wide' }, { now }) && this.capri.stance === 'stand' && this.mood.mood !== 'angry') this.capri.react('startle', this.towardPointer());
    }
  }

  // Every few seconds: the pointer left to rest by her, and with no AI, a word about it now and then.
  watch(now = performance.now()) {
    if (!this.enabled) return;
    const at = this.at;
    // (still by her? she may have gone somewhere else while the pointer rested)
    const h = at && this.capri.head();
    const near = Boolean(at) && Math.hypot(at.x - h.x, at.y - h.y) < NEAR_PX;
    if (near && !at.told && now - at.since >= LINGER_MS && this.calm(now)) {
      at.told = true;
      const angry = this.mood.mood === 'angry';
      this.remark({ line: pick(angry ? this.t.mouse.lingerAngry : this.t.mouse.linger), face: angry ? 'many' : 'smug' }, { now });
      return;
    }
    if (!this.aiReady && this.noAiTold < NOAI_MAX && now - this.noAiAt >= NOAI_EVERY && this.calm(now)) {
      this.noAiAt = now;
      this.noAiTold++;
      this.remark(this.noAiLine('chatter'), { now });
    }
  }

  // What she says with no AI to answer: `kind` 'click' or 'chatter', and the button that opens her main menu.
  noAiLine(kind) {
    const n = this.t.noAi;
    return {
      line: pick(n[kind]),
      face: 'aside',
      hold: 7000,
      actions: [{ id: 'connect', label: n.button, primary: true }],
      onAction: (id) => {
        this.panel.hide();
        if (id === 'connect') this.onConnect?.();
      },
    };
  }

  // You clicked her (app.js, after poke()): true if it is the second click of a double click.
  tapped(now = performance.now()) {
    const double = now - this.lastTap < DOUBLE_MS;
    this.lastTap = double ? 0 : now;
    return double;
  }

  // What she says for a click with nothing going on, by where it landed (`zone`: head, legs or body) and whether
  // it was a double click; null if she has nothing special (her usual lines then).
  clickLine({ zone = 'body', double = false } = {}) {
    if (!this.enabled) return null;
    const m = this.t.mouse;
    if (double) return { line: pick(m.doubleClick), face: 'look' };
    if (!this.aiReady && Math.random() < 0.5) return this.noAiLine('click');
    if (zone !== 'body' && Math.random() < 0.7) return { line: pick(zone === 'head' ? m.headClick : m.legsClick), face: zone === 'head' ? 'wide' : 'look' };
    return Math.random() < 0.3 ? { line: pick(m.bodyClick), face: 'look' } : null;
  }

  // The pointer moved (app.js), over her body (`on`) or not, and over her head (`head`).
  pointer(on, head, now = performance.now()) {
    if (!this.enabled || now < this.calmUntil || this.capri.busy || this.capri.dragging) return;
    const h = this.hover;
    if (on !== h.on) {
      h.on = on;
      h.passes = [...h.passes.filter((t) => now - t < TICKLE_WINDOW), now];
      if (h.passes.length >= TICKLE_PASSES) {
        h.passes = [];
        this.tickled();
        return;
      }
    }
    // a head pat: the pointer moving on her head, without leaving it, for a moment
    if (head) {
      if (!h.patStart || now - h.patLast > 400) h.patStart = now;
      h.patLast = now;
      if (now - h.patStart > PAT_MS) {
        h.patStart = 0;
        this.patted();
      }
    } else {
      h.patStart = 0;
    }
  }

  tickled() {
    this.calmUntil = performance.now() + COOLDOWN;
    this.mood.event('tickled');
    this.capri.react(Math.random() < 0.45 ? 'laugh' : 'giggle');
    this.panel.say({ kind: 'info', face: 'laugh', line: pick(this.t.tickle), hold: 2600 });
  }

  patted() {
    this.calmUntil = performance.now() + COOLDOWN * 2;
    const angry = this.mood.mood === 'angry';
    this.mood.event('petted');
    if (angry) {
      // still angry: she shakes it off, but it helps a little
      this.mood.apply({ anger: -0.12 });
      this.mood.changed();
      this.capri.react('pout');
      return;
    }
    this.capri.react('shy');
    const h = this.capri.head();
    marks.heart(this.capri.fx, h.x, h.top + 30, { scale: this.capri.scale * 1.5 });
    this.voice.play('shy');
  }

  // When she blows up, she zaps your pointer a moment later (if it's on her screen).
  zapLater() {
    setTimeout(async () => {
      const at = await this.host.cursor().catch(() => null);
      if (at?.inside) this.capri.zap(at.x, at.y);
    }, 1300);
  }

  towardPointer() {
    const m = this.capri.mouse;
    return m ? (m.x < this.capri.pos.x ? -1 : 1) : this.capri.towardCenter();
  }

  // Her mood in a line for when her chat can't answer (no AI set up), by reaction.
  reactionLine(reaction, name = '') {
    const lines = this.t.react[reaction];
    return lines ? fmt(pick(lines), { name }) : null;
  }
}
