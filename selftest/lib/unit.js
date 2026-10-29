'use strict';

// The project's own tests (tests/**/*.test.js), file by file, on this PC, with the Node this check runs on (or Capri's own, when
// the PC has no Node). A file's result is how many tests passed, failed or were left out, and for each failure what it said.

const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('./proc');

function find(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'fixtures' || e.name === 'helpers' || e.name === 'node_modules' ? [] : find(full);
    return e.name.endsWith('.test.js') ? [full] : [];
  });
}

const safeName = (rel) => rel.replace(/[^A-Za-z0-9._-]+/g, '_');

async function runFile(ctx, file) {
  const rel = path.relative(ctx.source, file).split(path.sep).join('/');
  const env = { ...process.env };
  if (ctx.runtime.viaCapri) {
    env.ELECTRON_RUN_AS_NODE = '1';
    delete env.NODE_OPTIONS; // (Electron refuses most of Node's own flags there, and then no test can start)
  }
  env.NODE_NO_WARNINGS = '1';
  delete env.NODE_TEST_CONTEXT; // (set when this check is itself run by node --test: the runner below must start as a runner)
  const r = await exec(process.execPath, [path.join(__dirname, 'test-worker.js'), file], { cwd: ctx.source, env, timeout: 240000 });
  const tally = { file: rel, pass: 0, fail: 0, skip: 0, ms: r.ms, failures: [], crashed: '' };
  const lines = [];
  let ended = false;
  for (const line of r.out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      lines.push(line);
      continue;
    }
    if (e.t === 'pass') { tally.pass++; lines.push(`ok      ${e.name} (${e.ms} ms)`); }
    else if (e.t === 'skip' || e.t === 'todo') { tally.skip++; lines.push(`skipped ${e.name}`); }
    else if (e.t === 'fail') { tally.fail++; tally.failures.push({ name: e.name, error: e.error }); lines.push(`FAILED  ${e.name} (${e.ms} ms)\n${String(e.error).replace(/^/gm, '        ')}`); }
    else if (e.t === 'out' || e.t === 'err') lines.push(`${e.t === 'err' ? 'stderr' : 'stdout'}: ${String(e.text).trimEnd()}`);
    else if (e.t === 'crash') tally.crashed = e.error;
    else if (e.t === 'end') ended = true;
  }
  if (!ended && !tally.crashed) {
    tally.crashed = r.timedOut ? 'не уложился во время (4 минуты), остановлен' : `процесс завершился без результата (код ${r.code}${r.error ? `, ${r.error}` : ''})`;
  }
  if (r.err.trim()) lines.push(`stderr of the runner:\n${r.err.trim().slice(0, 4000)}`);
  ctx.write(`logs/unit/${safeName(rel)}.log`, `${rel}\n${'='.repeat(rel.length)}\npass ${tally.pass}, fail ${tally.fail}, skipped ${tally.skip}, ${r.ms} ms\n\n${lines.join('\n')}\n`);
  return tally;
}

async function run(ctx) {
  if (!ctx.source) {
    ctx.add('unit', 'Тесты кода', 'skip', 'рядом нет папки с исходниками (source/), проверять нечего');
    return;
  }
  const dir = path.join(ctx.source, 'tests');
  if (!fs.existsSync(dir)) {
    ctx.add('unit', 'Тесты кода', 'skip', 'в исходниках нет папки tests/');
    return;
  }
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    ctx.add('unit', 'Тесты кода', 'warn', `Node ${process.versions.node}: тестам нужен Node 20 или новее (его можно взять из установленной Капри: запустите проверку ещё раз без Node в PATH)`);
    return;
  }
  const files = find(dir).sort();
  ctx.say(`  ${files.length} файлов с тестами`);
  const tallies = [];
  let done = 0;
  // two at a time: the tests use fake servers on free ports and temporary folders of their own
  const queue = files.slice();
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const t = await runFile(ctx, f);
      tallies.push(t);
      done++;
      if (t.fail || t.crashed) ctx.say(`  ${t.crashed ? 'сбой' : 'ошибки'}: ${t.file} (${t.fail} из ${t.pass + t.fail})`);
      else if (done % 8 === 0 || done === files.length) ctx.say(`  ... ${done}/${files.length}`);
    }
  };
  await Promise.all([worker(), worker()]);
  tallies.sort((a, b) => a.file.localeCompare(b.file));
  const sum = (k) => tallies.reduce((n, t) => n + t[k], 0);
  ctx.facts.unit = { files: tallies.length, pass: sum('pass'), fail: sum('fail'), skip: sum('skip'), tallies };
  const bad = tallies.filter((t) => t.fail || t.crashed);
  ctx.add('unit', 'Тесты кода', bad.length ? 'fail' : 'pass',
    `${sum('pass')} прошли, ${sum('fail')} не прошли, ${sum('skip')} пропущены, в ${tallies.length} файлах`);
  for (const t of bad) {
    const first = t.crashed ? t.crashed.split('\n')[0] : `${t.failures[0].name}: ${String(t.failures[0].error).split('\n')[0]}`;
    ctx.add('unit', `Тесты: ${t.file}`, 'fail', t.crashed ? `файл не отработал: ${first}` : `не прошло ${t.fail}: ${first}`, { log: `logs/unit/${safeName(t.file)}.log` });
  }
}

module.exports = { run, find };
