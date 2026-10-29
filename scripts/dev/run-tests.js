'use strict';

// Runs every test of the project (tests/**/*.test.js), the same way on every Node version from 20 up
// (`node --test` takes a folder or a pattern differently from one version to the next):
//   npm test                 all of them
//   npm test -- renderer     only the folders or files whose path contains "renderer"

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');

function find(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'fixtures' || e.name === 'helpers' ? [] : find(full);
    return e.name.endsWith('.test.js') ? [full] : [];
  });
}

const filters = process.argv.slice(2);
const files = find(path.join(ROOT, 'tests'))
  .filter((f) => !filters.length || filters.some((x) => path.relative(ROOT, f).includes(x)))
  .sort();
if (!files.length) {
  console.error('no tests match', filters.join(' '));
  process.exit(1);
}
const res = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, stdio: 'inherit' });
process.exit(res.status ?? 1);
