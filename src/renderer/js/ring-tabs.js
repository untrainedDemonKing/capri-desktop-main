// What's on each card of her circular menu (ring.js): the Bond (how close you two are, her notebook
// about you), the Mic (which microphone, how loud it hears you, how sensitive), her senses, her
// character, her colours, her voice, and the rest. Each tab is { sub?, render(ctx) }: ctx comes from
// ring.js (settings, `set` to change one, the bond, the ears...).

import { THEMES, THEME_IDS } from './themes.js';
import { lifeLines } from './lines-life.js';
import { fmt } from './util.js';
import { plural, dateOf } from './bond.js';
import { micThreshold, meterLevel } from './ears.js';
import { el, heading, note, row, button, buttons, toggle, pick, seg, slider, chips, quote } from './ring-ui.js';

export const ORDER = ['bond', 'mic', 'senses', 'character', 'colours', 'voice', 'more', 'chat'];

const isWindows = (host) => (host.platform ? host.platform === 'win32' : /win/i.test(globalThis.navigator?.platform || ''));
const prettyKey = (key) => String(key || 'Control+Alt+Space').replace(/\bControl\b/g, 'Ctrl').replace(/\bCommandOrControl\b/g, 'Ctrl');

// A button that does something with her and closes the ring.
const go = (c, label, name, extra, opts) => button(label, () => {
  c.hide();
  c.actions.run?.(name, extra);
}, opts);

// ---------- Bond ----------

const bond = {
  sub(c) {
    return c.bond ? lifeLines(c.lang).bond.levels[c.bond.progress().level] : '';
  },
  render(c) {
    const { t, cfg, state, lang } = c;
    const b = t.bond;
    const names = lifeLines(lang).bond.levels;
    const root = el('div');
    if (!c.bond) return root;
    const d = c.bond.data;
    const p = c.bond.progress();

    root.append(toggle(b.learn, cfg.learn !== false, (v) => c.set({ learn: v })));
    if (cfg.learn === false) root.append(note(b.off, true));

    // how close you two are
    const level = el('div', 'ring__level');
    level.append(el('div', 'ring__level-name', names[p.level]));
    const ticks = el('div', 'ring__ticks');
    for (let i = 0; i < p.max; i++) ticks.append(el('i', i < p.level ? 'is-lit' : ''));
    level.append(ticks);
    root.append(level);
    const bar = el('div', 'ring__bar');
    bar.style.setProperty('--fill', `${Math.round(p.fraction * 100)}%`);
    root.append(bar);
    if (p.next === null) root.append(note(b.maxed));
    else {
      const need = [];
      if (p.needTalks) need.push(fmt(b.need.talks, { n: p.needTalks }));
      if (p.needDays) need.push(fmt(b.need.days, { n: p.needDays }));
      root.append(note(fmt(b.next, { name: names[p.next], need: need.join(b.need.and) || '…' })));
    }
    if (p.held) root.append(note(b.held));
    if (d.talks) {
      root.append(note(fmt(b.since, {
        date: dateOf(d.met, lang),
        days: `${d.days} ${plural(d.days, b.days, lang)}`,
        talks: `${d.talks} ${plural(d.talks, b.messages, lang)}`,
      }), true));
    }

    // how you want her: the dials her learning turns, there to be set by hand
    root.append(heading(b.tuneH));
    for (const key of ['short', 'slang', 'tease', 'warm']) {
      root.append(slider({
        left: b.tune[key][0],
        right: b.tune[key][1],
        min: -100,
        max: 100,
        step: 5,
        value: Math.round((d.tune[key] || 0) * 100),
        onInput: (v) => c.bond.setTune(key, v / 100),
      }));
    }
    root.append(note(b.tuneHint, true));

    // her notebook
    root.append(heading(b.notesH));
    const n = d.notes;
    let any = false;
    for (const [kind, label] of [['facts', b.facts], ['likes', b.likes], ['dislikes', b.dislikes]]) {
      if (!n[kind].length) continue;
      any = true;
      root.append(note(label, true), chips(n[kind], (text) => {
        c.bond.removeNote(kind, text);
        c.refresh();
      }, b.remove));
    }
    for (const kind of ['style', 'us']) {
      if (!n[kind]) continue;
      any = true;
      root.append(quote(b[kind], n[kind], () => {
        c.bond.removeNote(kind);
        c.refresh();
      }, b.remove));
    }
    if (!any) root.append(note(b.empty, true));

    // write one yourself
    if (state.adding) {
      const kinds = [['facts', b.facts], ['likes', b.likes], ['dislikes', b.dislikes]].map(([id, label]) => ({ id, label }));
      root.append(seg(kinds, state.kind || 'facts', (id) => {
        state.kind = id;
        state.draft = root.querySelector('.ring__input')?.value || '';
        c.refresh();
      }));
      const form = el('form', 'ring__form');
      const input = el('input', 'ring__input');
      input.type = 'text';
      input.maxLength = 90;
      input.placeholder = b.addPlaceholder;
      input.value = state.draft || '';
      input.spellcheck = false;
      const save = button(b.save, () => form.requestSubmit(), { primary: true });
      form.append(input, save);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (c.bond.addNote(state.kind || 'facts', input.value)) {
          state.adding = false;
          state.draft = '';
          c.refresh();
        } else input.focus();
      });
      root.append(form);
      c.focus(input);
    } else {
      root.append(buttons(button(b.add, () => {
        state.adding = true;
        c.refresh();
      })));
    }

    // wipe it
    if (d.talks || any) {
      root.append(heading(''));
      if (state.sure) {
        root.append(note(b.sure), buttons(
          button(b.wipe, () => {
            c.bond.forget();
            state.sure = false;
            c.refresh();
          }, { primary: true }),
          button(b.cancel, () => {
            state.sure = false;
            c.refresh();
          }),
        ));
      } else {
        root.append(buttons(button(b.forget, () => {
          state.sure = true;
          c.refresh();
        }, { danger: true })));
      }
    }
    return root;
  },
};

