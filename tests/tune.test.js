'use strict';

// How her mind is asked, task by task, and fitted to the PC (src/main/tune.js, ollama.js), against a stand-in
// Ollama (tests/fixtures/fake-ollama.js).
//   node --test tests/tune.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const cp = require('node:child_process');
const { pathToFileURL } = require('node:url');

const tune = require('../src/main/tune.js');
const profiles = require('../src/main/profiles.js');
const ollama = require('../src/main/ollama.js');

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });

test('the size of a model is read from its name', () => {
  const table = [
    ['gemma3:1b', 1, 'tiny'], ['gemma3:4b', 4, 'small'], ['gemma3:12b', 12, 'mid'], ['gemma3:27b', 27, 'big'],
    ['qwen2.5:0.5b', 0.5, 'tiny'], ['qwen2.5:7b-instruct-q4_K_M', 7, 'mid'], ['phi3:3.8b', 3.8, 'small'],
    ['gemma3n:e2b', 2, 'tiny'], ['smollm2:135m', 0.135, 'tiny'], ['deepseek-r1:1.5b', 1.5, 'tiny'],
    ['llama3.2', null, 'mid'], ['llama3.2:latest', null, 'mid'], ['qwen2.5vl:latest', null, 'mid'], ['', null, 'mid'],
  ];
  for (const [name, b, cls] of table) {
    assert.equal(tune.billions(name), b, name);
    assert.equal(tune.sizeClass(name), cls, name);
  }
});

test('each task is asked for in its own way: chat lively, notes strict, a look at the screen factual', () => {
  const chat = tune.ask('chat', { model: 'gemma3:4b', lang: 'en' });
  assert.deepEqual(chat, { options: { temperature: 0.8, num_predict: 240, repeat_penalty: 1.06 }, format: '' });
  // a small model keeps its head: cooler and told not to repeat itself; a big one is left alone
  const tiny = tune.ask('chat', { model: 'gemma3:1b' }).options;
  const big = tune.ask('chat', { model: 'gemma3:27b' }).options;
  assert.ok(tiny.temperature < chat.options.temperature && chat.options.temperature < big.temperature);
  assert.ok(tiny.repeat_penalty > chat.options.repeat_penalty);
  assert.equal(big.repeat_penalty, undefined);
  // Russian takes about twice the tokens: the same three sentences need more room
  assert.ok(tune.ask('chat', { model: 'gemma3:4b', lang: 'ru' }).options.num_predict > chat.options.num_predict);
  // her notebook about you: the same JSON every time, the whole list of it (a chat's 240 tokens would cut it off)
  const note = tune.ask('note', { model: 'gemma3:4b', lang: 'ru' });
  assert.equal(note.format, 'json');
  assert.ok(note.options.temperature <= 0.2 && note.options.num_predict >= 700);
  assert.deepEqual(tune.ask('look', { model: 'gemma3:4b' }), { options: { temperature: 0.3, num_predict: 300 }, format: '' });
  // a slow PC: shorter answers, never longer than asked
  assert.equal(tune.ask('chat', { model: 'gemma3:4b', lang: 'ru', answerCap: 200 }).options.num_predict, 200);
  assert.equal(tune.ask('chat', { model: 'gemma3:4b', lang: 'en', answerCap: 300 }).options.num_predict, 240);
});

test('a request is measured in tokens, and the memory grows to hold it, one step at a time and never past the ceiling', () => {
  const latin = tune.estimateTokens([{ role: 'user', content: 'a'.repeat(3600) }]);
  const cyrillic = tune.estimateTokens([{ role: 'user', content: 'я'.repeat(3600) }]);
  assert.ok(latin >= 1000 && latin < 1100, `${latin}`);
  assert.ok(cyrillic > latin * 1.6, 'Russian costs about twice what English does');
  assert.ok(tune.estimateTokens([{ role: 'user', content: 'x', images: ['...'] }]) >= 300, 'a picture takes room too');
  assert.equal(tune.estimateTokens([]), 0);

  assert.equal(tune.grow(0, 5000, 8192), 0, 'no memory set: Ollama\'s own, left alone');
  assert.equal(tune.grow(3072, 2000, 4096), 3072, 'it fits: the same one (another would load the model again)');
  assert.equal(tune.grow(3072, 3500, 8192), 4096, 'it does not: the next step that holds it');
  assert.equal(tune.grow(3072, 7000, 8192), 8192);
  assert.equal(tune.grow(3072, 20000, 4096), 4096, 'never past the profile\'s ceiling');
  assert.equal(tune.grow(4096, 9000, 0), 4096, 'no ceiling given: it stays');
});

