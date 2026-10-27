// Her circular menu: right-click her and a ring of eight sectors opens around her, in her colours
// (they follow her theme: her colours menu recolours it with her). Each sector is a tab, shown as a
// card beside the ring:
//   Bond (how close you two are, her notebook about you), Mic (which microphone, how it's read, a
//   live level), Senses, Character, Colours, Voice, More; and Talk, which just opens her chat.
// The settings here are the same ones as in the tray menu, and change the same config.
//
// Everything that isn't drawing lives in ring-tabs.js; the DOM pieces are in ring-ui.js.

import { lifeLines } from './lines-life.js';
import { TABS, ORDER } from './ring-tabs.js';
import { el } from './ring-ui.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const VIEW = 460;                 // the ring's own drawing box
const MID = VIEW / 2;
const R_OUT = 222;
const R_IN = 142;
const CHAMFER = 10;
const GAP_DEG = 2.6;              // the empty space between two sectors
const CARD_W = 372;
const MARGIN = 8;
const STAY_MS = 5 * 60 * 1000;    // she stays put while it's open

// ---------- geometry (pure, tested) ----------

export const polar = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [MID + r * Math.cos(a), MID + r * Math.sin(a)];
};

const f = (n) => Math.round(n * 100) / 100;

// Sector i of n, from the top, clockwise: an annular segment with two corners cut (outer end and
// inner start), like her panels. Returns the path's `d`.
export function sectorPath(i, n = ORDER.length, { r0 = R_IN, r1 = R_OUT, gap = GAP_DEG, cut = CHAMFER } = {}) {
  const span = 360 / n;
  const a0 = -90 - span / 2 + i * span + gap / 2;
  const a1 = a0 + span - gap;
  const dOut = (cut / r1) * (180 / Math.PI);
  const dIn = (cut / r0) * (180 / Math.PI);
  const pt = (r, a) => polar(r, a).map(f).join(' ');
  const large = a1 - a0 > 180 ? 1 : 0;
  return [
    `M ${pt(r1, a0)}`,
    `A ${r1} ${r1} 0 ${large} 1 ${pt(r1, a1 - dOut)}`,
    `L ${pt(r1 - cut, a1)}`,
    `L ${pt(r0, a1)}`,
    `A ${r0} ${r0} 0 ${large} 0 ${pt(r0, a0 + dIn)}`,
    `L ${pt(r0 + cut, a0)}`,
    'Z',
  ].join(' ');
}

// The middle of sector i (where its icon and word go).
export function sectorMid(i, n = ORDER.length, r = (R_IN + R_OUT) / 2) {
  const [x, y] = polar(r, -90 + i * (360 / n));
  return { x, y };
}

// Where the ring and its card go on a screen of vw x vh, for a ring centred on (cx, cy): the ring as
// near her as the screen allows, the card on the side with room (the right first). `size`: the ring's
// size in px (it shrinks on a small screen).
export function place({ cx, cy, size, vw, vh, cardW = CARD_W, gap = 18, margin = MARGIN }) {
  const s = Math.max(240, Math.min(size, vh - 2 * margin, vw - 2 * margin));
  let left = cx - s / 2;
  const fits = (l, side) => (side === 'right' ? l + s + gap + cardW <= vw - margin : l - gap - cardW >= margin);
  let side = 'right';
  if (!fits(left, 'right')) {
    if (fits(left, 'left')) side = 'left';
    else if (cx < vw / 2) {
      // neither side has room around her: slide the ring over so the card fits
      left = Math.min(left, vw - margin - cardW - gap - s);
    } else {
      side = 'left';
      left = Math.max(left, margin + cardW + gap);
    }
  }
  left = Math.max(margin, Math.min(left, vw - s - margin));
  const top = Math.max(margin, Math.min(cy - s / 2, vh - s - margin));
  const cardLeft = side === 'right' ? left + s + gap : left - gap - cardW;
  return { left, top, size: s, side, cardLeft: Math.max(margin, Math.min(cardLeft, vw - cardW - margin)) };
}

// ---------- the icons (24 x 24, drawn with strokes, a few filled) ----------

