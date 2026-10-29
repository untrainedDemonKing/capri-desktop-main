'use strict';

// What Capri herself left on this PC and the state of what she fetched, for the failures that show up only when she is started for real
// ("Chatterbox did not start: timeout"): the two files she keeps in her data folder (the words of the voice server, what her preparation
// said), what is in the model hub's cache of the voice (how much, whether a file is half-fetched), and a look through the Python of her
// voice at the torch in it and the card (whether the build has the kernels for this card). Nothing is read of her settings, her keys or
// her memory; nothing is changed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exec, WIN } = require('./proc');

const GB = 1024 ** 3;
const MODEL_BYTES = 3.2e9; // the voice model, about (chatterbox.js)
const CACHE_NAMES = ['hf_home', 'hf-home', 'huggingface', 'hf_cache', 'hf-cache'];

const exists = (p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

// where her data folder may be (the name of her program, and of the sources run with Electron)
function dataFolders(env = process.env, platform = process.platform, home = os.homedir()) {
  const base = platform === 'win32' ? env.APPDATA : platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : env.XDG_CONFIG_HOME || path.join(home, '.config');
  return base ? ['Capri', 'capri-desktop'].map((n) => path.join(base, n)).filter(exists) : [];
}

// the folders she was told to keep what she fetches in ("Capri", marked by capri-folder.json): at the root of each drive, in the usual
// places of the user, and her data folders
function capriFolders(env = process.env, platform = process.platform, home = os.homedir()) {
  const roots = [];
  if (platform === 'win32') for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') roots.push(`${letter}:\\`);
  for (const sub of ['', 'Documents', 'Desktop', 'Downloads']) roots.push(path.join(home, sub));
  const found = [];
  for (const root of roots) {
    for (const name of ['Capri', 'capri']) {
      const dir = path.join(root, name);
      if (exists(path.join(dir, 'capri-folder.json')) || exists(path.join(dir, 'chatterbox'))) found.push(dir);
    }
  }
  for (const d of dataFolders(env, platform, home)) if (exists(path.join(d, 'chatterbox')) || exists(path.join(d, 'capri-folder.json'))) found.push(d);
  return [...new Set(found)];
}

// the size of a folder (files counted up to a limit: a Python environment has tens of thousands)
function sizeOf(dir, limit = 400000) {
  let bytes = 0;
  let files = 0;
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files > limit) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        files++;
        try {
          bytes += fs.statSync(full).size;
        } catch {
          // gone meanwhile
        }
      }
    }
  };
  walk(dir);
  return { bytes, files, cut: files > limit };
}

// the model hub's cache of the voice: how much of it is there, and which files are not whole
function voiceCache(dir, env = process.env, home = os.homedir()) {
  const hubs = [];
  for (const name of CACHE_NAMES) if (exists(path.join(dir, name))) hubs.push(path.join(dir, name, 'hub'));
  if (env.HUGGINGFACE_HUB_CACHE) hubs.push(env.HUGGINGFACE_HUB_CACHE);
  hubs.push(path.join(env.HF_HOME || path.join(home, '.cache', 'huggingface'), 'hub'));
  const out = [];
  for (const hub of [...new Set(hubs)]) {
    let entries = [];
    try {
      entries = fs.readdirSync(hub);
    } catch {
      continue;
    }
    for (const entry of entries.filter((e) => /^models--.*chatterbox/i.test(e))) {
      const blobs = path.join(hub, entry, 'blobs');
      let bytes = 0;
      const partial = [];
      try {
        for (const name of fs.readdirSync(blobs)) {
          const st = fs.statSync(path.join(blobs, name));
          bytes += st.size;
          if (name.endsWith('.incomplete')) partial.push({ size: st.size, ageMin: Math.round((Date.now() - st.mtimeMs) / 60000) });
        }
      } catch {
        // no blobs yet
      }
      out.push({ hub, model: entry, bytes, partial });
    }
  }
  return out;
}

// the Python of her voice, asked about the torch in it and the card
const TORCH_PROBE = `
import json, sys
out = {'python': sys.version.split()[0]}
try:
    import torch
    out['torch'] = torch.__version__
    out['cuda_build'] = torch.version.cuda
    out['cuda_available'] = bool(torch.cuda.is_available())
    if out['cuda_available']:
        out['device'] = torch.cuda.get_device_name(0)
        out['capability'] = list(torch.cuda.get_device_capability(0))
        out['arch_list'] = torch.cuda.get_arch_list()
        out['kernel_ok'] = float((torch.ones(8, device='cuda') * 2).sum().item()) == 16.0
except Exception as e:
    out['torch_error'] = repr(e)[:300]
try:
    import torchaudio
    out['torchaudio'] = torchaudio.__version__
except Exception as e:
    out['torchaudio_error'] = repr(e)[:200]
try:
    import importlib.util as u
    out['chatterbox_package'] = u.find_spec('chatterbox') is not None
except Exception as e:
    out['chatterbox_error'] = repr(e)[:200]
print(json.dumps(out))
`;

