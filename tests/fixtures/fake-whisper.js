#!/usr/bin/env node
'use strict';

// A stand-in for whisper.cpp's `whisper-server`, for the tests. It takes the arguments Capri gives the real one
// (-m <model> read from the working folder, --host, --port, -t, -l) and does what the real one does with them: loads the model
// (a file that says BROKEN stops it with the error a bad model gives), listens, answers GET / with a page, and for POST /inference
// answers JSON about the wav it was sent: the words in FAKE_WHISPER_TEXT (or a Russian greeting) when the wav has any sound in it,
// an empty text when it is quiet. response_format json gives { text }, verbose_json the pieces too.
// FAKE_WHISPER_LOG: a file it appends every request to (one JSON per line, with the fields that came with the audio).
// FAKE_WHISPER_LOAD_MS: how long loading the model takes before it listens.
// FAKE_WHISPER_NO_VERBOSE: answers 400 to verbose_json, as a server that knows only the plain one.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };
const model = arg('-m') || arg('--model');
const port = Number(arg('--port')) || 8080;
const host = arg('--host') || '127.0.0.1';

if (!model || !fs.existsSync(path.resolve(process.cwd(), model))) {
  console.error(`error: failed to open '${model}' (no such file)`);
  process.exit(1);
}
if (/BROKEN/.test(fs.readFileSync(path.resolve(process.cwd(), model), 'latin1'))) {
  console.error('whisper_model_load: ERROR not all tensors loaded from model file');
  console.error('error: failed to initialize whisper context');
  process.exit(1);
}

// the fields of a multipart body, and the wav in it
function parse(body, type) {
  const boundary = /boundary=(.+)$/.exec(type || '')?.[1];
  const fields = {};
  let wav = null;
  if (!boundary) return { fields, wav };
  const delimiter = Buffer.from(`--${boundary}`);
  let at = body.indexOf(delimiter);
  while (at >= 0) {
    const next = body.indexOf(delimiter, at + delimiter.length);
    if (next < 0) break;
    const part = body.subarray(at + delimiter.length + 2, next - 2); // (a line break after the boundary, one before the next)
    const split = part.indexOf('\r\n\r\n');
    const name = /name="([^"]+)"/.exec(part.subarray(0, split).toString('latin1'))?.[1];
    const data = part.subarray(split + 4);
    if (name === 'file') wav = data;
    else if (name) fields[name] = data.toString('utf8');
    at = next;
  }
  return { fields, wav };
}

const loaded = () => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>whisper.cpp server</body></html>');
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.url !== '/inference') {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const { fields, wav } = parse(Buffer.concat(chunks), req.headers['content-type']);
      if (process.env.FAKE_WHISPER_LOG) fs.appendFileSync(process.env.FAKE_WHISPER_LOG, `${JSON.stringify({ fields, bytes: wav ? wav.length : 0, model: path.basename(model), pid: process.pid, args })}\n`);
      if (!wav || wav.length < 44) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end('{"error":"no audio"}');
        return;
      }
      if (fields.response_format === 'verbose_json' && process.env.FAKE_WHISPER_NO_VERBOSE) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end('{"error":"invalid response format"}');
        return;
      }
      let sound = false;
      for (let i = 44; i < wav.length; i++) if (wav[i] !== 0) { sound = true; break; }
      const text = sound ? ` ${process.env.FAKE_WHISPER_TEXT || 'Привет, Капри.'}\n` : '';
      const language = fields.language && fields.language !== 'auto' ? fields.language : 'russian';
      res.writeHead(200, { 'content-type': 'application/json' });
      if (fields.response_format === 'verbose_json') {
        res.end(JSON.stringify({ task: 'transcribe', language, duration: 1, text, segments: text ? [{ id: 0, text, no_speech_prob: 0.01, avg_logprob: -0.2 }] : [] }));
      } else res.end(JSON.stringify({ text }));
    });
  });
  server.listen(port, host);
};

setTimeout(loaded, Number(process.env.FAKE_WHISPER_LOAD_MS) || 0);
