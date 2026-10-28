'use strict';

// Getting files for her: a download that says how far it is and can be stopped, and unpacking the archives
// the downloads come in (a .zip in plain Node, so it works on every Windows; a .tar.gz with `tar`).

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { once } = require('node:events');
const { pipeline } = require('node:stream/promises');

const PART = '.part';

// Downloads `url` to `dest` (through dest + '.part', so a stopped download leaves no half file under the real
// name). onProgress({ completed, total }) as it comes (total 0 when the server does not say). md5 or sha256: the
// hash the file must have. Resolves { bytes }.
async function download(url, dest, { onProgress, signal, fetchFn = (...a) => fetch(...a), md5 = '', sha256 = '' } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetchFn(url, { redirect: 'follow', signal });
  if (!res.ok || !res.body) throw new Error(`${new URL(url).host} answered ${res.status} for ${path.basename(new URL(url).pathname)}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const part = dest + PART;
  const out = fs.createWriteStream(part);
  const algorithm = sha256 ? 'sha256' : md5 ? 'md5' : '';
  const expected = (sha256 || md5).toLowerCase();
  const hash = algorithm ? crypto.createHash(algorithm) : null;
  let got = 0;
  let shown = -1;
  try {
    for await (const chunk of res.body) {
      hash?.update(chunk);
      if (!out.write(chunk)) await once(out, 'drain');
      got += chunk.length;
      const step = total ? Math.floor((got / total) * 100) : Math.floor(got / 1048576);
      if (step !== shown) {
        shown = step;
        onProgress?.({ completed: got, total });
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    if (total && got !== total) throw new Error(`the download stopped at ${got} of ${total} bytes`);
    if (hash && hash.digest('hex') !== expected) throw new Error(`${path.basename(dest)} arrived damaged (the checksum differs)`);
    fs.renameSync(part, dest);
  } catch (err) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw err;
  }
  onProgress?.({ completed: got, total: total || got });
  return { bytes: got };
}

// Unpacks a .zip into `dest`: the central directory is read from the end of the file, each file is streamed out
// (stored or deflated), a path that leaves `dest` is refused. Big archives are fine: nothing is read whole.
async function unzip(file, dest, { onProgress } = {}) {
  const root = path.resolve(dest);
  fs.mkdirSync(root, { recursive: true });
  const fd = await fs.promises.open(file, 'r');
  try {
    const { size } = await fd.stat();
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    await fd.read(tail, 0, tailLen, size - tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error(`${path.basename(file)} is not a zip file`);
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('a zip64 archive: not supported');
    const cd = Buffer.alloc(cdSize);
    await fd.read(cd, 0, cdSize, cdOffset);
    const entries = [];
    for (let p = 0, i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('the zip directory is damaged');
      const nameLen = cd.readUInt16LE(p + 28);
      entries.push({
        method: cd.readUInt16LE(p + 10),
        csize: cd.readUInt32LE(p + 20),
        usize: cd.readUInt32LE(p + 24),
        offset: cd.readUInt32LE(p + 42),
        name: cd.toString('utf8', p + 46, p + 46 + nameLen),
      });
      p += 46 + nameLen + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32);
    }
    const totalBytes = entries.reduce((n, e) => n + e.usize, 0);
    let done = 0;
    for (const e of entries) {
      const target = path.resolve(root, e.name);
      if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`the zip has a path outside its folder: ${e.name}`);
      if (e.name.endsWith('/')) {
        fs.mkdirSync(target, { recursive: true });
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (e.usize === 0) {
        fs.writeFileSync(target, '');
        continue;
      }
      const head = Buffer.alloc(30);
      await fd.read(head, 0, 30, e.offset);
      const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      const source = fs.createReadStream(file, { start, end: start + e.csize - 1 });
      if (e.method === 8) await pipeline(source, zlib.createInflateRaw(), fs.createWriteStream(target));
      else if (e.method === 0) await pipeline(source, fs.createWriteStream(target));
      else throw new Error(`the zip uses a compression she cannot open (${e.method}): ${e.name}`);
      done += e.usize;
      onProgress?.({ completed: done, total: totalBytes });
    }
  } finally {
    await fd.close();
  }
}

// Unpacks a .tar.gz into `dest` (tar is on Linux, macOS and Windows 10)
function untar(file, dest, { execFile = cp.execFile } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xzf', file, '-C', dest], { windowsHide: true, timeout: 10 * 60 * 1000 }, (err, _out, stderr) => (
      err ? reject(new Error(`tar could not unpack ${path.basename(file)}: ${String(stderr || err.message).slice(0, 200)}`)) : resolve()));
  });
}

const extract = (file, dest, opts) => (/\.zip$/i.test(file) ? unzip(file, dest, opts) : untar(file, dest, opts));

// the first file called one of `names` in `root` or a few folders under it, shortest path first
function findFile(root, names, { depth = 3, fsx = fs } = {}) {
  const wanted = names.map((n) => n.toLowerCase());
  const queue = [[root, 0]];
  while (queue.length) {
    const [dir, level] = queue.shift();
    let entries = [];
    try {
      entries = fsx.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const hit = entries.find((e) => !e.isDirectory() && wanted.includes(e.name.toLowerCase()));
    if (hit) return path.join(dir, hit.name);
    if (level < depth) for (const e of entries) if (e.isDirectory() && !/^(node_modules|\.git|__pycache__)$/.test(e.name)) queue.push([path.join(dir, e.name), level + 1]);
  }
  return null;
}

module.exports = { download, unzip, untar, extract, findFile };
