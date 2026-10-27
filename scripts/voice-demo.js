#!/usr/bin/env node
'use strict';

// Makes WAV files with Capri's own voice (src/renderer/js/voice-synth.js), no app and no service needed,
// so her voice can be listened to and judged.
//   npm run voice:demo                          the same line in every mood, into ./voice-demo
//   npm run voice:demo -- "Привет, чумба" angry  one line, one mood
//   npm run voice:demo -- "Hello there" calm en  one line, one mood, one language (ru en es pt fr)

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const OUT = path.join(process.cwd(), 'voice-demo');
const LINE = 'Ну что, чумба, опять взламываешь лёд? Я бы на твоём месте не стала.';

(async () => {
  const { synthesize, toWav, MOOD_NAMES } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', 'voice-synth.js')).href);
  const [text, mood, lang = 'ru'] = process.argv.slice(2);
  fs.mkdirSync(OUT, { recursive: true });
  const jobs = text ? [[text, mood || 'calm']] : MOOD_NAMES.map((m) => [LINE, m]);
  for (const [t, m] of jobs) {
    if (!MOOD_NAMES.includes(m)) { console.error(`unknown mood "${m}", one of: ${MOOD_NAMES.join(' ')}`); process.exit(1); }
    const t0 = performance.now();
    const r = synthesize(t, { lang, mood: m });
    const file = path.join(OUT, `${text ? 'line' : 'mood'}-${m}-${lang}.wav`);
    fs.writeFileSync(file, Buffer.from(toWav(r.samples, r.sampleRate)));
    console.log(`${path.relative(process.cwd(), file)}  ${r.duration.toFixed(2)} s, made in ${Math.round(performance.now() - t0)} ms`);
  }
})();
