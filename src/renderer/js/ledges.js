// Where she can sit, and where she lands: the top edges of the windows (and the taskbar), seen from where
// the watcher last told they are (windows.js). Plain functions of the windows, the view and her size, so
// that how she follows a window, falls off it or lands is tested without a screen (tests/ledges.test.js).
//
// A window is { id, x, y, w, h, max } in the overlay's pixels, the front one first. The view is
// { w, h, floor }: floor is the top of the taskbar. Her position is her feet.

import { SPRITE } from './sprite.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const HIP_DROP = (scale) => (SPRITE.feet.y - SPRITE.hip) * scale; // from her hips to her feet

// Where her feet go so that her hips rest on the window's top edge.
export function seat(win, dx, scale) {
  return { x: win.x + dx, y: win.y + 3 + HIP_DROP(scale) };
}

// The top of the taskbar (the bottom of her screen), as a ledge like a window's: her legs hang down over it.
export function taskbar(view) {
  return { id: 'taskbar', x: 0, y: view.floor, w: view.w, h: view.h - view.floor, max: false };
}

// A window has to be a real one (not maximized), wide enough, with room above it for her and room below.
export function canSit(win, view, scale) {
  if (win.id === 'taskbar') return true;
  const roomAbove = SPRITE.hip * scale + 12;
  return !win.max && win.w > 260 && win.y > roomAbove && win.y < view.floor - 80;
}

// Is her spot on that ledge hidden under a window that is above it?
export function covered(win, x, wins, scale) {
  if (win.id === 'taskbar') return false; // nothing goes over the taskbar
  const half = 34 * scale;
  for (const o of wins) {
    if (o === win || o.id === win.id) return false; // reached it: everything after is below
    if (o.x < x + half && o.x + o.w > x - half && o.y <= win.y && o.y + o.h >= win.y) return true;
  }
  return false; // window not in the list any more
}

// What she is perched on, from its id: a window, or the taskbar (undefined: it is gone)
export function find(id, wins, view) {
  return id === 'taskbar' ? taskbar(view) : wins.find((w) => w.id === id);
}

// Where she sits now that the windows are as they are: { pos } to ride along with her window (pos is where
// her feet go), or { fall: true } when her ledge is gone (closed, minimized, maximized, covered, or moved
// where nobody can sit).
export function follow(perch, wins, view, scale) {
  const win = find(perch.id, wins, view);
  if (!win) return { fall: true };
  // (along the window, but where she can be seen: a window dragged half off the screen keeps her on its visible part)
  const lo = Math.max(50, 60 - win.x);
  const hi = Math.min(win.w - 60, view.w - 60 - win.x);
  if (lo > hi) return { fall: true }; // nothing of it to sit on is on the screen
  const dx = clamp(perch.dx, lo, hi);
  if (!canSit(win, view, scale) || covered(win, win.x + dx, wins, scale)) return { fall: true };
  return { pos: seat(win, dx, scale) };
}

// Where she ends up falling straight down from `pos`: a free ledge under her, or the floor. `except`: the
// ledge she just hopped off (it is right at her hips: she would land on it at once).
export function landing(pos, wins, view, scale, except = null) {
  const hip = pos.y - HIP_DROP(scale);
  let best = null;
  for (const win of wins) {
    if (win.id === except || !canSit(win, view, scale) || win.y < hip - 4) continue;
    if (pos.x < win.x + 40 || pos.x > win.x + win.w - 40) continue;
    if (covered(win, pos.x, wins, scale)) continue;
    if (!best || win.y < best.y) best = win;
  }
  if (best) {
    const dx = pos.x - best.x;
    return { y: seat(best, dx, scale).y, stance: 'sit', perch: { id: best.id, dx } };
  }
  return { y: view.floor - 6, stance: 'stand', perch: null };
}

// A ledge for her to be dropped onto: her hips within 26 px of the top edge of a window she could sit on.
export function dropOnto(pos, wins, view, scale) {
  const hip = pos.y - HIP_DROP(scale);
  for (const win of wins) {
    if (!canSit(win, view, scale) || Math.abs(hip - win.y) > 26) continue;
    if (pos.x < win.x + 40 || pos.x > win.x + win.w - 40 || covered(win, pos.x, wins, scale)) continue;
    const dx = pos.x - win.x;
    return { pos: seat(win, dx, scale), perch: { id: win.id, dx } };
  }
  return null;
}
