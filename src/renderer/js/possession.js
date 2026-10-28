// How she moves a window she has taken over (capri.js possess()). Each move is a path for the window's
// top-left corner: a function of time that starts and ends at (0, 0) (the window is put back where it was)
// and never takes it off the screen. Pure functions, no DOM: tests/possession.test.js plays them.
//
//   const move = make('drag', room, rng);   // { name, ms, at(t) -> { dx, dy } }
//
// `room`: how far the window can go from where it is, { left, right, up, down } in pixels, none negative
// (roomFor() works it out from the window and the screen).

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t); // 0..1 eased in and out
const ramp = (t, ms, edge) => clamp(Math.min(t, ms - t) / edge, 0, 1); // 0 at both ends, 1 in the middle

// the room a window has on the screen: its sides' distance to the screen's edges (the floor: the top of the taskbar)
export function roomFor(win, view) {
  return {
    left: Math.max(0, win.x),
    right: Math.max(0, view.w - (win.x + win.w)),
    up: Math.max(0, win.y),
    down: Math.max(0, view.floor - (win.y + win.h)),
  };
}

// keeps an offset inside the room
export function inside(o, room) {
  return { dx: clamp(o.dx, -room.left, room.right), dy: clamp(o.dy, -room.up, room.down) };
}

const MIN_ROOM = 60; // a window with less room than this (a nearly full-screen one) is not worth moving

// the moves a window with this room can be given
export function available(room) {
  const wide = room.left + room.right, high = room.up + room.down;
  if (Math.max(wide, high) < MIN_ROOM) return [];
  const out = ['shake'];
  if (wide >= MIN_ROOM) out.push('sway', 'dance');
  if (Math.max(room.left, room.right, room.up, room.down) >= 90) out.push('drag');
  if (Math.max(wide, high) >= 140) out.push('puck');
  if (room.up >= 70) out.push('bounce');
  return out;
}

// a path that is sampled: built once by stepping a simulation, then read at any time
function sampled(name, ms, step, sim) {
  const n = Math.ceil(ms / step);
  const pts = Array.from({ length: n + 1 }, (_, i) => sim(i * step));
  return {
    name,
    ms,
    at(t) {
      const f = clamp(t, 0, ms) / step;
      const i = Math.min(n - 1, Math.floor(f));
      const k = f - i;
      return { dx: lerp(pts[i].dx, pts[i + 1].dx, k), dy: lerp(pts[i].dy, pts[i + 1].dy, k) };
    },
  };
}

