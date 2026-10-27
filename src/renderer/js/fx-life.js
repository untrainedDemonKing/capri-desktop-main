// The marks of her moods and the props of what she's busy with, on the effect layer (fx.js).
// Same rules as everything else there: flat colours, a violet misregistered copy under each
// shape, drawn on whole frames, moves stepped like cels (nothing glides).
//
// Anchors can be points or functions returning one, so a mark can follow her around.

import { COLORS } from './fx.js';

const PINK = '#ff6fae';
const FRAME_MS = 1000 / 24;
const at = (anchor) => (typeof anchor === 'function' ? anchor() : anchor);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const step = (t, n) => Math.floor(t * n) / n; // t in n drawings

// Something drawn twice: its violet copy down-left, then itself.
function twice(ctx, draw, color, dx = -2, dy = 2) {
  draw(dx, dy, COLORS.violet);
  draw(0, 0, color);
}

// ---------- her moods ----------

// The anime anger mark: four bulging corners around a cross, pulsing. `anchor`: near her head.
export function vein(fx, anchor, { size = 1, life = 1500 } = {}) {
  return fx.add({
    type: 'life', life,
    render(ctx, t) {
      const p = at(anchor);
      if (!p) return;
      const frame = Math.floor((t * life) / FRAME_MS);
      // pops in big, then throbs on threes
      const k = (frame < 2 ? 1.45 : frame % 6 < 3 ? 1 : 1.18) * size * (t > 0.85 ? 1 - step((t - 0.85) / 0.15, 3) : 1);
      const S = 19 * k, g = 5 * k;
      ctx.lineCap = 'round';
      const mark = (dx, dy, color, width) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          ctx.beginPath();
          ctx.moveTo(p.x + dx + sx * g, p.y + dy + sy * S);
          ctx.quadraticCurveTo(p.x + dx + sx * g, p.y + dy + sy * g, p.x + dx + sx * S, p.y + dy + sy * g);
          ctx.stroke();
        }
      };
      // an ink outline so it reads over her red mane, her violet copy, then the mark, a white glint
      const w = Math.max(2, 4.2 * k);
      mark(-2, 2, COLORS.violet, w + 4);
      mark(0, 0, COLORS.ink, w + 4);
      mark(0, 0, '#ff3b2f', w);
      mark(0, 0, COLORS.paper, Math.max(1, w * 0.25));
    },
  });
}

// A word or a sign floating up and away ("ХА", "!?", "хмф", "♪", "zzZ"...).
export function word(fx, x, y, text, { color = COLORS.paper, size = 18, life = 1000, rise = 40, drift = 0, wobble = 0, font = null } = {}) {
  return fx.add({
    type: 'life', life,
    render(ctx, t) {
      const k = step(t, 8);
      const px = Math.round(x + drift * k + (wobble ? Math.sin(k * 12) * wobble : 0));
      const py = Math.round(y - rise * k);
      const pop = k < 0.12 ? 1.3 : 1;
      ctx.globalAlpha = t > 0.75 ? 1 - step((t - 0.75) / 0.25, 3) : 1;
      ctx.font = font || `700 ${Math.round(size * pop)}px "Chakra Petch", "JetBrains Mono", sans-serif`;
      ctx.textAlign = 'center';
      twice(ctx, (dx, dy, c) => {
        ctx.fillStyle = c;
        ctx.fillText(text, px + dx, py + dy);
      }, color);
    },
  });
}

// "ХА ХА" (or "HA HA") bursting out around her head as she laughs.
export function haha(fx, head, { lang = 'en', count = 2 } = {}) {
  const ha = lang === 'ru' ? 'ХА' : lang === 'fr' ? 'HA' : lang === 'es' || lang === 'pt' ? 'JA' : 'HA';
  for (let i = 0; i < count; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    word(fx, head.x + side * rand(40, 90), head.y - rand(20, 70), ha, {
      color: pick([COLORS.paper, COLORS.red, PINK]), size: rand(16, 26), life: rand(700, 1000), rise: rand(30, 60), drift: side * rand(10, 30),
    });
  }
}

