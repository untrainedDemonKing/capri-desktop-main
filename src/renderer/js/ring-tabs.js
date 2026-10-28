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
import { PROVIDERS, GROUPS, needsKey, isLocal } from './brain-providers.js';

export const ORDER = ['bond', 'brain', 'mic', 'senses', 'character', 'colours', 'voice', 'more', 'chat'];

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

// ---------- AI: who answers her ----------

const brain = {
  sub(c) {
    return c.cfg.provider ? (PROVIDERS[c.cfg.provider]?.name || c.cfg.provider) : '';
  },
  render(c) {
    const { t, cfg, host, state } = c;
    const b = t.brain;
    const root = el('div');
    const provider = cfg.provider || 'ollama';
    const keys = cfg.keys || [];

    // what's known about whoever answers her now (the models, or why it can't): asked once per visit
    if (state.asked !== provider && !state.loading) {
      state.loading = true;
      state.asked = provider;
      Promise.resolve(host.chatModels?.()).catch(() => null).then((info) => {
        state.loading = false;
        state.info = { ...(info || { models: [], error: '' }), provider }; // (for the one that was asked about)
        if (c.open) c.refresh();
      });
    }
    if (state.codeFound === undefined) {
      state.codeFound = null;
      Promise.resolve(host.claudeFound?.()).catch(() => false).then((found) => {
        state.codeFound = Boolean(found);
        if (c.open) c.refresh();
      });
    }
    const info = state.info?.provider === provider ? state.info : null;
    const models = info?.models || [];
    const connected = Boolean(info) && models.length > 0 && !info.error;

    // the state of it all, and a way to check
    const head = el('div', 'ring__link');
    const dot = el('i', `ring__dot${connected ? ' is-on' : ''}`);
    const name = PROVIDERS[provider]?.name || provider;
    const model = models.find((m) => m.id === info?.current)?.label || info?.current || '';
    const line = el('div', 'ring__link-text');
    line.append(el('b', '', connected ? b.on : state.busy || state.loading ? b.checking : b.off));
    line.append(el('span', '', connected ? fmt(b.using, { name, model }) : info?.error ? String(info.error).slice(0, 110) : name));
    head.append(dot, line);
    root.append(head);
    root.append(buttons(button(b.test, async () => {
      state.busy = 'test';
      state.result = '';
      c.refresh();
      const res = await host.chatStatus().catch((err) => ({ ok: false, error: err.message }));
      state.busy = null;
      state.asked = null; // (asked again)
      state.result = res?.ok ? fmt(b.works, { n: models.length || 1 }) : `${b.fails} ${String(res?.error || '').slice(0, 100)}`;
      if (c.open) c.refresh();
    }, { disabled: Boolean(state.busy) })));
    if (state.result) root.append(note(state.result, true));

    // the key (or the address) of the one you're setting up
    const chosen = state.pick;
    if (chosen && PROVIDERS[chosen]) {
      const pname = PROVIDERS[chosen].name;
      const isUrl = chosen === 'custom';
      root.append(heading(isUrl ? b.urlH : fmt(b.keyH, { name: pname })));
      const form = el('form', 'ring__form');
      const input = el('input', 'ring__input');
      input.type = isUrl ? 'text' : 'password';
      input.placeholder = isUrl ? b.urlPlaceholder : b.keyPlaceholder;
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.value = state.draft || '';
      input.addEventListener('input', () => { state.draft = input.value; });
      form.append(input, button(b.connect, () => form.requestSubmit(), { primary: true, disabled: Boolean(state.busy) }));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = input.value.trim();
        if (!value) { input.focus(); return; }
        connect(c, chosen, isUrl ? { url: value } : { key: value });
      });
      root.append(form);
      if (state.error) root.append(note(`${b.fails} ${state.error}`));
      if (!isUrl) {
        root.append(note(fmt(b.keyNote, { name: pname }), true));
        if (chosen === 'anthropic') root.append(note(b.envNote, true));
        root.append(buttons(
          button(b.page, () => host.keyPage(chosen)), // (main.js setup.js KEY_PAGES: every service that takes a key has one)
          button(b.fromEnv, () => connect(c, chosen, {}), { disabled: Boolean(state.busy) }),
        ));
      }
      c.focus(input);
    } else if (state.error) root.append(note(`${b.fails} ${state.error}`));

    // who answers
    for (const group of GROUPS) {
      root.append(heading(b.groups[group]));
      const items = Object.entries(PROVIDERS).filter(([, p]) => p.group === group);
      const box = el('div', 'ring__providers');
      for (const [id] of items) {
        const [label, hint] = b.providers[id] || [PROVIDERS[id].name, ''];
        const on = id === provider;
        const btn = el('button', `ring__provider${on ? ' is-on' : ''}${state.pick === id ? ' is-pick' : ''}`);
        btn.type = 'button';
        btn.append(el('span', 'ring__provider-name', label));
        const tag = needsKey(id) && keys.includes(id) ? b.hasKey : '';
        btn.append(el('span', 'ring__provider-hint', [hint, tag && `· ${tag}`].filter(Boolean).join(' ')));
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (state.busy) return;
          state.error = '';
          if (needsKey(id) && !keys.includes(id)) { state.pick = id; c.refresh(true); return; } // asks for the key
          if (id === 'custom') { state.pick = id; c.refresh(true); return; } // and the address
          state.pick = null;
          if (id !== provider) connect(c, id);
        });
        box.append(btn);
      }
      root.append(box);
    }

    // what's special about the one that answers now
    if (provider === 'claude') root.append(note(state.codeFound === false ? b.codeMissing : b.codeNote, true));
    if (provider === 'ollama' && info && !models.length) root.append(note(b.ollamaDown, true));
    // Ollama, started by her from its folder: how it is doing, and the preparation window for what is missing
    if (provider === 'ollama' && host.ollamaStatus) {
      const box = el('div');
      root.append(box);
      const paint = (st) => {
        const text = st.phase === 'ready' ? b.ollReady.replace('{model}', st.model ? `: ${st.model}` : '')
          : st.phase === 'starting' ? b.ollStarting
          : st.phase === 'failed' ? b.ollFailed.replace('{error}', String(st.error || '').slice(0, 140))
          : b.ollOff;
        box.replaceChildren(note(text, st.phase !== 'failed'), buttons(button(b.ollPrepare, () => host.prepareShow?.())));
      };
      host.ollamaStatus().then(paint).catch(() => {});
      c.onLeave(host.onOllama(paint));
    }
    if (isLocal(provider)) root.append(note(b.localNote, true));
    else if (provider !== 'claude') root.append(note(b.cloudNote, true));
    if (keys.includes(provider) && needsKey(provider) && state.pick !== provider) {
      root.append(buttons(button(b.changeKey, () => { state.pick = provider; state.draft = ''; c.refresh(true); })));
    }

    // the model
    if (models.length > 1) {
      root.append(heading(b.modelH));
      root.append(pick_(models, info.current, (id) => c.set({ chatModel: id })));
      if (provider === 'anthropic') root.append(note(b.claudeNote, true));
    } else if (provider === 'anthropic' && connected) root.append(note(b.claudeNote, true));

    root.append(heading(''));
    root.append(buttons(go(c, b.wizard, 'setupChat')));
    return root;
  },
};

