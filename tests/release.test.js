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

test('the uninstaller asks whether what she downloaded goes too, and never on an update or a silent uninstall', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.build.nsis.include, 'build/installer.nsh', 'the installer script is part of the build');
  const raw = fs.readFileSync(path.join(__dirname, '..', pkg.build.nsis.include));
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'a UTF-8 file with a byte-order mark (the question is in Russian too)');
  const nsh = raw.toString('utf8');
  assert.match(nsh, /!macro customUnInstall/);
  assert.match(nsh, /\$\{ifNot\} \$\{isUpdated\}/i, 'an update asks nothing and removes nothing');
  assert.match(nsh, /MessageBox MB_YESNO[^\n]*Удалить также[^\n]*Also delete/, 'the question, in both languages');
  assert.match(nsh, /GetOptions\} \$R0 "\/S"/, 'a silent uninstall is told apart');
  assert.equal((nsh.match(/--remove-everything/g) || []).length >= 3, true);
  assert.match(nsh, /RMDir \/r "\$APPDATA\\\$\{APP_FILENAME\}"/, 'her data folder goes with a yes');
  // the app's side of it: the flag is handled before anything else starts
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.ok(main.indexOf("argv.includes('--remove-everything')") < main.indexOf('applyRender();\n  if (!app.requestSingleInstanceLock'), 'before she takes the one-instance lock');
  assert.match(main, /Uninstall \$\{app\.name\}\.exe/, 'the uninstaller the installer makes');
  assert.match(main, /'\/S', '--delete-app-data'/);
});
