'use strict';

// Which mind and which voice this PC can carry, and how to get them: the "profiles" of her set-up. From the
// picture of the PC (hardware.js) one is picked, by itself or as you ask, and it says what to fetch (a model
// for Ollama, a voice engine, a device), how much that is, and how to tune it so a small PC is not choked.
//
//   cloud     no local models fit (32-bit Windows, under 4 GB of memory, no room on the disk): her mind is a cloud
//             one you pick, her voice the lightest there is
//   light     a small PC: a 1B model, the Piper voice
//   standard  a usual PC: a 4B model (it sees the screen too), the Piper voice
//   strong    a PC with a good NVIDIA card (or an Apple chip with 16 GB+): the model fills what the card has left, and
//             the voice is Chatterbox on the card
//
// Nothing here touches the machine: it is a function from a picture to a plan, tested on a table of PCs.

const { GB } = require('./hardware');

const IDS = ['cloud', 'light', 'standard', 'strong'];

// What she talks with, small to big (gemma3 speaks many languages, and from 4B on it sees pictures)
const LADDER = [
  { model: 'gemma3:1b', bytes: 0.8 * GB, vision: false },
  { model: 'gemma3:4b', bytes: 3.3 * GB, vision: true },
  { model: 'gemma3:12b', bytes: 8.1 * GB, vision: true },
  { model: 'gemma3:27b', bytes: 17 * GB, vision: true },
];
const modelInfo = (name) => LADDER.find((m) => m.model === name) || { model: name, bytes: 4 * GB, vision: true };

// All the models she can talk with, with what is known of them (sizes as Ollama lists them; how well they speak
// Russian is a rough grade, from "ok" to "best"; the gemma3 ones from 4B on see pictures, so they can look at
// your screen). The ladder above is the gemma3 part of it, which she takes by herself.
const CATALOG = [
  { model: 'gemma3:1b', bytes: 0.8 * GB, vision: false, ru: 'ok' },
  { model: 'qwen2.5:3b', bytes: 1.9 * GB, vision: false, ru: 'ok' },
  { model: 'gemma3:4b', bytes: 3.3 * GB, vision: true, ru: 'good' },
  { model: 'qwen2.5:7b', bytes: 4.7 * GB, vision: false, ru: 'good' },
  { model: 'gemma3:12b', bytes: 8.1 * GB, vision: true, ru: 'great' },
  { model: 'qwen2.5:14b', bytes: 9.0 * GB, vision: false, ru: 'great' },
  { model: 'gemma3:27b', bytes: 17 * GB, vision: true, ru: 'best' },
  { model: 'qwen2.5:32b', bytes: 20 * GB, vision: false, ru: 'best' },
];
const RU_GRADE = { ok: 1, good: 2, great: 3, best: 4 };

// what is fetched for the pieces, and what the memory of the card must hold for them (rough, rounded up)
const SIZE = {
  ollama: 1.6 * GB, // its own program (the zip of its releases)
  piper: 0.03 * GB + 0.08 * GB, // the program and one voice
  chatterboxCpu: 6 * GB, // the Python environment with torch (the plain one) and the model
  chatterboxCuda: 10 * GB, // and torch with the card's libraries
  node: 0.04 * GB, // the portable Node.js (a zip of about 30 MB)
};
const VOICE_VRAM = 6.5 * GB; // Chatterbox on a card
const CHATTERBOX_MIN_VRAM = 8 * GB;
const APPLE_MIN_RAM = 15 * GB;

// where the piece of the voice can run: Piper has a program for 64-bit Windows, Linux and macOS
function piperWorks(hw) {
  return hw.os.is64 && ['win32', 'linux', 'darwin'].includes(hw.os.platform);
}

// 'cuda' (an NVIDIA card with room for the voice), 'mps' (an Apple chip with the memory), else 'cpu'
function chatterboxDevice(hw) {
  const g = hw.gpu;
  if (g && g.vendor === 'nvidia' && g.vram >= CHATTERBOX_MIN_VRAM && hw.os.is64 && hw.os.platform !== 'darwin') return 'cuda';
  if (g && g.unified && hw.os.platform === 'darwin' && hw.ram >= APPLE_MIN_RAM) return 'mps';
  return 'cpu';
}

