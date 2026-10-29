'use strict';

// Capri's PowerShell on this Windows, without touching anything: the scripts her hands would send are collected and handed to
// PowerShell's own parser; the helpers (Win32 and the mouse) are compiled for real by the harmless probe; the two watchers
// (windows and music) are started for a few seconds like the app starts them.

const fs = require('node:fs');
const path = require('node:path');
const { exec, psFile, WIN } = require('./proc');

const SIZE_LIMIT = 30000; // the command line of a program may hold 32767 characters

function listPs1(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listPs1(full, found);
    else if (e.name.endsWith('.ps1')) found.push(full);
  }
  return found;
}

async function parseAll(ctx, files) {
  const list = ctx.path('logs/powershell/files-to-parse.txt');
  fs.mkdirSync(path.dirname(list), { recursive: true });
  fs.writeFileSync(list, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(files.join('\n'), 'utf8')]));
  const r = await psFile(path.join(ctx.kit, 'windows', 'parse.ps1'), [list], { timeout: 90000 });
  let parsed = null;
  try {
    parsed = JSON.parse(r.out.trim().split(/\r?\n/).pop());
  } catch {
    // not JSON
  }
  return { parsed, raw: r };
}

async function scripts(ctx) {
  if (!ctx.source) {
    ctx.add('windows', 'Сценарии PowerShell', 'skip', 'нет исходников');
    return;
  }
  // 1. what her hands would send
  const dir = ctx.path('logs/powershell');
  fs.mkdirSync(dir, { recursive: true });
  const env = { ...process.env, ...(ctx.runtime.viaCapri && { ELECTRON_RUN_AS_NODE: '1' }) };
  if (ctx.runtime.viaCapri) delete env.NODE_OPTIONS;
  const cap = await exec(process.execPath, [path.join(__dirname, 'capture.js'), ctx.source, dir], { timeout: 60000, env });
  let index = [];
  try {
    index = JSON.parse(cap.out.trim().split(/\r?\n/).pop());
  } catch {
    ctx.add('windows', 'Сбор сценариев рук Капри', 'fail', (cap.err || cap.out || 'пустой ответ').trim().slice(0, 300));
    return;
  }
  const broken = index.filter((i) => !i.file);
  if (broken.length) ctx.add('windows', 'Сценарий не собрался', 'fail', broken.map((b) => `${b.name}: ${b.error}`).join('; '));
  const biggest = Math.max(0, ...index.map((i) => i.encodedLength || 0));
  ctx.facts.scriptSizes = Object.fromEntries(index.filter((i) => i.file).map((i) => [i.name, i.encodedLength]));
  ctx.add('windows', 'Размер команд PowerShell', biggest > SIZE_LIMIT ? 'fail' : 'pass', `самая большая ${biggest} знаков из ${SIZE_LIMIT} допустимых`);

  // 2. PowerShell's parser over those and over every .ps1 of the program
  const own = [...listPs1(path.join(ctx.source, 'src')), ...listPs1(path.join(ctx.source, 'scripts')), ...listPs1(path.join(ctx.kit, 'windows'))];
  const files = [...index.filter((i) => i.file).map((i) => path.join(dir, i.file)), ...own];
  const { parsed, raw } = await parseAll(ctx, files);
  if (!parsed) {
    ctx.add('windows', 'Разбор сценариев PowerShell', 'fail', (raw.error ? `PowerShell не запустился (${raw.error})` : (raw.err || raw.out || 'PowerShell не ответил').trim()).slice(0, 400), { code: raw.code });
    return;
  }
  const bad = parsed.filter((p) => p.errors && p.errors.length);
  ctx.facts.scriptSyntax = parsed.map((p) => ({ file: path.basename(p.file), errors: p.errors || [] }));
  ctx.add('windows', 'Сценарии PowerShell разбираются', bad.length ? 'fail' : 'pass', bad.length ? `ошибки в ${bad.length} из ${parsed.length}` : `${parsed.length} сценариев без синтаксических ошибок`);
  for (const b of bad) {
    ctx.add('windows', `Синтаксис: ${path.basename(b.file)}`, 'fail', b.errors.slice(0, 3).map((e) => `строка ${e.line}: ${e.message}`).join('; '));
  }
}