// the models as a column of rows
const pick_ = (models, current, onPick) => pick(models.map((m) => ({ id: m.id, label: m.label })), current, onPick);

// Connecting: saved and tried, and put back as it was if it doesn't work (main.js setup:use).
async function connect(c, provider, extra = {}) {
  const { state, host } = c;
  state.busy = provider;
  state.error = '';
  c.refresh();
  const res = await host.useProvider({ provider, ...extra }).catch((err) => ({ ok: false, error: err.message }));
  state.busy = null;
  if (res?.ok) {
    state.pick = null;
    state.draft = '';
    state.asked = null; // (the models of the new one are asked for)
    state.result = '';
    c.cfg.provider = provider;
    if (extra.key) c.cfg.keys = [...new Set([...(c.cfg.keys || []), provider])];
  } else {
    state.pick = provider;
    state.error = String(res?.error || 'failed').slice(0, 140);
  }
  if (c.open) c.refresh();
}

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
    root.append(toggle(k.possessMove, cfg.possess === true && cfg.possessMove !== false, (v) => c.set({ possessMove: v }), { disabled: cfg.possess !== true || !win }));
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
    root.append(pick(['system', 'piper', 'chatterbox', 'openai', 'elevenlabs', 'custom'].map((id) => ({ id, label: v.engines[id] })), cfg.ttsEngine || 'system', (id) => c.set({ ttsEngine: id })));
    // Chatterbox, on this PC: whether it is up, which folder, and a button to start it again
    if (cfg.ttsEngine === 'chatterbox' && c.host.chatterboxStatus) {
      const box = el('div');
      root.append(box);
      const paint = (st) => {
        const text = st.phase === 'ready' ? v.cbReady
          : st.phase === 'starting' ? v.cbStarting
          : st.phase === 'failed' ? v.cbFailed.replace('{error}', String(st.error || '').slice(0, 160))
          : v.cbOff;
        box.replaceChildren(
          note(text, st.phase !== 'failed'),
          note(st.dir ? v.cbDir.replace('{dir}', st.dir) : v.cbNoDir, true),
          ...(st.phase === 'starting' && st.log?.length ? [note(st.log[st.log.length - 1].slice(0, 120), true)] : []),
          buttons(
            button(v.cbFolder, () => { c.host.chatterboxChoose().then(() => c.refresh()); }),
            button(v.cbRestart, () => { c.host.chatterboxRestart().then(paint); }),
            button(v.cbPrepare, () => c.host.prepareShow?.()),
          ),
        );
      };
      c.host.chatterboxStatus().then(paint).catch(() => {});
      c.onLeave(c.host.onChatterbox(paint));
    }
    // Piper, on this PC: whether it works, which voice, and the preparation window
    if (cfg.ttsEngine === 'piper' && c.host.piperStatus) {
      const box = el('div');
      root.append(box);
      const paint = (st) => {
        const text = st.phase === 'ready' ? v.ppReady.replace('{voice}', st.voice || '')
          : st.phase === 'starting' ? v.ppStarting
          : st.phase === 'failed' ? v.ppFailed.replace('{error}', String(st.error || '').slice(0, 160))
          : v.ppOff;
        box.replaceChildren(note(text, st.phase !== 'failed'), buttons(button(v.cbPrepare, () => c.host.prepareShow?.())));
      };
      c.host.piperStatus().then(paint).catch(() => {});
      c.onLeave(c.host.onPiper(paint));
    }
    root.append(buttons(go(c, v.setup, 'setupVoice'), go(c, v.test, 'testVoice')));

    // where it comes out: speakers, headphones... (and your own mic there, to check)
    const { voice: sound, ears, state } = c;
    root.append(heading(v.outH));
    root.append(note(sound?.canPickOutput === false ? v.outNone : `${v.outNote}${cfg.ttsEngine === 'system' || !cfg.ttsEngine ? ` ${v.outSystem}` : ''}`, true));
    if (sound?.canPickOutput !== false) {
      const list = el('div');
      root.append(list);
      let alive = true;
      c.onLeave(() => { alive = false; });
      sound?.outputs().then((outs) => {
        if (!alive) return;
        const items = outs.map((d) => ({ id: d.id, label: d.id ? d.label : v.outDefault }));
        list.replaceChildren(pick(items, cfg.audioOut || '', (id) => {
          c.set({ audioOut: id });
          setTimeout(() => sound.test(), 350); // a sound on it, to hear it's the right one
        }));
      }).catch(() => {});
      if (sound?.sinkError) root.append(note(v.outFailed));
    }
    root.append(buttons(button(v.outTest, () => sound?.test())));
    root.append(toggle(v.monitor, state.monitor === true && cfg.ears === true, (on) => {
      state.monitor = on;
      state.monitorFailed = false;
      if (on) {
        c.hold('monitor', () => ears.monitor(true).then((ok) => {
          if (!ok) {
            state.monitor = false;
            state.monitorFailed = true;
            c.unhold('monitor');
            c.refresh();
          }
          return ok;
        }), () => ears.monitor(false));
      } else c.unhold('monitor');
      c.refresh();
    }, { disabled: !cfg.ears, hint: cfg.ears ? '' : v.monitorNeeds }));
    root.append(note(state.monitorFailed ? v.monitorFailed : v.monitorHint, !state.monitorFailed));
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

export const TABS = { bond, brain, mic, senses, character, colours, voice, more, chat: { render: () => el('div') } };
