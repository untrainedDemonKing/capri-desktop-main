#!/usr/bin/env node
'use strict';

// A stand-in for the `ollama` program, for the tests: `ollama serve` answers on OLLAMA_HOST the way the real
// one does for what Capri asks (version, tags, pull with its progress, chat streamed, generate), and keeps
// its models as folders under OLLAMA_MODELS/manifests/registry.ollama.ai/library/<name>/<tag>, like the real
// one's manifests. No model, no download: the answers are canned. FAKE_OLLAMA_LOG: a file it appends every
// request to (one JSON per line, with the OLLAMA_MODELS it was started with).

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
  if (process.env.FAKE_OLLAMA_LOG) fs.appendFileSync(process.env.FAKE_OLLAMA_LOG, `${JSON.stringify({ ...what, models: process.env.OLLAMA_MODELS || '' })}\n`);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (url === '/api/version') return json(200, { version: '0.0.0-fake' });
  if (url === '/api/tags') return json(200, { models: installed().map((name) => ({ name, size: 1e9 })) });
  const b = req.method === 'POST' ? await body(req) : {};
  record({ url, model: b.model, stream: b.stream, last: b.messages?.[b.messages.length - 1]?.content });
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
  if (url === '/api/chat') {
    if (!installed().some((m) => m === b.model || m.split(':')[0] === b.model)) return json(404, { error: `model '${b.model}' not found` });
    const question = String(b.messages?.[b.messages.length - 1]?.content || '');
    const answer = `Ты спросил: «${question.slice(0, 80)}». Я Капри, я здесь, и я отвечаю.`;
    if (b.stream === false) return json(200, { message: { role: 'assistant', content: answer }, done: true });
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
