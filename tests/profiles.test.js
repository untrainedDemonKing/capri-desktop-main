'use strict';

// Which mind and voice each kind of PC gets (src/main/profiles.js): a table of machines, from a 32-bit Windows
// to a 32 GB graphics card, and what the plan for each is.
//   node --test tests/profiles.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const hw = require('../src/main/hardware.js');
const profiles = require('../src/main/profiles.js');

const GB = 1024 ** 3;
const pc = (o = {}) => hw.make({ disk: { path: '', free: 300 * GB, total: 500 * GB }, ...o });
const nvidia = (name, vram, extra = {}) => ({ name: `NVIDIA GeForce ${name}`, vram: vram * GB, ...extra });

// [what it is, the PC, profile, model, voice engine/device]
const TABLE = [
  ['a 32-bit Windows', { arch: 'ia32', env: { PROCESSOR_ARCHITECTURE: 'x86' }, ram: 3 * GB }, 'cloud', '', 'system/'],
  ['a 64-bit PC with 3 GB', { ram: 3 * GB }, 'cloud', '', 'piper/cpu'],
  ['an office PC, 4 GB, processor graphics', { ram: 3.9 * GB, gpus: [{ name: 'Intel(R) UHD Graphics 620', vram: 128 * 1048576 }] }, 'light', 'gemma3:1b', 'piper/cpu'],
  ['a laptop with 8 GB', { ram: 7.8 * GB, gpus: [{ name: 'Intel(R) UHD Graphics', vram: 1 * GB }] }, 'standard', 'gemma3:4b', 'piper/cpu'],
  ['a Ryzen with 16 GB and no card', { ram: 15.9 * GB, gpus: [{ name: 'AMD Radeon(TM) Graphics', vram: 2 * GB }] }, 'standard', 'gemma3:4b', 'piper/cpu'],
  ['a GTX 1650 (4 GB): too small for the voice', { ram: 15.9 * GB, gpus: [nvidia('GTX 1650', 4)] }, 'standard', 'gemma3:4b', 'piper/cpu'],
  ['a GTX 1660 (6 GB): the mind on the card, the voice on the processor', { ram: 15.9 * GB, gpus: [nvidia('GTX 1660', 6)] }, 'standard', 'gemma3:4b', 'piper/cpu'],
  ['an RTX 3060 (12 GB)', { ram: 15.9 * GB, gpus: [nvidia('RTX 3060', 12)] }, 'strong', 'gemma3:4b', 'chatterbox/cuda'],
  ['an RTX 4070 (12 GB) with only 8 GB of memory: too little for the voice\'s Python', { ram: 7.8 * GB, gpus: [nvidia('RTX 4070', 12)] }, 'standard', 'gemma3:4b', 'piper/cpu'],
  ['an RTX 4080 (16 GB)', { ram: 31 * GB, gpus: [nvidia('RTX 4080', 16)] }, 'strong', 'gemma3:4b', 'chatterbox/cuda'],
  ['an RTX 4090 (24 GB)', { ram: 63 * GB, gpus: [nvidia('RTX 4090', 24)] }, 'strong', 'gemma3:12b', 'chatterbox/cuda'],
  ['an RTX 5090 (32 GB)', { ram: 63 * GB, gpus: [nvidia('RTX 5090', 32, { compute: 12 })] }, 'strong', 'gemma3:27b', 'chatterbox/cuda'],
  ['a Radeon RX 7800 XT (16 GB): Ollama may use it, Chatterbox cannot', { ram: 31 * GB, gpus: [{ name: 'AMD Radeon RX 7800 XT', vram: 16 * GB }] }, 'standard', 'gemma3:4b', 'piper/cpu'],
  ['a MacBook with an M2 and 16 GB', { platform: 'darwin', arch: 'arm64', ram: 16 * GB, gpus: [{ name: 'Apple M2', vram: 16 * GB * 0.66, unified: true }] }, 'strong', 'gemma3:4b', 'chatterbox/mps'],
  ['a MacBook with an M1 and 8 GB', { platform: 'darwin', arch: 'arm64', ram: 8 * GB, gpus: [{ name: 'Apple M1', vram: 8 * GB * 0.66, unified: true }] }, 'standard', 'gemma3:4b', 'piper/cpu'],
  ['a Linux box with 2 GB', { platform: 'linux', ram: 2 * GB }, 'cloud', '', 'piper/cpu'],
];

