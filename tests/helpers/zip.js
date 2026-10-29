'use strict';

// Zip files for the tests, written here in Node (no Python needed: a Windows PC that runs the tests has none, as a rule).
//   writeZip(file, { 'dir/': '', 'dir/a.txt': 'text', '../x': 'a name that leaves the folder' })
//   zipFolder(folder, file)   every file under a folder, with names relative to it

const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../../selftest/lib/zip.js');

function writeZip(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const list = Object.entries(entries).map(([name, body]) => ({ name, data: Buffer.from(body) }));
  fs.writeFileSync(file, build(list));
  return file;
}

function zipFolder(folder, file) {
  const entries = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else entries[path.relative(folder, full).split(path.sep).join('/')] = fs.readFileSync(full);
    }
  };
  walk(folder);
  return writeZip(file, entries);
}

module.exports = { writeZip, zipFolder };
