'use strict';

// Node.js on this PC. The installed Capri carries its own and needs none, but what she sets up beside herself
// does: the hooks of Codex run as `node script.js`, and running her from the sources is `npm start`. So she looks
// for it, and when it is not there she fetches the portable Node from nodejs.org (a zip: no installer, no
// administrator) into her own folder, checks it against nodejs.org's checksum, and adds it to your PATH (yours
// only), so that every program you start from then on finds it.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { download, unzip, findFile } = require('./fetch-files');
const { which } = require('./proc');

const MIN_MAJOR = 18;
const DIST = 'https://nodejs.org/dist';

function parseVersion(text) {
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(String(text));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
const goodEnough = (v) => Boolean(v) && v[0] >= MIN_MAJOR;

// the places Node's own installer puts it, and her own folder's
function knownPlaces(platform = process.platform, env = process.env, ours = '') {
  const out = [];
  if (platform === 'win32') {
    for (const base of [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']]) if (base) out.push(path.join(base, 'nodejs', 'node.exe'));
    if (env.LOCALAPPDATA) out.push(path.join(env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe'));
  } else {
    out.push('/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node');
  }
  return [...new Set(out)].concat(ours ? [ours] : []);
}

function versionOf(exe, { spawnSync = cp.spawnSync } = {}) {
  try {
    const r = spawnSync(exe, ['-v'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return r.status === 0 ? parseVersion(r.stdout) : null;
  } catch {
    return null;
  }
}

// Where Node is, if there is a good one (18 or newer): on the PATH, in a place its installer uses, or in her own
// folder (`ours`: the folder she fetched it to). { exe, version, where } or null. `tooOld`: one was found, but old.
async function findNode({ platform = process.platform, env = process.env, ours = '', whichFn = which, run = versionOf, exists = fs.existsSync } = {}) {
  let old = null;
  const tryExe = (exe, where) => {
    const v = run(exe);
    if (goodEnough(v)) return { exe, version: v.join('.'), where };
    if (v && !old) old = v.join('.');
    return null;
  };
  const onPath = await whichFn('node', { platform });
  const first = onPath && tryExe(onPath, 'path');
  if (first) return first;
  const ownExe = ours ? findFile(ours, [platform === 'win32' ? 'node.exe' : 'node'], { depth: 2 }) : null;
  for (const exe of [...knownPlaces(platform, env), ...(ownExe ? [ownExe] : [])]) {
    if (!exists(exe)) continue;
    const hit = tryExe(exe, exe === ownExe ? 'ours' : 'known');
    if (hit) return hit;
  }
  return old ? { tooOld: old } : null;
}

// The newest long-term release that has a zip for this system: { version, name, url } or null. nodejs.org's own
// list says which releases have which builds (the newest ones have dropped 32-bit Windows).
function pickRelease(index, arch = process.arch) {
  const kind = { x64: 'x64', ia32: 'x86', arm64: 'arm64' }[arch];
  if (!kind) return null;
  const hit = (index || []).filter((r) => r.lts && (r.files || []).includes(`win-${kind}-zip`))
    .sort((a, b) => {
      const [x, y] = [parseVersion(b.version), parseVersion(a.version)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    })[0];
  if (!hit) return null;
  const name = `node-${hit.version}-win-${kind}.zip`;
  return { version: hit.version, name, url: `${DIST}/${hit.version}/${name}`, sums: `${DIST}/${hit.version}/SHASUMS256.txt` };
}

// the checksum of a file out of nodejs.org's SHASUMS256.txt
function checksumOf(text, name) {
  const line = String(text).split(/\r?\n/).find((l) => l.trim().endsWith(` ${name}`));
  const sum = line && /^([0-9a-f]{64})\s/i.exec(line.trim());
  return sum ? sum[1].toLowerCase() : '';
}

// Fetches the portable Node into `dir` (Windows). Resolves { exe, dir, version }; throws with what went wrong.
async function install({ dir, arch = process.arch, fetchFn = (...a) => fetch(...a), onProgress, signal, tmp = os.tmpdir() } = {}) {
  const res = await fetchFn(`${DIST}/index.json`, { signal, redirect: 'follow' });
  if (!res.ok) throw new Error(`nodejs.org answered ${res.status}`);
  const rel = pickRelease(await res.json(), arch);
  if (!rel) throw new Error(`nodejs.org has no Node for ${arch} Windows`);
  const sums = await fetchFn(rel.sums, { signal, redirect: 'follow' });
  const sha256 = sums.ok ? checksumOf(await sums.text(), rel.name) : '';
  if (!sha256) throw new Error(`nodejs.org gave no checksum for ${rel.name}`);
  const file = path.join(tmp, `capri-${process.pid}-${rel.name}`);
  try {
    await download(rel.url, file, { onProgress, signal, fetchFn, sha256 });
    fs.rmSync(dir, { recursive: true, force: true });
    await unzip(file, dir);
  } finally {
    fs.rmSync(file, { force: true });
  }
  const exe = findFile(dir, ['node.exe'], { depth: 2 });
  if (!exe) throw new Error(`${rel.name} unpacked, but it has no node.exe in it`);
  return { exe, dir: path.dirname(exe), version: rel.version.replace(/^v/, '') };
}

// Runs a PowerShell script that changes your account's PATH (nothing shown, nothing asked)
function changeUserPath(lines, spawnSync) {
  const script = lines.join('; ');
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    return { ok: r.status === 0, error: r.status === 0 ? '' : String(r.stderr || r.stdout).slice(0, 200) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Adds a folder to the PATH of your account (yours only, no administrator; new programs see it), and to hers now.
function addToUserPath(folder, { platform = process.platform, spawnSync = cp.spawnSync, env = process.env } = {}) {
  env.PATH = `${folder}${path.delimiter}${env.PATH || ''}`;
  if (platform !== 'win32') return { ok: false, error: 'Windows only' };
  return changeUserPath([
    `$d = '${folder.replace(/'/g, "''")}'`,
    "$p = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "if (-not (($p -split ';') -contains $d)) { [Environment]::SetEnvironmentVariable('Path', ((($p + ';' + $d) -replace '^;+', '') -replace ';{2,}', ';'), 'User') }",
  ], spawnSync);
}

// Takes a folder, and every PATH entry inside it, out of the PATH of your account again (what addToUserPath put in:
// the folder with node.exe, a level down in hers), and out of hers.
function removeFromUserPath(folder, { platform = process.platform, spawnSync = cp.spawnSync, env = process.env } = {}) {
  const lower = folder.replace(/[\\/]+$/, '').toLowerCase();
  const within = (p) => {
    const q = String(p).replace(/[\\/]+$/, '').toLowerCase();
    return q === lower || q.startsWith(`${lower}\\`) || q.startsWith(`${lower}/`);
  };
  env.PATH = String(env.PATH || '').split(path.delimiter).filter((p) => p && !within(p)).join(path.delimiter);
  if (platform !== 'win32') return { ok: false, error: 'Windows only' };
  return changeUserPath([
    `$d = '${folder.replace(/[\\/]+$/, '').replace(/'/g, "''")}'.ToLower()`,
    "$p = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "if ($p) { [Environment]::SetEnvironmentVariable('Path', (($p -split ';' | Where-Object { $_ -and -not (($_.TrimEnd('\\','/').ToLower() -eq $d) -or ($_.ToLower().StartsWith($d + '\\'))) }) -join ';'), 'User') }",
  ], spawnSync);
}

// The command that runs a script with Node: `node` when it is on the PATH, else the path of the one she found
// (quoted), else null. For the hooks of the assistants.
function nodeCommand({ spawnSync = cp.spawnSync, env = process.env, platform = process.platform, exists = fs.existsSync } = {}) {
  if (goodEnough(versionOf('node', { spawnSync }))) return 'node';
  for (const exe of knownPlaces(platform, env)) if (exists(exe) && goodEnough(versionOf(exe, { spawnSync }))) return /\s/.test(exe) ? `"${exe}"` : exe;
  return null;
}

module.exports = { findNode, pickRelease, checksumOf, install, addToUserPath, removeFromUserPath, nodeCommand, parseVersion, knownPlaces, versionOf, MIN_MAJOR };
