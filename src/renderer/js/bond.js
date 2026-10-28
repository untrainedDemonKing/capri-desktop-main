// Her bond with you: she gets to know who she's talking to, and grows with it.
//
// She learns three ways, and keeps it all on this PC (bond.json in her app data, main.js):
// - How you write: short or long messages, emoji, swearing, "ты" or "вы", laughing, questions,
//   the hours you're around. Only counts and averages: none of your messages is kept here.
// - What you make of her answers: you laugh, thank her or call her cute after a short cheeky answer,
//   and she leans that way; "короче", "без сленга", "не шути", "подробнее" and she changes at once.
// - What you tell her about yourself: every few messages (and when a chat ends) her own chat model
//   writes a few lines in her notebook: what you do, what you like and don't, how you like to be
//   talked to. The model you already talk to her with; never Claude Code (it works in your project).
//
// The longer you're together, the closer she gets: strangers, getting to know each other, friends,
// close, one of us. She tells you when it changes, and it shows in how she talks to you.
//
// Her menu › Character › Learns about me turns it off. "What she knows about me" shows it, with a
// button to wipe it; "забудь всё обо мне" in her chat does the same.

import { pick, fmt, clamp, today } from './util.js';
import { lifeLines } from './lines-life.js';
import { classify } from './mood.js';

const REFLECT_EVERY = 8;        // your messages between two notebook entries
const REFLECT_ON_CLOSE = 3;     // ...or this many, when a chat ends
const REFLECT_GAP = 3 * 60000;  // never two entries (or tries) closer than this
const FEEDBACK_MS = 10 * 60000; // your message says something about her last answer if it's this recent
const SAVE_MS = 4000;
const LEARN = 0.07;             // how far one reaction moves her
const CAPS = { facts: 14, likes: 10, dislikes: 10 };

const L = '(?<![\\p{L}\\p{N}])';
const R = '(?![\\p{L}\\p{N}])';
const re = (src) => new RegExp(src, 'iu');

// What you ask of how she talks, plainly: [what it moves, how far, the words]
export const ASKS = [
  // ("короче" alone is mostly a filler word in Russian: only as an ask, or on its own)
  ['short', 0.55, re(`^\\s*(?:ну\\s+)?короче[.!?]*\\s*$|${L}(?:покороче|(?:давай|можно|говори|пиши|отвечай)\\s+(?:по)?короче|короче\\s+(?:говори|пиши|отвечай)|кратко|кратче|в\\s+двух\\s+словах|меньше\\s+(?:слов|текста|воды)|слишком\\s+(?:много|длинно|долго)|без\\s+воды|не\\s+растекайся|too\\s+long|shorter|tl;?dr|be\\s+brief|keep\\s+it\\s+short)`)],
  ['short', -0.45, re(`${L}(?:подробн|поподробнее|развернут|детальн|расскажи\\s+(?:больше|побольше)|а\\s+подробнее|more\\s+details?|elaborate|tell\\s+me\\s+more|go\\s+on)`)],
  ['slang', -0.55, re(`${L}(?:без\\s+сленга|хватит\\s+(?:сленга|чумб)|что\\s+(?:значит|такое)\\s+(?:чумба|нова|гонк|флэтлайн|преем)|не\\s+понимаю\\s+(?:твой\\s+|твоего\\s+|этот\\s+)?сленг|no\\s+slang|what\\s+(?:does|is)\\s+(?:choom|preem|nova|gonk|flatline)|stop\\s+(?:saying|calling\\s+me)\\s+choom)`)],
  ['slang', 0.4, re(`${L}(?:(?:больше|побольше)\\s+сленга|говори\\s+как\\s+в\\s+(?:киберпанке|найт[- ]?сити)|more\\s+slang|talk\\s+like\\s+night\\s+city)`)],
  ['tease', -0.55, re(`${L}(?:(?:будь|давай)\\s+(?:по)?серь[её]зн|не\\s+(?:шути|прикалывайся|издевайся|подкалывай|язви|ерничай)|хватит\\s+(?:шутить|прикалываться|издеваться|подкалывать|язвить|стебать)|без\\s+(?:шуток|приколов|подколов)|stop\\s+(?:joking|teasing|mocking)|be\\s+serious|no\\s+jokes)`)],
  ['tease', 0.45, re(`${L}(?:подколи|подкалывай|дерзи|будь\\s+(?:дерзк|наглее|злее)|поязви|roast\\s+me|be\\s+(?:sassier|meaner|cheekier)|tease\\s+me)`)],
  ['warm', 0.5, re(`${L}(?:будь\\s+(?:милее|добрее|нежнее|ласковее|помягче|мягче)|(?:помягче|поласковее)\\s+со\\s+мной|be\\s+(?:nicer|sweeter|kinder|gentle))`)],
  ['warm', -0.45, re(`${L}(?:(?:хватит|не\\s+надо)\\s+(?:сюсюкать|нежностей|сюсю)|не\\s+(?:сюсюкай|подлизывайся)|less\\s+sweet|stop\\s+being\\s+(?:so\\s+)?(?:nice|sweet|cute))`)],
];