// The model for this PC: the biggest that fits the card (what is left of it after the voice), or the memory (a
// usual processor is slow with anything over 4B, so that is where it stops); the better of the two.
function mindFor(hw, { voiceOnCard = false, floor = 0 } = {}) {
  const fits = (m, budget) => m.bytes * 1.12 + 0.5 * GB <= budget;
  const g = hw.gpu;
  const cardUsable = g && (g.vendor === 'nvidia' || g.unified) && g.vram >= 4 * GB;
  let pick = LADDER[0];
  if (cardUsable) {
    const budget = g.vram - (voiceOnCard ? VOICE_VRAM : 0.5 * GB) - 0.5 * GB;
    for (const m of LADDER) if (fits(m, budget)) pick = m;
  }
  const ramBudget = hw.ram * 0.45;
  for (const m of LADDER.slice(0, 2)) if (fits(m, ramBudget) && LADDER.indexOf(m) > LADDER.indexOf(pick)) pick = m;
  return LADDER[Math.max(LADDER.indexOf(pick), floor)];
}

// Whether a model of this many bytes runs well here: all of it on the card (what is left of it after the voice),
// or small enough for the processor (4B at most: anything bigger is slow there).
function runsWell(hw, bytes, { voiceOnCard = false } = {}) {
  const need = bytes * 1.12 + 0.5 * GB;
  const g = hw.gpu;
  if (g && (g.vendor === 'nvidia' || g.unified) && g.vram >= 4 * GB && need <= g.vram - (voiceOnCard ? VOICE_VRAM : 0.5 * GB) - 0.5 * GB) return true;
  return bytes <= LADDER[1].bytes && need <= hw.ram * 0.45;
}

// Which models to put on this PC, best first, and why: every model of the catalog with whether it runs well here,
// the best one for this PC (what she would take by herself), and an alternative of another family that is as good in
// Russian but does not see the screen, if one also fits. `voiceOnCard`: the voice shares the card.
function recommend(hw, { voiceOnCard = false } = {}) {
  const best = mindFor(hw, { voiceOnCard, floor: hw.ram >= 7 * GB ? 1 : 0 });
  const g = hw.gpu;
  const onCard = Boolean(g && (g.vendor === 'nvidia' || g.unified) && g.vram >= 4 * GB);
  const rows = CATALOG.map((m) => {
    const fits = runsWell(hw, m.bytes, { voiceOnCard });
    return { model: m.model, bytes: m.bytes, vision: m.vision, ru: m.ru, fits, rank: m.model === best.model ? 'best' : fits ? 'ok' : 'heavy' };
  });
  const bestRow = rows.find((r) => r.rank === 'best') || rows[0];
  const alt = rows.filter((r) => r.rank === 'ok' && r.model !== bestRow.model && !r.vision && RU_GRADE[r.ru] >= RU_GRADE[bestRow.ru] && r.bytes >= bestRow.bytes)
    .sort((a, b) => b.bytes - a.bytes)[0] || null;
  if (alt) alt.rank = 'alt';
  const why = (r) => [
    r.vision ? 'vision' : 'noVision',
    `ru-${r.ru}`,
    r.bytes <= 1 * GB ? 'small' : onCard && runsWell({ ...hw, ram: 0 }, r.bytes, { voiceOnCard }) ? (voiceOnCard ? 'fitsCardVoice' : 'fitsCard') : 'fitsRam',
  ];
  return { best: bestRow.model, alt: alt ? alt.model : null, rows, bestWhy: why(bestRow), altWhy: alt ? why(alt) : [] };
}

// The voice for this PC and how it will go: Chatterbox on a card that can carry it (fast) or an Apple chip (so-so),
// else Piper; Chatterbox on the processor is possible but slow (a little less on a strong one).
function recommendVoice(hw) {
  const device = chatterboxDevice(hw);
  if (device === 'cuda') return { engine: 'chatterbox', device, speed: 'fast', torch: 'cuda', alsoPiper: true };
  if (device === 'mps') return { engine: 'chatterbox', device, speed: 'ok', torch: 'mps', alsoPiper: true };
  const strong = hw.cpu.threads >= 12 && hw.ram >= 24 * GB;
  if (piperWorks(hw)) return { engine: 'piper', device: 'cpu', speed: 'fast', torch: '', alsoPiper: false, chatterbox: strong ? 'slow' : 'veryslow' };
  return { engine: 'system', device: '', speed: 'fast', torch: '', alsoPiper: false, chatterbox: 'none' };
}