// ---------- Mic ----------

const CELLS = 28;

const mic = {
  sub(c) {
    return c.cfg.ears ? `PTT ${prettyKey(c.cfg.pushToTalk)}` : '';
  },
  render(c) {
    const { t, cfg, ears, state } = c;
    const m = t.mic;
    const root = el('div');
    root.append(toggle(m.listen, cfg.ears === true, (v) => c.set({ ears: v })));
    if (!cfg.ears) {
      c.unhold('mic');
      root.append(note(m.off, true));
      return root;
    }

    // keep the mic open for the meter for as long as this tab is on screen (the badge by the clock says so)
    const opened = c.hold('mic', () => ears.watch(true), () => ears.watch(false));
    Promise.resolve(opened).then((ok) => {
      if (ok === false && c.open && !state.denied) {
        state.denied = true;
        c.refresh();
      }
    });
    if (state.denied) {
      root.append(note(m.denied), buttons(button(m.retry, () => {
        state.denied = false;
        c.unhold('mic'); // (and the next draw asks again)
        c.refresh();
      })));
    } else root.append(note(m.live, true));

    // what she hears: the waveform, a row of cells, and the line where "voice" starts
    root.append(heading(m.level));
    const scope = el('canvas', 'ring__scope');
    scope.width = 680;
    scope.height = 108;
    root.append(scope);
    const meter = el('div', 'ring__meter');
    for (let i = 0; i < CELLS; i++) meter.append(el('i'));
    const line = el('span', 'ring__thresh');
    meter.append(line);
    root.append(meter);
    const stateRow = el('div', 'ring__state');
    const word = el('b', '', m.quiet);
    const device = el('span', '', '');
    stateRow.append(word, device);
    root.append(stateRow);

    // how sensitive
    root.append(slider({
      left: m.sensitivity,
      right: '',
      min: 0,
      max: 1,
      step: 0.01,
      value: cfg.micSensitivity ?? 0.4,
      show: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => c.drag({ micSensitivity: v }),
      onChange: () => c.drop(),
    }));
    root.append(note(m.sensHint, true));

    // which microphone (the names fill in once the mic is open: the browser keeps them back until then)
    root.append(heading(m.device));
    const devices = el('div');
    root.append(devices);
    let alive = true;
    c.onLeave(() => { alive = false; });
    Promise.resolve(opened).then(() => ears.devices()).then((list) => {
      if (!alive) return;
      const items = list.map((d) => ({ id: d.id, label: d.id ? d.label : m.defaultDevice }));
      devices.replaceChildren(pick(items, cfg.micDevice || '', (id) => c.set({ micDevice: id })));
      const current = items.find((d) => d.id === (cfg.micDevice || ''));
      device.textContent = current && current.id ? current.label.slice(0, 34) : '';
    }).catch(() => {});

    // how she's talked to
    root.append(heading(m.mode));
    root.append(pick([{ id: 'ptt', label: m.ptt }, { id: 'converse', label: m.converse }], cfg.converse ? 'converse' : 'ptt', (id) => c.set({ converse: id === 'converse' })));
    root.append(note(fmt(m.pttKey, { key: prettyKey(cfg.pushToTalk) }), true));
    root.append(toggle(m.meter, cfg.micMeter !== false, (v) => c.set({ micMeter: v })));
    root.append(row(fmt(m.stt, { engine: m.engines[cfg.sttEngine] || cfg.sttEngine || '…' }), go(c, m.setup, 'setupEars')));

    // the live part
    const cells = [...meter.querySelectorAll('i')];
    const pen = getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#ff2152';
    const g = scope.getContext('2d');
    let was = -1;
    let hearing = false;
    const tick = () => {
      const level = ears.stream ? ears.level : 0;
      const threshold = meterLevel(micThreshold(cfg.micSensitivity ?? 0.4));
      const lit = Math.round(level * CELLS);
      const cut = Math.round(threshold * CELLS);
      line.style.left = `calc(${(threshold * 100).toFixed(1)}% - 1px)`;
      if (lit !== was) {
        was = lit;
        cells.forEach((cell, i) => { cell.className = i < lit ? (i >= cut ? 'is-lit is-hot' : 'is-lit') : ''; });
      }
      const now = level >= threshold && level > 0.02;
      if (now !== hearing) {
        hearing = now;
        word.textContent = now ? m.hearing : m.quiet;
        stateRow.classList.toggle('is-hearing', now);
      }
      // her waveform, in her colour
      g.clearRect(0, 0, scope.width, scope.height);
      g.strokeStyle = pen;
      g.lineWidth = 3;
      g.beginPath();
      const data = ears.stream ? ears.vadData : null;
      const mid = scope.height / 2;
      if (data?.length) {
        const step = data.length / 170;
        for (let x = 0; x <= 170; x++) {
          const v = ((data[Math.floor(x * step)] - 128) / 128) * 3.2;
          const y = mid - Math.max(-1, Math.min(1, v)) * (mid - 6);
          if (x) g.lineTo((x / 170) * scope.width, y);
          else g.moveTo(0, y);
        }
      } else {
        g.moveTo(0, mid);
        g.lineTo(scope.width, mid);
      }
      g.stroke();
    };
    tick();
    const timer = setInterval(tick, 50);
    c.onLeave(() => clearInterval(timer));
    return root;
  },
};