// "What do you know about me?" / "Forget everything about me"
export const ABOUT_ME = re(`${L}(?:что\\s+ты\\s+(?:вообще\\s+)?(?:знаешь|помнишь|узнала|думаешь)\\s+(?:обо|о|про)\\s+(?:мне|меня)|что\\s+ты\\s+(?:обо|о|про)\\s+(?:мне|меня)\\s+(?:знаешь|помнишь|узнала|думаешь)|кто\\s+я\\s+для\\s+тебя|what\\s+do\\s+you\\s+(?:know|remember|think)\\s+(?:about|of)\\s+me|who\\s+am\\s+i\\s+to\\s+you)`);
export const FORGET_ME = re(`${L}(?:забудь|сотри|удали|стери)\\p{L}*\\s+(?:вс[её],?\\s+)?(?:что\\s+(?:ты\\s+)?(?:знаешь|узнала|помнишь|запомнила)\\s+)?(?:обо\\s+мне|о\\s+мне|про\\s+меня)|forget\\s+(?:everything\\s+|all\\s+)?(?:you\\s+know\\s+|you\\s+learned\\s+)?about\\s+me`);

// How you take her last answer: good, bad (beyond the tags of mood.js)
const GOOD = re(`${L}(?:круто|класс|кайф|супер|топ${R}|огонь|лол|именно|согласен|согласна|в\\s+точку|ахах|хаха|ору${R}|nice|cool|lol|exactly|love\\s+it|great|perfect)|❤|😂|🤣|👍|🔥`);
const BAD = re(`${L}(?:не\\s+так|не\\s+то|не\\s+понял|не\\s+поняла|бред|чушь|ерунд|скучно|занудн|непонятно|зачем\\s+ты|что\\?|что\\s+за\\s+бред|отстой|кринж|cringe|what\\?|nonsense|boring|that'?s\\s+wrong|not\\s+what\\s+i)|👎|🙄`);
// Night City slang in her answer (to tell what you liked about it)
const SLANG = re(`${L}(?:чумб|нова${R}|гонк|флэтлайн|преем|корпо|choom|preem|nova${R}|gonk|flatline|delta|дельта)`);
const SWEAR = re(`${L}(?:бля|хуй|хуе|хуё|пизд|еба|ёба|ебу|ебл|сука${R}|нахер|херн|fuck|shit)`);
const FORMAL = re(`${L}(?:вы|вас|вам|вами|ваш\\p{L}*)${R}`);
const INFORMAL = re(`${L}(?:ты|тебя|тебе|тобой|твой|твоя|твоё|твое|твои|твоих)${R}`);
const EMOJI = /\p{Extended_Pictographic}/u;
// What never goes in her notebook, whatever the model writes
const SENSITIVE = /@|\d[\d\s-]{5,}\d|парол|password|passwort|mot\s+de\s+passe|contraseña|senha|паспорт|passport|карт[аыу]\s+\d|card\s+number|cvv|iban|снилс|инн(?![\p{L}])|адрес\s+проживания|home\s+address|диагноз|diagnos/iu;

