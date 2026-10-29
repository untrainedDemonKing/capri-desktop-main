'use strict';

// What is taken out of every file before it is packed: the name of the user and the PC, the home folder, addresses of the local
// network, passwords in an address. The check never reads a key, a chat or a setting of Capri's, so there are none of those; this is
// for the places that show up in paths and in what programs print.

const os = require('node:os');

const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function makeRedactor({ home = os.homedir(), user = safe(() => os.userInfo().username), host = os.hostname(), extra = [] } = {}) {
  const rules = [];
  const add = (re, to) => rules.push([re, to]);
  // the home folder first, in the ways it is written (backslashes, slashes, doubled backslashes in JSON, 8.3 short names)
  if (home && home.length > 3) {
    const parts = home.split(/[\\/]+/).filter(Boolean);
    const sep = '[\\\\/]+';
    add(new RegExp((/^[\\/]/.test(home) ? sep : '') + parts.map(escape).join(sep), 'gi'), '~');
  }
  if (user && user.length >= 3) {
    const u = escape(user);
    add(new RegExp(`([\\\\/]Users[\\\\/]+)${u}(?![\\w.-])`, 'gi'), '$1<user>');
    add(new RegExp(`([\\\\/]home[\\\\/]+)${u}(?![\\w.-])`, 'gi'), '$1<user>');
    add(new RegExp(`(?<![\\w.-])${u}(?![\\w.-])`, 'gi'), '<user>');
  }
  if (host && host.length >= 3) add(new RegExp(`(?<![\\w.-])${escape(host)}(?![\\w.-])`, 'gi'), '<pc>');
  for (const e of extra) if (e && String(e).length >= 3) add(new RegExp(escape(e), 'gi'), '<hidden>');
  // a name and a password in an address
  add(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1<hidden>@');
  // addresses of the local network (the loopback ones stay: they are what the tests talk to)
  add(/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g, 'x.x.x.x');
  // MAC addresses
  add(/\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/gi, 'xx:xx:xx:xx:xx:xx');
  // Windows security identifiers
  add(/\bS-1-5-21(?:-\d+){3,4}\b/g, 'S-1-5-21-<hidden>');
  // keys that look like keys (nothing here reads one; if one is printed by a program it does not leave)
  add(/\b(?:sk-[A-Za-z0-9_-]{16,}|gsk_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,})\b/g, '<key>');
  return (text) => {
    let t = String(text);
    for (const [re, to] of rules) t = t.replace(re, to);
    return t;
  };
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return '';
  }
}

module.exports = { makeRedactor };
