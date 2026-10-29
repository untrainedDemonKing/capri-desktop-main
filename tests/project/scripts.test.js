'use strict';

// The scripts that Windows reads (.ps1 by PowerShell, .cmd by cmd.exe) are read in the PC's own code page unless they say otherwise,
// and a Russian Windows reads a UTF-8 file without a mark at its start as Windows-1251: the bytes of "ё" (D1 91) come out as a curly
// quote, which PowerShell takes for the end of a string. So a script is either plain ASCII or starts with the UTF-8 mark (.ps1), and
// a .cmd is plain ASCII with Windows line ends (the words it shows are said by Node, not by the script).
//   node --test tests/project/scripts.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SKIP = new Set(['node_modules', 'dist', '.git', 'captures', 'results']);

function walk(dir, found = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, found);
    else if (/\.(ps1|cmd|bat)$/i.test(e.name)) found.push(full);
  }
  return found;
}

const files = walk(ROOT);
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const ascii = (buf) => buf.every((b) => b < 0x80);

test('there are scripts to look at', () => {
  assert.ok(files.some((f) => f.endsWith('.ps1')), 'some .ps1');
  assert.ok(files.some((f) => f.endsWith('.cmd')), 'some .cmd');
});

test('a .ps1 is plain ASCII, or starts with the UTF-8 mark so that Windows PowerShell reads its words as they are', () => {
  for (const f of files.filter((x) => x.endsWith('.ps1'))) {
    const buf = fs.readFileSync(f);
    assert.ok(ascii(buf) || buf.subarray(0, 3).equals(BOM), `${rel(f)} has letters beyond ASCII and no UTF-8 mark`);
  }
});

test('a .cmd or .bat has Windows line ends, and its letters beyond ASCII (if any) come after it has switched the console to UTF-8', () => {
  for (const f of files.filter((x) => /\.(cmd|bat)$/i.test(x))) {
    const text = fs.readFileSync(f).toString('latin1');
    assert.ok(!/(^|[^\r])\n/.test(text), `${rel(f)} has a line that ends without the carriage return`);
    const beyond = text.search(/[^\x00-\x7f]/);
    if (beyond >= 0) {
      const switched = text.search(/^\s*chcp\s+65001/im);
      assert.ok(switched >= 0 && switched < beyond, `${rel(f)} has letters beyond ASCII before "chcp 65001"`);
    }
  }
});

test('the check\'s own launchers are plain ASCII (they only start Node: the words are Node\'s)', () => {
  const kit = files.filter((f) => /selftest[\\/].*\.(cmd|bat)$/i.test(f));
  for (const f of kit) assert.ok(ascii(fs.readFileSync(f)), `${rel(f)} has letters beyond ASCII`);
});