const EMPTY = () => ({
  v: 1,
  met: '',             // the day you first talked (YYYY-MM-DD)
  talks: 0,            // your messages to her
  days: 0,             // days you talked
  lastDay: '',
  // how you write (running averages, 0..1 except words)
  style: { n: 0, words: 0, emoji: 0, swear: 0, formal: 0.5, laugh: 0, ask: 0, hostile: 0, warm: 0 },
  hours: Array(24).fill(0),
  // what you like in her answers (-1..1): short, Night City slang, teasing, warmth
  tune: { short: 0, slang: 0, tease: 0, warm: 0 },
  // her notebook (her chat model writes it)
  notes: { facts: [], likes: [], dislikes: [], style: '', us: '' },
  level: 0,
  pending: 0,          // your messages since her last notebook entry
});

const LEVELS = [
  'You have only just met the user: you are curious about them and a little guarded. Now and then (not in every answer) ask them one small thing about themselves: what they do, what they like, how their day is.',
  'You are getting to know the user: friendly, and you remember what they told you. Ask them about themselves once in a while.',
  'You and the user are friends by now: relaxed, you tease them like a friend, you bring back things they told you, you are glad when they show up.',
  'The user is one of the people closest to you: warm and open with them, inside jokes, you missed them when they were gone, you can be honest even when it stings.',
  'The user is practically one of the minds in you: you know them very well, deep trust, you can finish their thoughts. Still Capri: cheeky, never sappy.',
];

export class Bond {
  constructor({ host, brain, heart }) {
    this.host = host;
    this.brain = brain;
    this.heart = heart;
    this.enabled = true;
    this.data = EMPTY();
    this.last = null;        // her last answer: { words, slang, tease, warm, at }
    this.reflecting = false;
    this.triedAt = -Infinity;
    this.saveTimer = 0;
    this.onLevel = null;     // (level, line) => void: she grew closer (app.js shows it)
    this.agent = false;      // her chat is Claude Code: no notebook entries (chat.js keeps it)
  }

  get t() {
    return lifeLines(this.brain.lang).bond;
  }

  async start() {
    const saved = await this.host.bondLoad?.().catch(() => null);
    this.data = normalize(saved);
    if (this.heart) this.heart.mood.tolerance = this.tolerance();
  }

  configure(cfg) {
    this.enabled = cfg.learn !== false;
  }

  // ---------- learning ----------

  // A message from you (chat.js, before her answer). `tags`: what mood.js made of it. Returns the
  // level she just reached, or 0.
  observe(text, tags = null) {
    if (!this.enabled) return 0;
    const raw = String(text || '');
    if (!tags) tags = classify(raw).tags; // her emotions off: what the message is, all the same (else heart.js already read it)
    const d = this.data;
    const now = new Date();
    // what you think of her last answer
    if (this.last && Date.now() - this.last.at < FEEDBACK_MS) learnFrom(d.tune, this.last, feedback(raw, tags));
    this.last = null;
    // what you ask of her, plainly: right away, and for good
    for (const [key, delta, pattern] of ASKS) if (pattern.test(raw)) d.tune[key] = clamp(d.tune[key] + delta, -1, 1);
    // how you write
    observeStyle(d.style, raw, tags);
    d.hours[now.getHours()] += 1;
    d.talks += 1;
    d.pending += 1;
    const day = today();
    if (!d.met) d.met = day;
    if (d.lastDay !== day) {
      d.lastDay = day;
      d.days += 1;
    }
    if (this.heart) this.heart.mood.tolerance = this.tolerance();
    const level = levelOf(d);
    const grew = level > d.level ? level : 0;
    d.level = level;
    this.save();
    return grew;
  }

