import { Capri } from './capri.js';
import { FxLayer, GRAB_FRAMES } from './fx.js';
import { Chip, Mask } from './chip.js';
import { Panel } from './panel.js';
import { Voice } from './voice.js';
import { Brain } from './brain.js';
import { Guide } from './guide.js';
import { Mission } from './mission.js';
import { Chat } from './chat.js';
import { Setup } from './setup.js';
import { Custom } from './custom.js';
import { Heart } from './heart.js';
import { Life } from './life.js';
import { Speech } from './speech.js';
import { Eyes } from './eyes.js';
import { Rhythm } from './rhythm.js';
import { Hands } from './hands.js';
import { Ears } from './ears.js';
import { Bond } from './bond.js';
import { Ring } from './ring.js';
import { applyTheme, resolveTheme, askedTheme } from './themes.js';
import { classify } from './mood.js';
import { linesFor } from './lines.js';
import { lifeLines } from './lines-life.js';
import { pick, fmt, reducedMotion } from './util.js';

const host = window.host;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// close-ups of her for the cut-ins, frames of the show (tools/build-cutins.py)
const CUTINS = ['grin', 'laugh', 'eyes', 'many', 'look'];
const WATCH_MS = 2000; // how often she checks the pointer still reaches her

// what you made her, from the config (custom.js)
const mine = (cfg) => ({ userName: cfg.userName || '', persona: cfg.persona || '', myLines: cfg.myLines || [], memories: cfg.memories || [] });