const ICONS = {
  bond: [['path', { d: 'M12 21 L3.5 12.5 A5 5 0 0 1 12 6.4 A5 5 0 0 1 20.5 12.5 Z', class: 'is-fill' }]],
  brain: [
    ['circle', { cx: 6, cy: 12, r: 2.8, class: 'is-fill' }],
    ['circle', { cx: 18, cy: 6, r: 2.8, class: 'is-fill' }],
    ['circle', { cx: 18, cy: 18, r: 2.8, class: 'is-fill' }],
    ['path', { d: 'M8.5 10.9 L15.5 7.1 M8.5 13.1 L15.5 16.9' }],
  ],
  mic: [
    ['path', { d: 'M9 3 H15 V12 A3 3 0 0 1 9 12 Z', class: 'is-fill' }],
    ['path', { d: 'M5 11 A7 7 0 0 0 19 11 M12 18 V21.5 M8.5 21.5 H15.5' }],
  ],
  senses: [
    ['path', { d: 'M2 12 Q12 3 22 12 Q12 21 2 12 Z' }],
    ['circle', { cx: 12, cy: 12, r: 3.2, class: 'is-fill' }],
  ],
  character: [['path', { d: 'M13.5 2 L5 13.5 H11 L9.5 22 L19 9.5 H13 Z', class: 'is-fill' }]],
  colours: [['path', { d: 'M12 2.8 C12 2.8 5 11 5 15.2 A7 7 0 0 0 19 15.2 C19 11 12 2.8 12 2.8 Z', class: 'is-fill' }]],
  voice: [
    ['path', { d: 'M3.5 9 H8 L13 5 V19 L8 15 H3.5 Z', class: 'is-fill' }],
    ['path', { d: 'M16 9 Q18.5 12 16 15 M18.8 6.5 Q23 12 18.8 17.5' }],
  ],
  more: [
    ['path', { d: 'M3 6 H21 M3 12 H21 M3 18 H21' }],
    ['rect', { x: 14, y: 3.5, width: 4, height: 5, class: 'is-fill' }],
    ['rect', { x: 6, y: 9.5, width: 4, height: 5, class: 'is-fill' }],
    ['rect', { x: 15, y: 15.5, width: 4, height: 5, class: 'is-fill' }],
  ],
  chat: [['path', { d: 'M3.5 4 H20.5 V16 H10 L5.5 20.5 V16 H3.5 Z', class: 'is-fill' }]],
};

const svg = (tag, attrs = {}) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

function icon(id, size = 24) {
  const g = svg('g', { class: 'ring__ico', transform: `scale(${size / 24})` });
  for (const [tag, attrs] of ICONS[id] || []) g.append(svg(tag, attrs));
  return g;
}

// ---------- the ring ----------

export class Ring {
  constructor({ host, capri, panel, brain, bond, ears, voice, actions = {} }) {
    this.host = host;
    this.capri = capri;
    this.panel = panel;
    this.brain = brain;
    this.bond = bond;
    this.ears = ears;
    this.voice = voice;
    this.actions = actions;   // { run(name, extra) }: what the sectors and buttons ask of her (app.js)
    this.root = document.getElementById('ring');
    this.cfg = {};
    this.isOpen = false;
    this.tab = 'bond';
    this.state = {};          // what a tab keeps while it's open (a form half-written, a confirm)
    this.holds = new Map();   // things a tab keeps running while it's selected (the mic's meter)
    this.cleanups = [];
    this.dragging = false;
    this.focused = false;     // the overlay has the keyboard (a text box in a card)
    this.saveTimer = 0;
    this.pending = {};
    this.onToggle = null;     // (open) => void
    this.onGuide = null;      // () => void: her guide has a panel up as the ring opens (app.js drops it)
    this.onKey = (e) => this.key(e);
  }

  get open() {
    return this.isOpen;
  }

  get t() {
    return lifeLines(this.brain.lang).ring;
  }

  // The settings as they are now (app.js passes every change along); the open card follows.
  configure(cfg) {
    this.cfg = { ...cfg };
    if (!this.isOpen || this.dragging) return;
    if (this.builtFor !== (this.capri.scale || 0.8)) this.rebuild(); // her size changed: the ring goes round her new size
    else this.refresh();
  }

  rebuild() {
    this.runCleanups();
    this.build();
    for (const g of this.root.querySelectorAll('.ring__sector')) g.classList.toggle('is-on', g.dataset.tab === this.tab);
    this.refresh();
  }

  toggle() {
    if (this.isOpen) this.hide();
    else this.show();
  }

  show(tab) {
    if (this.isOpen) {
      if (tab) this.select(tab);
      return;
    }
    const { capri, panel } = this;
    capri.wake?.();
    panel.park(); // (what's showing would be under the ring: a passing line goes, Claude's news waits)
    if (panel.visible && panel.current?.guide) this.onGuide?.(); // her guide, mid-question: you chose the menu instead
    this.isOpen = true;
    panel.quiet = true;
    this.state = {};
    this.build();
    this.root.hidden = false;
    this.root.classList.add('is-entering');
    setTimeout(() => this.root.classList.remove('is-entering'), 420);
    this.stay();
    window.addEventListener('keydown', this.onKey, true); // (capturing: Esc is the ring's, not the chat's under it)
    this.select(tab || this.tab);
    this.onToggle?.(true);
  }