// whether the card's capability (12.0 for the newest) is among what the torch was built for: a binary "sm_MN" runs on the same major
// number with a minor at least N, a "compute_MN" (PTX, compiled on the spot) on any card of M.N or newer
function builtFor(arch = [], capability = []) {
  if (!arch.length || capability.length < 2) return true; // (nothing to say it is not)
  const [major, minor] = capability.map(Number);
  const split = (digits) => [Number(digits.slice(0, -1)), Number(digits.slice(-1))];
  return arch.some((a) => {
    const m = /^(sm|compute)_(\d+)/.exec(a);
    if (!m) return false;
    const [am, an] = split(m[2]);
    return m[1] === 'sm' ? am === major && an <= minor : am < major || (am === major && an <= minor);
  });
}

function readTail(file, max = 300000) {
  try {
    const buf = fs.readFileSync(file);
    return (buf.length > max ? Buffer.concat([Buffer.from('...[cut]...\n'), buf.subarray(buf.length - max)]) : buf).toString('utf8');
  } catch {
    return '';
  }
}

async function diagnostics(ctx, data = dataFolders()) {
  const dirs = data.map((d) => path.join(d, 'diagnostics')).filter(exists);
  if (!dirs.length) {
    ctx.add('capri', 'Журналы самой Капри', 'info', 'пока нет (их пишет Капри с этой версии, когда готовит голос и нейросеть: запустите её, дождитесь ошибки и проверьте снова)');
    return;
  }
  for (const dir of dirs) {
    for (const name of fs.readdirSync(dir).filter((n) => /\.(txt|log)$/.test(n)).slice(0, 12)) {
      const text = readTail(path.join(dir, name));
      const st = fs.statSync(path.join(dir, name));
      ctx.write(`logs/capri/${name}`, text);
      ctx.add('capri', `Журнал Капри: ${name}`, 'info', `${Math.round(st.size / 1024)} КБ, изменён ${new Date(st.mtimeMs).toLocaleString('ru-RU')}`, { log: `logs/capri/${name}` });
      if (name === 'provision.txt') {
        const steps = [...text.matchAll(/^\[(failed|stopped)\] (\S+)(?::[^\n]*)?\n\s+error: ([^\n]*)/gm)];
        for (const m of steps) ctx.add('capri', `Подготовка Капри: шаг «${m[2]}» не удался`, 'fail', m[3].slice(0, 400), { log: 'logs/capri/provision.txt' });
        if (!steps.length && /^\[done\]/m.test(text)) ctx.add('capri', 'Подготовка Капри прошла без ошибок', 'pass', 'в её отчёте нет упавших шагов');
      }
      if (/server/.test(name)) {
        const bad = text.split(/\r?\n/).filter((l) => /(Traceback|Error|Exception|CUDA|out of memory|No module|Killed)/i.test(l));
        if (bad.length) ctx.add('capri', 'Голосовой сервер сообщал об ошибках', 'warn', bad.slice(-3).join(' | ').slice(0, 500), { log: `logs/capri/${name}` });
        const last = text.trim().split(/\r?\n/).slice(-2).join(' | ');
        if (last) ctx.add('capri', 'Голосовой сервер: последнее, что он сказал', 'info', last.slice(0, 300));
      }
    }
  }
}

