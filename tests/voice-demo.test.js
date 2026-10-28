'use strict';

// scripts/voice-demo.js: the recordings of her voices as they sound on a PC, made by her own code, against stand-ins for the
// Piper program and the Chatterbox model (the real ones are not needed to see that the way through works).
//   node --test tests/voice-demo.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-demo-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const posix = process.platform !== 'win32';
const script = path.join(__dirname, '..', 'scripts', 'voice-demo.js');
const touch = (file, text = '') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const run = (args) => cp.spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 90000 });
const wavSeconds = (file) => { const b = fs.readFileSync(file); return b.readUInt32LE(40) / (b.readUInt32LE(24) * b.readUInt16LE(22) * (b.readUInt16LE(34) / 8)); };

function piperIn(data, voices) {
  const dir = path.join(data, 'piper');
  fs.mkdirSync(path.join(dir, 'espeak-ng-data'), { recursive: true });
  const exe = path.join(dir, 'piper');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'fake-piper.js'), exe);
  fs.chmodSync(exe, 0o755);
  for (const v of voices) {
    touch(path.join(dir, 'voices', `${v}.onnx`), 'MODEL');
    touch(path.join(dir, 'voices', `${v}.onnx.json`), '{}');
  }
}

test('every Russian and English Piper voice she has says a line; other languages are left alone; the report says what happened', { skip: !posix && 'the stand-in is a script' }, () => {
  const data = path.join(tmp, 'a');
  piperIn(data, ['ru_RU-irina-medium', 'en_US-amy-medium', 'de_DE-thorsten-medium']);
  const out = path.join(tmp, 'a-out');
  const r = run(['--data', data, '--out', out, '--only', 'piper']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(out).sort(), ['piper-en_US-amy-medium.wav', 'piper-ru_RU-irina-medium.wav', 'report.txt']);
  for (const f of ['piper-en_US-amy-medium.wav', 'piper-ru_RU-irina-medium.wav']) assert.ok(wavSeconds(path.join(out, f)) > 1, `${f} has sound`);
  const report = fs.readFileSync(path.join(out, 'report.txt'), 'utf8');
  assert.match(report, /--length_scale 0\.94/, 'the style she asks for is in the report');
  assert.match(report, /piper-ru_RU-irina-medium\.wav: [\d.]+ s of speech/);
  assert.doesNotMatch(report, /thorsten/);
});

test('without Piper, or without a voice, it says so instead of failing', { skip: !posix && 'the stand-in is a script' }, () => {
  const none = path.join(tmp, 'b');
  fs.mkdirSync(none, { recursive: true });
  let r = run(['--data', none, '--out', path.join(tmp, 'b-out'), '--only', 'piper']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Piper: the program is not found/);
  const bare = path.join(tmp, 'c');
  piperIn(bare, []);
  r = run(['--data', bare, '--out', path.join(tmp, 'c-out'), '--only', 'piper']);
  assert.match(r.stdout, /no Russian or English voice/);
});

const python = (() => {
  try {
    return cp.spawnSync('python3', ['-c', 'import numpy, venv; print(1)'], { encoding: 'utf8' }).status === 0 ? 'python3' : null;
  } catch {
    return null;
  }
})();

test('Chatterbox says the line in Russian and English with the model\'s own voice, and with the recording she was given', { skip: (!posix && 'the stand-in is a script') || (!python && 'no python3 with numpy here') }, () => {
  const data = path.join(tmp, 'd');
  const box = path.join(data, 'chatterbox');
  cp.execFileSync(python, ['-m', 'venv', '--without-pip', '--system-site-packages', path.join(box, 'venv')]);
  const site = fs.readdirSync(path.join(box, 'venv', 'lib')).map((d) => path.join(box, 'venv', 'lib', d, 'site-packages')).find((p) => fs.existsSync(p));
  touch(path.join(site, 'chatterbox', '__init__.py'));
  touch(path.join(site, 'chatterbox', 'mtl_tts.py'), `
import numpy as np
class _W:
    def __init__(self, a): self.a = a
    def squeeze(self): return self
    def detach(self): return self
    def cpu(self): return self
    def numpy(self): return self.a
class ChatterboxMultilingualTTS:
    sr = 24000
    @classmethod
    def from_pretrained(cls, device='cpu'): return cls()
    def generate(self, text, language_id='en', audio_prompt_path=None, exaggeration=0.5, cfg_weight=0.5, temperature=0.8):
        n = int(self.sr * 0.01 * max(5, len(text)))
        return _W((0.3 * np.sin(2 * np.pi * (330 if audio_prompt_path else 220) * np.arange(n) / self.sr)).astype('float32'))
`);
  const recording = path.join(tmp, 'mine.wav');
  const rate = 16000;
  const wav = Buffer.alloc(44 + rate * 2 * 6);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(rate * 2 * 6, 40);
  for (let i = 0; i < rate * 6; i++) wav.writeInt16LE(Math.round(Math.sin(i / 9) * 12000), 44 + i * 2);
  fs.writeFileSync(recording, wav);
  const out = path.join(tmp, 'd-out');
  const r = run(['--data', data, '--out', out, '--only', 'chatterbox', '--sample', recording]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(fs.readdirSync(out).sort(), ['chatterbox-en-capri-voice.wav', 'chatterbox-en-model-voice.wav', 'chatterbox-ru-capri-voice.wav', 'chatterbox-ru-model-voice.wav', 'report.txt']);
  for (const f of fs.readdirSync(out).filter((x) => x.endsWith('.wav'))) assert.ok(wavSeconds(path.join(out, f)) > 1, f);
  assert.ok(fs.existsSync(path.join(data, 'voices', 'capri.wav')), 'the recording was taken as her voice, in her own folder');
  assert.match(fs.readFileSync(path.join(out, 'report.txt'), 'utf8'), /is now her voice/);
});