// Blushing: pink hatching on both cheeks, flickering.
export function blush(fx, anchor, { scale = 1, life = 2400 } = {}) {
  return fx.add({
    type: 'life', life,
    render(ctx, t) {
      const p = at(anchor);
      if (!p) return;
      const frame = Math.floor((t * life) / FRAME_MS);
      if (t > 0.8 && frame % 2) return; // flickers out
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, 2.6 * scale);
      const jitter = frame % 4 < 2 ? 0 : 1;
      for (const side of [-1, 1]) {
        const cx = p.x + side * 26 * scale, cy = p.y + 10 * scale + jitter;
        const hatch = (color, width) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(cx + i * 6 * scale - 3 * scale, cy + 5 * scale);
            ctx.lineTo(cx + i * 6 * scale + 3 * scale, cy - 5 * scale);
            ctx.stroke();
          }
        };
        // inked, so the pink reads over her red
        hatch(COLORS.ink, Math.max(3, 4.6 * scale));
        hatch(PINK, Math.max(1.5, 2.6 * scale));
      }
    },
  });
}

// Little blue drops falling off her face (sad, stung).
export function drops(fx, anchor, { count = 3, scale = 1 } = {}) {
  const p0 = at(anchor);
  if (!p0) return;
  for (let i = 0; i < count; i++) {
    const x = p0.x + rand(-30, 30) * scale;
    const y = p0.y + rand(0, 20) * scale;
    const life = rand(700, 1100);
    const delay = i * 180;
    fx.add({
      type: 'life', life: life + delay,
      render(ctx, t) {
        const age = t * (life + delay) - delay;
        if (age < 0) return;
        const k = step(age / life, 8);
        const py = y + k * k * 70 * scale;
        const r = 4 * scale * (1 - k * 0.5);
        twice(ctx, (dx, dy, c) => {
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.moveTo(x + dx, py + dy - r * 2.2);
          ctx.quadraticCurveTo(x + dx + r * 1.2, py + dy, x + dx, py + dy + r);
          ctx.quadraticCurveTo(x + dx - r * 1.2, py + dy, x + dx, py + dy - r * 2.2);
          ctx.fill();
        }, COLORS.blue, -1, 1);
      },
    });
  }
}

// Steam puffing off her head (anger).
export function steam(fx, anchor, { count = 3, scale = 1 } = {}) {
  const p0 = at(anchor);
  if (!p0) return;
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    const life = rand(700, 1000);
    const delay = i * 140;
    const x = p0.x + side * rand(20, 60) * scale;
    fx.add({
      type: 'life', life: life + delay,
      render(ctx, t) {
        const age = t * (life + delay) - delay;
        if (age < 0) return;
        const k = step(age / life, 6);
        const r = (6 + 14 * k) * scale;
        const px = x + side * 18 * k * scale, py = p0.y - 40 * k * scale;
        ctx.globalAlpha = 1 - k * 0.8;
        twice(ctx, (dx, dy, c) => {
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.arc(px + dx, py + dy, r, 0, Math.PI * 2);
          ctx.arc(px + dx + r * 0.7, py + dy + r * 0.3, r * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }, COLORS.paper);
      },
    });
  }
}

// Stars going round her head (dizzy).
export function dizzy(fx, anchor, { scale = 1, life = 2000 } = {}) {
  return fx.add({
    type: 'life', life,
    render(ctx, t, now, layer) {
      const p = at(anchor);
      if (!p) return;
      const a0 = step(t, 24) * Math.PI * 6;
      for (let i = 0; i < 3; i++) {
        const a = a0 + (i * Math.PI * 2) / 3;
        const x = p.x + Math.cos(a) * 46 * scale;
        const y = p.y - 30 * scale + Math.sin(a) * 12 * scale;
        layer.sparkle(x, y, 7 * scale + 2, i === 1 ? COLORS.green : COLORS.paper);
      }
    },
  });
}

