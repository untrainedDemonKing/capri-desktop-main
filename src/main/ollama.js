'use strict';

// Talking to her: a local model through Ollama (https://ollama.com). Done from here, not from
// the overlay's page, which can't reach other local ports. Everything stays on this machine
// unless OLLAMA_HOST points somewhere else.

// How she asks for her answers, set from the profile of this PC (profiles.js): how much of the talk the model
// holds at once (the memory it takes grows with it) and how long it stays loaded after the last question.
let tuning = { numCtx: 0, keepAlive: '15m' };
function tune(t = {}) {
  tuning = { numCtx: Number(t.numCtx) || 0, keepAlive: t.keepAlive || '15m' };
}
// (the same context in every call: a different one makes Ollama load the model again)
const withContext = (options = {}) => (tuning.numCtx ? { ...options, num_ctx: tuning.numCtx } : options);

function base() {
  let host = process.env.OLLAMA_HOST || '127.0.0.1:11434';
  if (!/^https?:\/\//.test(host)) host = `http://${host}`;
  return host.replace('://0.0.0.0', '://127.0.0.1').replace(/\/+$/, '');
}

// Ollama's errors come as {"error": "..."}
async function failure(res) {
  const body = await res.text().catch(() => '');
  try {
    return new Error(JSON.parse(body).error);
  } catch {
    return new Error(body || `Ollama answered ${res.status}`);
  }
}

// The models installed, by name ("llama3.2:latest"...).
async function models() {
  const res = await fetch(`${base()}/api/tags`, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw await failure(res);
  const { models: list = [] } = await res.json();
  return list.map((m) => m.name);
}

// The models installed with what each takes on the disk: [{ name, size }]
async function list() {
  const res = await fetch(`${base()}/api/tags`, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw await failure(res);
  const { models: all = [] } = await res.json();
  return all.map((m) => ({ name: m.name, size: Number(m.size) || 0 }));
}

// Takes a model off the disk (Ollama keeps the pieces other models share).
async function remove(name) {
  const res = await fetch(`${base()}/api/delete`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: name, name }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw await failure(res);
}

// Whether an Ollama answers at this address, and which version it is ('' if none does).
async function version(signal = AbortSignal.timeout(1500)) {
  try {
    const res = await fetch(`${base()}/api/version`, { signal });
    if (!res.ok) return '';
    return String((await res.json()).version || '0');
  } catch {
    return '';
  }
}

// One answer in one go (not streamed): her eyes ask this about a picture (llm.js see).
async function once({ model, messages }, signal) {
  const res = await fetch(`${base()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, keep_alive: tuning.keepAlive, options: withContext({ temperature: 0.4, num_predict: 300 }) }),
    signal,
  });
  if (!res.ok) throw await failure(res);
  const body = await res.json();
  if (body.error) throw new Error(body.error);
  return body.message?.content || '';
}

// Loads the model into memory ahead of the first message (the first answer after a fresh start
// otherwise waits for it to load, which can take a while).
function warm(model) {
  fetch(`${base()}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: tuning.keepAlive, options: withContext() }),
  }).catch(() => {});
}

// Her answer, streamed: onDelta(piece) as it comes, resolves with all of it.
async function chat({ model, messages }, onDelta, signal) {
  const res = await fetch(`${base()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      keep_alive: tuning.keepAlive, // she stays loaded while you chat
      options: withContext({ temperature: 0.85, num_predict: 240 }),
    }),
    signal,
  });
  if (!res.ok) throw await failure(res);
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(msg.error);
      const piece = msg.message?.content || ''; // a thinking model's reasoning comes apart, and is left out
      if (piece) {
        text += piece;
        onDelta(piece);
      }
      if (msg.done) return text;
    }
  }
  return text;
}

// Fetches a model. Ollama sends its pieces one after the other: onProgress({ completed, total })
// adds them up, so the bar goes once from empty to full.
async function pull(name, onProgress, signal) {
  const res = await fetch(`${base()}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: name, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
  const pieces = new Map(); // digest -> { completed, total }
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(msg.error);
      if (msg.digest && msg.total) pieces.set(msg.digest, { completed: msg.completed || 0, total: msg.total });
      let completed = 0;
      let total = 0;
      for (const p of pieces.values()) {
        completed += p.completed;
        total += p.total;
      }
      onProgress?.({ completed, total, status: msg.status });
      if (msg.status === 'success') return;
    }
  }
}

module.exports = { base, tune, version, models, list, remove, warm, chat, once, pull };
