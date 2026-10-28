#!/usr/bin/env node
'use strict';

// The text of a GitHub release (in Russian), from the installers just built: which file is for which
// Windows, their SHA-256 sums, what's new (.github/RELEASE_NEWS.md, edited for each release).
//   node scripts/release-notes.js <folder with the Capri-Setup-*.exe files>  >  release-notes.md
// REPO (owner/name, as GitHub Actions sets GITHUB_REPOSITORY) is for the link to the README.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

const WHICH = {
  x64: 'для 64-битной Windows (почти у всех). Проверить: Параметры › Система › О системе › «Тип системы»',
  ia32: 'для 32-битной Windows. Собран на Electron 43: новее Electron 32-битную Windows уже не выпускает',
};

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function notes(dir, { version, repo, news }) {
  const files = fs.readdirSync(dir)
    .filter((f) => /^Capri-Setup-.+-(x64|ia32)\.exe$/.test(f))
    .sort((a, b) => (/x64/.test(a) ? -1 : 1) - (/x64/.test(b) ? -1 : 1)); // 64-bit first
  if (!files.length) throw new Error(`no Capri-Setup-*.exe in ${dir}`);
  const arch = (f) => /-(x64|ia32)\.exe$/.exec(f)[1];
  const readme = repo ? `https://github.com/${repo}/blob/main/README.md` : 'README.md';
  const out = [
    `## Capri ${version}`,
    '',
    'Живая Капри на рабочем столе Windows: следит за Claude Code, Codex и Antigravity, болтает через любую нейросеть, злится, смеётся, видит экран, слышит и запоминает тебя.',
    '',
    '### Какой файл скачать',
    '',
    '| Файл | Для чего |',
    '|---|---|',
    ...files.map((f) => `| **\`${f}\`** | ${WHICH[arch(f)]} |`),
    '',
    'Установка в один щелчок, на твою учётную запись (права администратора не нужны), на рабочем столе появится ярлык, и Капри сразу запустится.',
    '',
    '> Установщики не подписаны (сертификат подписи платный), поэтому Windows SmartScreen может написать «Windows защитил ваш компьютер». Нажми **Подробнее › Выполнить в любом случае**.',
    '',
    '### Что дальше',
    '',
    '1. При первом запуске сам откроется **главное меню**: выбери, на чём она думает (Ollama на твоём ПК, Claude по ключу, бесплатные Groq и Gemini и другие) и чем говорит, и нажми **«Установить и запустить»**. Потом всё можно поменять: правый клик по Капри › вкладка **ИИ** или меню у часов › «Главное меню».',
    '2. Если пользуешься Claude Code, Codex или Antigravity, нажми на её приветствии **«Подключить меня к Claude»**.',
    '',
    `Подробные инструкции: [README](${readme}).`,
    '',
  ];
  if (news && news.trim()) out.push('### Что нового', '', news.trim(), '');
  out.push(
    '### Контрольные суммы SHA-256',
    '',
    '```',
    ...files.map((f) => `${sha256(path.join(dir, f))}  ${f}`),
    '```',
    '',
  );
  return out.join('\n');
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/release-notes.js <folder with the installers>');
    process.exit(2);
  }
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const newsFile = path.join(ROOT, '.github', 'RELEASE_NEWS.md');
  const news = fs.existsSync(newsFile) ? fs.readFileSync(newsFile, 'utf8') : '';
  process.stdout.write(notes(dir, { version, repo: process.env.REPO || process.env.GITHUB_REPOSITORY || '', news }));
}

module.exports = { notes };
