// Her own little life on your desktop, when nobody needs her: she finds things to do.
//
// - She hacks some corp's ICE (a wireframe of it turning between her hands, the ticker counting
//   up), reads a data shard, plays a tiny arcade game (and wins, or loses and gets mad), paints
//   graffiti on your screen with her finger, scans your network, argues with the other minds in
//   her, stretches.
// - Music playing (main.js media.js): headphones on, head bobbing on the beat, a word about the
//   track now and then. In DJ mode she skips a track herself once in a while (her menu turns it
//   off). Bored in the silence, she offers to put something on.
// - You: she notices when you're away (no keyboard or mouse for a while) and when you're back,
//   says good morning, tells you to go to bed at 3 am, and complains when the battery runs low.
//
// What she does depends on how she feels (mood.js): bored, she finds something sooner; angry, she
// hacks (and loses more); happy, she paints and plays.

import { lifeLines } from './lines-life.js';
import { pick, fmt, rand, duration, today } from './util.js';
import * as marks from './fx-life.js';

const FIRST_AFTER = [45000, 90000];     // her first activity after she starts
const EVERY = [70000, 170000];          // then one every so often
const AWAY_AFTER = 5 * 60;              // seconds without input: you're away
const SKIP_COOLDOWN = [18 * 60000, 35 * 60000];
const OFFER_COOLDOWN = 45 * 60000;
const NIGHT = [1, 5];                   // from 1 am to 5 am, she tells you to go to bed
const STORE = 'capri.life';

export class Life {
  constructor({ capri, panel, voice, host, brain, heart, fx }) {
    this.capri = capri;
    this.panel = panel;
    this.voice = voice;
    this.host = host;
    this.brain = brain;
    this.heart = heart;
    this.fx = fx;
    this.chat = null;  // chat.js (is a chat open?)
    this.guide = null; // guide.js (is she showing you something?)
    this.ring = null;  // ring.js (her circular menu is open: she stays put)
    this.enabled = true; // her menu: her own activities
    this.dj = true;      // her menu: DJ mode (she skips tracks herself)
    this.musicAware = true;
    this.run = null;     // the activity going on: { name, cancelled, cleanup }
    this.media = {};     // what's playing: { app, title, artist, playing }
    this.track = null;   // { key, since, commented }
    this.phones = null;  // her headphones (a prop), while music plays
    this.audio = false;  // sound is coming out of the PC (rhythm.js), whatever the player
    this.away = false;
    this.awaySince = 0;
    this.paused = false; // resting deeply (app.js): her clock stops
    const now = performance.now();
    this.nextAt = now + rand(...FIRST_AFTER);
    this.nextSkipAt = now + rand(6 * 60000, 12 * 60000);
    this.lastOffer = -Infinity;
    this.memo = this.load();
  }

  get t() {
    return lifeLines(this.brain.lang).life;
  }

  configure(cfg) {
    this.enabled = cfg.life !== false;
    this.dj = cfg.dj !== false;
    this.musicAware = cfg.musicAware !== false;
    if (!this.enabled && this.run) this.cancel();
    if (!this.musicAware) this.onMedia({});
  }

  start() {
    setInterval(() => this.tick(), 1000);
    this.host.onMedia?.((now) => this.onMedia(now));
    this.host.onPresence?.((p) => this.onPresence(p));
    this.watchBattery();
  }

  // Nothing else going on: not working for Claude, no chat, no guide, no panel, not asleep or away.
  free({ panel = true } = {}) {
    const c = this.capri;
    return c.mode === 'idle' && !c.busy && !c.dragging && !c.stowed && !c.dormant && !c.hidden && !c.sky && !c.pointing
      && (c.stance === 'stand' || c.stance === 'sit')
      && !(panel && this.panel.visible) && !this.chat?.open && !this.ring?.open && !this.guide?.running && !this.brain.busySessions.length;
  }

  // ---------- the clock ----------

  tick() {
    if (this.paused) return; // resting deeply (app.js): nothing to do until she's back
    const now = performance.now();
    if (this.run) {
      // something more important came up: she drops what she was doing
      if (!this.free({ panel: false })) this.cancel();
      return;
    }
    this.music(now);
    if (!this.enabled || now < this.nextAt || !this.free()) return;
    const bored = this.heart.mood.mood === 'bored';
    this.nextAt = now + rand(...EVERY) * (bored ? 0.5 : 1);
    this.begin(this.choose());
  }