  // Her answer (chat.js): what it was like, so your next message can say whether you liked it.
  replied(answer, mood = '') {
    if (!this.enabled) return;
    const words = wordCount(answer);
    this.last = {
      words,
      slang: SLANG.test(answer),
      tease: ['smug', 'laugh', 'annoyed'].includes(mood),
      warm: ['happy', 'shy'].includes(mood),
      at: Date.now(),
    };
  }

  // Swearing that's just how you talk (often, never at her): she stops pulling a face at it.
  tolerance() {
    const s = this.data.style;
    if (!this.enabled || s.n < 10 || s.hostile > 0.12) return 0;
    return clamp((s.swear - 0.15) * 3, 0, 1);
  }

  // Every few messages, or when the chat ends: her chat model updates her notebook about you.
  async reflect(history, { closing = false } = {}) {
    const d = this.data;
    if (!this.enabled || this.agent || this.reflecting || !this.host.bondReflect) return false;
    if (d.pending < (closing ? REFLECT_ON_CLOSE : REFLECT_EVERY)) return false;
    if (performance.now() - this.triedAt < REFLECT_GAP) return false;
    const talk = history.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-24);
    if (!talk.some((m) => m.role === 'user')) return false;
    this.reflecting = true;
    this.triedAt = performance.now();
    try {
      const res = await this.host.bondReflect({ messages: reflectPrompt(d.notes, talk, this.brain.lang, this.brain.custom?.userName) });
      const notes = res?.ok ? parseNotes(res.text) : null;
      if (!notes) return false;
      d.notes = mergeNotes(d.notes, notes);
      d.pending = 0;
      this.save();
      return true;
    } catch {
      return false;
    } finally {
      this.reflecting = false;
    }
  }

  progress() {
    return progressOf(this.data);
  }

  // Runs her patterns once on a sample (app.js, in a quiet moment): they compile the first time they
  // run, which shouldn't be under your first message.
  warm(sample) {
    for (const [, , pattern] of ASKS) pattern.test(sample);
    ABOUT_ME.test(sample);
    FORGET_ME.test(sample);
    feedback(sample, []);
    observeStyle({ n: 0, words: 0, emoji: 0, swear: 0, formal: 0.5, laugh: 0, ask: 0, hostile: 0, warm: 0 }, sample, []);
  }

  // Her ring menu: take back one line of her notebook ('facts' | 'likes' | 'dislikes'), or empty a
  // sentence ('style' | 'us').
  removeNote(kind, text) {
    const n = this.data.notes;
    if (Array.isArray(n[kind])) n[kind] = n[kind].filter((x) => x !== text);
    else if (kind === 'style' || kind === 'us') n[kind] = '';
    else return;
    this.save();
  }

  // ...or write one yourself (a fact about you). False if it's empty or the kind she never keeps.
  addNote(kind, text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    if (t.length < 2 || SENSITIVE.test(t) || !['facts', 'likes', 'dislikes'].includes(kind)) return false;
    // (mergeNotes puts the new one first, and drops it from the opposite list: liked, no longer disliked)
    this.data.notes = mergeNotes(this.data.notes, { [kind]: [t] });
    this.save();
    return true;
  }

  // Her ring menu: how you want her (the same four dials her learning turns), -1..1.
  setTune(key, value) {
    if (!(key in this.data.tune) || !Number.isFinite(value)) return;
    this.data.tune[key] = clamp(value, -1, 1);
    this.save();
  }

  forget() {
    this.data = EMPTY();
    this.last = null;
    if (this.heart) this.heart.mood.tolerance = 0;
    this.save(true);
  }

  save(now = false) {
    clearTimeout(this.saveTimer);
    const write = () => {
      this.saveTimer = 0;
      this.host.bondSave?.(this.data);
    };
    if (now) write();
    else this.saveTimer = setTimeout(write, SAVE_MS);
  }

  // ---------- what it changes ----------

  // What her chat model is told: how close you are, how you talk, what you like from her, her notes.
  // `text`: your message now (asking what she knows about you).
  context(text = '') {
    if (!this.enabled) return [];
    const d = this.data;
    const lines = [LEVELS[d.level]];
    if (d.talks >= 3) lines.push(`You have talked ${d.talks} times over ${d.days} day${d.days === 1 ? '' : 's'} (since ${d.met}).`);
    const how = [...styleHints(d.style), ...tuneHints(d.tune), ...hourHints(d.hours, d.talks)];
    if (how.length) lines.push(`What you've picked up about how to talk with them (follow it, while staying Capri): ${how.join(' ')}`);
    const n = d.notes;
    const notebook = [
      n.facts.length && `about them: ${n.facts.join('; ')}`,
      n.likes.length && `they like: ${n.likes.join('; ')}`,
      n.dislikes.length && `they don't like: ${n.dislikes.join('; ')}`,
      n.style && `how they like to be talked to: ${n.style}`,
      n.us && `between you: ${n.us}`,
    ].filter(Boolean);
    if (notebook.length) lines.push(`Your own notes on the user, from your talks (bring things up naturally now and then, never all at once, never invent more): ${notebook.join('. ')}.`);
    if (ABOUT_ME.test(text)) {
      lines.push(notebook.length || d.talks >= 3
        ? 'The user asks what you know about them or what they are to you: tell them, warmly and in character, from what you have learned above (a few things, not a list), and how close you feel. Never make anything up.'
        : 'The user asks what you know about them: you barely know them yet. Say so, and ask them something about themselves.');
    }
    return lines;
  }

  // When you click her with nothing going on, now and then, once you're close: a word about the two of you.
  idleLine() {
    if (!this.enabled || this.data.level < 2 || Math.random() > 0.18) return null;
    const lines = this.t.near[Math.min(this.data.level, 4)];
    return lines ? { line: fmt(pick(lines), { name: this.brain.custom?.userName || '' }).replace(/\s+,|,\s*(?=[.!?…])/g, ''), face: 'smug' } : null;
  }

  // Everything she knows, said in one go (her menu › What she knows about me).
  summary() {
    const { t } = this;
    const d = this.data;
    if (!d.talks) return t.nothing;
    const lang = this.brain.lang;
    const parts = [fmt(t.summary, {
      level: t.levels[d.level],
      date: dateOf(d.met, lang),
      talks: `${d.talks} ${plural(d.talks, t.messages, lang)}`,
    })];
    const n = d.notes;
    if (n.facts.length) parts.push(fmt(t.knows, { list: n.facts.slice(0, 6).join(', ') }));
    if (n.likes.length) parts.push(fmt(t.likes, { list: n.likes.slice(0, 5).join(', ') }));
    if (n.dislikes.length) parts.push(fmt(t.dislikes, { list: n.dislikes.slice(0, 4).join(', ') }));
    if (!n.facts.length && !n.likes.length) parts.push(t.little);
    return parts.join(' ');
  }
}