// Her own settings for the profile, so a small PC is not choked: how much she remembers of the talk at once (the
// memory it takes grows with it; her persona alone is 1.5-2.5k tokens, so even the smallest holds a few messages beside
// it), the most that memory may grow to when a request needs more (tune.js), how long a model stays loaded, and what
// Ollama is started with
function tuningFor(id, hw) {
  const nvidia = hw.gpu?.vendor === 'nvidia';
  if (id === 'light') return { numCtx: 3072, maxCtx: 4096, keepAlive: '10m', ollamaEnv: { OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_NUM_PARALLEL: '1' } };
  if (id === 'strong') return { numCtx: 8192, maxCtx: 16384, keepAlive: '30m', ollamaEnv: { OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_NUM_PARALLEL: '1', ...(nvidia ? { OLLAMA_FLASH_ATTENTION: '1' } : {}) } };
  return { numCtx: 4096, maxCtx: 8192, keepAlive: '15m', ollamaEnv: { OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_NUM_PARALLEL: '1' } };
}

// what a set-up of this profile fetches, in pieces (`have` says which she has already)
function downloads({ mind, voice, device, have = {} }) {
  const items = [];
  if (mind.kind === 'ollama') {
    if (!have.ollama) items.push({ id: 'ollama', bytes: SIZE.ollama });
    if (!(have.models || []).some((m) => m === mind.model || m.startsWith(`${mind.model.split(':')[0]}:`))) items.push({ id: 'model', name: mind.model, bytes: modelInfo(mind.model).bytes });
  }
  if (voice === 'chatterbox' && !have.chatterbox) items.push({ id: 'chatterbox', bytes: device === 'cuda' ? SIZE.chatterboxCuda : SIZE.chatterboxCpu });
  if (voice === 'piper' && !have.piper) items.push({ id: 'piper', bytes: SIZE.piper });
  return { items, total: items.reduce((n, i) => n + i.bytes, 0), need: items.length ? items.reduce((n, i) => n + i.bytes, 0) * 1.1 + 1 * GB : 0 };
}

function build(id, hw, have, { forced = false, voiceOverride = '' } = {}) {
  const notes = [];
  const device = chatterboxDevice(hw);
  let mind = { kind: 'ollama', model: '', bytes: 0, vision: false };
  let voice = { engine: 'system', device: '' };
  if (id === 'cloud') {
    mind = { kind: 'cloud', model: '', bytes: 0, vision: false };
    voice = piperWorks(hw) && hw.ram >= 2 * GB ? { engine: 'piper', device: 'cpu' } : { engine: 'system', device: '' };
  } else if (id === 'light') {
    const m = LADDER[0];
    mind = { kind: 'ollama', model: m.model, bytes: m.bytes, vision: m.vision };
    voice = piperWorks(hw) ? { engine: 'piper', device: 'cpu' } : { engine: 'system', device: '' };
  } else if (id === 'standard') {
    const m = LADDER[1];
    mind = { kind: 'ollama', model: m.model, bytes: m.bytes, vision: m.vision };
    voice = piperWorks(hw) ? { engine: 'piper', device: 'cpu' } : { engine: 'system', device: '' };
  } else {
    // strong: Chatterbox, on the card if there is one that can carry it (else on the processor: slow, and said so)
    voice = { engine: 'chatterbox', device };
    const m = mindFor(hw, { voiceOnCard: device !== 'cpu', floor: 1 });
    mind = { kind: 'ollama', model: m.model, bytes: m.bytes, vision: m.vision };
    if (device === 'cpu') notes.push('slowVoice');
  }
  // the voice you put next to her (a Chatterbox folder), not the one the profile would give
  if (voiceOverride && voiceOverride !== voice.engine) {
    voice = { engine: voiceOverride, device: voiceOverride === 'chatterbox' ? device : voiceOverride === 'piper' ? 'cpu' : '' };
    notes.push('folderWins');
    if (voice.engine === 'chatterbox' && device === 'cpu') notes.push('slowVoice');
  }
  const tuning = tuningFor(id, hw);
  const download = downloads({ mind, voice: voice.engine, device: voice.device, have });
  const g = hw.gpu;
  if (mind.kind === 'ollama' && g && !g.integrated && g.vendor !== 'nvidia' && !g.unified) notes.push('cardMaybe'); // AMD, Intel Arc: Ollama may use it, may not
  if (mind.kind === 'ollama' && !mind.vision) notes.push('noEyes');
  if (id === 'cloud') notes.push(!hw.os.is64 ? 'os32' : hw.ram < 3.5 * GB ? 'ramLow' : 'diskLow');
  return { id, forced, mind, voice, tuning, download, notes, disk: { free: hw.disk.free, need: download.need, ok: hw.disk.free >= download.need } };
}