for (const [what, o, id, model, voice] of TABLE) {
  test(`the plan for ${what}`, () => {
    const p = profiles.plan(pc(o));
    assert.equal(p.id, id, `${what}: profile`);
    assert.equal(p.mind.model, model, `${what}: model`);
    assert.equal(`${p.voice.engine}/${p.voice.device}`, voice, `${what}: voice`);
    assert.equal(p.mind.kind, id === 'cloud' ? 'cloud' : 'ollama');
    assert.equal(p.auto, true);
  });
}

test('what each plan fetches: the mind\'s program and model, the voice\'s pieces, and a total that grows with the card', () => {
  const small = profiles.plan(pc({ ram: 7.8 * GB }));
  assert.deepEqual(small.download.items.map((i) => i.id), ['ollama', 'model', 'piper']);
  const mid = profiles.plan(pc({ ram: 15.9 * GB, gpus: [nvidia('RTX 3060', 12)] }));
  assert.deepEqual(mid.download.items.map((i) => i.id), ['ollama', 'model', 'chatterbox']);
  assert.equal(mid.download.items.find((i) => i.id === 'chatterbox').bytes, profiles.SIZE.chatterboxCuda, 'torch with the card\'s libraries');
  const cpuOnly = profiles.plan(pc({ ram: 15.9 * GB }), { choice: 'strong' });
  assert.equal(cpuOnly.download.items.find((i) => i.id === 'chatterbox').bytes, profiles.SIZE.chatterboxCpu, 'the plain torch is much smaller');
  assert.ok(mid.download.total > small.download.total);
  const have = profiles.plan(pc({ ram: 7.8 * GB }), { have: { ollama: true, models: ['gemma3:4b'], piper: true } });
  assert.deepEqual(have.download.items, [], 'what she has is not fetched again');
  assert.equal(have.download.need, 0);
  const family = profiles.plan(pc({ ram: 7.8 * GB }), { have: { ollama: true, models: ['gemma3:4b-it-q4_K_M'], piper: true } });
  assert.deepEqual(family.download.items, [], 'a model of the same family counts');
});

test('the disk: a plan that does not fit is made lighter, down to the cloud, and says so', () => {
  const gpu = { ram: 15.9 * GB, gpus: [nvidia('RTX 3060', 12)] };
  const roomy = profiles.plan(pc(gpu));
  assert.equal(roomy.id, 'strong');
  assert.ok(roomy.disk.ok);
  const tight = profiles.plan(pc({ ...gpu, disk: { path: '', free: 8 * GB, total: 100 * GB } }));
  assert.equal(tight.id, 'standard', '8 GB are not enough for torch with the card\'s libraries, but are for the small model and Piper');
  assert.ok(tight.notes.includes('diskLighter'));
  const none = profiles.plan(pc({ ...gpu, disk: { path: '', free: 1.5 * GB, total: 100 * GB } }));
  assert.equal(none.id, 'cloud');
  assert.ok(none.notes.includes('diskLow'));
  assert.equal(none.voice.engine, 'piper', 'and the lightest voice is still there');
  const unknown = profiles.plan(pc({ ...gpu, disk: { path: '', free: Infinity, total: 0 } }));
  assert.equal(unknown.id, 'strong', 'a disk she cannot measure is not "full"');
});

test('a profile that is asked for is given, even above what the PC carries, and she says so', () => {
  const weak = pc({ ram: 15.9 * GB });
  const strong = profiles.plan(weak, { choice: 'strong' });
  assert.equal(strong.id, 'strong');
  assert.equal(strong.auto, false);
  assert.equal(strong.voice.engine, 'chatterbox');
  assert.equal(strong.voice.device, 'cpu');
  assert.ok(strong.notes.includes('slowVoice'), 'Chatterbox on the processor is slow');
  const light = profiles.plan(pc({ ram: 15.9 * GB, gpus: [nvidia('RTX 4090', 24)] }), { choice: 'light' });
  assert.equal(light.id, 'light');
  assert.equal(light.mind.model, 'gemma3:1b');
  assert.equal(light.voice.engine, 'piper');
  assert.ok(light.notes.includes('noEyes'), 'a 1B model cannot see the screen');
  const cloud = profiles.plan(pc({ ram: 15.9 * GB }), { choice: 'cloud' });
  assert.equal(cloud.mind.kind, 'cloud');
  const short = profiles.plan(pc({ ram: 15.9 * GB, gpus: [nvidia('RTX 3060', 12)], disk: { path: '', free: 3 * GB, total: 100 * GB } }), { choice: 'strong' });
  assert.equal(short.id, 'strong', 'asked for, so given');
  assert.ok(short.notes.includes('diskShort'));
  assert.equal(profiles.plan(weak, { choice: 'nonsense' }).auto, true, 'something that is no profile is "auto"');
});