// ---------- Senses ----------

const senses = {
  render(c) {
    const { t, cfg, host } = c;
    const s = t.senses;
    const win = isWindows(host);
    const root = el('div');
    root.append(toggle(s.vision, cfg.vision === true, (v) => c.set({ vision: v })));
    root.append(buttons(
      go(c, s.look, 'lookNow', {}, { disabled: cfg.vision !== true }),
      go(c, s.visionSetup, 'setupVision'),
    ));
    root.append(toggle(s.rhythm, cfg.rhythm === true, (v) => c.set({ rhythm: v })));
    root.append(heading(''));
    root.append(toggle(s.hands, cfg.hands === true, (v) => c.set({ hands: v }), { disabled: !win, hint: win ? '' : s.winOnly }));
    root.append(toggle(s.handsType, cfg.handsType !== false, (v) => c.set({ handsType: v }), { disabled: !win || cfg.hands !== true }));
    root.append(note(s.privacy, true));
    return root;
  },
};

// ---------- Character ----------

const character = {
  render(c) {
    const { t, cfg, host } = c;
    const k = t.character;
    const win = isWindows(host);
    const root = el('div');
    root.append(toggle(k.emotions, cfg.emotions !== false, (v) => c.set({ emotions: v })));
    root.append(toggle(k.life, cfg.life !== false, (v) => c.set({ life: v })));
    root.append(toggle(k.musicAware, cfg.musicAware !== false, (v) => c.set({ musicAware: v }), { disabled: !win }));
    root.append(toggle(k.dj, cfg.dj !== false, (v) => c.set({ dj: v }), { disabled: !win || cfg.musicAware === false }));
    root.append(toggle(k.learn, cfg.learn !== false, (v) => c.set({ learn: v })));
    root.append(heading(''));
    root.append(toggle(k.wander, cfg.wander === true, (v) => c.set({ wander: v })));
    root.append(toggle(k.possess, cfg.possess === true, (v) => c.set({ possess: v })));
    root.append(buttons(go(c, k.custom, 'customize'), cfg.claude ? go(c, k.report, 'report') : null));
    return root;
  },
};