// A little heart (she's flustered and you said the word).
export function heart(fx, x, y, { scale = 1, life = 1200 } = {}) {
  return fx.add({
    type: 'life', life,
    render(ctx, t) {
      const k = step(t, 8);
      const s = 9 * scale * (k < 0.15 ? 1.4 : 1);
      const py = y - 36 * k * scale;
      ctx.globalAlpha = t > 0.7 ? 1 - step((t - 0.7) / 0.3, 3) : 1;
      twice(ctx, (dx, dy, c) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(x + dx, py + dy + s);
        ctx.bezierCurveTo(x + dx - s * 1.6, py + dy - s * 0.2, x + dx - s * 0.6, py + dy - s * 1.4, x + dx, py + dy - s * 0.5);
        ctx.bezierCurveTo(x + dx + s * 0.6, py + dy - s * 1.4, x + dx + s * 1.6, py + dy - s * 0.2, x + dx, py + dy + s);
        ctx.fill();
      }, PINK);
    },
  });
}

// ---------- what she's busy with (life.js) ----------

// Her scan of your network: a red line sweeping down the screen, glyphs in its wake.
export function scan(fx, { life = 2800 } = {}) {
  const glyphs = ['0x', '▚', '//', '01', 'ICE', '◢', '#', 'NET'];
  const marks = Array.from({ length: 22 }, () => ({ x: Math.random(), y: Math.random(), g: pick(glyphs) }));
  return fx.add({
    type: 'life', life,
    render(ctx, t) {
      const { w, h } = fx.size;
      const k = step(t, 30);
      const y = Math.round(k * h);
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = COLORS.violet;
      ctx.fillRect(0, y - 26, w, 24);
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.violet;
      ctx.fillRect(0, y + 1, w, 2);
      ctx.fillStyle = COLORS.red;
      ctx.fillRect(0, y - 1, w, 2);
      ctx.font = '600 11px "JetBrains Mono", monospace';
      for (const m of marks) {
        const my = m.y * h;
        if (my > y || y - my > 140) continue;
        ctx.globalAlpha = 1 - (y - my) / 140;
        ctx.fillStyle = COLORS.green;
        ctx.fillText(m.g, m.x * w, my);
      }
    },
  });
}

// A prop she holds up and works on, following `anchor` (a function: between her hands).
// kind: 'ice' (a wireframe of the ICE she's cracking, a progress ring round it), 'pane' (a data
// shard's text scrolling by), 'arcade' (a tiny game: a ball, a paddle, a score), 'headphones'
// (over her ears; anchor: her head). Handle: set({ progress, score, title }), stop().
export function prop(fx, kind, anchor, { scale = 1 } = {}) {
  const data = { progress: 0, score: 0, title: '', lines: [] };
  const item = fx.add({
    type: 'life', life: 10 * 60 * 1000, fadeAt: 0,
    render(ctx, t, now, layer) {
      const p = at(anchor);
      if (!p) return;
      const age = now - item.born;
      const frame = Math.floor(age / FRAME_MS);
      // comes in over three drawings, goes the same way
      let k = Math.min(1, step(age / 160, 3) + 0.34);
      if (item.fadeAt) {
        const out = (now - item.fadeAt) / 200;
        if (out >= 1) {
          item.life = 0;
          return;
        }
        k = 1 - step(out, 3);
      }
      const s = scale * k;
      if (kind === 'ice') drawIce(ctx, p, s, frame, data);
      else if (kind === 'pane') drawPane(ctx, p, s, frame, data);
      else if (kind === 'arcade') drawArcade(ctx, p, s, frame, data);
      else if (kind === 'headphones') drawHeadphones(ctx, p, s, frame);
      if (frame % 9 === 0 && kind !== 'headphones' && Math.random() < 0.5) layer.glyph?.(p.x + rand(-30, 30) * s, p.y - 30 * s);
    },
  });
  return {
    set: (patch) => Object.assign(data, patch),
    stop: () => { item.fadeAt ||= performance.now(); },
  };
}

