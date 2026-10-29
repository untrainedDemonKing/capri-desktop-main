// What you ask her to do with the mouse, the keys and the controls of a window, read plainly (Russian and English), and the tags her AI may
// add for the same. Pure functions: hands.js does it, control.js (main) is the one that touches the PC.
//   "подвинь мышку в центр", "кликни", "правый клик", "двойной клик", "прокрути вниз на 5"
//   "нажми «Сохранить» в блокноте", "нажми кнопку ОК в калькуляторе", "нажми ctrl+s в блокноте", "напиши в блокноте: привет"
//   [[click: Блокнот | Сохранить]]  [[keys: Блокнот | ctrl+s]]  [[type: Блокнот | текст]]  [[mouse: move | center]]
// A request is read only when it starts like one (a verb first), and a control is named in quotes or after "кнопку/button".

const re = (src) => new RegExp(src, 'iu');

// ---- the names of windows: what is said ("в блокноте") and what control.js looks for (a program's name or a word of its title) ----

const ALIASES = [
  [/^(?:блокнот\p{L}*|notepad)$/iu, 'notepad'],
  [/^(?:калькулятор\p{L}*|calculator|calc)$/iu, 'calc'],
  [/^(?:проводник\p{L}*|explorer|file\s+explorer)$/iu, 'explorer'],
  [/^(?:хром\p{L}*|chrome|google\s+chrome)$/iu, 'chrome'],
  [/^(?:фаерфокс\p{L}*|файрфокс\p{L}*|firefox)$/iu, 'firefox'],
  [/^(?:эдж\p{L}*|edge|microsoft\s+edge)$/iu, 'msedge'],
  [/^(?:опер[аеуыой]|opera)$/iu, 'opera'],
  [/^(?:ворд\p{L}*|word|microsoft\s+word)$/iu, 'winword'],
  [/^(?:эксел\p{L}*|excel)$/iu, 'excel'],
  [/^(?:пауэрпоинт\p{L}*|powerpoint)$/iu, 'powerpnt'],
  [/^(?:пейнт\p{L}*|paint)$/iu, 'mspaint'],
  [/^(?:терминал\p{L}*|terminal|windows\s+terminal)$/iu, 'windowsterminal'],
  [/^(?:пауэршелл\p{L}*|powershell)$/iu, 'powershell'],
  [/^(?:vs\s?code|vscode|вс\s?код\p{L}*|visual\s+studio\s+code)$/iu, 'code'],
  [/^(?:спотифай\p{L}*|спотик\p{L}*|spotify)$/iu, 'spotify'],
  [/^(?:телеграм\p{L}*|телег[аеуиой]|telegram)$/iu, 'telegram'],
  [/^(?:дискорд\p{L}*|discord)$/iu, 'discord'],
  [/^(?:ватсап\p{L}*|вотсап\p{L}*|whatsapp)$/iu, 'whatsapp'],
  [/^(?:слак\p{L}*|slack)$/iu, 'slack'],
  [/^(?:стим\p{L}*|steam)$/iu, 'steam'],
];
const WINDOW_FILL = /^(?:(?:в|во|на|in|on|into|the)\s+)?(?:(?:окне|окно|окна|программе|приложении|window|app)\s+)?/iu;

