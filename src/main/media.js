'use strict';

// What's playing on the PC (Windows), for her little life (life.js): she puts headphones on and
// bobs her head, says what she thinks of the track, and in DJ mode skips one now and then.
// A small PowerShell helper (media.ps1) asks Windows' media controls; nothing but the title, the
// artist and the app goes to the overlay, and it stays on this PC.

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'media.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// onUpdate({ app, title, artist, playing }) whenever it changes ({} when nothing plays)
function startMediaWatch({ onUpdate }) {
  if (process.platform !== 'win32') return { stop() {} };
  let child = null;
  let stopped = false;
  let restarts = 0;

  const start = () => {
    if (stopped) return; // stopped while a restart was pending
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, String(process.pid),
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let now;
      try {
        now = JSON.parse(line);
      } catch {
        return;
      }
      if (stopped) return;
      const app = String(now.app || '');
      onUpdate(app || now.title ? {
        app: app.replace(/\.exe$/i, '').split(/[!\\/]/).pop(),
        title: String(now.title || '').slice(0, 120),
        artist: String(now.artist || '').slice(0, 120),
        playing: /playing/i.test(String(now.status || '')),
      } : {});
    });
    child.stderr.on('data', (d) => console.error('[capri] media watch:', String(d).trim()));
    child.on('exit', () => {
      child = null;
      if (!stopped && restarts++ < 3) setTimeout(start, 5000);
    });
  };

  start();
  return {
    stop() {
      stopped = true;
      child?.kill();
    },
  };
}

module.exports = { startMediaWatch };