function drawIce(ctx, p, s, frame, data) {
  // a cube turning on twos, red edges, a green ring filling with the hack's progress
  const a = Math.floor(frame / 2) * 0.16;
  const b = 0.55;
  const R = 22 * s;
  const pts = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const x1 = x * Math.cos(a) - z * Math.sin(a);
    const z1 = x * Math.sin(a) + z * Math.cos(a);
    const y1 = y * Math.cos(b) - z1 * Math.sin(b);
    pts.push([p.x + x1 * R, p.y + y1 * R]);
  }
  const edges = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
  ctx.lineWidth = Math.max(1.2, 2 * s);
  twice(ctx, (dx, dy, c) => {
    ctx.strokeStyle = c;
    ctx.beginPath();
    for (const [i, j] of edges) {
      ctx.moveTo(pts[i][0] + dx, pts[i][1] + dy);
      ctx.lineTo(pts[j][0] + dx, pts[j][1] + dy);
    }
    ctx.stroke();
  }, frame % 14 === 0 ? COLORS.red : COLORS.paper);
  const ring = 42 * s;
  ctx.lineWidth = Math.max(2, 4 * s);
  ctx.strokeStyle = COLORS.violet;
  ctx.beginPath();
  ctx.arc(p.x - 2, p.y + 2, ring, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = COLORS.green;
  ctx.beginPath();
  ctx.arc(p.x, p.y, ring, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, data.progress));
  ctx.stroke();
  ctx.font = `600 ${Math.round(10 * Math.max(0.8, s))}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.paper;
  ctx.fillText(`${Math.round(data.progress * 100)}%`, p.x, p.y + ring + 14 * s);
}

const PANE_TEXT = ['>> decrypt', '0x4F2A ▚▞', 'NIGHT CITY', '// sat.lnk', 'ICE: none', '▙▟ 1101', 'mind#07: ok', 'mind#31: ?', 'cap.ri//', 'red.light'];

function drawPane(ctx, p, s, frame, data) {
  // a slanted holo pane, text scrolling up on twos
  const w = 118 * s, h = 76 * s;
  const x = p.x - w / 2, y = p.y - h / 2;
  const slant = 10 * s;
  const shape = (dx, dy) => {
    ctx.beginPath();
    ctx.moveTo(x + dx + slant, y + dy);
    ctx.lineTo(x + dx + w, y + dy);
    ctx.lineTo(x + dx + w - slant, y + dy + h);
    ctx.lineTo(x + dx, y + dy + h);
    ctx.closePath();
  };
  ctx.globalAlpha = 0.9;
  shape(-3, 3);
  ctx.fillStyle = COLORS.violet;
  ctx.fill();
  shape(0, 0);
  ctx.fillStyle = COLORS.ink;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLORS.green;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.save();
  shape(0, 0);
  ctx.clip();
  ctx.font = `400 ${Math.round(9 * Math.max(0.85, s))}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'left';
  const lines = data.lines.length ? data.lines : PANE_TEXT;
  const lh = 11 * Math.max(0.85, s);
  const off = (Math.floor(frame / 2) * 1.5) % (lh * lines.length);
  for (let i = 0; i < lines.length * 2; i++) {
    const ly = y + 14 * s + i * lh - off;
    if (ly < y || ly > y + h + lh) continue;
    ctx.fillStyle = i % 5 === 2 ? COLORS.red : COLORS.green;
    ctx.fillText(lines[i % lines.length], x + slant + 6 * s, ly);
  }
  ctx.restore();
  if (data.title) {
    ctx.font = `600 ${Math.round(9 * Math.max(0.85, s))}px "JetBrains Mono", monospace`;
    ctx.fillStyle = COLORS.red;
    ctx.fillRect(x + slant, y - 14 * s, Math.min(w, ctx.measureText(data.title).width + 10), 13 * s);
    ctx.fillStyle = COLORS.paper;
    ctx.fillText(data.title, x + slant + 5, y - 4 * s);
  }
}

