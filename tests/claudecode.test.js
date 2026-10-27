'use strict';

// Her chat through Claude Code (src/main/llm.js claudeChat), against a stand-in `claude` command:
// what she knows about you goes in a file only you can open, that is gone once she has answered, and a
// command that quits without reading its input is an error, not a crash.
//   npm run test:claudecode

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const posix = process.platform !== 'win32';

test('the persona file is private, holds what she knows, and is deleted afterwards', { skip: !posix }, async () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-fakebin-'));
  const record = path.join(bin, 'record.json');
  fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const file = args[args.indexOf('--append-system-prompt-file') + 1];
let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ file, mode: fs.statSync(file).mode & 0o777, persona: fs.readFileSync(file, 'utf8'), stdin, args }));
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ну, слушаю' }] } }));
  console.log(JSON.stringify({ type: 'result', result: 'ну, слушаю' }));
});
`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  try {
    const llm = require('../src/main/llm.js');
    const pieces = [];
    const text = await llm.chat('claude', { claudeMode: 'default', claudeCwd: os.tmpdir() },
      { model: null, messages: [{ role: 'system', content: 'PERSONA with notes: любит синтвейв' }, { role: 'user', content: 'привет' }] },
      (p) => pieces.push(p), new AbortController().signal);
    assert.equal(text, 'ну, слушаю');
    assert.deepEqual(pieces, ['ну, слушаю']);
    const seen = JSON.parse(fs.readFileSync(record, 'utf8'));
    assert.equal(seen.persona, 'PERSONA with notes: любит синтвейв');
    assert.equal(seen.stdin, 'привет', 'the message on stdin, never on the command line');
    assert.equal(seen.mode, 0o600, 'only you can read it');
    assert.equal(fs.existsSync(path.dirname(seen.file)), false, 'gone once she has answered');
    assert.notEqual(path.basename(seen.file), 'capri-persona.txt', 'not a name anyone can guess');
    llm.resetClaude();
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('a Claude Code that quits at once is an error, and leaves nothing behind', { skip: !posix }, async () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-fakebin-'));
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\necho "not logged in" >&2\nexit 1\n', { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  const before = fs.readdirSync(os.tmpdir()).filter((f) => /^capri-[A-Za-z0-9]{6}$/.test(f));
  try {
    const llm = require('../src/main/llm.js');
    // a long message: written to a pipe nobody reads (the EPIPE that used to take the app down)
    await assert.rejects(
      llm.chat('claude', { claudeMode: 'default', claudeCwd: os.tmpdir() }, { model: null, messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'y'.repeat(2e6) }] }, () => {}, new AbortController().signal),
      /not logged in/,
    );
    await new Promise((r) => setTimeout(r, 50));
    const after = fs.readdirSync(os.tmpdir()).filter((f) => /^capri-[A-Za-z0-9]{6}$/.test(f));
    assert.deepEqual(after.sort(), before.sort(), 'no persona folder left');
    llm.resetClaude();
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(bin, { recursive: true, force: true });
  }
});