test('her persona fits the memory of every profile with room left for the talk (the old 2048 left none)', async () => {
  const { Chat } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', 'chat.js')).href);
  const build = (lang, full) => {
    const chat = Object.create(Chat.prototype);
    chat.brain = { assistant: 'claude', lang, watching: true, context: () => 'Running tests in the project. Edited 3 files.', custom: full ? { userName: 'Кирилл', persona: 'x'.repeat(200), memories: ['любит синтвейв', 'работает ночью'] } : {} };
    chat.apps = full ? Array.from({ length: 12 }, (_, i) => ({ name: `App${i}`, label: `Window title ${i}` })) : [];
    chat.hands = { powers: () => (full ? [`Her hands: ${'x'.repeat(500)}`] : []) };
    chat.eyes = { enabled: full, context: () => (full ? 'You last looked at the screen: a code editor with a terminal. ' : '') };
    chat.heart = { describe: () => `Right now you feel calm; ${full ? 'x'.repeat(250) : ''}` };
    chat.life = { context: () => (full ? `Lately you hacked ICE, played arcade. ${'x'.repeat(150)}` : '') };
    chat.bond = { context: () => (full ? [`You know the user well: ${'x'.repeat(500)}`] : []) };
    chat.agent = false;
    return [{ role: 'system', content: chat.persona('hello') }, { role: 'user', content: 'привет' }];
  };
  const hw = { gpu: null };
  for (const id of ['light', 'standard', 'strong']) {
    const t = profiles.tuningFor(id, hw);
    for (const lang of ['en', 'ru']) {
      const answer = tune.ask('chat', { model: 'gemma3:4b', lang }).options.num_predict;
      const bare = tune.needed(build(lang, false), answer);
      const full = tune.needed(build(lang, true), answer);
      assert.ok(t.numCtx - bare >= 1000, `${id}/${lang}: ${t.numCtx - bare} tokens left for the talk on a bare persona`);
      assert.ok(t.numCtx >= full, `${id}/${lang}: the whole persona (${full}) fits ${t.numCtx}`);
    }
  }
  // (what the smallest profile had before: nothing left for the talk beside her persona and a Russian answer)
  assert.ok(2048 - tune.needed(build('ru', true), 320) < 0);
});

test('a short run says how fast the model is and whether it sits on the card', () => {
  const run = (tps, extra = {}) => tune.judge({ evalCount: 48, evalNs: (48 / tps) * 1e9, size: 4e9, vram: 4e9, ...extra });
  assert.deepEqual(run(40), { tps: 40, speed: 'fast', onCard: 1 });
  assert.equal(run(12).speed, 'ok');
  assert.equal(run(3).speed, 'slow');
  assert.equal(run(25).speed, 'fast');
  assert.equal(run(24.9).speed, 'ok');
  assert.equal(run(5.9).speed, 'slow');
  assert.equal(run(30, { vram: 1e9 }).onCard, 0.25, 'a quarter of it is on the card');
  assert.equal(run(30, { vram: 0 }).onCard, 0, 'none: the processor does it all');
  assert.equal(run(30, { size: 0 }).onCard, null, 'an Ollama that does not say');
  assert.equal(run(30, { vram: NaN }).onCard, null);
  // too few words to tell, or nothing at all
  assert.equal(tune.judge({ evalCount: 3, evalNs: 1e9 }), null);
  assert.equal(tune.judge({ evalCount: 48, evalNs: 0 }), null);
  assert.equal(tune.judge(null), null);
});