// `ask`: how the Python is run (the tests stand in for it)
async function voice(ctx, folders = capriFolders(), ask = exec) {
  if (!folders.length) {
    ctx.add('capri', 'Папка Капри с тем, что она скачала', 'info', 'не найдена (ни «Capri» на дисках, ни её папки данных): голос и нейросеть ещё не ставились');
    return;
  }
  ctx.facts.capriFolders = [];
  for (const dir of folders) {
    const parts = {};
    for (const sub of ['ollama', 'chatterbox', 'piper', 'whisper', 'node']) {
      const p = path.join(dir, sub);
      if (exists(p)) parts[sub] = sizeOf(p);
    }
    ctx.facts.capriFolders.push({ dir, parts });
    const line = Object.entries(parts).map(([k, v]) => `${k} ${(v.bytes / GB).toFixed(1)} ГБ`).join(', ');
    ctx.add('capri', `Папка Капри: ${dir}`, 'info', line || 'пока пустая');
    if (!parts.chatterbox) continue;

    const chatterbox = path.join(dir, 'chatterbox');
    const python = [path.join(chatterbox, 'venv', 'Scripts', 'python.exe'), path.join(chatterbox, 'venv', 'bin', 'python3')].find(exists);
    ctx.add('capri', 'Chatterbox: Python его окружения', python ? 'pass' : 'fail', python ? python : 'окружения (venv) нет: голос не установлен до конца');

    const caches = voiceCache(chatterbox);
    ctx.facts.voiceCache = caches;
    if (!caches.length) ctx.add('capri', 'Chatterbox: модель голоса в кэше', 'warn', 'в кэше Hugging Face ничего от неё нет: модель ещё не скачивалась (или лежит в другом месте)');
    for (const c of caches) {
      const share = Math.round((100 * c.bytes) / MODEL_BYTES);
      const partial = c.partial.length ? `; недокачанных файлов: ${c.partial.length} (${c.partial.map((p) => `${(p.size / GB).toFixed(2)} ГБ, тронут ${p.ageMin} мин назад`).join('; ')})` : '';
      ctx.add('capri', 'Chatterbox: модель голоса в кэше', c.bytes >= MODEL_BYTES * 0.95 && !c.partial.length ? 'pass' : 'warn', `${(c.bytes / GB).toFixed(2)} ГБ из ~${(MODEL_BYTES / GB).toFixed(1)} (${Math.min(share, 100)}%)${partial}`);
    }

    if (python) {
      ctx.say('  смотрю, что за torch в окружении голоса (первый запуск torch может занять минуту)...');
      const r = await ask(python, ['-I', '-c', TORCH_PROBE], { timeout: 240000, cwd: chatterbox });
      let info = null;
      try {
        info = JSON.parse(r.out.trim().split(/\r?\n/).pop());
      } catch {
        // not JSON
      }
      if (!info) {
        ctx.add('capri', 'Chatterbox: Python и torch отвечают', 'fail', r.timedOut ? 'Python не ответил за 4 минуты (антивирус проверяет файлы torch?)' : (r.error ? `не запустился (${r.error})` : (r.err || r.out || 'пустой ответ').trim().slice(-400)));
        continue;
      }
      ctx.facts.torch = info;
      if (info.torch_error) {
        ctx.add('capri', 'Chatterbox: torch', 'fail', info.torch_error);
      } else {
        ctx.add('capri', 'Chatterbox: torch', 'info', `torch ${info.torch} (CUDA ${info.cuda_build || 'нет'}), torchaudio ${info.torchaudio || '—'}, Python ${info.python}, пакет chatterbox ${info.chatterbox_package ? 'есть' : 'НЕ найден'}`);
        if (info.chatterbox_package === false) ctx.add('capri', 'Chatterbox: пакет не установлен', 'fail', 'в окружении голоса нет библиотеки chatterbox: установка пакета не дошла до конца');
        if (!info.cuda_available) ctx.add('capri', 'Chatterbox: torch не видит видеокарту', 'warn', 'установлена сборка для процессора (или не подходит драйвер): голос будет медленным');
        else {
          const ok = builtFor(info.arch_list, info.capability);
          ctx.add('capri', 'Chatterbox: сборка torch подходит этой видеокарте', ok && info.kernel_ok ? 'pass' : 'fail',
            `${info.device}, compute ${info.capability.join('.')}; сборка рассчитана на ${(info.arch_list || []).join(' ')}; пробный расчёт на карте ${info.kernel_ok ? 'прошёл' : 'НЕ прошёл'}${ok ? '' : ': для этой карты в сборке нет ядер, голос упадёт с «no kernel image»'}`);
        }
      }
    }
  }
}

async function run(ctx) {
  await diagnostics(ctx);
  await voice(ctx);
  if (WIN) {
    const smi = await exec('nvidia-smi', ['--query-gpu=name,driver_version,compute_cap,memory.used,memory.total', '--format=csv,noheader'], { timeout: 15000 });
    if (smi.code === 0 && smi.out.trim()) ctx.add('capri', 'Видеокарта сейчас', 'info', `${smi.out.trim().split(/\r?\n/)[0]} (имя, драйвер, compute, занято, всего)`);
  }
}

module.exports = { run, diagnostics, voice, dataFolders, capriFolders, voiceCache, builtFor, sizeOf, TORCH_PROBE };