const MOVES = {
  // trembling, as if something were trying to get out: quick small jolts that die away
  shake(room, rng) {
    const ms = 1500;
    const A = Math.min(13, Math.max(room.left + room.right, room.up + room.down) / 2);
    const [p, q] = [rng() * TAU, rng() * TAU];
    return {
      name: 'shake', ms,
      at: (t) => {
        const env = ramp(t, ms, 140) * (1 - t / ms);
        const dx = A * env * (Math.sin(TAU * 11 * (t / 1000) + p) + 0.6 * Math.sin(TAU * 27 * (t / 1000) + q)) / 1.6;
        const dy = A * 0.6 * env * (Math.sin(TAU * 13 * (t / 1000) + q) + 0.5 * Math.sin(TAU * 31 * (t / 1000) + p)) / 1.5;
        return inside({ dx, dy }, room);
      },
    };
  },

  // rocked like a boat: slow, wide, a little up and down
  sway(room, rng) {
    const ms = 2400;
    const A = Math.min(34, (room.left + room.right) / 2.2);
    const lean = rng() < 0.5 ? 1 : -1;
    return {
      name: 'sway', ms,
      at: (t) => {
        const u = t / ms;
        const env = Math.sin(Math.PI * u) ** 0.6;
        return inside({ dx: lean * A * env * Math.sin(TAU * 2 * u), dy: -A * 0.22 * env * Math.abs(Math.sin(TAU * 2 * u)) }, room);
      },
    };
  },

  // dances: a figure of eight, two times round
  dance(room) {
    const ms = 2600;
    const R = Math.min(48, (room.left + room.right) / 2.4, Math.max(20, (room.up + room.down) / 2.4));
    return {
      name: 'dance', ms,
      at: (t) => {
        const u = t / ms;
        const env = smooth(clamp(Math.min(u, 1 - u) / 0.15, 0, 1));
        return inside({ dx: R * env * Math.sin(TAU * 2 * u), dy: R * 0.55 * env * Math.sin(TAU * 4 * u) }, room);
      },
    };
  },

  // carried off: across the screen, held there shaking a little, and brought back
  drag(room, rng) {
    const sides = [['left', -1, 0], ['right', 1, 0], ['up', 0, -1], ['down', 0, 1]];
    const best = Math.max(...sides.map(([k]) => room[k]));
    const roomy = sides.filter(([k]) => room[k] >= best * 0.6); // any of the sides with about the most room
    const [key, ux, uy] = roomy[Math.floor(rng() * roomy.length)];
    const D = Math.min(300, room[key] * 0.9);
    const ms = 2300;
    return {
      name: 'drag', ms,
      at: (t) => {
        const out = 950, hold = 380, back = ms - out - hold;
        const k = t < out ? smooth(t / out) : t < out + hold ? 1 : 1 - smooth((t - out - hold) / back);
        const wob = t < out ? Math.sin((t / out) * Math.PI) : t < out + hold ? 0.5 : 0;
        const side = Math.sin(TAU * 4 * (t / 1000)) * 7 * (wob > 0 ? Math.max(wob, 0.3) : 0);
        return inside({ dx: ux * D * k + (uy ? side : 0), dy: uy * D * k + (ux ? side : 0) }, room);
      },
    };
  },

  // hops like a ball, lower each time
  bounce(room) {
    const heights = [100, 62, 30].map((h) => Math.min(h, room.up * 0.9));
    const hop = 520, gap = 70;
    const ms = heights.length * (hop + gap);
    return {
      name: 'bounce', ms,
      at: (t) => {
        const i = Math.min(heights.length - 1, Math.floor(t / (hop + gap)));
        const u = (t - i * (hop + gap)) / hop;
        const arc = u >= 0 && u <= 1 ? 4 * u * (1 - u) : 0;
        return inside({ dx: 0, dy: -heights[i] * arc }, room);
      },
    };
  },

  // shoved like a puck: slides off, bounces off the edges of the screen, slows, and is brought back
  puck(room, rng) {
    const ang = rng() * TAU;
    const speed = 1150; // px/s at the shove
    const slide = 1900, home = 800;
    const ms = slide + home;
    const step = 16;
    let x = 0, y = 0, vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed * 0.6;
    const trail = [];
    for (let t = 0; t <= slide; t += step) {
      trail.push({ dx: x, dy: y });
      const f = Math.exp(-step / 650);
      vx *= f; vy *= f;
      x += (vx * step) / 1000; y += (vy * step) / 1000;
      if (x < -room.left) { x = -room.left; vx = Math.abs(vx) * 0.8; }
      if (x > room.right) { x = room.right; vx = -Math.abs(vx) * 0.8; }
      if (y < -room.up) { y = -room.up; vy = Math.abs(vy) * 0.8; }
      if (y > room.down) { y = room.down; vy = -Math.abs(vy) * 0.8; }
    }
    const end = trail[trail.length - 1];
    return sampled('puck', ms, step, (t) => {
      if (t <= slide) return trail[Math.min(trail.length - 1, Math.round(t / step))];
      const k = smooth(clamp((t - slide) / home, 0, 1));
      return { dx: lerp(end.dx, 0, k), dy: lerp(end.dy, 0, k) };
    });
  },
};

// a move by name for a window with this room (null if it has no such move or no room for it)
export function make(name, room, rng = Math.random) {
  if (!MOVES[name] || !available(room).includes(name)) return null;
  return MOVES[name](room, rng);
}

