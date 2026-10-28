'use strict';

// How her mind is asked, task by task, and fitted to this PC once it is set up.
//
// The profile of the PC (profiles.js tuningFor) gives the start: how much of the talk the model holds at once and how
// long it stays loaded. Here that is made finer:
//   - by the task: talking in her own voice wants some variety; writing her notebook about you wants the same JSON
//     every time (a low temperature, room for the whole list, Ollama's JSON mode); a look at your screen wants facts
//   - by the model: a 1B model derails at a temperature a 12B one carries, and repeats itself sooner
//   - by the language: Russian takes about twice the tokens English does, so three sentences need more room
//   - by her own persona: with all she knows about you it takes 1.5-2.5k tokens, and the memory of the talk must fit
//     beside it, so the context grows (to the profile's ceiling) when a request would not fit
//   - by a measurement: a short run after the set-up says how fast the model really is on this PC and whether it
//     sits on the graphics card; a slow PC gets shorter answers and keeps the model loaded longer
//
// Nothing here talks to the machine: pure functions (tests/tune.test.js); ollama.js asks, main.js keeps the result.

const STEPS = [2048, 3072, 4096, 6144, 8192, 12288, 16384, 32768]; // the sizes of memory she asks for (one step up is one model reload)
const FRESH_DAYS = 30; // a measurement is good for this long (the PC may have changed after that)
const MARGIN = 128; // tokens kept free beside the prompt and the answer

// ---- the model ----

// Its size in billions of parameters, from its name: gemma3:4b → 4, qwen2.5:0.5b → 0.5, smollm2:135m → 0.135, llama3.2 → null
function billions(model) {
  const [name, tag = ''] = String(model || '').toLowerCase().split(':');
  for (const part of [tag, name]) {
    const b = /(?:^|[^a-z0-9.])e?(\d+(?:\.\d+)?)b(?![a-z0-9])/.exec(part);
    if (b) return Number(b[1]);
    const m = /(?:^|[^a-z0-9.])(\d+)m(?![a-z0-9])/.exec(part);
    if (m) return Number(m[1]) / 1000;
  }
  return null;
}

// 'tiny' (under 2.5B), 'small' (to 6B), 'mid' (to 20B), 'big'; a model whose size is not in its name is taken as 'mid'
function sizeClass(model) {
  const b = billions(model);
  if (b === null) return 'mid';
  return b < 2.5 ? 'tiny' : b < 6 ? 'small' : b < 20 ? 'mid' : 'big';
}

// ---- the task ----

const CHAT_TEMPERATURE = { tiny: 0.7, small: 0.8, mid: 0.85, big: 0.9 }; // her talk: lively, but a small model keeps its head
const REPEAT_PENALTY = { tiny: 1.12, small: 1.06 }; // (the bigger ones are left to their own default)
// the tokens that three sentences take, by language (Cyrillic costs about twice what Latin does)
const ANSWER = { ru: 320, en: 240 };

// What to ask for in this task: Ollama's `options`, and its `format` ('json' or '') apart.
//   { model, lang, answerCap (the longest answer wanted: a slow PC sets it) }
function ask(task, { model = '', lang = 'en', answerCap = 0 } = {}) {
  const cls = sizeClass(model);
  if (task === 'note') {
    // her notebook about you: JSON again and again, the whole list of it
    return { options: { temperature: 0.2, num_predict: answerCap ? Math.max(400, answerCap * 2) : 768 }, format: 'json' };
  }
  if (task === 'look') return { options: { temperature: 0.3, num_predict: 300 }, format: '' };
  let predict = ANSWER[lang] || ANSWER.en;
  if (answerCap) predict = Math.min(predict, answerCap);
  const options = { temperature: CHAT_TEMPERATURE[cls], num_predict: predict };
  if (REPEAT_PENALTY[cls]) options.repeat_penalty = REPEAT_PENALTY[cls];
  return { options, format: '' };
}

// ---- the memory of the talk ----

// About how many tokens a request is: Latin text runs about 3.6 characters a token, other scripts about 2; a picture
// takes a few hundred.
function estimateTokens(messages) {
  let total = 0;
  for (const m of messages || []) {
    const text = typeof m?.content === 'string' ? m.content : '';
    let latin = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 0x250) latin++;
    total += latin / 3.6 + (text.length - latin) / 2 + 6;
    total += (Array.isArray(m?.images) ? m.images.length : 0) * 300;
  }
  return Math.ceil(total);
}

// the smallest memory size that holds `need` tokens (the largest there is when nothing does)
const stepFor = (need) => STEPS.find((s) => s >= need) || STEPS[STEPS.length - 1];

// What a request needs of the memory, with the answer and a margin.
const needed = (messages, predict) => estimateTokens(messages) + (Number(predict) || 0) + MARGIN;

// The memory to ask with after a request that needs `need` tokens: what she has, or one that holds it (never over `max`;
// no memory set at all means Ollama's own, which is left alone).
function grow(current, need, max) {
  if (!current || need <= current) return current;
  const ceiling = Math.max(current, max || current);
  return Math.min(stepFor(need), ceiling);
}

// ---- the measurement ----

// What a short run says: { evalCount, evalNs, size, vram } (Ollama's own counters) → { tps, speed, onCard } or null.
// onCard: the part of the model that sits in the memory of the card (0..1), null if unknown.
function judge(sample) {
  const count = Number(sample?.evalCount);
  const ns = Number(sample?.evalNs);
  if (!(count >= 8) || !(ns > 0)) return null; // (too few words to tell)
  const tps = Math.round((count / (ns / 1e9)) * 10) / 10;
  const speed = tps < 6 ? 'slow' : tps >= 25 ? 'fast' : 'ok';
  const size = Number(sample?.size);
  const vram = Number(sample?.vram);
  const onCard = size > 0 && Number.isFinite(vram) && vram >= 0 ? Math.round(Math.min(1, vram / size) * 100) / 100 : null;
  return { tps, speed, onCard };
}

// whether a saved measurement still holds: the same model on the same kind of PC, not too old
function stillGood(saved, { model, profile, now = Date.now() } = {}) {
  if (!saved || typeof saved !== 'object') return false;
  return saved.model === model && saved.profile === profile && Number(saved.at) > 0 && now - saved.at < FRESH_DAYS * 86400000;
}

// ---- both together ----

// What she asks with: the profile's numbers, and what the measurement changes in them.
//   base: { numCtx, maxCtx, keepAlive }; measured: { speed, onCard } or null
// → { numCtx, maxCtx, keepAlive, speed, onCard, answerCap }
function settle(base = {}, measured = null) {
  const numCtx = Number(base.numCtx) || 0;
  const out = { numCtx, maxCtx: Number(base.maxCtx) || numCtx, keepAlive: base.keepAlive || '15m', speed: '', onCard: null, answerCap: 0 };
  if (!measured || !measured.speed) return out;
  out.speed = measured.speed;
  out.onCard = measured.onCard ?? null;
  if (measured.speed === 'slow') {
    // every word costs seconds: shorter answers, no growing of the memory beyond a step (a bigger prompt is slower
    // to read too), and the model stays loaded (loading it again is the slowest part)
    out.answerCap = 200;
    out.keepAlive = '60m';
    if (numCtx) out.maxCtx = Math.min(out.maxCtx, Math.max(numCtx, STEPS[STEPS.indexOf(stepFor(numCtx)) + 1] || numCtx));
  }
  return out;
}

module.exports = { billions, sizeClass, ask, estimateTokens, needed, grow, judge, stillGood, settle };
