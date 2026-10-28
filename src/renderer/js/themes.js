// Her colours, from her menu (Colours) or her chat ("turn blue"): her mane's hue (sprite.js),
// her violet misregistered copy, the panel's background and accents (CSS variables), and the
// effect layer's palette (fx.js COLORS: her lightning, her shards). 'mood' follows how she feels.

import { COLORS } from './fx.js';

// hue: where the red of her mane is pushed (0..1), mix: how hard (the original is 0.6: a push
// toward the show's hot red), sat / val: the mane's saturation and brightness, rim: her violet copy
export const THEMES = {
  classic: {
    hue: 0.968, mix: 0.6, sat: 1, val: 1, rim: [0.48, 0.24, 1.0],
    css: {},
    fx: { red: '#ff2152', violet: '#7b3dff' },
  },
  netrunner: {
    hue: 0.52, mix: 1, sat: 1, val: 1.08, rim: [1.0, 0.18, 0.72],
    css: { '--red': 'oklch(0.82 0.15 205)', '--violet': 'oklch(0.62 0.26 345)', '--ink': 'oklch(0.17 0.04 245)', '--ink-2': 'oklch(0.23 0.05 245)' },
    fx: { red: '#22e4ff', violet: '#ff2fb8' },
  },
  toxic: {
    hue: 0.23, mix: 1, sat: 1, val: 1.1, rim: [0.48, 0.24, 1.0],
    css: { '--red': 'oklch(0.9 0.21 125)', '--ink': 'oklch(0.16 0.035 150)', '--ink-2': 'oklch(0.22 0.045 150)' },
    fx: { red: '#b6ff2e', violet: '#7b3dff' },
  },
  violet: {
    hue: 0.78, mix: 1, sat: 1, val: 1.1, rim: [0.1, 0.85, 1.0],
    css: { '--red': 'oklch(0.68 0.26 305)', '--violet': 'oklch(0.78 0.15 210)', '--ink': 'oklch(0.16 0.05 300)', '--ink-2': 'oklch(0.22 0.06 300)' },
    fx: { red: '#b04bff', violet: '#1fd6ff' },
  },
  gold: {
    hue: 0.115, mix: 1, sat: 0.95, val: 1.15, rim: [0.85, 0.08, 0.3],
    css: { '--red': 'oklch(0.85 0.17 82)', '--violet': 'oklch(0.56 0.22 15)', '--ink': 'oklch(0.16 0.025 60)', '--ink-2': 'oklch(0.22 0.03 60)' },
    fx: { red: '#ffc531', violet: '#d4134a' },
  },
  sakura: {
    hue: 0.915, mix: 1, sat: 0.62, val: 1.25, rim: [0.45, 0.3, 1.0],
    css: { '--red': 'oklch(0.8 0.14 350)', '--ink': 'oklch(0.18 0.04 340)', '--ink-2': 'oklch(0.24 0.05 340)' },
    fx: { red: '#ff8fc4', violet: '#7b3dff' },
  },
  ghost: {
    hue: 0.968, mix: 0.6, sat: 0.06, val: 1.3, rim: [1.0, 0.13, 0.32],
    css: { '--red': 'oklch(0.95 0.01 350)', '--violet': 'oklch(0.65 0.245 15)', '--ink': 'oklch(0.13 0.005 300)', '--ink-2': 'oklch(0.2 0.008 300)' },
    fx: { red: '#f4f2ff', violet: '#ff2152' },
  },
};

export const THEME_IDS = [...Object.keys(THEMES), 'mood'];

// 'mood': the colours of how she feels
const BY_MOOD = { angry: 'classic', annoyed: 'classic', sad: 'netrunner', shy: 'sakura', happy: 'gold', bored: 'ghost', calm: 'classic' };

// The theme to show for a setting and a mood.
export function resolveTheme(setting, mood = 'calm') {
  if (setting === 'mood') return BY_MOOD[mood] || 'classic';
  return THEMES[setting] ? setting : 'classic';
}

let applied = null;

// Puts a theme on: the page's colours, the effects', and hers (capri.setTheme). Returns its id.
export function applyTheme(id, { capri, root = document.documentElement } = {}) {
  const theme = THEMES[id] || THEMES.classic;
  const key = THEMES[id] ? id : 'classic';
  if (applied !== key) {
    // back to the stylesheet's own colours first, then this theme's
    for (const name of ['--red', '--violet', '--ink', '--ink-2']) root.style.removeProperty(name);
    for (const [name, value] of Object.entries(theme.css)) root.style.setProperty(name, value);
    root.dataset.theme = key;
    Object.assign(COLORS, THEMES.classic.fx, theme.fx);
    applied = key;
  }
  capri?.setTheme(theme);
  return key;
}

// What she understands in her chat: "перекрасься в синий", "turn pink", "make yourself gold"...
// (Russian words from their start, any ending; the others whole words only: "red" isn't in "tired")
const word = (ru, other) => new RegExp(`${ru}|(?<![\\p{L}])(?:${other})(?![\\p{L}])`, 'iu');
const NAMES = [
  ['netrunner', word('син|голуб|бирюз|циан|неттраннер|нетраннер', 'blue|cyan|teal|netrunner')],
  ['toxic', word('зел[её]н|токсич|кислот|салат', 'green|toxic|acid|lime')],
  ['violet', word('фиолет|сирен|пурпур|лилов', 'violet|purple|lilac')],
  ['gold', word('золот|ж[её]лт|оранж', 'gold|golden|yellow|orange')],
  ['sakura', word('розов|сакур', 'pink|sakura|rose')],
  ['ghost', word('бел(?:ый|ой|ая|ую|ым|еньк|ою)|сер(?:ый|ой|ая|ую|ым|еньк|ою)|призрак|монохром', 'white|grey|gray|ghost|mono|monochrome')],
  ['classic', word('красн|обычн|стандарт|классич|верни\\s+(?:как\\s+было|цвет)', 'red|classic|default')],
  ['mood', word('по\\s+настроени|под\\s+настроени', 'mood')],
];
// a message asking her to change colour (needs a colour word too)
const RECOLOUR = /перекрас|верни\s+(?:как\s+было|цвет|свой\s+цвет)|покрась|смени\s+цвет|поменяй\s+цвет|сделай\s+(?:себя|себе|волосы|гриву)|стань\s+\p{L}+|цвет\s+(?:волос|гривы)|recolou?r|turn\s+(?:yourself\s+)?\w+|change\s+(?:your\s+)?colou?r|dye|make\s+yourself|colou?r\s+(?:yourself|your\s+hair)|change\s+de\s+couleur|cambia\s+de\s+color|mude\s+de\s+cor/iu;

// The theme a message asks for, or null.
export function askedTheme(text) {
  const said = String(text || '');
  if (!RECOLOUR.test(said)) return null;
  for (const [id, pattern] of NAMES) if (pattern.test(said)) return id;
  return null;
}
