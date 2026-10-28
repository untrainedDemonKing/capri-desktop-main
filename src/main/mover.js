'use strict';

// Moving the windows she has taken over (Windows). When she possesses a window she can shake it, carry it about
// the screen, bounce it, and puts it back where it was. A small PowerShell helper (mover.ps1) does the Win32 call;
// this decides whether it is allowed and keeps it safe:
//
// - only a window she has just been given by the window watcher (a visible, normal, not-maximised one), only
//   with "Possess my windows" and "Move the windows" both on, and only one window at a time;
// - it is only ever moved: never resized, raised or activated;
// - if you take hold of the window yourself (it is not where she put it last), she lets go at once and never
//   puts it back over you;
// - whatever happens (the page stops talking for a moment, she closes), the window is put back where it was.

const path = require('node:path');
const cp = require('node:child_process');

// in the installed app it sits next to the app archive (asarUnpack), where PowerShell can read it
const SCRIPT = path.join(__dirname, 'mover.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const SILENT_MS = 2500; // no word from the page this long while a window is held: put it back

const whole = (n) => Number.isFinite(n) && Math.abs(n) < 100000;

/**
 * @param {object} o
 * @param {object} o.screen     Electron's screen (dipToScreenRect)
 * @param {() => {x:number,y:number,width:number,height:number}} o.bounds  the overlay's bounds (DIP)
 * @param {() => ({wins: Array<{id:number,x:number,y:number,w:number,h:number,max:boolean}>}|null)} o.windows  the watcher's last look (overlay DIP)
 * @param {() => boolean} o.enabled   both settings on
 * @param {(id:number, why:string) => void} [o.onLost]  she let go of a window (it was taken from her, or it is gone)
 */
function createMover({ screen, bounds, windows, enabled, onLost = () => {}, spawn = cp.spawn, platform = process.platform, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let child = null;
  let active = null;   // { id, home: {x, y, w, h} (DIP, the window as it was), lost: false }
  let inflight = false; // a command is out and its answer has not come
  let queued = null;   // the newest position asked for while one was out
  let watchdog = null;
  let buffer = '';

  const physical = (x, y, w, h) => {
    const b = bounds();
    const r = screen.dipToScreenRect(null, { x: Math.round(x + b.x), y: Math.round(y + b.y), width: Math.round(w), height: Math.round(h) });
    return { x: Math.round(r.x), y: Math.round(r.y) };
  };

  function ensureHelper() {
    if (child) return true;
    if (platform !== 'win32') return false;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      child = null;
      return false;
    }
    const mine = child;
    mine.stdout.on('data', (d) => {
      buffer += d;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line) answered(line);
      }
    });
    mine.stderr?.on('data', () => {});
    mine.on('error', () => dropHelper(mine));
    mine.on('exit', () => dropHelper(mine));
    return true;
  }

  function dropHelper(which) {
    if (child !== which) return;
    child = null;
    inflight = false;
    queued = null;
    buffer = '';
    if (active) lose('helper');
  }

  function send(line) {
    if (!child) return false;
    try {
      child.stdin.write(`${line}\n`);
      return true;
    } catch {
      return false;
    }
  }

  // an answer from the helper: "OK 123", "LOST 123", "GONE 123", "DENIED 123"
  function answered(line) {
    const [what, id] = line.split(' ');
    inflight = false;
    if (what !== 'OK' && active && String(active.id) === id) lose(what.toLowerCase());
    if (queued && active && !active.lost) {
      const next = queued;
      queued = null;
      push(next.x, next.y);
    }
  }

  // she lets go: it is not hers to move any more (and is not put back)
  function lose(why) {
    if (!active) return;
    const { id } = active;
    active.lost = true;
    clearTimer(watchdog);
    watchdog = null;
    queued = null;
    if (child) send(`E ${id}`);
    active = null;
    onLost(id, why);
  }

  function push(x, y) {
    if (!active || active.lost || !child) return;
    const p = physical(x, y, active.home.w, active.home.h);
    inflight = true;
    if (!send(`M ${active.id} ${p.x} ${p.y}`)) {
      inflight = false;
      lose('helper');
    }
  }

  function arm() {
    clearTimer(watchdog);
    watchdog = setTimer(() => {
      watchdog = null;
      release(active?.id, { restore: true });
    }, SILENT_MS);
    watchdog.unref?.();
  }

  // Takes hold of a window: { ok: true } or { ok: false, why }.
  function grab(id) {
    if (platform !== 'win32') return { ok: false, why: 'nowin' };
    if (!enabled()) return { ok: false, why: 'off' };
    if (active) release(active.id, { restore: true });
    const win = windows()?.wins?.find((w) => w.id === id);
    if (!win) return { ok: false, why: 'unknown' };
    if (win.max) return { ok: false, why: 'maximised' };
    if (![win.x, win.y, win.w, win.h].every(whole)) return { ok: false, why: 'unknown' };
    if (!ensureHelper()) return { ok: false, why: 'helper' };
    active = { id, home: { x: win.x, y: win.y, w: win.w, h: win.h }, lost: false };
    arm();
    return { ok: true };
  }

  // Puts the window's top-left (the visible frame's, in the overlay's DIP) at x, y. Newest position wins.
  function move(id, x, y) {
    if (!active || active.id !== id || active.lost || !whole(x) || !whole(y)) return false;
    arm();
    if (inflight) queued = { x, y };
    else push(x, y);
    return true;
  }

  // Done with the window: back where it was (unless you took it), and let go.
  function release(id, { restore = true } = {}) {
    if (!active || active.id !== id) return false;
    const { home } = active;
    clearTimer(watchdog);
    watchdog = null;
    queued = null;
    if (restore && !active.lost && child) {
      const p = physical(home.x, home.y, home.w, home.h);
      send(`M ${id} ${p.x} ${p.y}`);
    }
    if (child) send(`E ${id}`);
    active = null;
    return true;
  }

  function stop() {
    if (active) release(active.id, { restore: true });
    const mine = child;
    child = null;
    try {
      mine?.stdin.end();
    } catch {
      // gone already
    }
  }

  return { grab, move, release, stop, isHolding: () => Boolean(active), SILENT_MS };
}

module.exports = { createMover, SCRIPT, SILENT_MS };
