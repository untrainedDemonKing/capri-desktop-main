// Her eyes: now and then (and whenever you ask) she takes a look at your screen and reacts to what's
// on it. The picture is grabbed and read in the main process (screen.js, llm.js see()); here we
// decide when she looks, turn what she saw into a mood and a line in character, and keep the last
// thing she saw so her chat can talk about it.
//
// Off unless you turn it on (her menu › Senses › Let her see my screen). While it's on, the eye by
// the clock is open, and she tells you the first time she takes a look.

import { fmt } from './util.js';
import { lifeLines } from './lines-life.js';
import { ASSISTANT_NAMES } from './lines.js';

const MIN_GAP = 18000;        // never two looks closer than this, whatever asks
const CHANGE_GAP = 8000;      // the foreground window changed: wait this long before a fresh glance

export class Eyes {
  constructor({ host, brain, heart, panel, capri, voice, life }) {
    this.host = host;
    this.brain = brain;
    this.heart = heart;
    this.panel = panel;
    this.capri = capri;
    this.voice = voice;
    this.life = life;
    this.enabled = false;
    this.every = 45000;       // on her own, at most this often (0: only when asked)
    this.lastLook = -Infinity;
    this.nextGlance = performance.now() + 60000;
    this.scene = null;        // { text, at }: the last thing she saw, for her chat
    this.fgSeen = 0;          // when the foreground window last changed
    this.greeted = false;
    this.clock = 0;           // the interval that asks tick() (only while she may look: configure)
  }

  get t() {
    return lifeLines(this.brain.lang).eyes;
  }

  configure(cfg) {
    this.enabled = cfg.vision === true;
    this.every = Math.max(0, (cfg.visionEvery ?? 45)) * 1000;
    if (!this.enabled) this.scene = null;
    // her glance clock only runs while she's allowed to look on her own (off by default: no timer at all)
    const want = this.enabled && this.every > 0;
    if (want && !this.clock) this.clock = setInterval(() => this.tick(), 2500);
    else if (!want && this.clock) {
      clearInterval(this.clock);
      this.clock = 0;
    }
  }

  // the foreground window changed (app.js): worth a glance soon, if she's allowed
  onForeground() {
    this.fgSeen = performance.now();
  }

  tick(now = performance.now()) {
    if (!this.enabled || !this.every || now < this.nextGlance) return;
    this.nextGlance = now + Math.max(this.every, MIN_GAP);
    if (!this.free()) return;
    // a glance when you switched to another window a moment ago (once it's settled), or when she
    // hasn't looked in a while (a long video, a game: the window in front never changes)
    const since = now - this.fgSeen;
    const switched = this.fgSeen > 0 && since >= CHANGE_GAP && since <= 60000 && this.lastLook < this.fgSeen;
    const stale = now - this.lastLook > this.every * 4;
    if (switched || stale) this.look({ reason: 'glance' });
  }

  free() {
    const c = this.capri;
    return c.mode === 'idle' && !c.busy && !c.dragging && !c.stowed && !c.dormant && !c.sky
      && !this.panel.visible && !this.ring?.open && !this.brain.busySessions.length;
  }

  // She takes a look. ask: you asked her to (she always does, and says what she sees). silent: just
  // fetch what's on screen for her chat, don't say anything. Returns the scene text, or null.
  async look({ ask = false, silent = false, reason = 'ask' } = {}) {
    const now = performance.now();
    if (!this.enabled) {
      if (ask && !silent) this.say(this.t.off, { face: 'aside', kind: 'info' });
      return null;
    }
    if (!ask && !silent && now - this.lastLook < MIN_GAP) return this.scene?.text || null;
    this.lastLook = now;
    if (ask && !silent) this.capri.perform('curious', this.capri.towardCenter());
    const res = await this.host.see({ prompt: this.prompt(ask || silent) }).catch((err) => ({ ok: false, error: err.message }));
    if (!res?.ok) {
      if (ask && !silent) this.say(fmt(this.t.blind, { error: String(res?.error || '').slice(0, 80) }), { face: 'wide', kind: 'error' });
      return null;
    }
    const seen = parse(res.text);
    this.scene = { text: seen.scene || res.text, at: now };
    if (silent) return this.scene.text;
    // the very first look: she tells you she can see now
    if (!this.greeted && !ask) {
      this.greeted = true;
      this.heart?.event('userBack');
    }
    const mood = this.heart?.answered(seen.mood) || null;
    if (mood) this.panel.setFace?.(this.heart.face(mood));
    const line = seen.line || seen.scene;
    if (line && (ask || this.free())) {
      this.say(line, { face: mood ? this.heart.face(mood) : 'look', kind: 'info', badge: this.t.badge });
      if (this.capri.react && mood) this.capri.react({ laugh: 'laugh', happy: 'happy', shy: 'shy', angry: 'huff', sad: 'hurt' }[mood] || null);
    }
    return this.scene.text;
  }

  say(line, { face = 'look', kind = 'info', badge } = {}) {
    if (this.panel.visible && kind === 'info') return;
    this.panel.say({ kind, face, line, badge, hold: 5000, life: true });
  }

  // What the vision model is told: who she is, and to react in character, in the user's language.
  prompt(ask) {
    const lang = LANG_NAME[this.brain.lang] || 'the user\'s language';
    const watching = this.brain.watching;
    const assistant = ASSISTANT_NAMES[this.brain.assistant] || 'Claude Code';
    return [
      'You are Capri, a playful, teasing cyberpunk AI girl (Cyberpunk: Edgerunners) living on the user\'s desktop.',
      'This image is a screenshot of the user\'s screen right now.',
      ask
        ? 'The user just asked what you see. Look, and tell them in one or two short sentences, in character: what is on their screen and a cheeky or warm reaction to it.'
        : 'Glance at it and, only if something is genuinely worth a word (a game, a video, a funny site, their code, music), give one short in-character reaction. If it is just a plain desktop or nothing interesting, leave "line" empty.',
      watching ? `Ignore the small glitchy cyberpunk figure (that is you) and any speech bubble; also do not mind ${assistant}.` : 'Ignore the small glitchy cyberpunk figure (that is you) and any speech bubble.',
      `Answer ONLY as compact JSON: {"scene": "a few neutral words on what is on screen, in English", "mood": one of calm|happy|laugh|smug|surprised|shy|sad|annoyed, "line": "your reaction in ${lang} (or empty)"}.`,
      'No markdown, no code fence, just the JSON object.',
    ].join(' ');
  }

  // What she last saw, for her chat (so "что у меня на экране?" works even without a fresh look).
  context() {
    if (!this.enabled || !this.scene || performance.now() - this.scene.at > 90000) return '';
    return `You can see the user's screen. A moment ago it showed: ${this.scene.text}.`;
  }
}

const LANG_NAME = { ru: 'Russian', en: 'English', fr: 'French', es: 'Spanish', pt: 'Brazilian Portuguese' };

// A lenient read of the model's answer: the JSON if it's there, else the whole thing as the line.
export function parse(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      return { scene: str(o.scene), mood: str(o.mood).toLowerCase(), line: str(o.line) };
    } catch {
      // not valid JSON: fall through
    }
  }
  const clean = raw.replace(/```[a-z]*|```/g, '').replace(/[*_`#]+/g, '').trim();
  return { scene: clean.slice(0, 120), mood: '', line: clean.slice(0, 200) };
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
