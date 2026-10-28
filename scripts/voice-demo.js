#!/usr/bin/env node
'use strict';

// Makes recordings of her voices as they sound on this PC, to hear that they work: every Piper voice she has (Russian and
// English), and Chatterbox (Russian and English, with the recording she was given as her voice and without), by the same
// code she speaks with. Nothing is installed or fetched: it uses what is there, and says what is not.
//
//   node scripts/voice-demo.js [--data <her data folder>] [--out <folder for the recordings>] [--only piper|chatterbox]
//                              [--sample <a recording to take the voice from>]
//
// Her data folder is where she keeps Piper, Chatterbox and her voice (Windows: %APPDATA%\Capri). The recordings and a
// report.txt go to ./voice-samples. Chatterbox takes a while to load (and, with no card, to speak).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Piper, STYLE } = require('../src/main/piper');
const { Chatterbox } = require('../src/main/chatterbox');
const { createSample } = require('../src/main/voice-sample');
const tts = require('../src/main/tts');

const LINES = {
  ru: 'Привет, чумба! Я живу на твоём рабочем столе и очень люблю смотреть на спутник. Только не называй меня ботом, ладно?',
  en: 'Hey, choom! I live on your desktop now, and I really love watching the satellite. Just do not call me a bot, okay?',
};

const args = process.argv.slice(2);
const option = (name, fallback = '') => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const home = process.platform === 'win32' ? process.env.APPDATA : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config');
const data = path.resolve(option('data', path.join(home || os.homedir(), 'Capri')));
const out = path.resolve(option('out', 'voice-samples'));
const only = option('only');
const report = [];
const say = (line) => {
  report.push(line);
  console.log(line);
};
// (a plain wav's length: the size of its data over bytes a second)
const seconds = (wav) => Math.round((wav.readUInt32LE(40) / (wav.readUInt32LE(24) * wav.readUInt16LE(22) * (wav.readUInt16LE(34) / 8))) * 10) / 10;
const save = (name, wav, t0) => {
  fs.writeFileSync(path.join(out, name), wav);
  say(`  ${name}: ${seconds(wav)} s of speech, made in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
};

async function piperVoices() {
  const piper = new Piper({ roots: () => [data, process.cwd()], defaultDir: () => path.join(data, 'piper') });
  const cfg = {};
  if (!piper.locate(cfg)) return say('Piper: the program is not found (she fetches it when Piper is picked in her main menu).');
  const voices = piper.voices(cfg).filter((v) => /^(ru|en)_/i.test(v.key));
  if (!voices.length) return say('Piper: the program is there, but no Russian or English voice.');
  say(`Piper (${piper.locate(cfg).exe}), the speech style she asks for: ${STYLE.join(' ')}`);
  for (const v of voices) {
    const lang = v.key.slice(0, 2).toLowerCase();
    const t0 = Date.now();
    try {
      save(`piper-${v.key}.wav`, await piper.speak({ ttsVoice: v.key }, { text: LINES[lang], lang }), t0);
    } catch (err) {
      say(`  ${v.key}: FAILED: ${err.message}`);
    }
  }
  piper.stop();
  return undefined;
}

async function chatterboxVoice() {
  const sample = createSample({ dir: path.join(data, 'voices') });
  const given = option('sample');
  if (given) {
    const res = sample.use(given);
    say(res.ok ? `The recording ${given} is now her voice (${res.seconds ?? '?'} s).` : `The recording ${given} was refused: ${res.error}`);
  }
  const folder = fs.existsSync(path.join(data, 'chatterbox')) ? path.join(data, 'chatterbox') : '';
  const box = new Chatterbox({ roots: () => [data, process.cwd()], voices: () => [sample.dir()] });
  const cfg = { ttsEngine: 'chatterbox', chatterboxDir: folder };
  if (!folder) say('Chatterbox: no folder of its own in her data folder; trying a Chatterbox folder next to her, else the Python on the PATH.');
  say('Chatterbox: loading the model (the first time it is downloaded: a few GB)…');
  try {
    await box.sync(cfg);
    const base = await box.ready(cfg, 30 * 60 * 1000);
    say(`Chatterbox is ready on ${box.status().device || 'the processor'}.`);
    const has = sample.current();
    const mine = has ? { sample: has, sampleLang: sample.lang() } : {};
    for (const lang of ['ru', 'en']) {
      for (const [label, extra] of [['model-voice', {}], ...(has ? [['capri-voice', mine]] : [])]) {
        const t0 = Date.now();
        try {
          save(`chatterbox-${lang}-${label}.wav`, await tts.speak(cfg, {}, { text: LINES[lang], mood: 'happy', lang, base, ...extra }), t0);
        } catch (err) {
          say(`  chatterbox-${lang}-${label}: FAILED: ${err.message}`);
        }
      }
    }
  } catch (err) {
    say(`Chatterbox: FAILED: ${err.message}${box.status().log.length ? `\n    ${box.status().log.slice(-3).join('\n    ')}` : ''}`);
  } finally {
    box.stop();
  }
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  say(`Her data folder: ${data}\nRecordings go to: ${out}\n`);
  if (only !== 'chatterbox') await piperVoices();
  if (only !== 'piper') await chatterboxVoice();
  fs.writeFileSync(path.join(out, 'report.txt'), `${report.join('\n')}\n`);
  console.log(`\nReport: ${path.join(out, 'report.txt')}`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
