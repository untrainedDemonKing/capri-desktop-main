'use strict';

// setup.js (src/main/setup/setup.js) needs electron's safeStorage, for the keys; under plain Node there is no electron to ask (on a PC
// without the electron package the require fails), so it is loaded with a stand-in for it.

const os = require('node:os');
const Module = require('node:module');

module.exports = function loadSetup() {
  const realLoad = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'electron') return { safeStorage: {}, app: { getPath: () => os.tmpdir() } };
    return realLoad.call(this, request, ...rest);
  };
  try {
    return require('../../src/main/setup/setup.js');
  } finally {
    Module._load = realLoad;
  }
};