  // What she feels like doing, by mood and by where she is (props need her standing).
  choose() {
    const mood = this.heart.enabled ? this.heart.mood.mood : 'calm';
    const standing = this.capri.stance === 'stand';
    const playing = this.media.playing;
    const weights = {
      hack: standing ? { angry: 5, annoyed: 4, happy: 2 }[mood] || 2 : 0,
      read: standing ? { sad: 4, calm: 3, bored: 2 }[mood] || 2 : 0,
      game: standing ? { happy: 4, bored: 4, calm: 3 }[mood] || 2 : 0,
      graffiti: standing ? { happy: 4, shy: 2, bored: 3 }[mood] || 1.5 : 0,
      scan: { angry: 2, calm: 1.5 }[mood] || 1,
      minds: { bored: 3, calm: 2, happy: 2 }[mood] || 1,
      stretch: { bored: 3 }[mood] || 0.6,
      offer: !playing && this.musicAware && performance.now() - this.lastOffer > OFFER_COOLDOWN ? { bored: 3, calm: 1 }[mood] || 0.5 : 0,
    };
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (const [name, w] of Object.entries(weights)) {
      r -= w;
      if (r <= 0) return name;
    }
    return 'stretch';
  }

  // Starts one (her menu's --dev "act" can name it). Resolves when it's over.
  async begin(name) {
    if (this.run) this.cancel();
    const fn = this[`do_${name}`];
    if (!fn) return;
    const run = { name, cancelled: false, cleanup: [] };
    this.run = run;
    this.stopPhones(); // her hands are busy
    try {
      await fn.call(this, run);
    } finally {
      for (const undo of run.cleanup) undo();
      if (this.run === run) this.run = null;
    }
  }

  cancel() {
    if (!this.run) return;
    this.run.cancelled = true;
    for (const undo of this.run.cleanup) undo();
    this.run.cleanup = [];
    this.run = null;
  }

  // Waits, unless what she's doing got cancelled meanwhile: false then.
  async wait(run, ms) {
    await new Promise((r) => setTimeout(r, ms));
    return !run.cancelled && this.run === run;
  }

  say(line, { face = 'smug', hold = 3200, kind = 'info', badge, quote } = {}) {
    if (!line) return false;
    if (this.chat?.open || this.guide?.running) return false;
    return this.panel.say({ kind, face, line, hold, badge, quote, life: true });
  }

  // Her ticker, saying what she's up to (cleared when she's done, if it's still hers).
  ticker(run, verb, target) {
    const action = { verb, target, life: true };
    this.panel.setTicker(action);
    if (!run.tickerSet) {
      run.tickerSet = true;
      run.cleanup.push(() => {
        if (this.panel.tickerAction?.life) this.panel.setTicker(null);
      });
    }
  }

  // Busy hands: a prop between them, and her float changed for it.
  hold(run, kind, act, extra = {}) {
    this.capri.setActivity(act);
    const s = this.capri.scale;
    const prop = marks.prop(this.fx, kind, () => this.propAt(kind), { scale: s * 1.5, ...extra });
    run.cleanup.push(() => {
      prop.stop();
      this.capri.setActivity(null);
    });
    return prop;
  }

  // Where a prop floats: in front of her chest, a little toward the open side of the screen.
  propAt(kind) {
    const c = this.capri;
    const s = c.scale;
    const h = c.head();
    if (kind === 'headphones') return { x: h.x, y: h.y - 34 * s };
    return { x: h.x + c.towardCenter() * 18 * s, y: h.y + 92 * s };
  }

  // ---------- what she does ----------

  async do_hack(run) {
    const t = this.t.hack;
    const corp = pick(this.t.corps);
    this.say(fmt(pick(t.start), { corp }), { face: 'smug', hold: 2600 });
    if (!(await this.wait(run, 1800))) return;
    const prop = this.hold(run, 'ice', 'tinker');
    const angry = ['angry', 'annoyed'].includes(this.heart.mood.mood);
    const win = Math.random() < (angry ? 0.5 : 0.7);
    let pct = 0;
    while (pct < 1) {
      pct = Math.min(1, pct + rand(0.05, 0.11));
      if (!win && pct > 0.78) break;
      prop.set({ progress: pct });
      this.ticker(run, t.verb, fmt(t.target, { corp, pct: Math.round(pct * 100) }));
      if (Math.random() < 0.35) this.capri.spark();
      if (!(await this.wait(run, rand(900, 1500)))) return;
    }
    for (const undo of run.cleanup.splice(0)) undo();
    if (win) {
      this.voice.play('win');
      this.heart.event('hackWon');
      this.capri.react('happy');
      this.say(fmt(pick(t.win), { corp }), { face: 'smug', kind: 'done' });
    } else {
      this.capri.hurt();
      this.voice.play('error');
      this.heart.event('hackLost');
      this.say(fmt(pick(t.lose), { corp }), { face: 'wide', kind: 'error' });
    }
  }