test('on a Windows that is 32-bit nothing local is offered, and she says why', () => {
  const p = profiles.plan(pc({ arch: 'ia32', env: { PROCESSOR_ARCHITECTURE: 'x86' }, ram: 8 * GB }));
  assert.equal(p.id, 'cloud');
  assert.ok(p.notes.includes('os32'));
  assert.equal(p.voice.engine, 'system');
  const wow = profiles.plan(pc({ arch: 'ia32', env: { PROCESSOR_ARCHITECTURE: 'x86', PROCESSOR_ARCHITEW6432: 'AMD64' }, ram: 8 * GB }));
  assert.equal(wow.id, 'standard', 'her 32-bit build on a 64-bit Windows can start 64-bit programs');
});

test('the model fills what the card has left after the voice; the processor stops at 4B', () => {
  const m = (o, voice) => profiles.mindFor(pc(o), { voiceOnCard: voice }).model;
  assert.equal(m({ ram: 15.9 * GB, gpus: [nvidia('RTX 3060', 12)] }, true), 'gemma3:4b');
  assert.equal(m({ ram: 31 * GB, gpus: [nvidia('RTX 3090', 24)] }, true), 'gemma3:12b');
  assert.equal(m({ ram: 31 * GB, gpus: [nvidia('RTX 3090', 24)] }, false), 'gemma3:27b', 'no voice on the card: all of it is the model\'s');
  assert.equal(m({ ram: 128 * GB }, false), 'gemma3:4b', 'a lot of memory and no card: still 4B (anything bigger is slow on a processor)');
  assert.equal(m({ ram: 4 * GB }, false), 'gemma3:1b');
});

test('tuning: a small PC remembers less of the talk and lets a model go sooner; Ollama is told to keep to one model', () => {
  const light = profiles.tuningFor('light', pc({ ram: 4 * GB }));
  const strong = profiles.tuningFor('strong', pc({ ram: 32 * GB, gpus: [nvidia('RTX 4090', 24)] }));
  assert.ok(light.numCtx < strong.numCtx);
  assert.equal(light.ollamaEnv.OLLAMA_MAX_LOADED_MODELS, '1');
  assert.equal(strong.ollamaEnv.OLLAMA_FLASH_ATTENTION, '1');
  assert.equal(profiles.tuningFor('strong', pc({ ram: 32 * GB })).ollamaEnv.OLLAMA_FLASH_ATTENTION, undefined, 'only on an NVIDIA card');
  assert.equal(profiles.tuningFor('standard', pc()).numCtx, 4096);
});

test('describe: the PC in plain facts for her window', () => {
  const d = profiles.describe(pc({ ram: 16 * GB, cpu: { name: 'Intel i5', threads: 12 }, gpus: [nvidia('RTX 3060', 12)] }));
  assert.equal(d.cpu, 'Intel i5');
  assert.equal(d.threads, 12);
  assert.deepEqual([d.gpu.name, d.gpu.vram], ['NVIDIA GeForce RTX 3060', 12 * GB]);
  assert.deepEqual([d.os, d.bits], ['win32', 64]);
  assert.equal(profiles.describe(pc()).gpu, null);
});

test('after the fetching the plan counts again: what is there is not "to fetch" any more', () => {
  const planned = profiles.plan(pc({ ram: 15.9 * GB }));
  assert.ok(planned.download.total > 4 * GB);
  const after = profiles.refresh(planned, { ollama: true, models: ['gemma3:4b'], piper: true });
  assert.equal(after.download.total, 0);
  assert.equal(after.disk.ok, true);
  assert.equal(after.id, planned.id, 'the rest of the plan is the same');
  assert.equal(profiles.refresh(planned, { ollama: true, models: [], piper: true }).download.items[0].id, 'model', 'a model still missing is still counted');
});

test('the choices she offers are the four profiles', () => {
  assert.deepEqual(profiles.IDS, ['cloud', 'light', 'standard', 'strong']);
  assert.deepEqual(profiles.plan(pc()).choices, profiles.IDS);
});
