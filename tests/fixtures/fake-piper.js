#!/usr/bin/env node
'use strict';

// A stand-in for the `piper` program, for the tests. It takes the same arguments Capri gives the real one
// (--model, --config, --output_dir, --quiet, and the speech style: --length_scale --noise_scale --noise_w --sentence_silence) and does what the real one does with them: for each line of text on
// its input it makes a wav in the output folder (a tone as long as the line, 22.05 kHz, 16-bit, mono) and prints
// the path of the file. A model file that says BROKEN makes it stop with an error, as a bad model does.
// FAKE_PIPER_LOG: a file it appends every line it was asked to say to (one JSON per line).

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };
const model = arg('--model');
const outDir = arg('--output_dir');
if (!model || !fs.existsSync(model)) {
  console.error(`[piper] [error] Model file not found: ${model}`);
  process.exit(1);
}
if (!fs.existsSync(arg('--config') || `${model}.json`)) {
  console.error('[piper] [error] Config file not found');
  process.exit(1);
}
if (/BROKEN/.test(fs.readFileSync(model, 'utf8'))) {
  console.error('[piper] [error] Failed to load model: invalid protobuf');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

function wav(seconds, hz = 330) {
  const rate = 22050;
  const n = Math.round(seconds * rate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 9000), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

let n = 0;
readline.createInterface({ input: process.stdin }).on('line', (text) => {
  if (!text.trim()) return;
  if (process.env.FAKE_PIPER_LOG) fs.appendFileSync(process.env.FAKE_PIPER_LOG, `${JSON.stringify({ text, model: path.basename(model), pid: process.pid, args })}\n`);
  if (/HANG/.test(text)) return; // never answers
  const file = path.join(outDir, `${Date.now()}_${n++}.wav`);
  fs.writeFileSync(file, wav(Math.min(3, 0.4 + text.length * 0.03)));
  process.stdout.write(`${file}\n`);
});