test('a measurement holds for the same model on the same kind of PC, for a month', () => {
  const now = Date.now();
  const saved = { model: 'gemma3:4b', profile: 'standard', at: now - 86400000, speed: 'ok' };
  assert.equal(tune.stillGood(saved, { model: 'gemma3:4b', profile: 'standard', now }), true);
  assert.equal(tune.stillGood(saved, { model: 'gemma3:12b', profile: 'standard', now }), false, 'another model');
  assert.equal(tune.stillGood(saved, { model: 'gemma3:4b', profile: 'strong', now }), false, 'another kind of PC');
  assert.equal(tune.stillGood(saved, { model: 'gemma3:4b', profile: 'standard', now: now + 31 * 86400000 }), false, 'too old');
  assert.equal(tune.stillGood(null, { model: 'gemma3:4b', profile: 'standard' }), false);
  assert.equal(tune.stillGood({ model: 'gemma3:4b', profile: 'standard' }, { model: 'gemma3:4b', profile: 'standard' }), false, 'a record with no time on it');
});

test('what the measurement changes in the profile\'s numbers: a slow PC gets shorter answers and a longer stay in memory', () => {
  const base = { numCtx: 4096, maxCtx: 8192, keepAlive: '15m' };
  assert.deepEqual(tune.settle(base, null), { numCtx: 4096, maxCtx: 8192, keepAlive: '15m', speed: '', onCard: null, answerCap: 0 });
  assert.deepEqual(tune.settle(base, { speed: 'fast', onCard: 1 }), { numCtx: 4096, maxCtx: 8192, keepAlive: '15m', speed: 'fast', onCard: 1, answerCap: 0 });
  const slow = tune.settle(base, { speed: 'slow', onCard: 0 });
  assert.equal(slow.answerCap, 200);
  assert.equal(slow.keepAlive, '60m');
  assert.equal(slow.maxCtx, 6144, 'one step more at most: a longer prompt is slower to read, too');
  assert.equal(slow.numCtx, 4096, 'the memory in use is not changed by a measurement (that would load the model again)');
  assert.deepEqual(tune.settle({}, { speed: 'slow' }).numCtx, 0);
  // the numbers are the profile's, and a profile always leaves room to grow
  for (const id of ['light', 'standard', 'strong']) {
    const t = profiles.tuningFor(id, { gpu: null });
    assert.ok(tune.settle(t, { speed: 'slow' }).maxCtx > t.numCtx);
  }
});

// ---- against a stand-in Ollama ----