// ---------- the pieces (exported for the tests) ----------

export function normalize(saved) {
  const d = EMPTY();
  if (!saved || typeof saved !== 'object') return d;
  const num = (v, a, b, def) => (Number.isFinite(v) ? clamp(v, a, b) : def);
  d.met = typeof saved.met === 'string' ? saved.met.slice(0, 10) : '';
  d.talks = num(saved.talks, 0, 1e7, 0);
  d.days = num(saved.days, 0, 1e5, 0);
  d.lastDay = typeof saved.lastDay === 'string' ? saved.lastDay.slice(0, 10) : '';
  for (const k of Object.keys(d.style)) d.style[k] = num(saved.style?.[k], 0, k === 'n' ? 1e7 : k === 'words' ? 500 : 1, d.style[k]);
  if (Array.isArray(saved.hours) && saved.hours.length === 24) d.hours = saved.hours.map((h) => num(h, 0, 1e7, 0));
  for (const k of Object.keys(d.tune)) d.tune[k] = num(saved.tune?.[k], -1, 1, 0);
  d.notes = mergeNotes(d.notes, saved.notes || {});
  d.pending = num(saved.pending, 0, 1e5, 0);
  d.level = levelOf(d);
  return d;
}

export function wordCount(text) {
  return (String(text || '').match(/[\p{L}\p{N}]+/gu) || []).length;
}