// ---------- Colours ----------

const colours = {
  render(c) {
    const { t, cfg } = c;
    const k = t.colours;
    const root = el('div');
    root.append(note(k.hint, true));
    const grid = el('div', 'ring__swatches');
    const current = cfg.theme || 'classic';
    for (const id of THEME_IDS) {
      const b = el('button', `ring__swatch${id === current ? ' is-on' : ''}`);
      b.type = 'button';
      b.dataset.theme = id;
      const fx = { ...THEMES.classic.fx, ...(THEMES[id]?.fx || {}) };
      b.style.setProperty('--a', fx.red);
      b.style.setProperty('--b', fx.violet);
      b.append(el('span', 'ring__swatch-chip'), document.createTextNode(k.themes[id] || id));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (id !== current) c.set({ theme: id });
      });
      grid.append(b);
    }
    root.append(grid);
    return root;
  },
};

// ---------- Voice ----------

const voice = {
  render(c) {
    const { t, cfg } = c;
    const v = t.voice;
    const root = el('div');
    root.append(pick(['off', 'chat', 'all'].map((id) => ({ id, label: v[id] })), cfg.voiceMode || 'chat', (id) => c.set({ voiceMode: id })));
    root.append(heading(''));
    root.append(toggle(v.mute, cfg.muted === true, (on) => c.set({ muted: on })));
    root.append(slider({
      left: v.volume,
      min: 0,
      max: 1,
      step: 0.05,
      value: cfg.volume ?? 0.7,
      show: (x) => `${Math.round(x * 100)}%`,
      onInput: (x) => {
        c.drag({ volume: x });
        c.voice?.configure({ volume: x });
      },
      onChange: () => c.drop(),
    }));
    root.append(heading(v.engine));
    root.append(pick(['system', 'openai', 'elevenlabs', 'custom'].map((id) => ({ id, label: v.engines[id] })), cfg.ttsEngine || 'system', (id) => c.set({ ttsEngine: id })));
    root.append(buttons(go(c, v.setup, 'setupVoice'), go(c, v.test, 'testVoice')));
    return root;
  },
};

// ---------- More ----------

const LANGS = [['auto', null], ['fr', 'Français'], ['en', 'English'], ['es', 'Español'], ['pt', 'Português'], ['ru', 'Русский']];
const SIZES = [['small', 0.45], ['medium', 0.6], ['large', 0.8]];

const more = {
  render(c) {
    const { t, cfg, host } = c;
    const m = t.more;
    const root = el('div');
    const size = SIZES.reduce((best, [id, scale]) => (Math.abs(scale - (cfg.scale ?? 0.8)) < Math.abs(best[1] - (cfg.scale ?? 0.8)) ? [id, scale] : best), SIZES[2])[0];
    root.append(row(m.size, seg(SIZES.map(([id, scale]) => ({ id, label: m[id], scale })), size, (id) => c.set({ scale: SIZES.find(([s]) => s === id)[1] }))));
    root.append(row(m.rest, seg([{ id: 'corner', label: m.corner }, { id: 'taskbar', label: m.taskbar }], cfg.rest || 'corner', (id) => c.set({ rest: id }))));
    root.append(row(m.lang, null));
    root.append(seg(LANGS.map(([id, name]) => ({ id, label: name || m.auto })), cfg.lang || 'auto', (id) => c.set({ lang: id })));
    root.append(heading(''));
    root.append(buttons(
      go(c, m.teleport, 'teleport'),
      go(c, m.satellite, 'satellite'),
      go(c, m.help, 'welcome'),
      go(c, m.model, 'setupChat'),
    ));
    root.append(buttons(
      button(m.hide, () => {
        c.hide();
        host.setConfig({ visible: false });
        c.actions.run?.('stow', { on: true });
      }),
      button(m.system, () => {
        c.hide();
        host.openMenu();
      }),
    ));
    return root;
  },
};

export const TABS = { bond, mic, senses, character, colours, voice, more, chat: { render: () => el('div') } };