// the real helpers, compiled on this PC
async function probe(ctx) {
  if (!ctx.source) return;
  const control = require(path.join(ctx.source, 'src', 'main', 'system', 'control.js'));
  const t0 = Date.now();
  let line = '';
  try {
    line = await control.probe();
  } catch (err) {
    ctx.add('windows', 'Руки Капри: Win32 и мышь компилируются', 'fail', String(err.message || err).slice(0, 500));
    return;
  }
  const m = /ps=(\S+) screen=(\d+)x(\d+) windows=(\d+)/.exec(line);
  if (!m) {
    ctx.add('windows', 'Руки Капри: Win32 и мышь компилируются', 'fail', `непонятный ответ: ${String(line).slice(0, 300)}`);
    return;
  }
  ctx.facts.hands = { powershell: m[1], screen: [Number(m[2]), Number(m[3])], windows: Number(m[4]), compileMs: Date.now() - t0 };
  ctx.add('windows', 'Руки Капри: Win32 и мышь компилируются', 'pass', `PowerShell ${m[1]}, экран ${m[2]}×${m[3]}, видно окон: ${m[4]}, ${Date.now() - t0} мс`);
  if (Number(m[4]) === 0) ctx.add('windows', 'Окон не видно', 'warn', 'перечисление окон вернуло 0: Капри не сможет садиться на окна');
}

// the two watchers, started like the app starts them, for a few seconds
async function watchers(ctx) {
  if (!ctx.source) return;
  const sys = path.join(ctx.source, 'src', 'main', 'system');
  const win = await psFile(path.join(sys, 'windows.ps1'), ['0', String(process.pid)], { timeout: 6000 });
  const snaps = win.out.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter((s) => s && Array.isArray(s.wins));
  if (snaps.length) {
    ctx.add('windows', 'Наблюдатель за окнами (windows.ps1)', 'pass', `прислал ${snaps.length} снимков, в первом ${snaps[0].wins.length} окон${win.err.trim() ? ', но писал в stderr' : ''}`);
  } else {
    ctx.add('windows', 'Наблюдатель за окнами (windows.ps1)', 'fail', `не прислал ни одного снимка за 6 секунд. ${(win.err || win.out || '').trim().slice(0, 400) || 'молчит'}`, { code: win.code });
  }
  if (win.err.trim()) ctx.write('logs/watch-windows.stderr.txt', win.err);

  const media = await psFile(path.join(sys, 'media.ps1'), [String(process.pid)], { timeout: 5000 });
  // it runs until it is stopped: being stopped by the time limit is how it should end; ending by itself, with a word on stderr, is not
  if (media.timedOut) ctx.add('windows', 'Наблюдатель за музыкой (media.ps1)', 'pass', `работает${media.out.trim() ? `, сказал: ${media.out.trim().split(/\r?\n/)[0].slice(0, 100)}` : ' (сейчас ничего не играет)'}`);
  else ctx.add('windows', 'Наблюдатель за музыкой (media.ps1)', 'fail', `завершился сам (код ${media.code}): ${(media.err || media.out || '').trim().slice(0, 300)}`);
  if (media.err.trim()) ctx.write('logs/watch-media.stderr.txt', media.err);
}

async function run(ctx) {
  if (!WIN) {
    ctx.add('windows', 'Часть для Windows', 'skip', `система ${process.platform}: PowerShell-часть Капри (руки, окна, музыка) здесь не работает`);
    return;
  }
  await scripts(ctx);
  await probe(ctx);
  await watchers(ctx);
}

module.exports = { run, scripts, probe, watchers, listPs1 };