// The profile that fits: what the PC is able to carry, and never more than the disk has room for.
// Returns { id, wanted }: wanted differs from id when the disk made it a lighter one.
function classify(hw, have) {
  if (!hw.os.is64 || hw.ram < 3.5 * GB) return { id: 'cloud', wanted: 'cloud' };
  const wanted = chatterboxDevice(hw) !== 'cpu' && hw.ram >= 11 * GB ? 'strong' : hw.ram >= 7 * GB ? 'standard' : 'light';
  const order = ['strong', 'standard', 'light', 'cloud'];
  for (let i = order.indexOf(wanted); i < order.length; i++) {
    if (order[i] === 'cloud' || build(order[i], hw, have).disk.ok) return { id: order[i], wanted };
  }
  return { id: 'cloud', wanted };
}

// The plan for this PC. `choice`: 'auto' or one of IDS, what you picked. `have`: what is on the PC already
// ({ ollama, models, chatterbox, piper }), so that only what is missing counts. `voice`: an engine to use
// instead of the profile's (the folder of one that you put next to her).
function plan(hw, { choice = 'auto', have = {}, voice = '' } = {}) {
  const forced = IDS.includes(choice);
  const { id, wanted } = forced ? { id: choice, wanted: choice } : classify(hw, have);
  const result = build(id, hw, have, { forced, voiceOverride: voice });
  if (id !== wanted) result.notes.push('diskLighter');
  if (forced && !result.disk.ok) result.notes.push('diskShort');
  return { ...result, auto: !forced, wanted, choices: IDS };
}

// The pieces of a set-up, each with its size and whether it is there already (what you pick in her main menu:
// a mind, a model, a voice): [{ id, name?, bytes, have }]. The total to fetch is that of the ones that are not.
function components({ mind, model = '', voice, device = 'cpu', node = false, have = {} }) {
  const out = [];
  if (node) out.push({ id: 'node', bytes: SIZE.node, have: Boolean(have.node) });
  if (mind === 'ollama') {
    out.push({ id: 'ollama', bytes: SIZE.ollama, have: Boolean(have.ollama) });
    if (model) out.push({ id: 'model', name: model, bytes: modelInfo(model).bytes, have: (have.models || []).some((m) => m === model || m.startsWith(`${model}-`) || (!model.includes(':') && m === `${model}:latest`)) });
  }
  if (voice === 'chatterbox') out.push({ id: 'chatterbox', bytes: device === 'cuda' ? SIZE.chatterboxCuda : SIZE.chatterboxCpu, have: Boolean(have.chatterbox) });
  if (voice === 'piper') out.push({ id: 'piper', bytes: SIZE.piper, have: Boolean(have.piper) });
  const missing = out.filter((c) => !c.have);
  const total = missing.reduce((n, c) => n + c.bytes, 0);
  return { items: out, total, need: missing.length ? total * 1.1 + 1 * GB : 0 };
}

// The same plan with what it still has to fetch counted again, after the fetching (what was missing is there now)
function refresh(planned, have) {
  const download = downloads({ mind: planned.mind, voice: planned.voice.engine, device: planned.voice.device, have });
  return { ...planned, download, disk: { free: planned.disk.free, need: download.need, ok: planned.disk.free >= download.need } };
}

// the PC as plain facts for her window (sentences are in prepare-lines.js)
function describe(hw) {
  const g = hw.gpu;
  return {
    cpu: hw.cpu.name,
    threads: hw.cpu.threads,
    ram: hw.ram,
    gpu: g ? { name: g.name, vram: g.vram, vendor: g.vendor, integrated: g.integrated, unified: g.unified } : null,
    diskFree: Number.isFinite(hw.disk.free) ? hw.disk.free : 0,
    os: hw.os.platform,
    bits: hw.os.is64 ? 64 : 32,
  };
}

module.exports = { plan, refresh, components, runsWell, recommend, recommendVoice, CATALOG, classify, build, mindFor, tuningFor, chatterboxDevice, piperWorks, describe, downloads, modelInfo, IDS, LADDER, SIZE, VOICE_VRAM };