  async do_read(run) {
    const t = this.t.read;
    const title = pick(t.titles);
    const prop = this.hold(run, 'pane', 'read');
    prop.set({ title: title.replace(/[«»"]/g, '') });
    const until = performance.now() + rand(16000, 28000);
    while (performance.now() < until) {
      this.ticker(run, t.verb, title);
      if (!(await this.wait(run, 2000))) return;
    }
    for (const undo of run.cleanup.splice(0)) undo();
    this.capri.perform('curious', this.capri.towardCenter());
    this.say(pick(t.done), { face: 'aside' });
  }

  async do_game(run) {
    const t = this.t.game;
    const game = pick(t.names);
    const prop = this.hold(run, 'arcade', 'tinker');
    const mood = this.heart.mood.mood;
    const win = Math.random() < (mood === 'happy' ? 0.65 : mood === 'angry' ? 0.3 : 0.5);
    let score = 0;
    const until = performance.now() + rand(15000, 24000);
    while (performance.now() < until) {
      score += Math.round(rand(10, 90) / 10) * 10;
      prop.set({ score });
      this.ticker(run, t.verb, fmt(t.target, { game, score }));
      if (Math.random() < 0.15) this.voice.play('tick');
      if (!(await this.wait(run, 800))) return;
    }
    for (const undo of run.cleanup.splice(0)) undo();
    if (win) {
      this.voice.play('win');
      this.heart.event('gameWon');
      this.capri.react('laugh');
      this.say(pick(t.win), { face: 'laugh', kind: 'done' });
    } else {
      this.voice.play('lose');
      this.heart.event('gameLost');
      this.capri.react(this.heart.mood.v.anger >= 0.5 ? 'rage' : 'huff');
      this.say(pick(t.lose), { face: 'many', kind: 'error' });
    }
  }

  async do_graffiti(run) {
    const c = this.capri;
    const s = c.scale;
    const dir = c.towardCenter();
    const h = c.head();
    const x = Math.min(Math.max(h.x + dir * rand(230, 330), 120), c.view.w - 120);
    const y = Math.min(Math.max(h.y - rand(30, 140), 110), c.view.h - 160);
    const mood = this.heart.mood.mood;
    const shape = mood === 'shy' ? 'heart' : mood === 'sad' ? 'satellite' : pick(['grin', 'satellite', 'star', 'eye', 'tag']);
    c.perform('paint', dir);
    this.voice.play('bolt', { soft: true });
    marks.graffiti(this.fx, x, y, shape, { scale: 0.75 + s * 0.4, drawMs: 2600, holdMs: 8000 });
    if (!(await this.wait(run, 3000))) return;
    this.say(pick(this.t.graffiti), { face: 'smug' });
  }

  async do_scan(run) {
    const t = this.t.scan;
    this.ticker(run, t.verb, t.target);
    this.capri.perform('curious', this.capri.towardCenter());
    this.voice.play('charge');
    marks.scan(this.fx, { life: 2800 });
    if (!(await this.wait(run, 3000))) return;
    for (const undo of run.cleanup.splice(0)) undo();
    this.say(pick(t.done), { face: 'look' });
  }

  async do_minds(run) {
    const talk = pick(this.t.minds);
    this.capri.perform('split');
    if (!(await this.wait(run, 900))) return;
    for (const [who, line] of talk) {
      if (!this.say(line, { face: who === 'CAPRI' || who === 'КАПРИ' ? 'smug' : pick(['many', 'aside', 'wide']), badge: who, hold: 2600 })) return;
      if (!(await this.wait(run, 2700))) return;
    }
  }

  async do_stretch(run) {
    this.capri.react('stretch');
    if (!(await this.wait(run, 1600))) return;
    this.say(pick(this.t.stretch), { face: 'calm' });
  }

  // Silence, and she's bored of it: she offers to put something on (a Spotify search).
  async do_offer(run) {
    this.lastOffer = performance.now();
    const t = this.t.music;
    const query = t.query[this.heart.mood.mood] || t.query.calm;
    await new Promise((done) => {
      const shown = this.panel.say({
        kind: 'info', face: 'smug', line: t.offer.line, quote: query, hold: 12000, life: true,
        actions: [{ id: 'yes', label: t.offer.yes, primary: true }, { id: 'no', label: t.offer.no }],
        onAction: async (id) => {
          this.panel.hide();
          if (id === 'yes' && (await this.host.music(query))) {
            const hh = this.capri.head();
            this.capri.zap(hh.x + this.capri.towardCenter() * 280, hh.y - 170);
            this.say(fmt(t.offered, { query }), { face: 'laugh' });
          }
          done();
        },
        onLeave: done,
      });
      if (!shown) done();
    });
    void run;
  }

  // ---------- music ----------

  onMedia(now = {}) {
    const was = this.media;
    this.media = this.musicAware ? now : {};
    const key = this.media.title ? `${this.media.artist}|${this.media.title}` : '';
    if (key && key !== this.track?.key) {
      this.track = { key, since: performance.now(), commented: false };
      if (this.media.playing) this.heart.event('music');
    }
    if (!this.media.playing && was.playing) this.stopPhones();
  }

  // Sound on or off (rhythm.js): her headphones follow it too.
  setAudio(on) {
    this.audio = Boolean(on);
    if (!this.audio && !this.media.playing) this.stopPhones();
  }

  // While music plays: headphones and bopping, a word about the track, and DJ mode.
  music(now) {
    const m = this.media;
    const playing = m.playing || this.audio;
    const free = this.free();
    if (!playing || this.run || this.capri.stance !== 'stand' || !free) {
      // the panel coming up for a moment doesn't take her headphones off
      if (this.phones && (!playing || this.run || this.capri.stance !== 'stand' || !this.free({ panel: false }))) this.stopPhones();
      return;
    }
    if (!this.phones) {
      this.phones = marks.prop(this.fx, 'headphones', () => this.propAt('headphones'), { scale: this.capri.scale * 1.15 });
      // if she's dancing to the real beat (rhythm.js), that groove wins over the plain bob
      if (!this.capri.dancing) this.capri.setActivity('bop');
    }
    const t = this.t.music;
    const track = this.track;
    const age = track ? now - track.since : 0;
    const vars = { track: [m.artist, m.title].filter(Boolean).join(' — '), artist: m.artist || m.title, title: m.title };
    // a word about it, now and then, a little while after it starts
    if (track && !track.commented && age > 6000) {
      track.commented = true;
      const mood = this.heart.mood.mood;
      const lines = mood === 'angry' ? t.angry : mood === 'sad' ? t.sad : t.on;
      if (Math.random() < 0.45 && vars.artist) this.say(fmt(pick(lines), vars), { face: mood === 'angry' ? 'look' : 'smug', hold: 3600 });
    }
    // DJ mode: bored of this one, she skips it (never one you just put on)
    if (this.dj && m.playing && track && age > 50000 && now > this.nextSkipAt) { // only a track the player says is on
      const mood = this.heart.mood.mood;
      const chance = ['bored', 'annoyed', 'angry'].includes(mood) ? 0.006 : 0.0015;
      if (Math.random() < chance) this.skip();
    }
  }

  async skip() {
    this.nextSkipAt = performance.now() + rand(...SKIP_COOLDOWN);
    const c = this.capri;
    const h = c.head();
    c.zap(h.x + c.towardCenter() * 260, h.y - 180);
    this.voice.play('skip');
    if (await this.host.media('next')) {
      if (this.track) this.track.since = performance.now();
      this.say(pick(this.t.music.skip), { face: 'smug', hold: 3000 });
    }
  }

  stopPhones() {
    if (!this.phones) return;
    this.phones.stop();
    this.phones = null;
    if (this.capri.activityAct === 'bop' && !this.capri.dancing) this.capri.setActivity(null);
  }

  // What's going on in her life, for her chat (English, like her prompt).
  context() {
    const bits = [];
    if (this.run) bits.push(`You were just ${{ hack: 'hacking some corp ICE for fun', read: 'reading a data shard', game: 'playing an arcade game', graffiti: 'painting graffiti on their screen', scan: 'scanning their network', minds: 'arguing with the other minds in you', stretch: 'stretching', offer: 'offering to put some music on' }[this.run.name] || 'busy'}.`);
    const m = this.media;
    if (m.playing && m.title) bits.push(`Music playing on their PC right now${m.app ? ` (${m.app})` : ''}: ${[m.artist, m.title].filter(Boolean).join(' - ')}. You can hear it and have opinions about it.`);
    if (this.dj) bits.push('You sometimes skip tracks yourself when you are bored of them (DJ mode).');
    return bits.join(' ');
  }

  // ---------- you ----------

  // How long since you last touched the keyboard or mouse (main.js, every few seconds).
  onPresence({ idle = 0 } = {}) {
    const now = Date.now();
    if (idle >= AWAY_AFTER && !this.away) {
      this.away = true;
      this.awaySince = now - idle * 1000;
      return;
    }
    if (idle < 10 && this.away) {
      this.away = false;
      this.welcomeBack(now - this.awaySince);
    }
    if (idle < 60) this.clock();
  }

  welcomeBack(ms) {
    if (ms < AWAY_AFTER * 1000 || this.capri.stowed) return;
    const t = this.t.presence;
    this.heart.event('userBack');
    const angry = this.heart.mood.v.anger >= 0.3;
    const lines = angry ? t.backAngry : ms >= 60 * 60000 ? t.backLong : t.back;
    setTimeout(() => {
      if (!this.free()) return;
      this.capri.wake();
      this.capri.react(angry ? 'huff' : 'happy');
      this.say(fmt(pick(lines), { time: duration(ms, this.brain.lang) }), { face: angry ? 'look' : 'grin', hold: 4500 });
    }, 1200);
  }

  // Good morning once a day, and bed at 3 am.
  clock() {
    if (!this.free()) return;
    const d = new Date();
    const hour = d.getHours();
    const t = this.t.presence;
    const name = this.brain.custom?.userName || (this.brain.lang === 'ru' ? 'чумба' : 'choom');
    const day = today();
    if (hour >= 6 && hour < 11 && this.memo.morning !== day) {
      this.remember({ morning: day });
      this.capri.react('happy');
      this.say(fmt(pick(t.morning), { name }), { face: 'grin', hold: 4500 });
      return;
    }
    if (hour >= NIGHT[0] && hour < NIGHT[1]) {
      const clock = `${hour}:${String(d.getMinutes()).padStart(2, '0')}`;
      const night = `${day}`;
      const warned = this.memo.night === night ? this.memo.nightAt : 0;
      if (!warned) {
        this.remember({ night, nightAt: Date.now() });
        this.capri.react('huff');
        this.say(fmt(pick(t.night), { clock }), { face: 'look', hold: 5000 });
      } else if (Date.now() - warned > 40 * 60000 && !this.memo.nightAgain) {
        this.remember({ nightAgain: night });
        this.heart.event('lateNight');
        this.capri.react('pout');
        this.say(fmt(pick(t.nightAgain), { clock }), { face: 'many', hold: 5000 });
      }
    }
  }

  async watchBattery() {
    if (!navigator.getBattery) return;
    try {
      const battery = await navigator.getBattery();
      let told = false;
      const check = () => {
        if (battery.charging) {
          told = false;
          return;
        }
        if (!told && battery.level <= 0.15 && this.free()) {
          told = true;
          this.capri.react('hurt');
          this.say(fmt(pick(this.t.presence.battery), { pct: Math.round(battery.level * 100) }), { face: 'aside', hold: 5000 });
        }
      };
      battery.addEventListener('levelchange', check);
      battery.addEventListener('chargingchange', check);
    } catch {
      // no battery to watch
    }
  }

  load() {
    try {
      return JSON.parse(localStorage.getItem(STORE) || '{}') || {};
    } catch {
      return {};
    }
  }

  remember(patch) {
    if (patch.night && patch.night !== this.memo.night) this.memo.nightAgain = null;
    this.memo = { ...this.memo, ...patch };
    try {
      localStorage.setItem(STORE, JSON.stringify(this.memo));
    } catch {
      // no storage: she may say it twice
    }
  }
}