// One message into the running averages of how you write.
export function observeStyle(s, text, tags = []) {
  const has = (t) => tags.includes(t);
  s.n += 1;
  const a = Math.max(0.04, 1 / s.n); // a plain average at first, then slowly following you
  const ema = (key, v) => { s[key] += (v - s[key]) * a; };
  ema('words', Math.min(120, wordCount(text)));
  ema('emoji', EMOJI.test(text) ? 1 : 0);
  ema('swear', SWEAR.test(text) || has('rude') ? 1 : 0);
  ema('laugh', has('laughing') ? 1 : 0);
  ema('ask', /\?/.test(text) ? 1 : 0);
  ema('hostile', has('insult') || has('threat') || has('justBot') ? 1 : 0);
  ema('warm', has('compliment') || has('love') || has('thanks') || has('flirt') ? 1 : 0);
  // "вы" or "ты": only when one of them is there
  const formal = FORMAL.test(text);
  const informal = INFORMAL.test(text);
  if (formal !== informal) s.formal += ((formal ? 1 : 0) - s.formal) * Math.max(0.1, a);
  return s;
}

// How your message takes her last answer: -1 (bad) .. 1 (good), 0 if it says nothing about it.
export function feedback(text, tags = []) {
  const has = (t) => tags.includes(t);
  let s = 0;
  if (has('laughing')) s += 0.8;
  if (has('thanks')) s += 0.5;
  if (has('compliment') || has('love')) s += 0.8;
  if (GOOD.test(text)) s += 0.5;
  if (has('insult')) s -= 1; // (yelling or a flood of messages is about you, not her answer)
  if (BAD.test(text)) s -= 0.8;
  return clamp(s, -1, 1);
}

// Leaning toward what you liked in her last answer (and away from what you didn't).
export function learnFrom(tune, last, score) {
  if (!score || !last) return tune;
  const step = LEARN * score;
  const length = last.words <= 14 ? 1 : last.words >= 35 ? -1 : 0;
  if (length) tune.short = clamp(tune.short + step * length, -1, 1);
  if (last.slang) tune.slang = clamp(tune.slang + step, -1, 1);
  if (last.tease) tune.tease = clamp(tune.tease + step, -1, 1);
  if (last.warm) tune.warm = clamp(tune.warm + step * 0.7, -1, 1);
  return tune;
}

// What each level takes: your messages, and days you came by. Level 0 is where everybody starts.
export const LEVEL_AT = [{ talks: 0, days: 0 }, { talks: 12, days: 0 }, { talks: 80, days: 3 }, { talks: 250, days: 10 }, { talks: 700, days: 30 }];

// The level time alone would give (without being held back for rudeness).
function earned({ talks = 0, days = 0 }) {
  let level = 0;
  LEVEL_AT.forEach((at, i) => { if (talks >= at.talks && days >= at.days) level = i; });
  return level;
}

// How close she is to you: 0 strangers, 1 getting to know each other, 2 friends, 3 close, 4 one of us.
export function levelOf(d) {
  let level = earned(d);
  // someone who's mostly rude to her doesn't get close
  if (d.style?.n >= 10 && d.style.hostile > 0.3) level = Math.min(level, 1);
  else if (d.style?.n >= 10 && d.style.hostile > 0.15) level = Math.min(level, 2);
  return level;
}