function drawArcade(ctx, p, s, frame, data) {
  // a tiny screen: a ball bouncing on twos, the paddle chasing it a step behind, the score
  const w = 104 * s, h = 70 * s;
  const x = p.x - w / 2, y = p.y - h / 2;
  ctx.fillStyle = COLORS.violet;
  ctx.fillRect(x - 3, y + 3, w, h);
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.red;
  ctx.strokeRect(x, y, w, h);
  const f = Math.floor(frame / 2);
  const tri = (n, period) => {
    const m = n % (period * 2);
    return m < period ? m / period : 2 - m / period;
  };
  const bx = x + 6 * s + tri(f, 23) * (w - 12 * s);
  const by = y + 8 * s + tri(f, 17) * (h - 22 * s);
  const lag = x + 6 * s + tri(Math.max(0, f - 3), 23) * (w - 12 * s);
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(Math.round(bx - 2 * s), Math.round(by - 2 * s), Math.max(3, 4 * s), Math.max(3, 4 * s));
  ctx.fillStyle = COLORS.green;
  ctx.fillRect(Math.round(lag - 11 * s), Math.round(y + h - 8 * s), 22 * s, Math.max(2, 3 * s));
  ctx.font = `600 ${Math.round(9 * Math.max(0.85, s))}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.red;
  ctx.fillText(String(data.score).padStart(5, '0'), x + w - 4 * s, y + 11 * s);
}

function drawHeadphones(ctx, p, s, frame) {
  // a band over the top of her mane, a cup on each side, the cups thumping on the beat
  const thump = Math.floor(frame / 6) % 2 ? 1.08 : 1;
  const r = 70 * s;
  const cy = p.y - 6 * s;
  ctx.lineWidth = Math.max(3, 6 * s);
  ctx.lineCap = 'round';
  twice(ctx, (dx, dy, c) => {
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.arc(p.x + dx, cy + dy, r, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
  }, COLORS.ink, -2, 2);
  for (const side of [-1, 1]) {
    const cx = p.x + side * r * 0.95;
    const cw = 12 * s * thump, ch = 26 * s * thump;
    twice(ctx, (dx, dy, c) => {
      ctx.fillStyle = c;
      ctx.fillRect(cx - cw / 2 + dx, cy - ch / 2 + dy, cw, ch);
    }, COLORS.red);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(cx - 1, cy - ch / 2 + 3 * s, 2, ch - 6 * s);
  }
}

// Graffiti: she paints something in neon on your screen with her finger. It's drawn as her hand
// goes (over `drawMs`), stays a while, then glitches away. `shape`: 'grin' (her zigzag grin),
// 'satellite', 'star', 'heart', 'eye' or 'tag' (her name, with `text`).
export function graffiti(fx, x, y, shape = 'grin', { scale = 1, drawMs = 2600, holdMs = 7000, text = 'CAPRI', color = COLORS.red } = {}) {
  const paths = SHAPES[shape]?.(scale) || SHAPES.grin(scale);
  const total = paths.reduce((n, path) => n + path.length, 0);
  const life = drawMs + holdMs + 500;
  return fx.add({
    type: 'life', life,
    render(ctx, t, now) {
      const age = t * life;
      const frame = Math.floor(age / FRAME_MS);
      const shown = Math.min(1, step(age / drawMs, Math.max(8, Math.round(drawMs / 120))));
      const leaving = age > drawMs + holdMs ? (age - drawMs - holdMs) / 500 : 0;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (shape === 'tag') {
        ctx.font = `700 ${Math.round(46 * scale)}px "Chakra Petch", sans-serif`;
        ctx.textAlign = 'center';
        const full = ctx.measureText(text).width;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - full / 2 - 10, y - 60 * scale, (full + 20) * shown, 90 * scale);
        ctx.clip();
        ctx.lineWidth = 3 * scale;
        ctx.strokeStyle = COLORS.violet;
        ctx.strokeText(text, x - 3, y + 3);
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
        ctx.restore();
        if (leaving) glitchOut(ctx, x - full / 2, y - 50 * scale, full, 60 * scale, leaving);
        return;
      }
      let budget = Math.round(total * shown);
      for (const path of paths) {
        if (budget <= 1) break;
        const pts = path.slice(0, budget);
        budget -= path.length;
        for (const [width, c, dx, dy] of [[9 * scale, COLORS.violet, -3, 3], [6 * scale, color, 0, 0], [1.6 * scale, COLORS.paper, 0, 0]]) {
          ctx.lineWidth = width;
          ctx.strokeStyle = c;
          ctx.beginPath();
          pts.forEach(([px, py], i) => {
            // a little jitter on the line every couple of drawings: it boils like the rest of her
            const j = (frame >> 1) % 3 === 0 ? 0.6 : 0;
            if (i) ctx.lineTo(x + px + dx + j, y + py + dy);
            else ctx.moveTo(x + px + dx, y + py + dy);
          });
          ctx.stroke();
        }
      }
      if (leaving) glitchOut(ctx, x - 80 * scale, y - 70 * scale, 160 * scale, 140 * scale, leaving);
    },
  });
}

function glitchOut(ctx, x, y, w, h, k) {
  // slices of it knocked sideways, then gone
  ctx.globalCompositeOperation = 'destination-out';
  const bands = 7;
  for (let i = 0; i < bands; i++) {
    if (Math.random() < k * 1.4) ctx.fillRect(x - 20, y + (h / bands) * i, w + 40, h / bands + 1);
  }
  ctx.globalCompositeOperation = 'source-over';
}

// The shapes, as polylines in px around (0, 0).
const SHAPES = {
  grin: (k) => {
    const teeth = [];
    for (let i = 0; i <= 10; i++) teeth.push([(-75 + i * 15) * k, (i % 2 ? 14 : -10) * k]);
    const eyeL = circle(-42 * k, -52 * k, 14 * k, 14);
    const eyeR = circle(42 * k, -52 * k, 14 * k, 14);
    return [eyeL, eyeR, teeth];
  },
  satellite: (k) => [
    circle(0, 0, 16 * k, 16),
    [[-70 * k, -14 * k], [-24 * k, -14 * k], [-24 * k, 14 * k], [-70 * k, 14 * k], [-70 * k, -14 * k]],
    [[70 * k, -14 * k], [24 * k, -14 * k], [24 * k, 14 * k], [70 * k, 14 * k], [70 * k, -14 * k]],
    arc(0, 40 * k, 110 * k, Math.PI * 1.15, Math.PI * 1.85, 18),
  ],
  star: (k) => {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = (i % 2 ? 26 : 64) * k;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return [pts];
  },
  heart: (k) => {
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const x = 16 * Math.sin(a) ** 3;
      const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
      pts.push([x * 3.6 * k, y * 3.6 * k]);
    }
    return [pts];
  },
  eye: (k) => [
    [...arc(0, 40 * k, 80 * k, Math.PI * 1.2, Math.PI * 1.8, 14), ...arc(0, -40 * k, 80 * k, Math.PI * 0.2, Math.PI * 0.8, 14)],
    circle(0, 0, 18 * k, 14),
  ],
};

function circle(cx, cy, r, n) {
  return arc(cx, cy, r, 0, Math.PI * 2, n);
}

function arc(cx, cy, r, a0, a1, n) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}
