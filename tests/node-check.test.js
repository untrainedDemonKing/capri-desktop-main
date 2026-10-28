'use strict';

// Node.js on this PC (src/main/node-check.js): found on the PATH or where its installer puts it, fetched as
// the portable zip when it is not there (checked against nodejs.org's checksum), and put on your PATH.
//   node --test tests/node-check.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const nc = require('../src/main/node-check.js');
const files = require('../src/main/fetch-files.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-node-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const mk = (...p) => { const d = path.join(tmp, `${n++}`, ...p); fs.mkdirSync(d, { recursive: true }); return d; };

test('versions are read from what `node -v` says; 18 and newer is good enough', () => {
  assert.deepEqual(nc.parseVersion('v22.11.0\n'), [22, 11, 0]);
  assert.deepEqual(nc.parseVersion('20.1.5'), [20, 1, 5]);
  assert.equal(nc.parseVersion('not node'), null);
  assert.equal(nc.MIN_MAJOR, 18);
});

test('Node is found on the PATH first, then where its installer puts it, then in her own folder; an old one is said to be old', async () => {
  const versions = { '/usr/bin/node': [22, 1, 0] };
  const run = (exe) => versions[exe] || null;
  const onPath = await nc.findNode({ platform: 'linux', whichFn: async () => '/usr/bin/node', run, exists: () => true });
  assert.deepEqual([onPath.exe, onPath.version, onPath.where], ['/usr/bin/node', '22.1.0', 'path']);
  // not on the PATH, but in Program Files (Windows)
  const win = { ProgramFiles: 'C:\\Program Files', ProgramW6432: 'C:\\Program Files' };
  const known = path.join('C:\\Program Files', 'nodejs', 'node.exe');
  const inFiles = await nc.findNode({ platform: 'win32', env: win, whichFn: async () => null, run: (exe) => (exe === known ? [20, 18, 0] : null), exists: (p) => p === known });
  assert.deepEqual([inFiles.exe, inFiles.where], [known, 'known']);
  // her own folder
  const ours = mk('node');
  fs.mkdirSync(path.join(ours, 'node-v22.1.0-win-x64'), { recursive: true });
  const exe = path.join(ours, 'node-v22.1.0-win-x64', 'node.exe');
  fs.writeFileSync(exe, 'x');
  const mine = await nc.findNode({ platform: 'win32', env: {}, ours, whichFn: async () => null, run: (e) => (e === exe ? [22, 1, 0] : null), exists: fs.existsSync });
  assert.deepEqual([mine.exe, mine.where], [exe, 'ours']);
  // nothing at all
  assert.equal(await nc.findNode({ platform: 'win32', env: {}, whichFn: async () => null, run: () => null, exists: () => false }), null);
  // one that is too old
  const old = await nc.findNode({ platform: 'linux', whichFn: async () => '/usr/bin/node', run: () => [16, 20, 0], exists: () => false });
  assert.deepEqual(old, { tooOld: '16.20.0' }, 'found, but not good enough: so she says which');
});

const INDEX = [
  { version: 'v25.0.0', lts: false, files: ['win-x64-zip', 'win-x86-zip'] },
  { version: 'v24.22.1', lts: 'Krypton', files: ['win-x64-zip', 'win-arm64-zip'] },
  { version: 'v24.22.0', lts: 'Krypton', files: ['win-x64-zip', 'win-arm64-zip'] },
  { version: 'v22.20.0', lts: 'Jod', files: ['win-x64-zip', 'win-x86-zip', 'win-arm64-zip'] },
  { version: 'v22.9.0', lts: 'Jod', files: ['win-x64-zip', 'win-x86-zip'] },
];

test('the release to fetch: the newest long-term one that has a zip for this system (32-bit Windows gets an older one)', () => {
  assert.equal(nc.pickRelease(INDEX, 'x64').version, 'v24.22.1', 'not the current (odd) release');
  const x86 = nc.pickRelease(INDEX, 'ia32');
  assert.equal(x86.version, 'v22.20.0', 'v24 has no 32-bit Windows build');
  assert.equal(x86.name, 'node-v22.20.0-win-x86.zip');
  assert.equal(x86.url, 'https://nodejs.org/dist/v22.20.0/node-v22.20.0-win-x86.zip');
  assert.equal(nc.pickRelease(INDEX, 'arm64').name, 'node-v24.22.1-win-arm64.zip');
  assert.equal(nc.pickRelease(INDEX, 'mips'), null);
  assert.equal(nc.pickRelease([{ version: 'v1.0.0', lts: 'x', files: [] }], 'x64'), null);
  assert.equal(nc.pickRelease(null, 'x64'), null);
});

test('the checksum of a file out of nodejs.org\'s list', () => {
  const sum = 'a'.repeat(64);
  const text = `${'b'.repeat(64)}  node-v22.20.0-win-x64.7z\n${sum}  node-v22.20.0-win-x64.zip\n${'c'.repeat(64)}  node-v22.20.0.tar.gz\n`;
  assert.equal(nc.checksumOf(text, 'node-v22.20.0-win-x64.zip'), sum);
  assert.equal(nc.checksumOf(text, 'node-v22.20.0-win-x86.zip'), '');
});

test('fetching: the index, the checksum, the zip (checked), unpacked into her folder; a zip that does not match is refused', async () => {
  const stage = mk('stage');
  fs.mkdirSync(path.join(stage, 'node-v24.22.1-win-x64'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'node-v24.22.1-win-x64', 'node.exe'), 'MZ'.repeat(3000));
  fs.writeFileSync(path.join(stage, 'node-v24.22.1-win-x64', 'npm.cmd'), '@echo off');
  const zip = path.join(mk('zips'), 'node.zip');
  cp.execFileSync('python3', ['-I', '-c', `
import zipfile, os
z = zipfile.ZipFile(${JSON.stringify(zip)}, 'w', zipfile.ZIP_DEFLATED)
for d, _, fs_ in os.walk(${JSON.stringify(stage)}):
    for f in fs_:
        p = os.path.join(d, f)
        z.write(p, os.path.relpath(p, ${JSON.stringify(stage)}))
z.close()
`]);
  const body = fs.readFileSync(zip);
  const sum = crypto.createHash('sha256').update(body).digest('hex');
  const served = {
    'https://nodejs.org/dist/index.json': Buffer.from(JSON.stringify(INDEX)),
    'https://nodejs.org/dist/v24.22.1/SHASUMS256.txt': Buffer.from(`${sum}  node-v24.22.1-win-x64.zip\n`),
    'https://nodejs.org/dist/v24.22.1/node-v24.22.1-win-x64.zip': body,
  };
  const asked = [];
  const fetchFn = async (url) => { asked.push(url); const b = served[url]; return b ? new Response(b, { headers: { 'content-length': String(b.length) } }) : new Response('no', { status: 404 }); };
  const dir = mk('userdata', 'node');
  const seen = [];
  const got = await nc.install({ dir, arch: 'x64', fetchFn, tmp: mk('tmpdl'), onProgress: (p) => seen.push(p) });
  assert.equal(got.exe, path.join(dir, 'node-v24.22.1-win-x64', 'node.exe'));
  assert.equal(got.dir, path.dirname(got.exe));
  assert.equal(got.version, '24.22.1');
  assert.ok(fs.existsSync(path.join(got.dir, 'npm.cmd')));
  assert.ok(seen.length > 0);
  assert.deepEqual(asked.map((u) => u.split('/').pop()), ['index.json', 'SHASUMS256.txt', 'node-v24.22.1-win-x64.zip']);
  // a zip that was changed on the way
  served['https://nodejs.org/dist/v24.22.1/node-v24.22.1-win-x64.zip'] = Buffer.from('not the node you wanted');
  const other = mk('userdata2', 'node');
  await assert.rejects(() => nc.install({ dir: other, arch: 'x64', fetchFn, tmp: mk('tmpdl2') }), /damaged|stopped at/);
  assert.deepEqual(fs.readdirSync(other), [], 'nothing is unpacked from a file that does not match');
  // no checksum, no node
  delete served['https://nodejs.org/dist/v24.22.1/SHASUMS256.txt'];
  await assert.rejects(() => nc.install({ dir: other, arch: 'x64', fetchFn, tmp: mk('tmpdl3') }), /no checksum/);
  // the site is down
  await assert.rejects(() => nc.install({ dir: other, arch: 'x64', fetchFn: async () => new Response('', { status: 503 }), tmp: mk('tmpdl4') }), /answered 503/);
});

test('the PATH of your account: the folder is added once (PowerShell, nothing to quote wrongly), and to hers now', () => {
  const calls = [];
  const env = { PATH: '/bin' };
  const res = nc.addToUserPath("C:\\Users\\O'Brien\\node", { platform: 'win32', env, spawnSync: (cmd, args) => { calls.push([cmd, args]); return { status: 0, stdout: '', stderr: '' }; } });
  assert.equal(res.ok, true);
  assert.equal(calls[0][0], 'powershell.exe');
  const script = Buffer.from(calls[0][1][calls[0][1].length - 1], 'base64').toString('utf16le');
  assert.match(script, /\$d = 'C:\\Users\\O''Brien\\node'/, 'a quote in a name is doubled');
  assert.match(script, /SetEnvironmentVariable\('Path'.*'User'\)/, 'your account\'s, not the machine\'s');
  assert.match(script, /-contains \$d/, 'only if it is not there');
  assert.ok(env.PATH.startsWith('C:\\Users\\O\'Brien\\node'), 'and she finds it at once');
  assert.deepEqual(nc.addToUserPath('/x', { platform: 'linux', env: {}, spawnSync: () => { throw new Error('no'); } }), { ok: false, error: 'Windows only' });
  assert.equal(nc.addToUserPath('C:\\n', { platform: 'win32', env: {}, spawnSync: () => ({ status: 1, stderr: 'denied' }) }).ok, false);
});

test('the command that runs a script with Node: `node`, else the path of one she knows, else none', () => {
  const ok = () => ({ status: 0, stdout: 'v22.1.0\n' });
  assert.equal(nc.nodeCommand({ spawnSync: ok }), 'node');
  const known = path.join('C:\\Program Files', 'nodejs', 'node.exe');
  const onlyKnown = (cmd) => (cmd === known ? { status: 0, stdout: 'v20.0.0' } : { status: 1, stdout: '' });
  assert.equal(nc.nodeCommand({ spawnSync: onlyKnown, platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' }, exists: (p) => p === known }), `"${known}"`, 'quoted: it has a space in it');
  assert.equal(nc.nodeCommand({ spawnSync: () => ({ status: 1 }), platform: 'win32', env: {}, exists: () => false }), null);
  assert.equal(nc.nodeCommand({ spawnSync: () => ({ status: 0, stdout: 'v16.0.0' }) }), null, 'too old');
});

test('a hash that is not the one asked for leaves nothing (download with sha256)', async () => {
  const dir = mk('dl');
  const body = Buffer.alloc(5000, 1);
  const fetchFn = async () => new Response(body, { headers: { 'content-length': String(body.length) } });
  await files.download('https://x.test/a', path.join(dir, 'a'), { fetchFn, sha256: crypto.createHash('sha256').update(body).digest('hex') });
  assert.ok(fs.existsSync(path.join(dir, 'a')));
  await assert.rejects(() => files.download('https://x.test/b', path.join(dir, 'b'), { fetchFn, sha256: 'f'.repeat(64) }), /damaged/);
  assert.equal(fs.existsSync(path.join(dir, 'b')), false);
});

test('removeFromUserPath takes out the folder and everything inside it (the folder with node.exe is a level down), nothing like it', () => {
  const sep = require('node:path').delimiter;
  const env = { PATH: ['/usr/bin', '/ud/node/node-v22-win-x64', '/ud/nodejs', '/ud/node', '/ud/node/'].join(sep) };
  const res = nc.removeFromUserPath('/ud/node', { platform: 'linux', env });
  assert.equal(res.ok, false, 'Windows only for the account\'s PATH');
  assert.equal(env.PATH, ['/usr/bin', '/ud/nodejs'].join(sep));
  // on Windows: the script that does it is given the folder, quoted
  const calls = [];
  const win = { PATH: '' };
  const done = nc.removeFromUserPath("C:\\Users\\o'brien\\node", { platform: 'win32', env: win, spawnSync: (cmd, args) => { calls.push([cmd, args]); return { status: 0, stdout: '', stderr: '' }; } });
  assert.equal(done.ok, true);
  const script = Buffer.from(calls[0][1].at(-1), 'base64').toString('utf16le');
  assert.match(script, /\$d = 'C:\\Users\\o''brien\\node'\.ToLower\(\)/);
  assert.match(script, /SetEnvironmentVariable\('Path'/);
});