// Where you stand (her ring menu › Bond): the level, how far to the next one (0..1, and what's still
// missing), and whether rudeness is what's holding her back.
export function progressOf(d) {
  const level = levelOf(d);
  const next = level < LEVEL_AT.length - 1 ? LEVEL_AT[level + 1] : null;
  const here = LEVEL_AT[level];
  const out = { level, max: LEVEL_AT.length - 1, held: earned(d) > level, next: next ? level + 1 : null, fraction: 1, needTalks: 0, needDays: 0 };
  if (!next) return out;
  const talks = Math.max(0, (d.talks || 0) - here.talks);
  out.needTalks = Math.max(0, next.talks - (d.talks || 0));
  out.needDays = Math.max(0, next.days - (d.days || 0));
  const parts = [talks / (next.talks - here.talks)];
  if (next.days > here.days) parts.push(Math.max(0, (d.days || 0) - here.days) / (next.days - here.days));
  out.fraction = clamp(Math.min(...parts), 0, 1);
  return out;
}

// How you write, as advice for her (only once there's enough to go on).
export function styleHints(s) {
  if (s.n < 6) return [];
  const out = [];
  if (s.words < 6) out.push('They write very short messages: keep your answers short and snappy too.');
  else if (s.words > 28) out.push('They write long, thoughtful messages: you can answer a little more fully.');
  if (s.emoji > 0.35) out.push('They use emoji a lot: be extra playful with them.');
  if (s.swear > 0.25 && s.hostile < 0.12) out.push('They swear casually, it is just how they talk and not aimed at you: don\'t take offence, you can be a bit rough yourself.');
  if (s.formal > 0.65) out.push('They address you formally ("вы"): stay yourself, with a touch more politeness and a little less teasing.');
  if (s.laugh > 0.3) out.push('They laugh a lot with you: keep the jokes coming.');
  if (s.ask > 0.6) out.push('They mostly ask you things: give a straight, useful answer first, then the attitude.');
  if (s.hostile > 0.25) out.push('They are often rude to you: you are wary of them, and you don\'t let it slide.');
  else if (s.warm > 0.3) out.push('They are often sweet to you (thanks, compliments): you can be softer with them.');
  return out;
}

// What they liked from her, as advice.
export function tuneHints(t) {
  const out = [];
  if (t.short > 0.25) out.push('They like short answers: one or two sentences, no more.');
  else if (t.short < -0.25) out.push('They like it when you say more: up to four or five sentences, with details.');
  if (t.slang < -0.25) out.push('Very little Night City slang with them: they don\'t like it or don\'t get it.');
  else if (t.slang > 0.3) out.push('They love your Night City slang: use it freely.');
  if (t.tease < -0.25) out.push('They don\'t enjoy being teased: be playful but kind, no jabs at them.');
  else if (t.tease > 0.3) out.push('They love it when you tease them: be cheeky.');
  if (t.warm > 0.25) out.push('They want you warmer and gentler with them.');
  else if (t.warm < -0.25) out.push('They like you with an edge: less sweet.');
  return out;
}

// When they're usually around (the 6 hours with most of their messages), and whether now is unusual.
export function hourHints(hours, talks, now = new Date().getHours()) {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total < 20) return [];
  let best = 0;
  let from = 0;
  for (let h = 0; h < 24; h++) {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += hours[(h + i) % 24];
    if (sum > best) {
      best = sum;
      from = h;
    }
  }
  if (best / total < 0.5) return [];
  const out = [`They are usually around from ${from}:00 to ${(from + 6) % 24}:00.`];
  const usual = (now - from + 24) % 24 < 6;
  if (!usual && hours[now] / total < 0.03 && talks >= 30) out.push('It is unusual for them to be here at this hour: you can notice it.');
  return out;
}