async function boot() {
  const [config, image, intro, ...cutins] = await Promise.all([
    host.getConfig(),
    loadImage('../../assets/capri/capri-full.png'),
    // her intro: her close-up grabbing the screen, and its drawings with her mouth and arm moving
    Promise.all(GRAB_FRAMES.map((name) => loadImage(`../../assets/capri/intro-${name}.webp`).catch(() => null)))
      // decoded now, not the first time each one shows up (a hitch right on "hi", on the wave)
      .then((cels) => Promise.all(cels.map((cel) => cel && createImageBitmap(cel))))
      .then((cels) => (cels[0] ? Object.fromEntries(GRAB_FRAMES.map((name, i) => [name, cels[i]])) : null)),
    ...CUTINS.map((name) => loadImage(`../../assets/capri/cutin-${name}.png`)),
    document.fonts.load('600 16px "Chakra Petch"'),
    document.fonts.load('400 11px "JetBrains Mono"'),
  ]);
  document.documentElement.lang = config.lang;
  // her animations: like Windows, full or reduced (her menu)
  const applyMotion = (setting) => {
    reducedMotion.setting = setting || 'auto';
    document.documentElement.dataset.motion = reducedMotion.matches ? 'reduced' : 'full';
  };
  applyMotion(config.motion);
  reducedMotion.onSystemChange(() => applyMotion(reducedMotion.setting));

  const fx = new FxLayer(document.getElementById('fx'), {
    cutins: Object.fromEntries(CUTINS.map((name, i) => [name, cutins[i]])),
    intro,
  });
  fx.resize(innerWidth, innerHeight);
  // how far the top of the taskbar is from the bottom of her window: she covers it too while she
  // rests on it (the floor she stands on stays its top)
  let floorGap = config.floorGap ?? 0;
  const chip = new Chip(document.getElementById('chip'));
  chip.place(innerWidth, innerHeight - floorGap);
  const mask = new Mask(document.getElementById('mask'));

  const voice = new Voice();
  voice.configure(config);
  host.listSounds().then((list) => list.length && voice.loadCustom(list));

  const panel = new Panel({
    panel: document.getElementById('panel'),
    ticker: document.getElementById('ticker'),
    labels: linesFor(config.lang, config.assistant),
  });

  const capri = new Capri({
    root: document.getElementById('capri'),
    canvas: document.getElementById('sprite'),
    image,
    fx,
    voice,
  });
  capri.wander = config.wander;
  capri.possessWindows = config.possess;
  capri.moveWindows = config.possessMove !== false;
  // she can move the windows she has taken over (the host does it: main/mover.js)
  if (host.windowGrab && host.platform === 'win32') capri.mover = { grab: (id) => host.windowGrab(id), move: (id, x, y) => host.windowMove(id, x, y), release: (id, restore) => host.windowRelease(id, restore) };
  host.onWindowLost?.(({ id }) => capri.moverLost(id));
  capri.restOn = config.rest || 'corner';
  capri.lang = config.lang;
  capri.setView(innerWidth, innerHeight, innerHeight - floorGap);
  capri.setScale(config.scale);

  const mission = new Mission();
  const brain = new Brain({ capri, panel, voice, host, mission, lang: config.lang, assistant: config.assistant });

  // Her feelings (heart.js, mood.js): what she shows, and her colours when they follow her mood.
  const heart = new Heart({ capri, panel, voice, brain, host });
  brain.heart = heart;
  let themeSetting = config.theme || 'classic';
  let themeShown = applyTheme(resolveTheme(themeSetting, heart.state.mood), { capri });
  heart.onMood = (state) => {
    host.moodState({ mood: state.mood, level: state.level });
    if (themeSetting === 'mood') themeShown = applyTheme(resolveTheme('mood', state.mood), { capri });
  };
  heart.configure(config);
  heart.start();
  // Her bond with you (bond.js): she learns who she's talking to, adapts to you, and grows closer.
  const bond = new Bond({ host, brain, heart });
  bond.configure(config);
  bond.start().catch(() => {});
  brain.bond = bond;
  // Her voice (speech.js): her chat answers read out, or everything she says
  const speech = new Speech({ voice, host });
  speech.configure(config);
  speech.onTalk = () => capri.perform('talk');
  let voiceWarned = 0;
  speech.onError = (error) => {
    if (Date.now() - voiceWarned < 10 * 60000) return; // said once in a while, not on every line
    voiceWarned = Date.now();
    panel.say({ kind: 'error', face: 'aside', line: fmt(lifeLines(brain.lang).voice.failed, { error: String(error).slice(0, 90) }), hold: 6000 });
  };
  panel.onLine = (msg) => {
    if (speech.wants('line') && msg.kind !== 'chat') speech.say(msg.line, { mood: heart.state.mood, kind: 'line' });
  };

  // Click-through everywhere except on her body, the panel and her biochip.
  let interactive = false;
  let mouse = null;
  const setInteractive = (on) => {
    if (on === interactive) return;
    interactive = on;
    host.setInteractive(on);
  };
  const onChip = () => Boolean(chip.visible && mouse && chip.contains(mouse.x, mouse.y, 0));
  let onHer = false; // the pointer is on her body (as of the last refreshHit)
  let ring = null; // her circular menu (below): while it's open the whole overlay takes clicks
  const refreshHit = () => {
    onHer = false;
    if (capri.dragging || ring?.open) return setInteractive(true);
    if (!mouse) return setInteractive(false);
    const r = panel.rect();
    const onPanel = r && mouse.x >= r.left && mouse.x <= r.right && mouse.y >= r.top && mouse.y <= r.bottom;
    const chipHit = onChip();
    document.body.style.cursor = chipHit ? 'pointer' : '';
    onHer = capri.hit(mouse.x, mouse.y);
    return setInteractive(Boolean(onPanel || onHer || chipHit));
  };
  // Her biochip: her eyes on it follow the pointer over it, and she comes out when you click it
  // (only then, so the pointer passing through that corner doesn't call her back).
  // Her mask, asleep: the pointer coming over it stirs her, and a moment of that wakes her up.
  let wakeTimer = 0;
  const comeOut = () => {
    if (capri.stowed) host.setConfig({ visible: true }); // the tray and Ctrl+Alt+C follow
    capri.unstow();
  };
  const hoverChip = () => {
    chip.pointer = chip.visible && mouse && chip.contains(mouse.x, mouse.y) ? mouse : null;
    const near = mask.visible && mouse && mask.contains(mouse.x, mouse.y, 30);
    mask.pointer = near ? mouse : null;
    if (!near) {
      clearTimeout(wakeTimer);
      wakeTimer = 0;
    } else if (!wakeTimer) {
      wakeTimer = setTimeout(() => {
        wakeTimer = 0;
        if (capri.dormant) capri.wake();
      }, 400);
    }
  };
  let lastMove = 0;
  window.addEventListener('mousemove', (e) => {
    lastMove = performance.now();
    mouse = { x: e.clientX, y: e.clientY };
    refreshHit();
    hoverChip();
    // tickling her, patting her head, shaking the pointer about, resting it by her (heart.js)
    heart.moved(mouse.x, mouse.y);
    if (!capri.hidden && capri.stance !== 'fall') {
      const h = onHer && capri.head();
      const onHead = onHer && Math.hypot(mouse.x - h.x, mouse.y - (h.y - 34 * capri.scale)) < 62 * capri.scale;
      heart.pointer(onHer, onHead);
    }
  });
  document.addEventListener('mouseleave', () => {
    mouse = null;
    refreshHit();
    hoverChip();
  });
  // Where the pointer really is, every couple of seconds: if it moved over her window and no
  // mousemove came, the hook that brings it to her is gone (Windows drops it without a word, after
  // sleep say), and main.js puts in a new one.
  let seen = null;
  let rearmedAt = -Infinity;
  let restLevel = 'awake'; // how deeply she rests (updateRest below)
  const watchPointer = async () => {
    const at = await host.cursor().catch(() => null);
    const before = seen;
    seen = at;
    const now = performance.now();
    const moved = at?.inside && before?.inside && (at.x !== before.x || at.y !== before.y);
    if (moved && now - lastMove >= WATCH_MS * 1.5 && now - rearmedAt >= 20000) {
      rearmedAt = now;
      host.rearm();
    }
    // resting deeply, only her mask or chip can be clicked: no need to check as often
    setTimeout(watchPointer, restLevel === 'deep' ? WATCH_MS * 3 : WATCH_MS);
  };
  setTimeout(watchPointer, WATCH_MS);
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (chip.visible && chip.contains(e.clientX, e.clientY, 0)) host.openMenu();
  });
  window.addEventListener('click', (e) => {
    if (chip.visible && chip.contains(e.clientX, e.clientY, 0)) comeOut();
  });

  // wiring
  capri.onMove = (head) => {
    // pointing at something: the panel goes on her other side, so it doesn't cover it
    panel.setAnchor({ ...head, lean: capri.pointing ? -capri.pointing.dir : 0 }, capri.view);
    // she may have moved out from under a still pointer: never leave a dead click zone behind
    refreshHit();
  };
  capri.onTeleport = (phase) => {
    if (phase === 'start') {
      ring?.hide(); // she's off somewhere (or folding away): the menu was drawn round where she stood
      panel.suspend();
    } else panel.resume();
  };
  capri.chipAt = () => chip.center();
  capri.onStow = () => {
    chip.setMode(capri.mode);
    chip.show();
  };
  capri.onUnstow = () => chip.hide();
  capri.onDoze = (phase, face) => {
    if (phase === 'start') {
      mask.place(face.x, face.y, capri.scale * 1.1);
      mask.show();
    } else if (phase === 'waking') {
      mask.wake();
    } else {
      mask.hide();
    }
  };
  capri.onMode = (mode, prev) => chip.setMode(mode, prev);
  // now and then she says something about the satellite: while she looks at it, or once
  // the red light has gone up (never during, nothing should cover that)
  capri.onGaze = (when) => {
    const lines = when === 'end' ? brain.t.uplink : brain.t.gaze;
    if (!panel.visible && Math.random() < (when === 'end' ? 0.6 : 0.4)) panel.say({ kind: 'info', line: pick(lines), hold: 3800 });
  };
  capri.onClick = (click) => {
    if (heart.poke()) return; // poked too many times: she's had it
    const double = heart.tapped(); // the second click of two: she has a word about it, instead of putting her line away
    if (panel.visible && !(double && panel.current?.kind === 'idle')) panel.hide();
    else brain.status({ ...click, double });
  };
  capri.onDrop = (drop) => heart.dragged(drop);
  // With no AI to answer her she says so, with a button for her main menu; asked now and then (not while she is being set up)
  heart.onConnect = () => host.hubShow?.();
  let aiTimer = 0;
  const checkAi = async () => {
    clearTimeout(aiTimer);
    heart.aiReady = (await host.chatReady?.().catch(() => 'ready')) !== 'none';
    // (with one connected she hardly needs to ask again; without, she looks every minute and a half)
    aiTimer = setTimeout(checkAi, heart.aiReady ? 15 * 60000 : 90000);
  };
  const askAiSoon = (ms) => {
    clearTimeout(aiTimer);
    aiTimer = setTimeout(checkAi, ms);
  };
  askAiSoon(8000);
  panel.onChar = (kind) => voice.play('blip', { mood: kind });
  panel.onTalk = (talking) => talking && capri.perform('talk');
  capri.onMenu = () => (ring ? ring.toggle() : host.openMenu()); // right-click: her circular menu

  // Her guide (guide.js): her welcome on first launch, and "How does it work?" in her menu,
  // where she takes you to things and points at them.
  const guide = new Guide({ capri, panel, voice, host, brain });
  // Talking to her (chat.js): "Talk to her" in her menu, or the button when you click her idle.
  const chat = new Chat({ capri, panel, voice, host, brain });
  brain.onTalk = () => chat.start();
  chat.heart = heart;
  chat.speech = speech;
  chat.bond = bond;
  // Her own little life (life.js): things to do, music, noticing you
  const life = new Life({ capri, panel, voice, host, brain, heart, fx });
  life.chat = chat;
  life.guide = guide;
  life.configure(config);
  life.start();
  chat.life = life;
  // she has been in one of your windows: a word about what she did there, now and then
  capri.onPossessed = (kind) => {
    const lines = life.t.possessed?.[kind];
    if (lines && Math.random() < 0.55 && life.free()) life.say(pick(lines), { face: 'smug', hold: 4200 });
  };

  // Her senses and her hands, all off until you turn them on (each in her menu).
  // Eyes: she takes a look at your screen and reacts (eyes.js, screen.js).
  const eyes = new Eyes({ host, brain, heart, panel, capri, voice, life });
  eyes.configure(config);
  chat.eyes = eyes;
  // Hands: windows and messages on your PC, only when you ask (hands.js, control.js).
  const hands = new Hands({ host, capri, panel, voice, brain });
  hands.configure(config);
  chat.hands = hands;
  // She moves to your real music (rhythm.js): the beat drives her, and she keeps her headphones on.
  const rhythm = new Rhythm({ host, capri });
  rhythm.onPlaying = (playing) => {
    capri.setDancing(playing); // she grooves whenever she's standing (capri.baseAct)
    life.setAudio(playing);    // headphones on while there's sound, even if no player reports a title
  };
  rhythm.configure(config);
  // Ears: you talk, she writes it down and answers (ears.js, stt.js); speech.js reads her answer out.
  const ears = new Ears({ host, capri, panel, voice, brain, speech });
  ears.configure(config);
  ears.onTranscript = (text) => {
    // show what you said and send it to her chat (open it first if need be)
    if (!chat.open) chat.start().then(() => setTimeout(() => chat.say(text), 400));
    else chat.say(text);
  };
  // Her circular menu (ring.js): right-click her. Its settings are the tray menu's, plus the mic and the bond.
  ring = new Ring({
    host, capri, panel, brain, bond, ears, voice,
    actions: { run: (name, extra) => runCommand({ name, ...extra }) },
  });
  ring.configure(config);
  ring.onToggle = () => refreshHit(); // click-through again once it's shut
  panel.onUrgent = () => ring.hide();  // a permission prompt, a chat or her guide: the menu steps aside
  ring.onGuide = () => { guide.answer(null); panel.hide(); }; // (and the other way: the menu opened over her guide's question)
  life.ring = ring;
  eyes.ring = ring;
  // the always-visible badge: a sense is never silently on
  const sensesEl = document.getElementById('senses');
  const eyeEl = sensesEl.querySelector('.senses__eye');
  const micEl = sensesEl.querySelector('.senses__mic');
  const barsEl = micEl.querySelector('.senses__bars');
  let meterOn = config.micMeter !== false;
  const showSenses = ({ listening = false } = {}) => {
    const ll = lifeLines(brain.lang);
    eyeEl.hidden = !eyes.enabled;
    eyeEl.querySelector('.senses__label').textContent = ll.eyes.badge;
    micEl.hidden = !ears.enabled;
    micEl.classList.toggle('is-live', listening);
    barsEl.hidden = !meterOn || !(listening || ears.stream);
    micEl.querySelector('.senses__label').textContent = listening ? ll.ears.listening : 'MIC';
    sensesEl.hidden = eyeEl.hidden && micEl.hidden;
  };
  ears.onState = (state) => {
    // 'metering': the mic is open only to show its level (her ring menu's Mic tab): live all the same
    const live = state === 'listening' || state === 'metering';
    host.senseState({ eyes: eyes.enabled, ears: ears.enabled, listening: live });
    showSenses({ listening: live });
    if (state === 'listening') capri.perform?.('curious', capri.towardCenter());
  };
  // the level in the badge, a dozen times a second at most
  let barsAt = 0;
  ears.onLevel = (level) => {
    const now = performance.now();
    if (!meterOn || now - barsAt < 80) return;
    barsAt = now;
    barsEl.style.setProperty('--lvl', level.toFixed(2));
  };
  showSenses();
  // while she's talking, her ears don't listen to her own voice
  speech.onStart = () => ears.heardSelf(true);
  speech.onDone = () => ears.heardSelf(false);

  // How deeply she rests: awake, dozing (still drawn, 6 drawings a second), or deep (down to her
  // mask, or put away in her chip). Resting deeply she costs next to nothing: her body isn't drawn,
  // the main process stops watching your windows and music, she stops listening for beats, and she
  // checks things less often. Anything that wakes her brings it all back.
  const updateRest = () => {
    const level = capri.dormant || capri.stowed ? 'deep' : capri.mode === 'sleep' ? 'sleep' : 'awake';
    if (level === restLevel) return;
    restLevel = level;
    host.restLevel?.(level);
    rhythm.pause(level === 'deep');
    life.paused = level === 'deep';
  };
  for (const hook of ['onStow', 'onUnstow', 'onDoze', 'onMode']) {
    const was = capri[hook];
    capri[hook] = (...args) => {
      was?.(...args);
      updateRest();
    };
  }
  setInterval(updateRest, 3000); // and a check now and then, whatever path she took

  // Getting her chat going with buttons (setup.js): Ollama and a model, a key, or an address
  const setup = new Setup({ guide, panel, host, brain, capri, voice });
  guide.setup = setup;
  guide.onTalk = () => chat.start();
  chat.onSetup = (status) => setup.chat(status);
  chat.onBetterModel = () => setup.better();
  setup.onReady = () => chat.start();
  // What she calls you, how she is, your lines, what she remembers (custom.js)
  const custom = new Custom({ guide, host, brain, capri, voice });
  guide.custom = custom;
  brain.custom = mine(config);
  // the first Claude Code event that ever reaches her: so you know it worked
  brain.linked = config.linked;
  brain.watching = config.claude !== false;
  brain.onLinked = () => {
    host.setConfig({ linked: true, welcomed: true });
    voice.play('hello');
    capri.perform('hop');
    panel.say({ kind: 'done', badge: 'LINK', line: brain.t.welcome.linked, hold: 6000 });
  };

  // The demo's second half, after its fake Claude session: everything she does on her own, one
  // after the other, a line before each.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (done, max = 15000) => {
    for (const t0 = Date.now(); !done() && Date.now() - t0 < max;) await wait(100);
  };
  const free = () => !capri.busy && !capri.act && capri.stance !== 'fall';
  brain.onShowcase = async () => {
    const t = brain.t.showcase;
    const caption = (line) => panel.say({ kind: 'info', line, hold: 2200 });
    capri.nextMove = capri.nextGaze = performance.now() + 120000; // nothing of her own in between
    if (capri.stowed) await capri.unstow();
    if (capri.dormant) capri.wake();
    await until(free);
    panel.hide();

    caption(t.minds);
    await wait(1000);
    await capri.perform('split');
    await wait(900);

    caption(t.zap);
    await wait(1000);
    const h = capri.head();
    capri.zap(h.x + capri.towardCenter() * 280, h.y - 170);
    await wait(1800);

    panel.hide();
    if (capri.gaze({ big: true })) await until(() => !capri.sky);
    await wait(2500);

    // a little terminal opens for her to take over, and closes under her once she's done with it
    if (capri.possessWindows && (await host.demoWindow(true))) {
      const top = () => capri.windows.wins.find((w) => capri.canSit(w)); // it opens on top of everything
      await until(top, 4000);
      const win = top();
      const seat = win && { win, dx: win.w * 0.4 };
      if (seat) {
        panel.hide();
        await capri.sitOn(seat);
        await until(free);
        caption(t.possess);
        await wait(1400);
        panel.hide();
        await capri.possess();
        await wait(1800);
      }
      host.demoWindow(false);
      await wait(400);
      await until(free); // she may have fallen off it
      await wait(900);
    }

    caption(t.sleep);
    await wait(1400);
    panel.hide();
    capri.setMode('sleep');
    await wait(2500); // dozing off
    await capri.doze();
    await wait(4500);
    capri.wake();
    await until(free);
    await wait(1200);

    caption(t.chip);
    await wait(1600);
    panel.hide();
    await capri.stow();
    await wait(3500);
    await capri.unstow();
    await wait(600);
    panel.say({ kind: 'info', line: t.end, hold: 5000 });
  };

  host.onClaudeEvent((evt) => brain.handle(evt));
  let lastFg = null;
  host.onWindows((data) => {
    capri.setWindows(data);
    brain.onWindows(data);
    if (data && data.fg !== lastFg) {
      lastFg = data.fg;
      eyes.onForeground(); // the window in front changed: worth a glance soon
    }
  });
  // (she glances at the screen on her own, now and then, when she's allowed and things are calm: eyes.js
  // keeps that clock itself, and only while vision is on)
  // the windows as they are now: the watcher only speaks again when something changes
  host.windowsNow().then((data) => data && capri.setWindows(data));

  host.onResize(({ width, height, gap = 0 }) => {
    floorGap = gap;
    fx.resize(width, height);
    chip.place(width, height - gap);
    capri.setView(width, height, height - gap);
  });
  window.addEventListener('resize', () => {
    fx.resize(innerWidth, innerHeight);
    chip.place(innerWidth, innerHeight - floorGap);
    capri.setView(innerWidth, innerHeight, innerHeight - floorGap);
  });

  host.onConfig((cfg) => {
    askAiSoon(2500); // (a new AI is connected, or taken away; many changes at once ask once)
    voice.configure(cfg);
    heart.configure(cfg);
    bond.configure(cfg);
    life.configure(cfg);
    meterOn = cfg.micMeter !== false;
    speech.configure(cfg);
    eyes.configure(cfg);
    hands.configure(cfg);
    rhythm.configure(cfg).catch(() => {});
    ears.configure(cfg);
    host.senseState({ eyes: eyes.enabled, ears: ears.enabled, listening: false });
    showSenses();
    capri.lang = cfg.lang;
    if ((cfg.theme || 'classic') !== themeSetting) {
      // new colours: a twirl to show them off (and a word, unless her chat already said one)
      themeSetting = cfg.theme || 'classic';
      const next = resolveTheme(themeSetting, heart.state.mood);
      if (next !== themeShown) {
        themeShown = applyTheme(next, { capri });
        capri.twitch();
        if (capri.stance === 'stand') capri.perform('spin');
        const h = capri.head();
        fx.burst(h.x, h.y - 30 * capri.scale, { count: 18, power: 0.7, spread: 90 * capri.scale });
        if (!chat.open && !panel.visible && !ring.open) panel.say({ kind: 'info', face: 'smug', line: themeSetting === 'mood' ? lifeLines(cfg.lang).theme.mood : pick(lifeLines(cfg.lang).theme.done), hold: 3500 });
      }
    }
    capri.wander = cfg.wander;
    capri.possessWindows = cfg.possess;
    capri.moveWindows = cfg.possessMove !== false;
    capri.restOn = cfg.rest || 'corner';
    applyMotion(cfg.motion);
    if ((cfg.claude === false && brain.watching) || cfg.assistant !== brain.assistant) {
      guide.answer(null);
      panel.hide();
      capri.stopPointing();
      brain.replyFor = null;
      brain.linked = cfg.linked;
      // no longer watching Claude Code: whatever it was in the middle of is no business of hers
      brain.sessions.clear();
      panel.setTicker(null);
      if (capri.mode === 'work' || capri.mode === 'alert') capri.setMode('idle');
    }
    brain.watching = cfg.claude !== false;
    brain.custom = mine(cfg);
    brain.assistant = cfg.assistant;
    panel.labels = linesFor(cfg.lang, cfg.assistant);
    if (cfg.scale !== capri.scale) capri.setScale(cfg.scale);
    if (cfg.lang !== brain.lang) {
      brain.lang = cfg.lang;
      panel.labels = linesFor(cfg.lang, cfg.assistant);
      document.documentElement.lang = cfg.lang;
    }
    // last: it redraws its open card from everything above (the senses its Mic tab reads, the language, the colours)
    ring.configure(cfg);
  });

  // Her voice, set up with buttons: which engine, then its key or address, then which voice, then a test.
  async function setupVoice() {
    const tv = lifeLines(brain.lang).voice;
    let saved = false;
    await guide.scene(async () => {
      const cfg = await host.getConfig();
      const engine = await guide.ask({
        face: 'look', line: tv.which, quote: tv.whichHow,
        actions: [...['system', 'piper', 'chatterbox', 'openai', 'elevenlabs', 'custom'].map((id) => ({ id, label: tv.engines[id], primary: id === cfg.ttsEngine })), { id: 'later', label: tv.later }],
      });
      if (!engine || engine === 'later') return;
      if (engine === 'system' || engine === 'piper') { // (nothing to ask: no key, no address; Piper is fetched by her, by the preparation)
        await host.ttsSetup({ engine });
        saved = true;
        return;
      }
      if (engine === 'chatterbox') { // (her folder is looked for next to her; only if there is none she asks for it)
        await host.ttsSetup({ engine });
        if (!(await host.chatterboxStatus()).dir) await host.chatterboxChoose();
        saved = true;
        return;
      }
      const choice = { engine };
      if (engine === 'custom') {
        const got = await guide.askText({ face: 'look', line: tv.url, quote: tv.urlHow, placeholder: cfg.ttsUrl || 'http://127.0.0.1:8000/v1', actions: cfg.ttsUrl ? [{ id: 'skip', label: tv.skip }] : [] });
        if (!got) return;
        if (got.text) choice.url = got.text;
      } else {
        const slot = engine === 'openai' ? 'openai' : 'elevenlabs';
        const has = cfg.keys?.includes(slot);
        const name = tv.engines[engine];
        const got = await guide.askText({
          face: 'look', line: fmt(tv.key, { name }), quote: fmt(tv.keyHow, { name }), secret: true, placeholder: 'sk-… / xi-…',
          actions: [{ id: 'where', label: tv.where }, ...(has ? [{ id: 'skip', label: tv.skip }] : [])],
          onAction: (id) => {
            if (id !== 'where') return false;
            host.ttsKeyPage(engine);
            return true; // the panel stays
          },
        });
        if (!got || (!got.text && !has)) return;
        if (got.text) choice.key = got.text;
      }
      const voiceGot = await guide.askText({ face: 'smug', line: tv.voiceId, quote: tv.voiceIdHow, placeholder: cfg.ttsVoice || (engine === 'openai' ? 'nova' : engine === 'elevenlabs' ? 'voice id' : 'af_bella'), actions: [{ id: 'skip', label: tv.skip }] });
      if (voiceGot?.text) choice.voice = voiceGot.text;
      await host.ttsSetup(choice);
      saved = true;
    });
    if (!saved) return;
    const cfg = await host.getConfig();
    speech.configure(cfg);
    if (cfg.voiceMode === 'off') host.setConfig({ voiceMode: 'chat' });
    capri.perform('hop');
    panel.say({ kind: 'done', face: 'grin', line: tv.saved, quote: tv.test, hold: 6000 });
    speech.say(tv.test, { mood: heart.state.mood, force: true });
  }

  // Which model she sees your screen with (her menu › Senses): just the model name; the key is her
  // chat provider's, already set up.
  async function setupVision() {
    const te = lifeLines(brain.lang).eyes;
    let got = null;
    await guide.scene(async () => {
      const cfg = await host.getConfig();
      got = await guide.askText({ face: 'look', line: te.setup, quote: te.setupHow, placeholder: cfg.visionModel || te.setupPlaceholder, send: brain.t.setup.save, actions: [{ id: 'skip', label: lifeLines(brain.lang).ears.skip }] });
    });
    if (!got || got.action) return;
    await host.setConfig({ visionModel: got.text.trim(), vision: true });
    capri.perform('curious', capri.towardCenter());
    panel.say({ kind: 'done', face: 'smug', line: te.saved, hold: 5000 });
    setTimeout(() => eyes.look({ ask: true }), 600);
  }

  // What she's learned about you (her menu › Character › What she knows about me), and a way to wipe it.
  async function showBond() {
    const tb = lifeLines(brain.lang).bond;
    let wipe = false;
    await guide.scene(async () => { // (it brings her out of her chip, if need be)
      const line = bond.enabled ? bond.summary() : `${bond.summary()} ${tb.off}`;
      const actions = [{ id: 'keep', label: tb.keep, primary: true }, ...(bond.data.talks ? [{ id: 'forget', label: tb.forget }] : [])];
      if ((await guide.ask({ face: 'smug', line, badge: tb.badge, actions })) !== 'forget') return;
      wipe = (await guide.ask({ face: 'wide', line: tb.sure, actions: [{ id: 'wipe', label: tb.wipe }, { id: 'no', label: tb.no, primary: true }] })) === 'wipe';
    });
    if (!wipe) return;
    bond.forget();
    panel.say({ kind: 'info', face: 'aside', line: pick(tb.forgot), hold: 5000 });
  }

  // Which service turns your voice into text (her menu › Senses): engine, then its key or address.
  async function setupEars() {
    const te = lifeLines(brain.lang).ears;
    let saved = false;
    await guide.scene(async () => {
      const cfg = await host.getConfig();
      const engine = await guide.ask({
        face: 'look', line: te.setup, quote: te.setupHow,
        actions: [...['groq', 'openai', 'custom'].map((id) => ({ id, label: te.engines[id], primary: id === cfg.sttEngine })), { id: 'later', label: te.later }],
      });
      if (!engine || engine === 'later') return;
      const choice = { engine };
      if (engine === 'custom') {
        const g = await guide.askText({ face: 'look', line: te.url, quote: te.urlHow, placeholder: cfg.sttUrl || 'http://127.0.0.1:8000/v1', actions: cfg.sttUrl ? [{ id: 'skip', label: te.skip }] : [] });
        if (!g) return;
        if (g.text) choice.url = g.text;
      } else {
        const slot = engine === 'groq' ? 'groq' : 'openai';
        const has = cfg.keys?.includes(slot);
        const name = te.engines[engine];
        const g = await guide.askText({
          face: 'look', line: fmt(te.key, { name }), quote: fmt(te.keyHow, { name }), secret: true, placeholder: 'gsk-… / sk-…', send: te.save,
          actions: [{ id: 'where', label: te.where }, ...(has ? [{ id: 'skip', label: te.skip }] : [])],
          onAction: (id) => { if (id !== 'where') return false; host.sttKeyPage(engine); return true; },
        });
        if (!g || (!g.text && !has)) return;
        if (g.text) choice.key = g.text;
      }
      await host.sttSetup(choice);
      saved = true;
    });
    if (!saved) return;
    host.setConfig({ ears: true });
    capri.perform('hop');
    panel.say({ kind: 'done', face: 'grin', line: te.saved, hold: 6000 });
  }

  async function runCommand(cmd) {
    const t = brain.t;
    switch (cmd.name) {
      case 'teleport':
        capri.teleport(capri.spot('random'));
        break;
      case 'status':
        brain.status();
        break;
      case 'customize': // "Make her yours" in her menu
        custom.open();
        break;
      case 'setupChat': // "Set it up with her" in her menu's AI model
        setup.chat();
        break;
      case 'setupKey': // "API key or address" in her menu's AI model, or a service picked there that needs one
        setup.key();
        break;
      case 'setupFree': // --dev: Claude Code (or Codex) through Ollama
        setup.free();
        break;
      case 'setupStep': // --dev: one step of her setup on its own (pickModel, pull, pickKeyed, address…)
        guide.scene(() => setup[cmd.step]?.(...(cmd.args || [])));
        break;
      case 'rearmed': // a new mouse hook (main.js): click-through until the pointer comes over her again
        mouse = null;
        refreshHit();
        break;
      case 'rearm': // --dev: as if she'd noticed the pointer no longer reaches her
        host.rearm();
        break;
      case 'loseGl': { // --dev: as if the GPU had been reset (waking from sleep): she goes, then comes back
        const lose = capri.sprite.gl.getExtension('WEBGL_lose_context');
        lose?.loseContext();
        setTimeout(() => lose?.restoreContext(), cmd.ms ?? 1500);
        break;
      }
      case 'answer': { // --dev: as if that button of her panel had been clicked (her chat's too)
        const button = document.querySelector(`.panel__action[data-id="${CSS.escape(cmd.id)}"]`);
        if (button) button.click();
        else guide.answer(cmd.id);
        break;
      }
      case 'assistantChanged': // Claude Code, Codex or Antigravity, picked in her menu
        guide.welcome();
        break;
      case 'welcome': // "How does it work?" in her menu
        guide.menu();
        break;
      case 'forget': // "Forget our conversations" in her menu, maybe with her chat open
        chat.history = [];
        break;
      case 'chat': // "Talk to her" in her menu
        chat.start();
        break;
      case 'setupVoice': // her menu › Voice › Key, address or voice
        setupVoice();
        break;
      case 'testVoice': // her menu › Voice › Test her voice
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        capri.wake();
        panel.say({ kind: 'info', face: 'grin', line: lifeLines(brain.lang).voice.test, hold: 5000 });
        speech.say(lifeLines(brain.lang).voice.test, { mood: heart.state.mood, force: true });
        break;
      case 'lookNow': // her menu › Senses › Look at my screen
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        capri.wake();
        eyes.look({ ask: true });
        break;
      case 'setupVision': // her menu › Senses › Vision model
        setupVision();
        break;
      case 'setupEars': // her menu › Senses › Speech-to-text
        setupEars();
        break;
      case 'bond': // her menu › Character › What she knows about me
        showBond();
        break;
      case 'pushToTalk': // the shortcut (main.js), or the mic button
        ears.toggle();
        break;
      case 'feel': // --dev: as if you'd sent her this message (her feelings only), or a reaction / an event
        if (cmd.text) heart.feel(cmd.text);
        if (cmd.reaction) capri.react(cmd.reaction);
        if (cmd.event) heart.event(cmd.event);
        if (cmd.mood) {
          heart.mood.apply(cmd.mood);
          heart.mood.changed();
        }
        break;
      case 'life': // --dev: one of her activities (hack, read, game, graffiti, scan, minds, stretch, offer)
        life.nextAt = Infinity;
        life.begin(cmd.activity);
        break;
      case 'media': // --dev: as if this were playing ({ title, artist, playing })
        life.onMedia(cmd.now || {});
        break;
      case 'presence': // --dev: as if you'd been away this long (s), or were back
        life.onPresence({ idle: cmd.idle ?? 0 });
        break;
      case 'report': // "Mission report" in her menu
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        capri.wake();
        if (brain.report()) capri.perform('curious', capri.towardCenter());
        break;
      case 'fakeClaude': { // --dev: the topmost window (the test window) is where a prompt was typed, and you're elsewhere
        const win = capri.windows.wins[0];
        if (win) {
          brain.sessions.set('dev', { id: 'dev', project: 'dev', taskStart: Date.now(), count: 0, files: new Set(), log: [], working: true, waiting: false, window: win.id, seen: Date.now() });
          capri.windows = { ...capri.windows, fg: -1 };
        }
        break;
      }
      case 'guide': // --dev: one topic of her guide (welcome, menu, connect, icon, claude, folder)
        if (cmd.topic === 'welcome') guide.welcome();
        else if (cmd.topic === 'menu') guide.menu();
        else if (typeof guide[cmd.topic] === 'function') guide.scene(() => guide[cmd.topic]());
        break;
      case 'stow': // Ctrl+Alt+C: into her biochip, or back out
        if (cmd.on) capri.stow();
        else capri.unstow();
        break;
      case 'satellite': // the whole sequence, on demand (tray)
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        capri.wake();
        if (capri.stance === 'peek') await capri.unpeek();
        if (!capri.gaze({ big: true })) setTimeout(() => capri.gaze({ big: true }), 1500);
        break;
      case 'hooks':
        if (cmd.ok) panel.say({ kind: 'info', line: cmd.action === 'install' ? t.hooksOk : t.hooksRemoved, hold: 6000 });
        else panel.say({ kind: 'error', line: fmt(t.hooksFail, { error: cmd.error }), hold: 9000 });
        break;
      // --dev helpers
      case 'intro': // her intro again, as when she starts (still: as with Windows' animations off)
        panel.hide();
        await capri.intro(capri.spot('post'), cmd.still ? { still: true } : {});
        break;
      case 'pose':
        capri.debug = cmd.params || null;
        if (cmd.still) capri.nextMove = capri.nextGaze = Infinity; // no wandering off mid-test
        if (cmd.hush) {
          panel.setTicker(null);
          panel.hide();
        }
        if (cmd.scale) capri.setScale(cmd.scale);
        if (cmd.stance) capri.setStance(cmd.stance, cmd);
        if (cmd.at) capri.pos = cmd.at;
        if (cmd.facing) capri.facing = cmd.facing;
        capri.drawFrame();
        break;
      case 'config': // a setting, as if changed from her menu
        host.setConfig(cmd.patch || {});
        break;
      case 'focus': // as if window `fg` had come to the front
        capri.windows = { ...capri.windows, fg: cmd.fg };
        brain.onWindows(capri.windows);
        break;
      case 'freeze':
        capri.hidden = Boolean(cmd.on);
        break;
      case 'act':
        // behaviours by method name (gaze, celebrate, hurt, shed, peek, fall, wanderStep...) or acts by name
        if (cmd.act === 'sit') {
          // pile: n-th window she could sit on from the top of the pile (0: the --dev test window
          // opened last), instead of the usual choice
          const top = cmd.pile !== undefined && capri.windows.wins.filter((w) => capri.canSit(w))[cmd.pile];
          const seat = top ? { win: top, dx: top.w * 0.4 } : capri.pickSeat();
          if (seat) capri.sitOn(seat);
        } else if (typeof capri[cmd.act] === 'function') capri[cmd.act](...(cmd.args || []));
        else capri.perform(cmd.act, cmd.dir || 0);
        break;
      case 'ring': // her circular menu (tray, or --dev): { tab } picks the card
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        capri.wake();
        if (cmd.open === false) ring.hide();
        else ring.show(cmd.tab);
        break;
      default:
        break;
    }
  }
  host.onCommand(runCommand);

  // the overlay opened in a plain browser (tests, screenshots): its pieces, to drive it from there
  if (location.protocol === 'http:') window.__capri = { capri, fx, panel, brain, heart, life, chat, speech, voice, eyes, hands, rhythm, ears, bond, ring };

  // Regular expressions are compiled the first time they run: the patterns that read your messages
  // (her feelings, her hands, her colours, her notebook) cost ~150 ms on the first one, which would
  // be a pause under your first message. Run once now, in a quiet moment, instead.
  setTimeout(() => (window.requestIdleCallback || setTimeout)(() => {
    const sample = 'привет, как дела? ты классная, спасибо, открой телеграм и напиши маме';
    for (let i = 0; i < 2; i++) {
      classify(sample);
      hands.parse(sample);
      askedTheme(sample);
      chat.asked(sample);
      bond.warm(sample);
    }
  }), 6000);

  // entrance: her face big in the corner says hi, then she dives down to her spot
  // (put away last time: she starts in her biochip)
  if (config.visible === false) capri.stowNow();
  else if (intro) await capri.intro(capri.spot('post'));
  else await capri.materialize(capri.spot('post'));
  // Windows has its animations off and she's following it: she barely moves. The first time, she
  // says so and asks whether to move anyway (her menu › Animations changes it later).
  if (reducedMotion.setting === 'auto' && reducedMotion.system && !config.motionAsked) {
    const m = brain.t.motion;
    await new Promise((done) => {
      const asked = panel.say({
        kind: 'info',
        face: 'aside',
        guide: true,
        line: m.line,
        quote: m.quote,
        actions: [{ id: 'full', label: m.full, primary: true }, { id: 'reduced', label: m.still }],
        onAction: (id) => {
          host.setConfig({ motion: id, motionAsked: true });
          panel.hide();
          if (id === 'full') capri.perform('hop');
        },
        onLeave: done,
        hold: null,
      });
      if (!asked) done();
    });
  }
  const hooks = await host.hooksStatus();
  // her welcome: the first time, or while she's meant to watch Claude Code and isn't plugged into it
  if (!config.welcomed || (config.claude && !hooks.installed)) guide.welcome();
  else panel.say({ kind: 'info', line: brain.onlineLine(), hold: 4000 });

  // In the evening, after a real day's work, she brings you her report card once, on her own,
  // at a quiet moment.
  setInterval(() => {
    const day = mission.day;
    const quiet = !brain.busySessions.length && !panel.visible && !guide.running && !capri.busy && !capri.act;
    if (new Date().getHours() < 18 || day.reported || day.missions < 3 || !quiet) return;
    if (capri.stowed || capri.dormant || capri.mode === 'sleep') return;
    if (brain.report()) {
      mission.markReported();
      capri.perform('curious', capri.towardCenter());
    }
  }, 60000);
}

boot().catch((err) => {
  console.error('[capri] boot failed', err);
});
