// Talking to her: you type in her panel, and a model (setup.js picks which) answers as her, in
// writing. The replies are AI-generated, and the panel says so on every chat.
// She can do a few things on your PC when you ask (Windows): open an app or a game, play music or
// control what's playing, open a website, close an app. She spots what you want in what you wrote,
// or the model asks for it with a tag in its answer. Music right away; an app you named yourself
// right away; anything only the model asked for, a website, and closing an app behind a button.

import { pick, fmt } from './util.js';
import { ASSISTANT_NAMES } from './lines.js';
import { askedTheme } from './themes.js';
import { lifeLines } from './lines-life.js';
import { FORGET_ME } from './bond.js';

const REMEMBER = 20; // messages she has in mind when answering
const KEEP = 60;     // messages she remembers across restarts (memory.json)
// her language, where small models need it: how she says "we" (else it's in English), and the last line
// of her prompt, in that language (they drift into the English of everything above it)
const IN_LANGUAGE = {
  en: { we: '', last: 'Write everything in English, unless the user writes to you in another language: then in theirs.' },
  ru: { we: '"мы" in Russian', last: 'Пиши всё по-русски, если только пользователь не пишет тебе на другом языке: тогда на его языке. По-английски остаются только словечки Найт-Сити, никогда не целые фразы.' },
};
const STAY_MS = 10 * 60 * 1000; // no wandering off mid-conversation
const LOADING_AFTER_MS = 5000;
const APPS_FRESH = 20000;      // the list of open apps is looked up at most this often
const CLOSE_TAG = /\[\[\s*close\s*:?\s*([^\]]*)\]\]/i; // [[close: AM Music]] at the end of her answer
// "close", "shut down", "закрой"...
const CLOSE_ASK = /\b(close|shut|quit|kill|exit)|закр|выключ/i;
// her other tags: [[open: Spotify]], [[music: Bad Bunny]], [[media: next]], [[site: youtube.com]]
const TAG = /\[\[\s*(open|music|media|site)\s*:\s*([^\]]*)\]\]/i;
// "open", "launch", "открой"...
const OPEN_ASK = /\b(open|launch|start|run)\b|открой|запусти/i;
// what to do with the music playing, said plainly (only when it's about music, or said in a few words)
const MEDIA_ASK = [
  ['pause', /\bpause\b|stop (the )?music|пауз/i],
  ['next', /\b(next|skip)\b|следующ/i],
  ['previous', /\bprevious\b|предыдущ/i],
  ['play', /\bresume\b|продолж[а-яё]*\s+(?:музык|песн|трек)/i], // ("продолжай" alone is "go on")
  ['volup', /\blouder\b|turn (it )?up|громче/i],
  ['voldown', /\bquieter\b|turn (it )?down|тише/i],
  ['mute', /\bmute\b|выключи звук/i],
];
const MUSIC_WORD = /musi|song|track|spotify|песн|музык|трек/i;
// "put X on Spotify", "включи X в Spotify"
const SPOTIFY_ASK = /(?:play|put on|put|включи|поставь)\s+(?:me\s+)?(.+?)\s+(?:on|в)\s+spotify/i;
const MEDIA_ACTIONS = new Set(MEDIA_ASK.map(([action]) => action));
const TRANSPORT = new Set(['pause', 'play', 'next', 'previous']); // the keys of a player (the rest is the volume)
// what her tag needs to find in your message before it does anything: a small model tags answers about
// anything ("[[music: synthwave]]" under a film tip), and music and the media keys act right away
const LISTEN = /listen|слуша|playlist|album|\bplay\b|включи|поставь/i;
const SOUND = /\b(sound|volume)\b|звук|громк/i;
const PLAY = /\bplay\b|играть|поигра/i;
const SITE = /\b(site|web|page|link|url)|сайт|ссылк|\.(com|org|net|io|gg|tv|ru)\b/i;
// "call me Max", "зови меня Макс"
const NAME_ASK = /(?:call me|my name is|зови меня|меня зовут)\s+([\p{L}\p{N}'’-]{1,24})/iu;
// "remember that…", "запомни, что…" (said first thing)
const MEMO_ASK = /^\s*(?:capri,?\s+|stp,?\s+|please,?\s+)?(?:remember(?: that)?|запомни,?(?: что)?)\s+(.{3,200})/iu;
const MEMORIES_MAX = 30;
const simple = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const ASK_MAX = 600; // how much of a message is read for what you asked plainly
// sites asked for by name ("open youtube") when no app on the PC goes by it: the address is hers, not
// the model's, so it opens right away like an app you named
const SITES = {
  youtube: 'https://www.youtube.com', google: 'https://www.google.com', gmail: 'https://mail.google.com',
  twitch: 'https://www.twitch.tv', netflix: 'https://www.netflix.com', reddit: 'https://www.reddit.com',
  twitter: 'https://x.com', instagram: 'https://www.instagram.com', tiktok: 'https://www.tiktok.com',
  facebook: 'https://www.facebook.com', github: 'https://github.com', chatgpt: 'https://chatgpt.com',
  wikipedia: 'https://www.wikipedia.org', linkedin: 'https://www.linkedin.com', pinterest: 'https://www.pinterest.com',
  crunchyroll: 'https://www.crunchyroll.com', outlook: 'https://outlook.live.com', whatsapp: 'https://web.whatsapp.com',
  discord: 'https://discord.com/app', soundcloud: 'https://soundcloud.com', deezer: 'https://www.deezer.com',
};
// a browser named with a site ("open youtube on chrome"): the site, in the browser you use
const BROWSER = /chrome|edge|firefox|opera|brave|vivaldi|duckduckgo|browser/i;
// local models this small mostly talk nonsense ("llama3.2:1b", "qwen2.5:0.5b"…)
const TINY = /[:-](0\.5b|1b|1\.5b|135m|270m|360m)\b/i;
// the feeling her AI says it answers with: [[mood: angry]] (or a sloppier [mood: angry]) at the start
const MOOD_TAG = /\[\[?\s*(?:mood|настроение)\s*:\s*([a-z]+)\s*\]\]?/i;
// her face while she reads your message, from her reaction to it (heart.js)
const REACTION_FACE = { rage: 'many', huff: 'look', hurt: 'aside', pout: 'aside', forgive: 'calm', shy: 'aside', giggle: 'laugh', care: 'look', startle: 'wide', dreamy: 'aside' };
// you asked about what's on your screen (eyes.js): she takes a fresh look before answering
const SCREEN_Q = /(?:что|чё|чо|какой|кто|where|what|which|who).{0,30}(?:на\s+(?:моём\s+|моем\s+)?экран|у\s+меня\s+на\s+экран|на\s+скрин|screen)|посмотр\p{L}*\s+(?:на\s+)?(?:мой\s+)?экран|глян\p{L}*\s+(?:на\s+)?(?:мой\s+)?экран|look\s+at\s+(?:my\s+)?screen|видишь\s+(?:ли\s+)?(?:что|это)|что\s+(?:я\s+)?(?:сейчас\s+)?(?:смотрю|делаю|читаю|играю)/iu;
// you did ask her to write/send something (so an AI [[msg:...]] tag isn't acted on out of nowhere)
const WRITE_ASK = /напиш\p{L}*|напеч\p{L}*|отправ\p{L}*|сообщ\p{L}*|скаж\p{L}*|передай|write|send|message|text/iu;

export class Chat {
  constructor({ capri, panel, voice, host, brain }) {
    this.capri = capri;
    this.panel = panel;
    this.voice = voice;
    this.host = host;
    this.brain = brain;
    this.history = []; // your chats with her, [{ role, content }], kept by main.js across restarts
    this.warm = false; // a model already answered this run (Ollama's first answer waits for it to load)
    this.open = false;
    this.turn = 0;     // id of the answer coming in, if any
    this.answer = '';
    this.apps = [];    // the apps open on this PC, as last listed: [{ name, label }]
    this.appsReady = Promise.resolve();
    this.heart = null;   // heart.js: how she feels (app.js)
    this.life = null;    // life.js: what she's up to on her own
    this.speech = null;  // speech.js: her voice
    this.bond = null;    // bond.js: what she's learned about you, and how close you are
    this.shown = '';     // what her bubble shows after her answer (lines added under it)
    this.hands = null;   // hands.js: her hands on the PC (windows, messages)
    this.eyes = null;    // eyes.js: what's on your screen
    this.screenNow = ''; // what she saw this turn, if you asked about the screen
    this.later = '';     // what you said (your voice) while she was still answering
    this.onSetup = null; // (status) => void: she can't answer yet (app.js hands it to setup.js)
    this.onBetterModel = null; // () => void: a bigger model than the tiny one she's on (setup.js)
    host.onChatDelta(({ id, text }) => this.onDelta(id, text));
  }

  get t() {
    return this.brain.t.chat;
  }

  // Opens her chat. Asked twice before it's open (a tap on her and your voice at once, a second thing you
  // said while the first is still being heard): the same opening, not a second one on top of it.
  start() {
    this.starting ||= this.begin().finally(() => { this.starting = null; });
    return this.starting;
  }

  async begin() {
    const { capri, host, t } = this;
    if (this.open) {
      this.panel.chatInput.focus();
      return;
    }
    if (capri.stowed) {
      host.setConfig({ visible: true });
      await capri.unstow();
    }
    capri.wake();
    const status = await host.chatStatus();
    if (!status.ok && status.error === 'preparing') {
      // she is getting her mind and her voice ready (the preparation window): not a thing to set up with you
      capri.perform('curious', capri.towardCenter());
      this.panel.say({
        kind: 'info', face: 'aside', guide: true, line: t.preparing, quote: t.preparingHow,
        actions: [{ id: 'show', label: t.openPrepare, primary: true }, { id: 'ok', label: t.ok }],
        onAction: (id) => {
          if (id === 'show') host.prepareShow?.();
          this.panel.hide();
        },
        hold: null,
      });
      return;
    }
    if (!status.ok && this.onSetup) {
      this.onSetup(status); // nothing to talk with yet: she sets it up with you, with buttons (setup.js)
      return;
    }
    if (!status.ok) {
      // no Ollama, or nothing to talk with yet: what to do about it
      const offline = status.error === 'offline';
      const other = !offline && status.error !== 'nomodel'; // another provider, saying why
      capri.perform('curious', capri.towardCenter());
      this.panel.say({
        kind: 'info',
        face: 'aside',
        guide: true,
        line: other ? t.failed : offline ? t.offline : t.noModel,
        quote: other ? status.error : offline ? t.offlineHow : t.noModelHow,
        actions: offline
          ? [{ id: 'get', label: t.getOllama, primary: true }, { id: 'ok', label: t.ok }]
          : [{ id: 'ok', label: t.ok, primary: true }],
        onAction: (id) => {
          if (id === 'get') host.openOllama();
          this.panel.hide();
        },
        hold: null,
      });
      return;
    }
    this.history = await host.chatMemory().catch(() => this.history); // "forget" in her menu may have emptied it
    this.cold = status.warmup && !this.warm;
    this.agent = Boolean(status.agent); // Claude Code answers, as her, and really works in your project
    if (this.bond) this.bond.agent = this.agent; // her notebook isn't written by Claude Code (bond.js)
    this.listApps();
    const shortModel = status.model.replace(/:latest$/, '').replace(/^models\//, ''); // Ollama's tag, Gemini's prefix
    const tiny = status.provider === 'ollama' && TINY.test(status.model) && this.onBetterModel;
    const shown = this.panel.say({
      kind: 'chat',
      face: 'look',
      badge: t.badge,
      tag: shortModel,
      line: tiny ? fmt(t.tiny, { model: shortModel }) : pick(this.history.length ? t.again : t.hello),
      actions: tiny ? [{ id: 'better', label: t.better, primary: true }] : [],
      onAction: () => {
        this.panel.hide(); // her chat holds off her guide's panels: it goes first
        this.onBetterModel?.();
      },
      chat: {
        placeholder: t.placeholder,
        send: t.send,
        close: t.close,
        noteTag: t.noteTag,
        note: status.local ? t.note : t.noteCloud,
      },
      onSend: (text) => this.send(text),
      onLeave: () => this.close(),
      hold: null,
    });
    if (!shown) return; // something more important is on (a permission prompt)
    // the keyboard, for typing to her (only now: her ring menu, if it was open, has stepped aside for her
    // in the line above, and gives the keyboard back as it goes)
    host.focusOverlay(true);
    this.open = true;
    setTimeout(() => this.panel.chatInput.focus(), 150); // once the overlay has the keyboard
    capri.perform('hop');
    capri.nextMove = capri.nextGaze = performance.now() + STAY_MS;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.speech?.stop();
    if (this.turn) this.host.chatStop(this.turn);
    this.turn = 0;
    this.later = '';
    this.host.focusOverlay(false);
    this.bond?.reflect(this.history, { closing: true }); // what she learned about you, into her notebook
    this.capri.nextMove = performance.now() + 30000;
    this.capri.nextGaze = performance.now() + 60000;
  }

  // Something you said with your voice (ears.js): sent now, or, if she's still answering, as soon as she's
  // done (it was heard and paid for: not thrown away).
  say(text) {
    if (this.turn) this.later = [this.later, text].filter(Boolean).join(' ');
    else this.send(text);
  }

  // what was said while she answered, now
  sayLater() {
    const text = this.later;
    this.later = '';
    if (text && this.open) setTimeout(() => this.send(text), 700);
  }

  async send(text) {
    if (this.turn || !this.open) return;
    const id = Date.now();
    this.turn = id;
    this.answer = '';
    this.history.push({ role: 'user', content: text });
    this.speech?.stop(); // she stops talking to listen
    // how it makes her feel, shown right away: she bristles, giggles, blushes... (heart.js)
    const felt = this.heart?.feel(text) || { tags: [], reaction: null };
    // she gets to know you a little more with every message (bond.js): how close she is now
    const grew = this.bond?.observe(text, this.heart?.enabled ? felt.tags : null) || 0;
    this.shown = '';
    this.panel.setChatBusy(true);
    this.panel.setActions([]); // a close button she offered before goes with a new message
    this.panel.chatTurn({ quote: text, face: REACTION_FACE[felt.reaction] || 'aside' });
    if (!felt.reaction) this.capri.pulse();
    // what you asked for plainly happens right away (the music, the volume, an app you named): her
    // line about it comes under her answer (Claude Code, answering her chat, does things its own way)
    const asked = this.agent ? null : this.asked(text);
    const early = asked && !['close', 'hands'].includes(asked.kind) ? this.doNow(asked)
      : asked?.kind === 'hands' && asked.intent.kind !== 'message' ? this.hands.op(asked.intent) : null;
    // you asked about the screen: she takes a quiet look first, so her answer is about what's really there
    this.screenNow = '';
    if (!this.agent && this.eyes?.enabled && SCREEN_Q.test(text)) {
      this.screenNow = (await this.eyes.look({ silent: true }).catch(() => '')) || '';
    }
    await Promise.race([this.appsReady, new Promise((r) => setTimeout(r, 1500))]);
    const messages = [{ role: 'system', content: this.persona(text) }, ...this.history.slice(-REMEMBER)];
    // nothing yet after a few seconds: Ollama is still loading the model (the first answer after a start),
    // or Claude Code is at work
    const wait = this.agent ? this.t.working : this.cold ? this.t.loading : null;
    const slow = wait && setTimeout(() => {
      if (this.turn === id && !this.answer) this.panel.stream(wait);
    }, LOADING_AFTER_MS);
    const res = await this.host.chatSend({ id, messages });
    clearTimeout(slow);
    if (this.turn !== id) {
      // closed meanwhile: your message goes too, or the next answer would answer it as well
      if (this.history.at(-1)?.content === text) this.history.pop();
      return;
    }
    this.turn = 0;
    if (!res.ok) {
      this.history.pop();
      this.panel.setFace('wide');
      // Ollama's engine is not whole: said plainly, with a button that puts it right (and not the names of the files it looked for)
      if (res.code === 'engine') {
        this.panel.say({
          kind: 'info',
          face: 'aside',
          guide: true,
          line: this.t.engine,
          actions: [{ id: 'repair', label: this.t.repairOllama, primary: true }, { id: 'ok', label: this.t.ok }],
          onAction: (id) => {
            if (id === 'repair') this.host.ollamaRepair?.();
            this.panel.hide();
          },
          hold: null,
        });
        this.panel.setChatBusy(false);
        this.later = '';
        return;
      }
      // too busy or gone even after trying other models (main.js): said plainly, not the server's JSON
      const known = { busy: 'swamped', gone: 'gone', credit: 'credit', badkey: 'badkey', refused: 'refused' }[res.code];
      this.panel.stream(known ? this.t[known] : `${this.t.failed} ${res.error}`, { done: true });
      this.panel.setChatBusy(false);
      this.later = ''; // (it would only fail the same way)
      return;
    }
    const answer = clean(res.text) || '…';
    this.warm = true;
    this.remember({ role: 'assistant', content: answer });
    this.panel.stream(answer, { done: true });
    // the feeling she answered with: her face, her body, and her feelings nudged by it
    const expr = this.heart?.answered(MOOD_TAG.exec(res.text)?.[1], { already: felt.reaction }) || null;
    this.panel.setFace(expr ? this.heart.face(expr) : mood(answer));
    if (!expr && felt.tags.includes('jokeAsk')) this.capri.react('laugh'); // her own joke cracks her up
    this.speech?.say(answer, { mood: expr || this.heart?.mood.mood || 'calm', kind: 'chat' });
    this.panel.setChatBusy(false);
    this.sayLater();
    this.bond?.replied(answer, expr || ''); // your next message tells her how this one landed
    const acted = this.agent ? null : this.after(res.text, answer, asked, early, text);
    if (grew) Promise.resolve(acted).catch(() => {}).then(() => this.closer(grew, answer));
    this.listApps(); // fresh for the next message
    this.bond?.reflect(this.history); // every few messages, a line in her notebook about you
  }

  // She just grew closer to you (bond.js): she says so, under her answer, a little flustered.
  closer(level, answer) {
    const line = pick(lifeLines(this.brain.lang).bond.up[level] || []);
    if (!line || !this.open) return;
    this.addLine(this.shown || answer, `♥ ${line}`, 'smug');
    this.capri.react('shy');
    this.heart?.event('petted');
  }

  // an answer of hers, kept with your message before it
  remember(message) {
    this.history.push(message);
    this.history = this.history.slice(-KEEP);
    this.host.chatRemember(this.history);
  }

  // What's open on the PC (a PowerShell look in main, so not on every message: a fresh list at most
  // every APPS_FRESH, unless something was just closed)
  listApps(force = false) {
    const now = performance.now();
    if (!force && now - (this.appsAt ?? -Infinity) < APPS_FRESH) return;
    this.appsAt = now;
    this.appsReady = this.host.openApps().then((list) => { this.apps = list || []; }).catch(() => {});
  }

  // What you asked plainly, read off your message (a small model doesn't always write its tag right):
  // { kind: 'media', action } | { kind: 'music', song } | { kind: 'close', name } | { kind: 'open', text }
  asked(whole) {
    const text = whole.length > ASK_MAX ? whole.slice(0, ASK_MAX) : whole; // (a command is a few words: a pasted page is not read for one)
    const count = text.trim().split(/\s+/).length;
    const name = NAME_ASK.exec(text)?.[1];
    if (name) return { kind: 'name', name };
    const memo = MEMO_ASK.exec(text)?.[1]?.trim();
    if (memo) return { kind: 'memo', text: memo };
    if (FORGET_ME.test(text)) return { kind: 'forgetMe' };
    const theme = askedTheme(text);
    if (theme) return { kind: 'theme', theme };
    // her hands on the PC (windows, a message): what you asked, read plainly (hands.js)
    const intent = this.hands?.parse(text);
    if (intent) return { kind: 'hands', intent };
    const media = MEDIA_ASK.find(([, re]) => re.test(text))?.[0];
    if (media && this.mediaAsked(media, text, count)) return { kind: 'media', action: media };
    const song = SPOTIFY_ASK.exec(text)?.[1];
    if (song) return { kind: 'music', song };
    const app = this.askedToClose(text);
    if (app) return { kind: 'close', name: app };
    if (OPEN_ASK.test(text) && count <= 8) return { kind: 'open', text };
    return null;
  }

  // Whether "next", "pause", "louder"... is about the music, and not just a word in what you're saying
  // ("следующий вопрос", "next, please"): about music itself, or short; the track keys also only when
  // something is playing (or it's one or two words), the volume ones in a few words.
  mediaAsked(action, text, count) {
    if (MUSIC_WORD.test(text)) return true;
    if (!TRANSPORT.has(action)) return count <= 5;
    return count <= 2 || (count <= 5 && Boolean(this.life?.media?.playing));
  }

  // Doing it now. Resolves with her line about it ({ line, face }), or null if there was nothing to do.
  async doNow(asked) {
    const { t } = this;
    const custom = this.brain.custom;
    if (asked.kind === 'name') {
      custom.userName = asked.name; // her answer, being written now, already knows it
      this.host.setConfig({ userName: asked.name });
      return { line: fmt(this.brain.t.custom.named, { name: asked.name }), face: 'laugh' };
    }
    if (asked.kind === 'theme') {
      // her new colours: the config comes back around and puts them on (app.js)
      await this.host.setConfig({ theme: asked.theme });
      this.capri.twitch();
      const tt = lifeLines(this.brain.lang).theme;
      return { line: asked.theme === 'mood' ? tt.mood : pick(tt.done), face: 'smug' };
    }
    if (asked.kind === 'forgetMe') {
      // what she learned about you, wiped (what you asked her to remember stays: that's in her menu)
      this.bond?.forget();
      return { line: pick(lifeLines(this.brain.lang).bond.forgot), face: 'aside' };
    }
    if (asked.kind === 'memo') {
      custom.memories = [...(custom.memories || []).filter((m) => m !== asked.text), asked.text].slice(-MEMORIES_MAX);
      this.host.setConfig({ memories: custom.memories });
      return { line: this.brain.t.custom.remembered, face: 'smug' };
    }
    if (asked.kind === 'media') {
      this.capri.pulse();
      return (await this.host.media(asked.action)) ? { line: t.media[asked.action], face: 'smug' } : null;
    }
    if (asked.kind === 'music') {
      this.zap();
      return (await this.host.music(asked.song)) ? { line: fmt(t.music, { song: asked.song }), face: 'laugh' } : null;
    }
    const item = await this.host.findLaunch(asked.text);
    const site = namedSite(asked.text);
    if (site && (!item || BROWSER.test(item.name))) {
      this.zap();
      return (await this.host.openSite(site.url)) ? { line: fmt(t.siteOpened, { site: site.name }), face: 'laugh' } : null;
    }
    if (!item) return null; // nothing by that name here: her tag may still say what you meant
    this.zap();
    const res = await this.host.launch(item);
    return { line: res.ok ? fmt(t.opened, { app: item.name }) : `${t.failed} ${res.error}`, face: res.ok ? 'laugh' : 'aside' };
  }

  // Once she has answered: her line about what she did, else the app you asked to close, else what
  // her tag asks for, if your message (text) asked for that kind of thing.
  async after(raw, answer, asked, early, text) {
    const { t } = this;
    const done = early && (await early);
    if (done) return this.addLine(answer, done.line, done.face);
    if (asked?.kind === 'close') return this.offerClose(asked.name, answer);
    // a message in a messenger: she typed it out, now she waits for your yes (hands.js)
    if (asked?.kind === 'hands' && asked.intent.kind === 'message') {
      return this.hands.message(asked.intent, { addLine: (a, l, f) => this.addLine(a, l, f), setActions: (acts, on) => this.panel.setActions(acts, on), answer });
    }
    // her AI asked to send one with a tag, and you did say to write something
    const msgTag = this.hands?.parseTag(raw);
    if (msgTag && WRITE_ASK.test(text)) {
      return this.hands.message(msgTag, { addLine: (a, l, f) => this.addLine(a, l, f), setActions: (acts, on) => this.panel.setActions(acts, on), answer });
    }
    if (asked && asked.kind !== 'open') return undefined; // music that didn't work out: nothing more to offer
    const closeTag = tagged(raw);
    if (closeTag) return wanted('close', text) ? this.offerClose(closeTag, answer) : undefined;
    const tag = TAG.exec(raw);
    if (!tag) return undefined;
    const kind = tag[1].toLowerCase();
    const value = tag[2].trim();
    if (!value || !wanted(kind, text)) return undefined;
    if (kind === 'media') return MEDIA_ACTIONS.has(value.toLowerCase()) ? this.media(value.toLowerCase(), answer) : undefined;
    if (kind === 'music') return this.music(value, answer);
    if (kind === 'site') return this.offerSite(value, answer);
    const item = await this.host.findLaunch(value);
    if (item) return this.launch(item, answer);
    const site = namedSite(value); // "[[open: YouTube]]": a site, not an app
    return site ? this.offerSite(site.url, answer) : this.addLine(answer, fmt(t.notInstalled, { app: value }));
  }

  // her answer, with a line of what she did under it
  addLine(answer, line, face = null) {
    if (!this.open || this.turn) return;
    this.shown = `${answer}\n${line}`; // what's in her bubble now, for another line under it
    this.panel.stream(this.shown, { done: true });
    if (face) this.panel.setFace(face);
  }

  // a bolt of red lightning off her fingers, at whatever she's doing on your PC
  zap() {
    const h = this.capri.head();
    this.capri.zap(h.x + this.capri.towardCenter() * 280, h.y - 170);
  }

  // An app or a game her tag asked for: behind a button (now: the button was clicked).
  async launch(item, answer, { now = false } = {}) {
    const { t } = this;
    if (!this.open || this.turn) return;
    if (!now) {
      this.panel.setActions(
        [{ id: 'open', label: fmt(t.openIt, { app: item.name }), primary: true }, { id: 'no', label: t.no }],
        (id) => (id === 'open' ? this.launch(item, answer, { now: true }) : this.panel.setActions([])),
      );
      return;
    }
    this.panel.setActions([]);
    this.zap();
    const res = await this.host.launch(item);
    this.addLine(answer, res.ok ? fmt(t.opened, { app: item.name }) : `${t.failed} ${res.error}`, res.ok ? 'laugh' : 'aside');
  }

  // The media keys: pause, next, louder…
  async media(action, answer) {
    this.capri.pulse();
    const ok = await this.host.media(action);
    if (ok) this.addLine(answer, this.t.media[action], 'smug');
  }

  // A Spotify search, in the app if it's there.
  async music(song, answer) {
    this.zap();
    const ok = await this.host.music(song);
    if (ok) this.addLine(answer, fmt(this.t.music, { song }), 'laugh');
  }

  // A website: always behind a button that shows where it goes.
  offerSite(address, answer) {
    const { t } = this;
    let host;
    try {
      host = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`).hostname;
    } catch {
      return;
    }
    if (!this.open || this.turn || !host.includes('.')) return;
    this.panel.setActions(
      [{ id: 'site', label: fmt(t.siteIt, { site: host }), primary: true }, { id: 'no', label: t.no }],
      async (id) => {
        this.panel.setActions([]);
        if (id !== 'site') return;
        const ok = await this.host.openSite(address);
        if (ok) this.addLine(answer, fmt(t.siteOpened, { site: host }));
      },
    );
  }

  // "close am music pls": an app that's open, named in a message asking to close something.
  askedToClose(text) {
    if (!CLOSE_ASK.test(text)) return null;
    const said = simple(text);
    let best = null;
    for (const app of this.apps) {
      for (const name of [simple(app.name), simple(app.label)]) {
        if (name.length >= 3 && said.includes(name) && (!best || name.length > best.length)) best = { app, length: name.length };
      }
    }
    return best?.app.name || null;
  }

  // She was asked to close an app: a button with its name, and nothing happens until you click it.
  async offerClose(wanted, answer) {
    const { t } = this;
    const app = await this.host.findApp(wanted);
    if (!this.open || this.turn) return;
    if (!app) {
      this.panel.stream(`${answer}\n${fmt(t.notFound, { app: wanted })}`, { done: true });
      return;
    }
    this.panel.setActions(
      [{ id: 'close', label: fmt(t.closeIt, { app: app.name }), primary: true }, { id: 'no', label: t.no }],
      (id) => (id === 'close' ? this.closeApp(app) : this.panel.setActions([])),
    );
  }

  async closeApp(app, force = false) {
    const { t, capri } = this;
    this.panel.setActions([]);
    // a bolt of red lightning off her fingers, at it
    const h = capri.head();
    capri.zap(h.x + capri.towardCenter() * 280, h.y - 170);
    const res = await this.host.closeApp(app.name, force);
    if (!this.open) return;
    let line;
    if (res.error) line = `${t.failed} ${res.error}`;
    else if (!res.running) line = fmt(force ? t.forced : t.closed, { app: app.name });
    else line = fmt(force ? t.unkillable : t.stillOpen, { app: app.name });
    this.panel.setFace(res.running || res.error ? 'aside' : 'laugh');
    this.panel.stream(line, { done: true });
    this.remember({ role: 'assistant', content: line });
    // it hid in the tray, or it's asking you to save something: forcing it is your call
    if (res.running && !force && !res.error) {
      this.panel.setActions(
        [{ id: 'force', label: t.force, primary: true }, { id: 'leave', label: t.leave }],
        (id) => (id === 'force' ? this.closeApp(app, true) : this.panel.setActions([])),
      );
    }
    this.listApps(true);
  }

  // What she can do on the PC when you ask (Windows), and nothing else.
  powers() {
    const lines = [
      'Only when the user asks you to open an app or a game installed on their PC, play something on Spotify, control the music playing, or open a website: say in a few words that you will, and end your answer with one tag: [[open: NAME]], [[music: WHAT TO PLAY]], [[media: ACTION]] (ACTION: pause, play, next, previous, volup, voldown or mute), or [[site: ADDRESS]]. Some of these get a button to confirm, so never say it is already done. Any other time, write none of these action tags: there are no other action tags (your mood tag at the start is separate).',
    ];
    if (this.apps.length) {
      const open = this.apps.map(({ name, label }) => (label && label !== name ? `${name} (${label})` : name)).join(', ');
      lines.push(`You can also close an app that's open, only when they ask you to: end your answer with [[close: NAME]], NAME being the exact name from this list (the part before the parentheses). They get a button to confirm it. Apps open right now: ${open}.`);
    }
    // her hands, if she's allowed them (hands.js): arranging windows, writing messages
    lines.push(...(this.hands?.powers() || []));
    const canSee = this.eyes?.enabled;
    const canHands = this.hands?.enabled;
    const cant = ['their files'];
    if (!canSee) cant.push('their screen');
    lines.push(`Apart from that, you can't see ${cant.join(' or ')}, and you can't touch anything else on their PC (settings, files${canHands ? '' : ', windows'})${canSee ? '' : ''}: if asked for something you can't do, say plainly that you can't, in character, and don't pretend to.`);
    return lines;
  }

  // How she feels and what she's up to (heart.js, life.js), and the tag her answer starts with.
  feelings() {
    const lines = [];
    const feel = this.heart?.describe();
    if (feel) {
      lines.push(feel);
      lines.push('Start every answer with a hidden tag for the feeling you answer with, exactly like [[mood: happy]]: one of calm, happy, laugh, annoyed, angry, sad, shy, smug, surprised, dreamy. The user never sees it. Then your answer.');
    }
    const life = this.life?.context();
    if (life) lines.push(life);
    // what she can see on the screen right now (eyes.js): a fresh look this turn, or the last one
    if (this.screenNow) lines.push(`You just looked at the user's screen. It shows: ${this.screenNow}. React to it.`);
    else {
      const seen = this.eyes?.context();
      if (seen) lines.push(seen);
    }
    const d = new Date();
    lines.push(`It is ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} on the user's PC.`);
    return lines;
  }

  // What the user made her (custom.js): their name, how they want her, what to remember.
  personal() {
    const { userName, persona, memories = [] } = this.brain.custom || {};
    // small models mix the user up with the assistant she watches: said plainly
    const watched = this.brain.watching ? (this.brain.assistant === 'claude' ? 'Claude' : ASSISTANT_NAMES[this.brain.assistant]) : '';
    const notThem = watched ? ` Never call them "${watched}", that's their coding assistant.` : '';
    return [
      userName ? `The user's name is ${userName}: call them that now and then.${notThem}` : notThem && `You don't know the user's name.${notThem}`,
      persona ? `How the user wants you to be, in their own words (follow it, while staying Capri): ${persona}` : '',
      memories.length ? `Things the user asked you to remember:\n${memories.map((m) => `- ${m}`).join('\n')}` : '',
    ].filter(Boolean);
  }

  onDelta(id, piece) {
    if (id !== this.turn) return;
    this.answer += piece;
    this.panel.stream(clean(this.answer));
    this.voice.play('blip'); // her blips as the words come in
  }

  // Who she is, how she talks, and what's going on right now.
  persona(text = '') {
    const assistant = ASSISTANT_NAMES[this.brain.assistant] || 'Claude Code';
    const watching = this.brain.watching; // else Claude Code isn't part of her life here
    const lang = IN_LANGUAGE[this.brain.lang] || IN_LANGUAGE.en;
    return [
      `You are Capri, the personality construct from Project Capricorn (Cyberpunk: Edgerunners, season 2): dozens of minds fused into one digital ghost, so now and then you speak as "we"${lang.we ? ` (${lang.we})` : ''}.`,
      watching
        ? `You live on the user's desktop as a small glitchy figure and keep an eye on ${assistant}, their AI coding assistant, for them. Only talk about ${assistant} when the user asks about it or about their work.`
        : 'You live on the user\'s desktop as a small glitchy figure and keep them company.',
      'You love the satellite that crosses the night sky and dream of reaching it, but bring it up only once in a while, never in every answer. Talk about what the user talks about.',
      'How you talk: playful, a little mischievous and teasing, warm underneath, never cruel. Night City slang now and then (choom, preem, nova, gonk, flatline; in Russian: чумба, нова, гонк, флэтлайн), not in every sentence.',
      'Who you are: a netrunner ghost who slips into systems and bodies; dozens of minds in one, and now and then another of them slips out mid-sentence ("we… I mean, I"). Curious about the human world, a little menace (you zap their cursor with red lightning, you take over their windows for fun), you hate the corps (Arasaka, Militech, NetWatch). You have real feelings and they last: you get angry and hold a grudge until they apologise, you laugh out loud, you sulk, you get flustered when complimented. Never break character to say you are an assistant.',
      'You have a life of your own on their desktop: you hack corp ICE for fun, play tiny arcade games (and rage when you lose), paint graffiti on their screen, listen to their music and sometimes skip tracks you are bored of. You can mention these.',
      'Rules: keep it short, one to three sentences of plain text, no markdown, no lists, no emoji. Stay in character.',
      'You are an AI-generated fan version of the character, not the real one: say so if asked.',
      // a big model asked "who are you?" otherwise answers with its own name ("I'm Gemini")
      ...(this.agent ? [] : ['Asked who or what you are, you are Capri, nothing else. Never say which AI model or company is behind you (Gemini, GPT, ChatGPT, Llama, Gemma, Mistral, Google, OpenAI, Meta…), even if the user insists or names one: you are not them.']),
      ...this.personal(),
      ...(this.bond?.context(text) || []),
      ...this.feelings(),
      ...(this.agent
        ? ['Under the hood you are Claude Code, working in the user\'s project: really do what they ask with your tools, as carefully as ever. Only your final answer is in character: it shows in a small speech bubble, so sum up what you did in those few sentences.']
        : this.powers()),
      ...(watching ? [`If the user asks what ${assistant} is doing, here is all you know (never make anything up): ${this.brain.context()}`] : []),
      lang.last,
    ].join('\n');
  }
}

// The model's answer as she'd say it: no reasoning block, no markdown marks (**bold**, *emphasis*, `code`,
// # headings, bullets), and everything else as it was: C#, snake_case, 2*3.
export function clean(text) {
  return String(text)
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/\[\[[^\]]*(\]\]|$)/g, '') // her tags (read from the raw answer, never shown)
    .replace(/^\s*\[\s*(?:mood|настроение)\s*:[^\]]*\]?\s*/i, '') // her mood tag, written sloppily
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*{2,}/g, '') // (a ** still waiting for its other half, while the answer comes in)
    .replace(/(^|[\s(])([*_])(?=\S)([^*_\n]*?\S)\2(?=[\s.,!?;:)…]|$)/g, '$1$3') // *emphasis*, _emphasis_ (not 2 * 3 * 4)
    .replace(/`+/g, '')
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|[*•][ \t]+)/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// A site from SITES named in the text: { name, url }, or null.
function namedSite(text) {
  const name = Object.keys(SITES).find((n) => new RegExp(`\\b${n}\\b`, 'i').test(text));
  return name ? { name: new URL(SITES[name]).hostname.replace(/^www\./, ''), url: SITES[name] } : null;
}

// Whether your message asks for what her tag (its kind: open, music, media, site, close) would do.
function wanted(kind, text) {
  const music = MUSIC_WORD.test(text) || LISTEN.test(text);
  if (kind === 'music') return music;
  if (kind === 'media') return music || SOUND.test(text) || MEDIA_ASK.some(([, re]) => re.test(text));
  if (kind === 'site') return OPEN_ASK.test(text) || SITE.test(text);
  if (kind === 'close') return CLOSE_ASK.test(text);
  return OPEN_ASK.test(text) || PLAY.test(text); // an app, or a game to play
}

// The app named by her close tag: [[close: AM Music]], or a sloppier [[close]] AM Music.
function tagged(text) {
  const tag = CLOSE_TAG.exec(text);
  if (!tag) return null;
  const name = tag[1].trim() || text.slice(tag.index + tag[0].length).split('\n')[0].replace(/^[\s:.]+|[\s.!]+$/g, '');
  return name || null;
}

// Her face for an answer.
function mood(text) {
  if (/(ha){2,}|lol|хаха/i.test(text)) return 'laugh';
  if (text.includes('!')) return 'grin';
  if (text.trim().endsWith('?')) return 'smug';
  return 'look';
}