// What her chat model is asked, to update her notebook.
export function reflectPrompt(notes, talk, lang = 'en', name = '') {
  const language = lang === 'ru' ? 'Russian' : 'English';
  const transcript = talk
    .map((m) => `${m.role === 'user' ? 'User' : 'Capri'}: ${String(m.content).replace(/\s+/g, ' ').slice(0, 400)}`)
    .join('\n');
  return [
    {
      role: 'system',
      content: [
        'You keep a small private notebook for Capri, a desktop AI companion, about the user she talks to, so she gets to know them over time.',
        'Read the notebook so far and the latest conversation, and return the updated notebook.',
        'facts: lasting things the user said about themselves (what they do or study, projects, hobbies, pets, the city or country, people in their life by first name, plans, what they are going through). Only what the user really said, never guesses, never what Capri said.',
        'likes / dislikes: things they enjoy or can\'t stand (games, music, food, topics…), and what they like or dislike in how Capri talks.',
        'style: one short sentence on how they like to be talked to. us: one short sentence on how things are between them and Capri.',
        'Never write passwords, phone numbers, emails, exact addresses, card or document numbers, health or money details.',
        'Keep what is still true, drop what is outdated, merge duplicates. At most 12 facts, 8 likes, 8 dislikes, each a few words.',
        `Write the items in ${language}${name ? `; the user's name is ${name}` : ''}.`,
        'Answer ONLY with compact JSON: {"facts":[],"likes":[],"dislikes":[],"style":"","us":""}. No markdown, no code fence.',
      ].join(' '),
    },
    { role: 'user', content: `Notebook so far: ${JSON.stringify(notes)}\n\nLatest conversation:\n${transcript}` },
  ];
}

// The model's notebook, read leniently and cleaned (nothing sensitive, nothing long). null if unreadable.
export function parseNotes(text) {
  const raw = String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '');
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o;
  try {
    o = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const list = (v, cap) => (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === 'string' ? x : '').replace(/\s+/g, ' ').trim().slice(0, 90))
    .filter((x) => x.length >= 2 && !SENSITIVE.test(x))
    .slice(0, cap);
  const line = (v) => {
    const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 180) : '';
    return SENSITIVE.test(s) ? '' : s;
  };
  return { facts: list(o.facts, CAPS.facts), likes: list(o.likes, CAPS.likes), dislikes: list(o.dislikes, CAPS.dislikes), style: line(o.style), us: line(o.us) };
}

// The new notebook first, what it left out after (a small model forgets more than it should),
// no duplicates, nothing liked and disliked at once, capped.
export function mergeNotes(old = {}, next = {}) {
  const key = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const join = (a = [], b = [], cap) => {
    const seen = new Set();
    const out = [];
    for (const item of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
      if (typeof item !== 'string') continue;
      const k = key(item);
      if (!k || seen.has(k) || SENSITIVE.test(item)) continue;
      seen.add(k);
      out.push(item.trim().slice(0, 90));
    }
    return out.slice(0, cap);
  };
  const keys = (v) => new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string').map(key));
  const without = (v, gone) => (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && !gone.has(key(x)));
  // something now liked isn't disliked any more, and the other way round
  const nowLiked = keys(next.likes);
  const nowDisliked = keys(next.dislikes);
  return {
    facts: join(next.facts, old.facts, CAPS.facts),
    likes: join(next.likes, without(old.likes, nowDisliked), CAPS.likes),
    dislikes: join(next.dislikes, without(old.dislikes, nowLiked), CAPS.dislikes),
    style: (typeof next.style === 'string' && next.style) || (typeof old.style === 'string' ? old.style : ''),
    us: (typeof next.us === 'string' && next.us) || (typeof old.us === 'string' ? old.us : ''),
  };
}

export function plural(n, forms, lang) {
  if (!Array.isArray(forms)) return forms;
  if (lang === 'ru' && forms.length >= 3) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return forms[0];
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
    return forms[2];
  }
  return n === 1 ? forms[0] : forms[1];
}

export function dateOf(day, lang) {
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  try {
    return d.toLocaleDateString(lang, { day: 'numeric', month: 'long' });
  } catch {
    return day;
  }
}
