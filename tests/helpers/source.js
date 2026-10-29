'use strict';

// Where a source file lies, by its name: the tests ask for 'chat.js' and need not know which folder of the tree it is in.
//   rendererFile('chat.js')   -> src/renderer/js/talk/chat.js
//   mainFile('control.js')    -> src/main/system/control.js
// (hub.js and prepare.js exist in both trees, which is why there are two lookups.)

const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');

function index(root) {
  const found = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (found.has(e.name)) throw new Error(`two files called ${e.name} under ${root}`);
      else found.set(e.name, full);
    }
  };
  walk(root);
  return found;
}

const trees = {};
const lookup = (tree, root) => (name) => {
  trees[tree] ||= index(root);
  const file = trees[tree].get(name);
  if (!file) throw new Error(`no ${name} under ${root}`);
  return file;
};

module.exports = {
  mainFile: lookup('main', path.join(SRC, 'main')),
  rendererFile: lookup('renderer', path.join(SRC, 'renderer', 'js')),
  root: path.join(__dirname, '..', '..'),
};