  hide() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.quiet = false;
    this.flush();
    this.release();
    this.runCleanups();
    this.root.hidden = true;
    this.root.replaceChildren();
    window.removeEventListener('keydown', this.onKey, true);
    if (this.focused) this.host.focusOverlay?.(false); // the keyboard back where it was (only if the notebook form took it)
    this.focused = false;
    this.capri.nextMove = performance.now() + 20000;
    this.onToggle?.(false);
  }

  // She stays where she is meanwhile: no wandering off, and no dozing off while you're in her menu.
  stay() {
    const now = performance.now();
    this.stayedAt = now;
    this.capri.nextMove = this.capri.nextGaze = now + STAY_MS;
    this.capri.lastActivity = now;
  }

  key(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // (a chat open under the ring stays open)
      this.hide();
      return;
    }
    const typing = e.target?.tagName === 'INPUT';
    if (typing) return;
    const tabs = ORDER.filter((id) => id !== 'chat');
    const i = tabs.indexOf(this.tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') this.select(tabs[(i + 1) % tabs.length]);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') this.select(tabs[(i + tabs.length - 1) % tabs.length]);
  }

  // ---------- drawing ----------

  build() {
    const { root } = this;
    root.replaceChildren();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const s = this.capri.scale || 0.8;
    this.builtFor = s;
    const feet = this.capri.pos || { x: vw / 2, y: vh * 0.8 };
    // around her body: from her head to a little below her hips
    const cx = feet.x;
    const cy = feet.y - 190 * s;
    const at = place({ cx, cy, size: Math.min(520, Math.max(380, Math.min(vw, vh) * 0.58)), vw, vh });
    this.at = at;

    const disc = svg('svg', { class: 'ring__disc', viewBox: `0 0 ${VIEW} ${VIEW}`, width: at.size, height: at.size, role: 'menu' });
    disc.style.left = `${at.left}px`;
    disc.style.top = `${at.top}px`;
    ORDER.forEach((id, i) => disc.append(this.sector(id, i)));
    root.append(disc);

    const card = el('section', 'ring__card');
    card.style.left = `${at.cardLeft}px`;
    card.style.top = `${at.top}px`;
    const plate = el('div', 'ring__plate');
    plate.style.setProperty('--card-max', `${Math.max(280, Math.min(vh - 2 * MARGIN, 640))}px`);
    const head = el('header', 'ring__head');
    this.badge = el('span', 'ring__badge');
    this.title = el('div', 'ring__title');
    const close = el('button', 'ring__x', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', this.t.close);
    close.addEventListener('click', () => this.hide());
    head.append(this.badge, this.title, close);
    this.body = el('div', 'ring__body');
    plate.append(head, this.body);
    card.append(plate);
    root.append(card);
    this.card = card;

    // a click anywhere else closes it (the overlay is click-through otherwise: app.js holds it open)
    root.onpointerdown = (e) => {
      if (e.target === root) this.hide();
    };
    root.oncontextmenu = (e) => {
      e.preventDefault();
      this.hide();
    };
    // the pointer moving over it is you being here: she doesn't doze (once in a few seconds is enough)
    root.onpointermove = () => {
      if (performance.now() - (this.stayedAt || 0) > 5000) this.stay();
    };
  }

  sector(id, i) {
    const t = this.t;
    const g = svg('g', { class: 'ring__sector', 'data-tab': id, tabindex: 0, role: 'menuitem', 'aria-label': t.tabs[id] });
    g.style.setProperty('--i', String(i));
    g.append(svg('path', { class: 'ring__shape', d: sectorPath(i) }));
    const { x, y } = sectorMid(i);
    const ico = icon(id, 24);
    ico.setAttribute('transform', `translate(${f(x - 12)} ${f(y - 24)})`);
    g.append(ico);
    const label = svg('text', { class: 'ring__label', x: f(x), y: f(y + 16) });
    label.textContent = t.tabs[id];
    g.append(label);
    if (id === 'bond') {
      // four ticks: how close you two are
      const level = this.bond?.enabled === false ? 0 : this.bond?.progress().level || 0;
      for (let k = 0; k < 4; k++) {
        g.append(svg('rect', { class: `ring__pip${k < level ? ' is-lit' : ''}`, x: f(x - 19 + k * 10), y: f(y + 24), width: 8, height: 4 }));
      }
    }
    const go = () => (id === 'chat' ? this.talk() : this.select(id));
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      go();
    });
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
    return g;
  }

  talk() {
    this.hide();
    this.actions.run?.('chat');
  }

  // A tab: its sector lights up, its card is drawn.
  select(id) {
    if (!TABS[id]) return;
    if (id !== this.tab || !this.body.childElementCount) {
      if (id !== this.tab) {
        this.release();
        this.state = {};
      }
      this.tab = id;
    }
    for (const g of this.root.querySelectorAll('.ring__sector')) g.classList.toggle('is-on', g.dataset.tab === id);
    this.stay();
    this.refresh();
    this.body.scrollTop = 0;
  }

  // Draws the card again from the settings as they are (keeping where it was scrolled to).
  refresh() {
    if (!this.isOpen || !this.body) return;
    const tab = TABS[this.tab];
    const scroll = this.body.scrollTop;
    this.runCleanups();
    const t = this.t;
    this.badge.replaceChildren();
    const mini = svg('svg', { viewBox: '0 0 24 24' });
    for (const [tag, attrs] of ICONS[this.tab] || []) mini.append(svg(tag, attrs));
    this.badge.append(mini);
    this.title.replaceChildren(document.createTextNode(t.tabs[this.tab]));
    const sub = tab.sub?.(this.ctx());
    if (sub) this.title.append(el('span', 'ring__sub', sub));
    this.body.replaceChildren(tab.render(this.ctx()));
    this.body.scrollTop = scroll;
    this.fit();
    // the sectors' words follow the language
    for (const g of this.root.querySelectorAll('.ring__sector')) {
      const text = g.querySelector('text');
      if (text && text.textContent !== t.tabs[g.dataset.tab]) text.textContent = t.tabs[g.dataset.tab];
    }
    // the Bond sector's ticks follow the level
    const lit = this.bond?.enabled === false ? 0 : this.bond?.progress().level || 0;
    this.root.querySelectorAll('.ring__pip').forEach((p, k) => p.classList.toggle('is-lit', k < lit));
  }

  // The card level with the ring's middle, or as near as the screen allows (its height changes with the tab).
  fit() {
    const h = this.card.offsetHeight;
    const mid = this.at.top + this.at.size / 2;
    const top = Math.max(MARGIN, Math.min(mid - h / 2, window.innerHeight - h - MARGIN));
    this.card.style.top = `${Math.round(top)}px`;
  }

  // What a tab gets to work with.
  ctx() {
    const self = this;
    return {
      t: this.t,
      lang: this.brain.lang,
      cfg: this.cfg,
      bond: this.bond,
      ears: this.ears,
      voice: this.voice,
      host: this.host,
      state: this.state,
      actions: this.actions,
      // change a setting: shown at once, saved through the config like the tray menu does
      set: (patch) => {
        Object.assign(this.cfg, patch);
        this.host.setConfig(patch);
        this.refresh();
      },
      // while dragging a slider: saved a moment later, and the card isn't redrawn under your hand
      drag: (patch) => {
        this.dragging = true;
        Object.assign(this.cfg, patch);
        Object.assign(this.pending, patch);
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flush(), 120);
      },
      drop: () => {
        this.flush();
        this.dragging = false;
      },
      // draw the card again; `top`: from the top (something was opened at the top of it)
      refresh: (top = false) => {
        this.refresh();
        if (top) this.body.scrollTop = 0;
      },
      hide: () => this.hide(),
      // keep something running while this tab is selected, even if the card is redrawn (the mic's meter)
      hold: (key, start, stop) => this.hold(key, start, stop),
      unhold: (key) => this.unhold(key),
      // run something until the card is redrawn or closed (a timer on the nodes just built)
      onLeave: (fn) => this.cleanups.push(fn),
      focus: (input) => {
        this.focused = true;
        this.host.focusOverlay?.(true);
        setTimeout(() => input.focus(), 150);
      },
      get open() {
        return self.isOpen;
      },
    };
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (!Object.keys(this.pending).length) return;
    const patch = this.pending;
    this.pending = {};
    this.host.setConfig(patch);
  }

  hold(key, start, stop) {
    if (this.holds.has(key)) return this.holds.get(key).result;
    const entry = { stop, result: start() };
    this.holds.set(key, entry);
    return entry.result;
  }

  unhold(key) {
    const entry = this.holds.get(key);
    if (!entry) return;
    this.holds.delete(key);
    try {
      entry.stop();
    } catch {
      // already gone
    }
  }

  release() {
    for (const { stop } of this.holds.values()) {
      try {
        stop();
      } catch {
        // already gone
      }
    }
    this.holds.clear();
  }

  runCleanups() {
    for (const fn of this.cleanups.splice(0)) {
      try {
        fn();
      } catch {
        // already gone
      }
    }
  }
}
