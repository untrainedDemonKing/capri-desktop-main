'use strict';

// Her ears: your voice turned into text, so you can talk to her instead of typing (ears.js records,
// this sends the audio to a speech-to-text service). Off unless you turn it on (her menu › Senses),
// and the audio only ever goes to the service you picked.
//
// By default whisper.cpp on this PC, fetched and run by her (whisper.js: nothing leaves the machine, no key, no account).
// Or Groq (a free tier, whisper-large-v3-turbo, good at Russian), OpenAI, or any OpenAI-compatible
// server of your own (faster-whisper...). A cloud service with no key saved is not a choice: the one on this PC answers.

const ENGINES = {
  local: { label: 'On this PC (whisper.cpp)', local: true, path: '/inference', timeout: 90000 },
  groq: { label: 'Groq (free tier)', url: 'https://api.groq.com/openai/v1', key: 'groq', env: 'GROQ_API_KEY', model: 'whisper-large-v3-turbo' },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1', key: 'openai', env: 'OPENAI_API_KEY', model: 'whisper-1' },
  custom: { label: 'OpenAI-compatible server', key: 'stt', model: 'whisper-1' },
};
const KEY_PAGES = { groq: 'https://console.groq.com/keys', openai: 'https://platform.openai.com/api-keys' };

const withCode = (err, code) => Object.assign(err, { code });

// Which engine answers: the one in her settings, but a service of the cloud with no key to go with it is not one that can
function engineFor(cfg, keys = {}) {
  const name = ENGINES[cfg.sttEngine] ? cfg.sttEngine : 'local';
  const e = ENGINES[name];
  if (e.key && name !== 'custom' && !keys[e.key] && !(e.env && process.env[e.env])) return 'local';
  return name;
}

async function failure(res) {
  const body = await res.text().catch(() => '');
  let message = body.slice(0, 200) || `answered ${res.status}`;
  try {
    const err = JSON.parse(body).error;
    if (err) message = typeof err === 'string' ? err : err.message || message;
  } catch {
    // not JSON
  }
  return Object.assign(withCode(new Error(message), res.status === 401 || res.status === 403 ? 'badkey' : null), { status: res.status });
}

// What she asks a recogniser to expect: her name and the words you are most likely to say to her (it hears "Капри" and "Spotify"
// right, not "Каприз" and "спотифай"). Said as a line of speech, in the language she is told you speak (both when it is not told).
const HINTS = {
  ru: 'Капри, привет. Открой Spotify, YouTube, Chrome, Telegram, Discord. Найди в Google. Включи музыку.',
  en: 'Capri, hello. Open Spotify, YouTube, Chrome, Telegram, Discord. Search Google. Play some music.',
};
const KNOWN = { russian: 'ru', ru: 'ru', english: 'en', en: 'en' };
const FILES = { 'audio/wav': 'speech.wav', 'audio/x-wav': 'speech.wav', 'audio/webm': 'speech.webm', 'audio/ogg': 'speech.ogg', 'audio/mpeg': 'speech.mp3', 'audio/mp4': 'speech.m4a' };

// The text of an answer in verbose_json, without what the recogniser made up for a noise: pieces it is sure were not speech
// (and was unsure of what it wrote), and a piece that repeats itself over and over. An answer without pieces is its text.
function spoken(body) {
  const pieces = Array.isArray(body.segments) ? body.segments : [];
  if (!pieces.length) return String(body.text || '').trim();
  const kept = pieces.filter((p) => !(p.no_speech_prob > 0.6 && p.avg_logprob < -0.7) && !(p.compression_ratio > 2.6));
  return kept.map((p) => String(p.text || '').trim()).filter(Boolean).join(' ').trim();
}

async function ask(base, key, { audio, mime, model, lang, prompt, plain = false, route = '/audio/transcriptions', timeout = 30000 }, fetchFn) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime }), FILES[mime] || 'speech.webm');
  if (model) form.append('model', model);
  form.append('response_format', plain ? 'json' : 'verbose_json'); // (a server that knows only the plain one is asked for it)
  form.append('temperature', '0');
  if (lang) form.append('language', lang);
  if (prompt && !plain) form.append('prompt', prompt);
  const res = await fetchFn(`${base}${route}`, {
    method: 'POST',
    headers: key ? { authorization: `Bearer ${key}` } : {},
    body: form,
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw await failure(res);
  // (an answer that is not JSON at all comes back marked, not as "you said nothing": it is asked for again in the plain form)
  return res.json().catch(() => ({ unreadable: true }));
}

// Transcribe audio (a Buffer of wav, or any format the engine takes). `lang`: the language you picked (ru, en), or '' for
// "whichever it is": then the recogniser hears which, and when it says a language she does not speak (a short Russian
// sentence taken for Ukrainian or Bulgarian) the same audio is asked again in `hint`, the language of her menus.
// Returns the text (may be empty if you said nothing).
async function transcribe(cfg, keys, { audio, mime = 'audio/webm', lang = '', hint = '' }, { fetch: fetchFn = fetch, whisper = null } = {}) {
  const engine = engineFor(cfg, keys);
  const e = ENGINES[engine];
  // (the server on this PC is started when it is first needed; one that is not installed is told as such, and ears.js fetches it)
  const base = (engine === 'local' ? await whisper?.ready(cfg) || '' : engine === 'custom' ? String(cfg.sttUrl || '') : e.url).replace(/\/+$/, '');
  if (!base) throw withCode(new Error(engine === 'local' ? 'the speech recogniser on this PC is not installed' : 'no address for the speech server'), engine === 'local' ? 'nolocal' : 'nourl');
  const key = engine === 'local' ? '' : keys[e.key] || (e.env && process.env[e.env]) || '';
  if (engine !== 'custom' && engine !== 'local' && !key) throw withCode(new Error(`no ${engine} key`), 'nokey');
  const model = engine === 'local' ? '' : cfg.sttModel || e.model;
  const prompt = lang ? HINTS[lang] || '' : `${HINTS.ru} ${HINTS.en}`;

  // (a hiccup of the network or the service is tried once more: a lost sentence is worse than a second of waiting; a server that
  // does not take the richer answer is asked for the plain one)
  const once = async (language) => {
    const request = { audio, mime, model, lang: language, prompt: language ? HINTS[language] || '' : prompt, route: e.path, timeout: e.timeout };
    try {
      const body = await ask(base, key, request, fetchFn);
      if (!body.unreadable) return body;
      const plain = await ask(base, key, { ...request, plain: true }, fetchFn);
      if (plain.unreadable) throw withCode(new Error('the speech server answered something that is not text'), 'badanswer');
      return plain;
    } catch (err) {
      if (err.code === 'badanswer') throw err;
      if ([400, 415, 422].includes(err.status)) return ask(base, key, { ...request, plain: true }, fetchFn);
      if (err.status && err.status < 500 && err.status !== 429) throw err;
      await new Promise((r) => setTimeout(r, 800));
      return ask(base, key, request, fetchFn);
    }
  };
  let body;
  try {
    body = await once(lang);
    const heard = KNOWN[String(body.language || '').toLowerCase()];
    if (!lang && body.language && !heard && KNOWN[hint]) body = await once(hint);
  } catch (err) {
    // (the server on this PC that does not answer at all has stopped: its own reason is the one to tell)
    if (engine === 'local' && !err.status) throw withCode(new Error(whisper.status?.().error || err.message), 'exited');
    throw err;
  }
  if (engine === 'local') whisper.rest?.();
  return spoken(body);
}

module.exports = { ENGINES, KEY_PAGES, HINTS, engineFor, transcribe, spoken };
