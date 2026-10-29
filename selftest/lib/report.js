'use strict';

// The end of the check: the findings as a text a person reads (report.txt) and as data (report.json), every text file cleaned of names
// and addresses of this PC, everything packed into one zip next to the results, and the folder opened.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { makeRedactor } = require('./redact');
const { zipFolder } = require('./zip');
const { TAGS } = require('./context');

const GROUPS = {
  check: 'Сама проверка', system: 'Компьютер', unit: 'Тесты кода', windows: 'Windows: PowerShell, окна, руки', hands: 'Руки Капри на тестовом окне',
  network: 'Сеть', app: 'Капри (установленная программа)', real: 'Распознавание речи и голос (настоящая установка)',
};
const TEXT = /\.(txt|json|log|ps1|md|csv|cmd|js)$/i;

function summary(results) {
  const n = (s) => results.filter((r) => r.status === s).length;
  return { fail: n('fail'), warn: n('warn'), pass: n('pass'), skip: n('skip'), info: n('info') };
}

function textReport(ctx, sum) {
  const lines = [];
  const mode = ctx.full ? 'полная' : 'быстрая';
  let version = '';
  try {
    version = JSON.parse(fs.readFileSync(path.join(ctx.source, 'package.json'), 'utf8')).version;
  } catch {
    // no sources
  }
  lines.push('ПРОВЕРКА КАПРИ — отчёт');
  lines.push(`Дата: ${ctx.started.toLocaleString('ru-RU')}   Режим: ${mode}   Версия исходников: ${version || '?'}   Длилась: ${Math.round((Date.now() - ctx.started) / 1000)} с`);
  const s = ctx.facts.system;
  if (s) lines.push(`ПК: ${s.platform} ${s.release} ${s.arch}; ${s.cpu}; ОЗУ ${s.ramGB} ГБ${s.windows ? `; ${s.windows.os} (сборка ${s.windows.build}), PowerShell ${s.windows.ps}` : ''}; Node ${s.runtime.node}${s.runtime.viaCapri ? ' (из Капри)' : ''}`);
  lines.push('');
  lines.push(`ИТОГ: ошибок ${sum.fail}, предупреждений ${sum.warn}, в порядке ${sum.pass}, пропущено ${sum.skip}`);
  const bad = ctx.results.filter((r) => r.status === 'fail');
  const warn = ctx.results.filter((r) => r.status === 'warn');
  if (bad.length) {
    lines.push('');
    lines.push('ЧТО НЕ ТАК (ошибки):');
    bad.forEach((r, i) => lines.push(`  ${i + 1}. [${GROUPS[r.group] || r.group}] ${r.title}\n     ${r.detail.split('\n').join('\n     ')}${r.log ? `\n     подробности: ${r.log}` : ''}`));
  }
  if (warn.length) {
    lines.push('');
    lines.push('НА ЗАМЕТКУ (предупреждения):');
    warn.forEach((r, i) => lines.push(`  ${i + 1}. [${GROUPS[r.group] || r.group}] ${r.title}\n     ${r.detail.split('\n').join('\n     ')}`));
  }
  const hints = ctx.results.filter((r) => r.hint);
  if (hints.length) {
    lines.push('');
    lines.push('ЧТО ПОМОГЛО:');
    hints.forEach((r) => lines.push(`  - ${r.title}\n    ${r.detail}`));
  }
  lines.push('');
  lines.push('ВСЁ ПО ПОРЯДКУ');
  let group = '';
  for (const r of ctx.results) {
    if (r.group !== group) {
      group = r.group;
      lines.push('');
      lines.push(`== ${GROUPS[group] || group}`);
    }
    lines.push(`  [${TAGS[r.status] || r.status}] ${r.title}${r.detail ? ` — ${r.detail.split('\n')[0]}` : ''}`);
  }
  lines.push('');
  lines.push('Файлы рядом: report.json (то же данными), logs/ (подробные журналы), app/ (снимки окон Капри), logs/unit/ (журнал каждого файла тестов).');
  return lines.join('\n');
}

// opens the folder with the zip selected
function reveal(file) {
  try {
    // (Explorer wants the path in quotes after the comma, as one piece: the arguments are handed over as they are)
    if (process.platform === 'win32') spawn('explorer.exe', [`/select,"${file}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
    else if (process.platform === 'darwin') spawn('open', ['-R', file], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // no desktop to open it on
  }
}

function finish(ctx) {
  const sum = summary(ctx.results);
  const redact = makeRedactor();
  const durationSec = Math.round((Date.now() - ctx.started) / 1000);
  const json = { tool: 'capri-check', mode: ctx.opts.mode, started: ctx.started.toISOString(), durationSec, summary: sum, results: ctx.results.map(({ stack, ...r }) => r), facts: ctx.facts };
  fs.writeFileSync(path.join(ctx.out, 'report.txt'), `﻿${textReport(ctx, sum)}\n`);
  fs.writeFileSync(path.join(ctx.out, 'report.json'), JSON.stringify(json, null, 2));

  const zipFile = path.join(path.dirname(ctx.out), `capri-check-${ctx.stamp}.zip`);
  const count = zipFolder(ctx.out, zipFile, {
    prefix: `capri-check-${ctx.stamp}`,
    skip: (rel) => /(^|\/)userdata(\/|$)/.test(rel),
    transform: (rel, data) => {
      if (!TEXT.test(rel)) return data;
      const text = data.toString('utf8').replace(/^﻿/, '');
      let out = redact(text);
      if (out.length > 3e6) out = `${out.slice(0, 1.5e6)}\n...[cut]...\n${out.slice(-1.5e6)}`;
      return Buffer.from(rel === 'report.txt' ? `﻿${out}` : out, 'utf8');
    },
  });
  return { sum, zipFile, count };
}

function announce(ctx, done) {
  const { sum, zipFile } = done;
  const line = '='.repeat(64);
  ctx.say('');
  ctx.say(line);
  ctx.say(`ИТОГ: ошибок ${sum.fail}, предупреждений ${sum.warn}, в порядке ${sum.pass}, пропущено ${sum.skip}`);
  if (sum.fail) {
    for (const r of ctx.results.filter((x) => x.status === 'fail').slice(0, 12)) ctx.say(`  - ${r.title}: ${r.detail.split('\n')[0].slice(0, 140)}`);
  }
  ctx.say('');
  ctx.say(sum.fail ? 'Что-то не в порядке: это и нужно показать.' : 'Ошибок не найдено. Всё равно отправьте файл: сведения о вашем ПК пригодятся.');
  ctx.say('Файл для отправки:');
  ctx.say(`  ${zipFile}`);
  ctx.say('В нём нет паролей, ключей и ваших переписок; имя пользователя, имя компьютера и адреса домашней сети заменены.');
  ctx.say(line);
}

module.exports = { finish, announce, summary, reveal, textReport };
