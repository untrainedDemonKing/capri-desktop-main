'use strict';

// The command line of the check:
//   --quick            what touches nothing: the tests, the PC, the network, her windows (default)
//   --full             also what does something: a test window that is clicked and typed into, the speech recogniser and the voice
//                      fetched into a temporary folder and tried (about 200 MB, taken off again), the microphone
//   --out <folder>     where the results go (default: results/ next to the check)
//   --capri <file>     Capri.exe to look at, when it is not where the installer puts it
//   --no-app --no-network --no-unit --no-hands --no-real --no-logs    leave one part out
//   --keep             do not take off what the full check fetched
//   --yes              do not ask before the full check starts (and do not wait for a key at the end)

const FLAGS = new Set(['quick', 'full', 'keep', 'yes', 'no-app', 'no-network', 'no-unit', 'no-hands', 'no-real', 'no-logs', 'help']);
const VALUED = new Set(['out', 'capri']);

function parseArgs(argv) {
  const opts = { mode: 'quick', keep: false, yes: false, skip: new Set(), out: '', capri: '', help: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) {
      opts.unknown.push(a);
      continue;
    }
    const [, name, inline] = m;
    if (VALUED.has(name)) {
      opts[name] = inline !== undefined ? inline : String(argv[++i] || '');
    } else if (FLAGS.has(name)) {
      if (name === 'full' || name === 'quick') opts.mode = name;
      else if (name.startsWith('no-')) opts.skip.add(name.slice(3));
      else opts[name] = true;
    } else opts.unknown.push(a);
  }
  return opts;
}

const HELP = `Проверка Капри
  --quick   быстрая проверка, ничего не двигает и не качает (по умолчанию)
  --full    полная: окно-мишень, скачивание распознавания речи и голоса во временную папку (~200 МБ), микрофон
  --out <папка>   куда сложить результат
  --capri <файл>  путь к Capri.exe, если она стоит не там, где её ставит установщик
  --no-app --no-network --no-unit --no-hands --no-real --no-logs   пропустить часть
  --keep    не удалять скачанное полной проверкой
  --yes     не спрашивать и не ждать нажатия клавиши
`;

module.exports = { parseArgs, HELP };