const posix = process.platform !== 'win32';
const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function fakeServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-tune-'));
  const models = path.join(dir, 'models');
  const lib = path.join(models, 'manifests', 'registry.ollama.ai', 'library', 'gemma3');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, '4b'), '{}');
  const port = await freePort();
  const log = path.join(dir, 'log.jsonl');
  const child = cp.spawn(process.execPath, [path.join(__dirname, 'fixtures', 'fake-ollama.js'), 'serve'], {
    env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${port}`, OLLAMA_MODELS: models, FAKE_OLLAMA_LOG: log, ...env },
    stdio: 'ignore',
  });
  process.env.OLLAMA_HOST = `127.0.0.1:${port}`;
  for (let i = 0; i < 100 && !(await ollama.version()); i++) await new Promise((r) => setTimeout(r, 50));
  const lines = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { lines, stop: () => { child.kill(); delete process.env.OLLAMA_HOST; ollama.tune({}); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('she asks Ollama in the way the task wants: chat lively, notes as JSON with room for all of it, the look factual', { skip: !posix && 'the stand-in is a node script, but needs a free port' }, async () => {
  const server = await fakeServer();
  try {
    ollama.tune({ numCtx: 3072, maxCtx: 4096, keepAlive: '10m', answerCap: 0 });
    const ask = [{ role: 'system', content: 'You are Capri.' }, { role: 'user', content: 'привет' }];
    await ollama.chat({ model: 'gemma3:4b', messages: ask, lang: 'ru' }, () => {});
    await ollama.chat({ model: 'gemma3:4b', messages: ask, task: 'note', lang: 'ru' }, () => {});
    await ollama.once({ model: 'gemma3:4b', messages: [{ role: 'user', content: 'what is on the screen', images: ['AAAA'] }] });
    const [chat, note, look] = server.lines().filter((l) => l.url === '/api/chat');
    assert.deepEqual(chat.options, { temperature: 0.8, num_predict: 320, repeat_penalty: 1.06, num_ctx: 3072 });
    assert.equal(chat.format, undefined, 'her talk is free text');
    assert.deepEqual(note.options, { temperature: 0.2, num_predict: 768, num_ctx: 3072 });
    assert.equal(note.format, 'json');
    assert.deepEqual(look.options, { temperature: 0.3, num_predict: 300, num_ctx: 3072 });
    assert.deepEqual([chat, note, look].map((l) => l.keepAlive), ['10m', '10m', '10m']);
  } finally {
    server.stop();
  }
});

test('a request that does not fit the memory makes it grow once, to the step that holds it, and then it stays', { skip: !posix && 'needs the stand-in' }, async () => {
  const server = await fakeServer();
  try {
    ollama.tune({ numCtx: 2048, maxCtx: 4096, keepAlive: '15m' });
    const long = [{ role: 'system', content: 'Я Капри. '.repeat(800) }, { role: 'user', content: 'привет' }]; // ~3000 tokens in Russian
    await ollama.chat({ model: 'gemma3:4b', messages: long, lang: 'ru' }, () => {});
    await ollama.chat({ model: 'gemma3:4b', messages: [{ role: 'user', content: 'и ещё' }], lang: 'ru' }, () => {});
    await ollama.chat({ model: 'gemma3:4b', messages: [{ role: 'user', content: 'и ещё' }], lang: 'ru' }, () => {});
    ollama.warm('gemma3:4b');
    await new Promise((r) => setTimeout(r, 200));
    const lines = server.lines();
    const sizes = lines.filter((l) => l.url === '/api/chat' || l.url === '/api/generate').map((l) => l.options.num_ctx);
    assert.deepEqual(sizes, [4096, 4096, 4096, 4096], 'one step up for the long request, then the same every time (another size loads the model again)');
    assert.equal(ollama.current().numCtx, 4096);
    // she is told the profile's numbers again at every look at the models: what the memory grew to stays (starting over
    // would load the model again each time), and a measurement that only shortens the ceiling does not shrink it
    ollama.tune({ numCtx: 2048, maxCtx: 4096, keepAlive: '15m' });
    assert.equal(ollama.current().numCtx, 4096, 'the same profile again');
    ollama.tune({ numCtx: 2048, maxCtx: 4096, keepAlive: '60m', answerCap: 200 });
    assert.deepEqual([ollama.current().numCtx, ollama.current().keepAlive, ollama.current().answerCap], [4096, '60m', 200], 'with what the measurement changed');
    ollama.tune({ numCtx: 3072, maxCtx: 4096 });
    assert.equal(ollama.current().numCtx, 3072, 'another profile starts from its own');
    ollama.tune({});
    assert.equal(ollama.current().numCtx, 0, 'no profile: Ollama\'s own');
    ollama.tune({ numCtx: 2048, maxCtx: 4096 });
    // and not past the ceiling, however long
    const huge = [{ role: 'user', content: 'я'.repeat(60000) }];
    await ollama.chat({ model: 'gemma3:4b', messages: huge, lang: 'ru' }, () => {});
    assert.equal(ollama.current().numCtx, 4096);
  } finally {
    server.stop();
  }
});

test('measuring the model: its speed and how much of it is on the card, read from Ollama\'s own counters', { skip: !posix && 'needs the stand-in' }, async () => {
  const server = await fakeServer({ FAKE_OLLAMA_TPS: '18', FAKE_OLLAMA_ONCARD: '0.6' });
  try {
    ollama.tune({ numCtx: 4096, maxCtx: 8192, keepAlive: '15m' });
    const sample = await ollama.measure('gemma3:4b');
    assert.deepEqual(tune.judge(sample), { tps: 18, speed: 'ok', onCard: 0.6 });
    const run = server.lines().find((l) => l.url === '/api/chat');
    assert.equal(run.options.num_predict, 48, 'a short run');
    assert.equal(run.options.temperature, 0);
    assert.equal(run.options.num_ctx, 4096, 'with the memory she really asks with: the model is not loaded twice');
    await assert.rejects(() => ollama.measure('nothing:here'), /not found/);
  } finally {
    server.stop();
  }
});

test('an Ollama with no /api/ps still gives the speed', { skip: !posix && 'needs the stand-in' }, async () => {
  const server = await fakeServer({ FAKE_OLLAMA_NO_PS: '1', FAKE_OLLAMA_TPS: '4' });
  try {
    const verdict = tune.judge(await ollama.measure('gemma3:4b'));
    assert.equal(verdict.speed, 'slow');
    assert.equal(verdict.onCard, null);
  } finally {
    server.stop();
  }
});
