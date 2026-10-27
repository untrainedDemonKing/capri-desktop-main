'use strict';

// The text of a release (scripts/release-notes.js, run by .github/workflows/release.yml): the installers
// listed 64-bit first with the right word for each, their SHA-256 sums, and what's new.
//   node --test tests/release.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { notes } = require('../scripts/release-notes.js');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

test('the release lists both installers, 64-bit first, with their checksums', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-release-'));
  try {
    fs.writeFileSync(path.join(dir, 'Capri-Setup-1.2.3-ia32.exe'), 'thirty-two');
    fs.writeFileSync(path.join(dir, 'Capri-Setup-1.2.3-x64.exe'), 'sixty-four');
    fs.writeFileSync(path.join(dir, 'latest.yml'), 'not an installer');
    const text = notes(dir, { version: '1.2.3', repo: 'me/capri', news: '- первое\n- второе\n' });
    assert.match(text, /^## Capri 1\.2\.3/);
    assert.ok(text.indexOf('Capri-Setup-1.2.3-x64.exe') < text.indexOf('Capri-Setup-1.2.3-ia32.exe'), '64-bit first');
    assert.match(text, /64-битной Windows/);
    assert.match(text, /32-битной Windows/);
    assert.match(text, /\[README\]\(https:\/\/github\.com\/me\/capri\/blob\/main\/README\.md\)/);
    assert.match(text, /### Что нового\n\n- первое\n- второе\n/);
    assert.ok(text.includes(`${sha('sixty-four')}  Capri-Setup-1.2.3-x64.exe`));
    assert.ok(text.includes(`${sha('thirty-two')}  Capri-Setup-1.2.3-ia32.exe`));
    assert.ok(!text.includes('latest.yml'), 'only the installers');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no news, no heading; and no installers is an error, not an empty release', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-release-'));
  try {
    assert.throws(() => notes(dir, { version: '1', repo: '', news: '' }), /no Capri-Setup/);
    fs.writeFileSync(path.join(dir, 'Capri-Setup-1-x64.exe'), 'x');
    const text = notes(dir, { version: '1', repo: '', news: '  \n' });
    assert.ok(!text.includes('Что нового'));
    assert.match(text, /\[README\]\(README\.md\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
