#!/usr/bin/env node
'use strict';

// A stand-in for the `ollama` program, for the tests: `ollama serve` answers on OLLAMA_HOST the way the real
// one does for what Capri asks (version, tags, pull with its progress, chat streamed, generate), and keeps
// its models as folders under OLLAMA_MODELS/manifests/registry.ollama.ai/library/<name>/<tag>, like the real
// one's manifests (and takes one off again on DELETE /api/delete). No model, no download: the answers are canned. FAKE_OLLAMA_LOG: a file it appends every
// request to (one JSON per line, with the OLLAMA_MODELS it was started with). It also reports how fast it "writes"
// (FAKE_OLLAMA_TPS tokens a second, 24 by default) and how much of the model "sits on the card" (FAKE_OLLAMA_ONCARD,
// 0..1, 1 by default) the way /api/chat's counters and /api/ps do, for the measurement of the model on this PC.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

if (process.argv[2] !== 'serve') {
  console.error('fake ollama: only "serve"');
  process.exit(2);
}
const host = (process.env.OLLAMA_HOST || '127.0.0.1:11434').replace(/^https?:\/\//, '');
const [hostname, port] = host.split(':');
const modelsDir = process.env.OLLAMA_MODELS || path.join(__dirname, 'no-models');
const library = path.join(modelsDir, 'manifests', 'registry.ollama.ai', 'library');
const record = (what) => {
  if (process.env.FAKE_OLLAMA_LOG) {
    const env = { maxLoaded: process.env.OLLAMA_MAX_LOADED_MODELS || '', parallel: process.env.OLLAMA_NUM_PARALLEL || '' };
    fs.appendFileSync(process.env.FAKE_OLLAMA_LOG, `${JSON.stringify({ ...what, env, models: process.env.OLLAMA_MODELS || '' })}\n`);
  }
};
const installed = () => {
  const out = [];
  try {
    for (const name of fs.readdirSync(library)) for (const tag of fs.readdirSync(path.join(library, name))) out.push(`${name}:${tag}`);
  } catch {
    // none yet
  }
  return out;
};
const body = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    try {
      resolve(JSON.parse(data || '{}'));
    } catch {
      resolve({});
    }
  });
});
const loaded = []; // the models "in memory" (what /api/ps lists)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (url === '/api/version') return json(200, { version: '0.0.0-fake' });
  if (url === '/api/tags') return json(200, { models: installed().map((name) => ({ name, size: 1e9 })) });
  if (url === '/api/ps') {
    if (process.env.FAKE_OLLAMA_NO_PS) return json(404, { error: 'not found' });
    return json(200, { models: loaded.map((name) => ({ name, model: name, size: 4e9, size_vram: Math.round(4e9 * Number(process.env.FAKE_OLLAMA_ONCARD ?? 1)) })) });
  }
  const b = req.method === 'POST' || req.method === 'DELETE' ? await body(req) : {};
  record({ url, model: b.model, stream: b.stream, last: b.messages?.[b.messages.length - 1]?.content, options: b.options, keepAlive: b.keep_alive, format: b.format, messages: b.messages?.length });
  if (url === '/api/pull') {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const line = (o) => res.write(`${JSON.stringify(o)}\n`);
    line({ status: 'pulling manifest' });
    if (process.env.FAKE_OLLAMA_PULL_FAIL) {
      line({ error: 'pull model manifest: file does not exist' });
      return res.end();
    }
    const layers = [['sha256:aaa', 3e8], ['sha256:bbb', 1e8]];
    for (let step = 1; step <= 4; step++) {
      for (const [digest, total] of layers) line({ status: `pulling ${digest.slice(7)}`, digest, total, completed: Math.round((total * step) / 4) });
      await sleep(120);
    }
    const [name, tag = 'latest'] = String(b.model).split(':');
    fs.mkdirSync(path.join(library, name), { recursive: true });
    fs.writeFileSync(path.join(library, name, tag), '{}');
    line({ status: 'success' });
    return res.end();
  }
  if (url === '/api/delete' && req.method === 'DELETE') {
    const [name, tag = 'latest'] = String(b.model || b.name).split(':');
    const file = path.join(library, name, tag);
    if (!fs.existsSync(file)) return json(404, { error: `model '${b.model || b.name}' not found` });
    fs.rmSync(file);
    return json(200, {});
  }
  if (url === '/api/chat') {
    if (!installed().some((m) => m === b.model || m.split(':')[0] === b.model)) return json(404, { error: `model '${b.model}' not found` });
    const question = String(b.messages?.[b.messages.length - 1]?.content || '');
    const answer = `Ты спросил: «${question.slice(0, 80)}». Я Капри, я здесь, и я отвечаю.`;
    if (!loaded.includes(b.model)) loaded.push(b.model);
    if (b.stream === false) {
      const tps = Number(process.env.FAKE_OLLAMA_TPS || 24);
      const count = Math.min(48, Number(b.options?.num_predict) || 48);
      return json(200, { message: { role: 'assistant', content: answer }, done: true, eval_count: count, eval_duration: Math.round((count / tps) * 1e9) });
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    for (const piece of answer.split(/(?<= )/)) {
      res.write(`${JSON.stringify({ message: { role: 'assistant', content: piece }, done: false })}\n`);
      await sleep(15);
    }
    res.write(`${JSON.stringify({ done: true })}\n`);
    return res.end();
  }
  if (url === '/api/generate') return json(200, { done: true });
  return json(404, { error: 'not found' });
}).listen(Number(port) || 11434, hostname || '127.0.0.1', () => console.log(`fake ollama: listening on ${host}, models in ${modelsDir}`));
