#!/usr/bin/env node
'use strict';

// Проверка Капри. Прогоняет на этом компьютере всё, что можно проверить без вас: тесты кода, систему, PowerShell, сеть, саму Капри,
// а в полном режиме ещё руки Капри, настоящую установку распознавания речи и голоса. Складывает результат в одну zip-папку, которую
// можно отправить разработчику. Читать это не нужно: запускайте Проверка-Капри.cmd (Windows), check.sh или check.command.
//
//   node selftest.js [--quick | --full] [--out папка] [--capri путь\Capri.exe] [--no-app --no-network --no-unit --no-hands --no-real] [--keep] [--yes]

const readline = require('node:readline');
const { parseArgs, HELP } = require('./lib/args');
const { createContext } = require('./lib/context');

const FULL_WARNING = `
ПОЛНАЯ ПРОВЕРКА. Что произойдёт:
  - откроется тестовое окно: Капри сама нажмёт в нём кнопки, напечатает текст и подвигает мышью.
    Примерно 30 секунд НЕ ТРОГАЙТЕ мышь и клавиатуру, пока идут «Руки Капри»;
  - скачается около 200 МБ (распознавание речи и голос) во временную папку, проверится и сразу удалится;
  - на секунду включится микрофон (проверка, что он открывается; звук нигде не сохраняется);
  - ненадолго покажется окно Капри и её главное меню.
Занимает 5–10 минут. Ничего на компьютере не устанавливается и не меняется.
`;

function ask(text) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(text, () => { rl.close(); resolve(); });
    rl.on('close', resolve);
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const ctx = createContext(opts, __dirname);
  ctx.say('Проверка Капри');
  ctx.say(`Режим: ${ctx.full ? 'ПОЛНЫЙ' : 'быстрый (ничего не двигает и не качает)'}. Результат: ${ctx.out}`);
  if (!ctx.source) ctx.say('Внимание: рядом нет папки source/ с кодом Капри, поэтому тесты и часть проверок будут пропущены.');
  if (ctx.full && !opts.yes && process.stdin.isTTY) {
    ctx.say(FULL_WARNING);
    await ask('Нажмите Enter, чтобы начать (или закройте это окно, чтобы отказаться)... ');
  }

  const sys = require('./lib/sys');
  const unit = require('./lib/unit');
  const windows = require('./lib/windows');
  const hands = require('./lib/hands');
  const net = require('./lib/net');
  const app = require('./lib/app');
  const capriLogs = require('./lib/capri-logs');
  const real = require('./lib/real');
  const report = require('./lib/report');

  // [title, work, minutes it may take]
  const parts = [
    ['Компьютер', async () => { await sys.snapshot(ctx); await sys.hardware(ctx); }, 5],
    ['Windows: PowerShell, окна, мышь', () => windows.run(ctx), 10],
    ctx.full && ctx.wants('hands') && ['Руки Капри на тестовом окне (не трогайте мышь!)', () => hands.run(ctx), 5],
    ctx.wants('unit') && ['Тесты кода', () => unit.run(ctx), 30],
    ctx.wants('network') && ['Сеть: откуда Капри всё скачивает', () => net.run(ctx), 5],
    ctx.wants('app') && ['Сама Капри', () => app.run(ctx), 12],
    ctx.wants('logs') && ['Журналы Капри и то, что она скачала (голос Chatterbox)', () => capriLogs.run(ctx), 10],
    ctx.full && ctx.wants('real') && ['Настоящая установка распознавания речи и голоса', () => real.run(ctx), 25],
  ].filter(Boolean);
  for (const [i, [title, fn, limit]] of parts.entries()) await ctx.phase(`${i + 1}/${parts.length}. ${title}`, fn, limit);

  ctx.say('');
  ctx.say('== Собираю отчёт');
  const done = report.finish(ctx);
  report.announce(ctx, done);
  if (!opts.yes) report.reveal(done.zipFile);
  return done.sum.fail ? 1 : 0;
}

process.on('unhandledRejection', (err) => {
  process.stderr.write(`\nВнутренняя ошибка проверки: ${err && err.stack || err}\n`);
});

// (left at once: a stuck part may still hold a program or a timer, and the report is already written)
main().then((code) => { process.exitCode = code; setTimeout(() => process.exit(code), 300); }, (err) => {
  process.stderr.write(`\nПроверка не смогла завершиться: ${err && err.stack || err}\n`);
  process.exitCode = 2;
  setTimeout(() => process.exit(2), 300);
});