// What control.js is asked to look for: a program known by its Russian name by its real one, else the word itself without its ending
// ("блокноте" is no part of a title that says "Блокнот": the stem is).
export function windowName(raw) {
  let name = String(raw || '').trim().replace(/[.!?,;:]+$/, '').replace(WINDOW_FILL, '').replace(/^["'«»“”]+|["'«»“”]+$/g, '').trim().slice(0, 60);
  if (!name) return '';
  for (const [pattern, program] of ALIASES) if (pattern.test(name)) return program;
  // a Russian word with a case ending: the stem (five letters or more are kept)
  if (/^[Ѐ-ӿ]{6,}$/.test(name)) name = name.replace(/(?:ами|ями|ого|ему|ому|ым|ом|ем|ой|ей|ою|ею|ах|ях|ов|ев|ам|ям|а|я|у|ю|е|ы|и|о)$/i, '');
  return name;
}

// ---- keys ----

const KEY_WORDS = [
  [/^(?:enter|энтер|ввод|return)$/i, 'enter'], [/^(?:esc|escape|эскейп|эск)$/i, 'esc'], [/^(?:tab|таб)$/i, 'tab'], [/^(?:space|пробел)$/i, 'space'],
  [/^(?:backspace|бэкспейс|бекспейс)$/i, 'backspace'], [/^(?:delete|del|делит|дел)$/i, 'delete'], [/^(?:home|хоум)$/i, 'home'], [/^(?:end|энд)$/i, 'end'],
  [/^(?:pageup|page\s?up|пейджап)$/i, 'pageup'], [/^(?:pagedown|page\s?down|пейджадаун)$/i, 'pagedown'],
  [/^(?:up|вверх)$/i, 'up'], [/^(?:down|вниз)$/i, 'down'], [/^(?:left|влево)$/i, 'left'], [/^(?:right|вправо)$/i, 'right'],
];
const MOD_WORDS = [[/^(?:ctrl|control|контрол|контрл|ктрл)$/i, 'ctrl'], [/^(?:alt|альт)$/i, 'alt'], [/^(?:shift|шифт)$/i, 'shift']];

// the Russian layout's letters and the keys they sit on (the shortcut keys are by place, not by letter)
const CYRILLIC_KEYS = { й: 'q', ц: 'w', у: 'e', к: 'r', е: 't', н: 'y', г: 'u', ш: 'i', щ: 'o', з: 'p', ф: 'a', ы: 's', в: 'd', а: 'f', п: 'g', р: 'h', о: 'j', л: 'k', д: 'l', я: 'z', ч: 'x', с: 'c', м: 'v', и: 'b', т: 'n', ь: 'm' };

// "ctrl+shift+s", "контрол с", "enter", "стрелка вниз", "f5" -> { mods, key }, or null
export function parseCombo(text) {
  const words = String(text || '').toLowerCase().replace(/стрелк\p{L}*\s+/giu, '').replace(/\s*\+\s*/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return null;
  const mods = [];
  let key = null;
  for (const word of words) {
    const mod = MOD_WORDS.find(([pattern]) => pattern.test(word));
    if (mod) {
      mods.push(mod[1]);
      continue;
    }
    if (key) return null; // (one key to a combination)
    const special = KEY_WORDS.find(([pattern]) => pattern.test(word));
    if (special) key = special[1];
    else if (/^[a-z0-9]$/.test(word)) key = word;
    else if (/^f(?:[1-9]|1[0-2])$/.test(word)) key = word;
    else if (/^[а-я]$/.test(word)) key = CYRILLIC_KEYS[word] || null; // (the key of the same place on the keyboard: "ctrl с" is Ctrl+C)
    else return null;
    if (!key) return null;
  }
  if (!key) return null;
  return { mods: [...new Set(mods)], key };
}

// how a combination is said back to you
export function sayCombo({ mods = [], key = '' } = {}) {
  const name = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  const k = { enter: 'Enter', esc: 'Esc', tab: 'Tab', space: 'Space', backspace: 'Backspace', delete: 'Delete', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', up: '↑', down: '↓', left: '←', right: '→' }[key] || String(key).toUpperCase();
  return [...mods.map((m) => name[m]), k].join('+');
}

// ---- the mouse ----

const POINTER = '(?:мышк\\p{L}*|мышь|курсор\\p{L}*|указател\\p{L}*|стрелк\\p{L}*|(?:the\\s+)?(?:mouse|pointer|cursor))';
const PATTERNS = {
  move: re(`^(?:подвинь|передвинь|перемести|наведи|сдвинь|поставь|move|put)\\s+${POINTER}\\s+(?:(?:в|на|к|to|into|onto)\\s+)?(?:the\\s+)?(.+)$`),
  click: re(`^(?:кликни|щёлкни|щелкни|клик|нажми\\s+мышк\\p{L}*|click)(?:\\s+(?:мышкой|мышью|тут|здесь|сюда|here|now))?\\s*$`),
  rightClick: re(`^(?:правый\\s+клик|кликни\\s+правой(?:\\s+кнопкой)?(?:\\s+мыши)?|щёлкни\\s+правой|right[- ]?click|click\\s+(?:the\\s+)?right)\\s*$`),
  doubleClick: re(`^(?:двойной\\s+клик|кликни\\s+дважды|дважды\\s+кликни|кликни\\s+два\\s+раза|double[- ]?click|click\\s+twice)\\s*$`),
  scroll: re(`^(?:прокрути|пролистай|скролль|листай|scroll)\\s+(вниз|вверх|down|up)(?:\\s+(?:на\\s+)?(\\d{1,2})(?:\\s+(?:раз|раза|клик\\p{L}*|строк\\p{L}*|times?|clicks?))?)?\\s*$`),
  // "нажми «Сохранить» в блокноте" / "нажми кнопку ОК в калькуляторе"
  pressQuoted: re(`^(?:нажми|кликни|щёлкни|щелкни|жми|тыкни|click|press|tap)\\s+(?:на\\s+)?(?:(?:кнопк\\p{L}*|пункт\\p{L}*|вкладк\\p{L}*|ссылк\\p{L}*|меню|button|tab|link|menu\\s+item)\\s+)?[«"'“](.+?)[»"'”]\\s*(?:(?:в|во|на|in|on)\\s+(.+))?$`),
  pressWord: re(`^(?:нажми|кликни|щёлкни|щелкни|жми|click|press)\\s+(?:на\\s+)?(?:кнопк\\p{L}*|пункт\\p{L}*|вкладк\\p{L}*|ссылк\\p{L}*|button|tab|link)\\s+([^«»"]+?)\\s+(?:в|во|на|in|on)\\s+(.+)$`),
  moveToElement: re(`^(?:наведи|подведи|move)\\s+${POINTER}\\s+(?:на|к|to|onto)\\s+[«"'“](.+?)[»"'”]\\s+(?:в|во|на|in|on)\\s+(.+)$`),
  keys: re(`^(?:нажми|нажать|press|hit)\\s+(.+?)(?:\\s+(?:в|во|на|in|on)\\s+(.+))?$`),
  type: re(`^(?:напиши|напечатай|введи|впиши|набери|type|write)\\s+(?:в|во|in|into)\\s+(?:окне\\s+|окно\\s+)?(\\S+?)\\s*[:,—-]\\s*(.+)$|^(?:напиши|напечатай|введи|впиши|набери|type|write)\\s+(?:в|во|in|into)\\s+(?:окне\\s+|окно\\s+)?(\\S+)\\s+(.+)$`, 's'),
};

// where on the screen it is said to go: a name control.js knows, or { x, y }
function place(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!?]+$/, '');
  const xy = /(?:точк\p{L}*\s+|coordinates?\s+)?(\d{1,5})\s*[,;xх×\s]\s*(\d{1,5})$/u.exec(t);
  if (xy) return { x: Number(xy[1]), y: Number(xy[2]) };
  if (/(?:левый\s+верх\p{L}*|верхн\p{L}*\s+лев\p{L}*|верхний\s+левый|top[- ]?left|upper\s+left)/u.test(t)) return 'topleft';
  if (/(?:правый\s+верх\p{L}*|верхн\p{L}*\s+прав\p{L}*|верхний\s+правый|top[- ]?right|upper\s+right)/u.test(t)) return 'topright';
  if (/(?:левый\s+ниж\p{L}*|нижн\p{L}*\s+лев\p{L}*|нижний\s+левый|bottom[- ]?left|lower\s+left)/u.test(t)) return 'bottomleft';
  if (/(?:правый\s+ниж\p{L}*|нижн\p{L}*\s+прав\p{L}*|нижний\s+правый|bottom[- ]?right|lower\s+right)/u.test(t)) return 'bottomright';
  if (/(?:центр|середин|посередин|center|centre|middle)/u.test(t)) return 'center';
  if (/(?:верх|вверх|top)/u.test(t)) return 'top';
  if (/(?:низ|вниз|bottom)/u.test(t)) return 'bottom';
  if (/(?:лев|left)/u.test(t)) return 'left';
  if (/(?:прав|right)/u.test(t)) return 'right';
  return null;
}

const text = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// What the message asks of the mouse, the keys and the controls of a window, or null. Intents:
//   { kind: 'mouse', op: 'move', target } | { kind: 'mouse', op: 'click', button, double } | { kind: 'mouse', op: 'scroll', clicks }
//   { kind: 'element', action: 'press' | 'move', window, name } | { kind: 'keys', window, mods, key } | { kind: 'type', window, text }
// `window` is '' when none was named (she says she needs one).
export function parseAct(raw, { type = true } = {}) {
  const body = text(raw).replace(/^(?:(?:капри|capri|эй|слушай|ну|а|и|давай|пожалуйста|please|можешь(?:\s+ли\s+ты)?|could\s+you|can\s+you|hey)[,!:\s]+)*/iu, '').replace(/[\s.!?…]+$/u, '');
  if (!body) return null;
  let m;
  if ((m = PATTERNS.moveToElement.exec(body))) return { kind: 'element', action: 'move', window: windowName(m[2]), name: text(m[1]) };
  if ((m = PATTERNS.move.exec(body))) {
    const target = place(m[1]);
    return target ? { kind: 'mouse', op: 'move', target } : null;
  }
  if (PATTERNS.rightClick.test(body)) return { kind: 'mouse', op: 'click', button: 'right', double: false };
  if (PATTERNS.doubleClick.test(body)) return { kind: 'mouse', op: 'click', button: 'left', double: true };
  if (PATTERNS.click.test(body)) return { kind: 'mouse', op: 'click', button: 'left', double: false };
  if ((m = PATTERNS.scroll.exec(body))) {
    const down = /^(?:вниз|down)$/i.test(m[1]);
    const n = Math.min(30, Math.max(1, Number(m[2]) || 5));
    return { kind: 'mouse', op: 'scroll', clicks: down ? -n : n };
  }
  if ((m = PATTERNS.pressQuoted.exec(body))) return { kind: 'element', action: 'press', window: windowName(m[2]), name: text(m[1]) };
  if ((m = PATTERNS.pressWord.exec(body))) return { kind: 'element', action: 'press', window: windowName(m[2]), name: text(m[1]) };
  if ((m = PATTERNS.keys.exec(body))) {
    const combo = parseCombo(m[1]);
    if (combo) return { kind: 'keys', window: windowName(m[2] || ''), ...combo };
  }
  if (type && (m = PATTERNS.type.exec(body))) {
    const window = windowName(m[1] || m[3]);
    const said = text(m[2] || m[4]).replace(/^["'«»“”]+|["'«»“”]+$/g, '').slice(0, 1500);
    if (window && said) return { kind: 'type', window, text: said };
  }
  return null;
}

// A tag her AI added for the same: [[click: window | name]], [[keys: window | ctrl+s]], [[type: window | text]], [[mouse: move | center]],
// [[mouse: click]], [[mouse: rightclick]], [[mouse: doubleclick]], [[mouse: scroll | down 5]]. Returns the intent, or null.
export function parseActTag(raw, { type = true } = {}) {
  const tag = /\[\[\s*(click|keys|type|mouse)\s*:\s*([^\]]+)\]\]/i.exec(String(raw || ''));
  if (!tag) return null;
  const kind = tag[1].toLowerCase();
  const parts = tag[2].split('|').map((p) => p.trim());
  const rest = tag[2].includes('|') ? tag[2].slice(tag[2].indexOf('|') + 1).trim() : ''; // (all that follows the first bar, as it was written)
  if (kind === 'click' && parts.length >= 2 && rest) return { kind: 'element', action: 'press', window: windowName(parts[0]), name: rest.slice(0, 80) };
  if (kind === 'keys' && parts.length >= 2) {
    const combo = parseCombo(parts[1]);
    return combo ? { kind: 'keys', window: windowName(parts[0]), ...combo } : null;
  }
  if (kind === 'type' && type && parts.length >= 2 && rest) return { kind: 'type', window: windowName(parts[0]), text: rest.slice(0, 1500) };
  if (kind === 'mouse') {
    const op = parts[0].toLowerCase().replace(/[\s_-]/g, '');
    if (op === 'click') return { kind: 'mouse', op: 'click', button: 'left', double: false };
    if (op === 'rightclick') return { kind: 'mouse', op: 'click', button: 'right', double: false };
    if (op === 'doubleclick') return { kind: 'mouse', op: 'click', button: 'left', double: true };
    if (op === 'move' && parts[1]) {
      const target = place(parts[1]);
      return target ? { kind: 'mouse', op: 'move', target } : null;
    }
    if (op === 'scroll' && parts[1]) {
      const m = /^(down|up|вниз|вверх)(?:\s+(\d{1,2}))?$/i.exec(parts[1]);
      if (m) return { kind: 'mouse', op: 'scroll', clicks: (/^(?:down|вниз)$/i.test(m[1]) ? -1 : 1) * Math.min(30, Math.max(1, Number(m[2]) || 5)) };
    }
  }
  return null;
}

// Whether your message asks for something like what a tag would do (a model tags answers about anything; the button waits for you, and
// only shows when you did ask).
export const ASKS_ACT = /нажми|нажать|жми|кликни|клик|щёлкни|щелкни|тыкни|подвинь|передвинь|перемести|наведи|сдвинь|прокрути|пролистай|скролль|введи|впиши|напечатай|набери|напиши|click|press|tap|move|scroll|type|write|hit/i;
