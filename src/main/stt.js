'use strict';

// Her ears: your voice turned into text, so you can talk to her instead of typing (ears.js records,
// this sends the audio to a speech-to-text service). Off unless you turn it on (her menu › Senses),
// and the audio only ever goes to the service you picked.
//
// Groq (a free tier, whisper-large-v3-turbo, good at Russian), OpenAI, or any OpenAI-compatible
// server on your PC (whisper.cpp, faster-whisper: nothing leaves the machine).

const ENGINES = {
  groq: { label: 'Groq (free tier)', url: 'https://api.groq.com/openai/v1', key: 'groq', env: 'GROQ_API_KEY', model: 'whisper-large-v3-turbo' },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1', key: 'openai', env: 'OPENAI_API_KEY', model: 'whisper-1' },
  custom: { label: 'OpenAI-compatible server', key: 'stt', model: 'whisper-1' },
};
const KEY_PAGES = { groq: 'https://console.groq.com/keys', openai: 'https://platform.openai.com/api-keys' };

const withCode = (err, code) => Object.assign(err, { code });

async function failure(res) {
  const body = await res.text().catch(() => '');
  let message = body.slice(0, 200) || `answered ${res.status}`;
  try {
    const err = JSON.parse(body).error;
    if (err) message = typeof err === 'string' ? err : err.message || message;
  } catch {
    // not JSON
  }
  return withCode(new Error(message), res.status === 401 || res.status === 403 ? 'badkey' : null);
}

// Transcribe audio (a Buffer of webm/opus, or any format the engine takes). `lang`: a hint (ru, en…).
// Returns the text (may be empty if you said nothing).
async function transcribe(cfg, keys, { audio, mime = 'audio/webm', lang = '' }) {
  const engine = ENGINES[cfg.sttEngine] ? cfg.sttEngine : 'groq';
  const e = ENGINES[engine];
  const base = (engine === 'custom' ? String(cfg.sttUrl || '') : e.url).replace(/\/+$/, '');
  if (!base) throw withCode(new Error('no address for the speech server'), 'nourl');
  const key = keys[e.key] || (e.env && process.env[e.env]) || '';
  if (engine !== 'custom' && !key) throw withCode(new Error(`no ${engine} key`), 'nokey');

  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime }), 'speech.webm');
  form.append('model', cfg.sttModel || e.model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (lang) form.append('language', lang);

  const res = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: key ? { authorization: `Bearer ${key}` } : {},
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw await failure(res);
  const body = await res.json().catch(() => ({}));
  return String(body.text || '').trim();
}

module.exports = { ENGINES, KEY_PAGES, transcribe };
