// Her own voice, step one: text to sounds (voice-synth.js makes the sound). No model, no service, no
// dictionary file: spelling rules for Russian (the best covered), and plainer ones for English, Spanish,
// Portuguese and French.
//
// phonemize(text, lang) -> phrases: [{ words: [{ text, phones: [{ p, stress?, long? }] }], end }]
//   `end` is how the phrase closes: '.', '?', '!', ',', '…' or '' (it sets her tune and the pause).
//   A phone `p` is one of:
//     vowels  a e E i I o O u U y @ V Q A 2 9 Y   (y = Russian ы, @ = schwa, Y = French u, 2 / 9 = ø / œ)
//     glides  j w
//     stops   p b t d k g          fricatives f v s z S Z C x h T D     (S = sh, Z = zh, C = soft sh, T/D = th)
//     nasals  m n N J             liquids l r R (R = a tap)
//     affricates ts tS tC dZ dz
//   and a trailing ' (an apostrophe) on a consonant means soft (palatalised), a trailing ~ a short vowel.
//   Words that are really a laugh come out as { laugh: n }.

const CYR = /[а-яёА-ЯЁ]/;

// ---------- Russian ----------

const RU_SOFT_VOWELS = 'яюеёи';
const RU_VOWEL_LETTERS = 'аоуыэяюеёи';
const RU_CONS = {
  б: 'b', в: 'v', г: 'g', д: 'd', ж: 'Z', з: 'z', к: 'k', л: 'l', м: 'm', н: 'n', п: 'p', р: 'r', с: 's', т: 't',
  ф: 'f', х: 'x', ц: 'ts', ч: 'tC', ш: 'S', щ: 'C', й: 'j',
};
const SOFTENABLE = new Set(['p', 'b', 't', 'd', 'k', 'g', 'f', 'v', 's', 'z', 'x', 'm', 'n', 'l', 'r']);
const VOICED = { b: 'p', d: 't', g: 'k', v: 'f', z: 's', Z: 'S' };
const DEVOICED = Object.fromEntries(Object.entries(VOICED).map(([v, u]) => [u, v]));
// words said as spelled differently, and the little words that carry no stress of their own
const RU_SAID = {
  что: 'што', чтобы: 'штобы', конечно: 'конешно', скучно: 'скушно', сегодня: 'севодня', чего: 'чево', его: 'ево',
  него: 'нево', какого: 'какова', этого: 'этова', сейчас: 'сичас', здравствуй: 'здраствуй', здравствуйте: 'здраствуйте',
  солнце: 'сонце', чувство: 'чуство', вообще: 'вабще', ничего: 'ничево', тогда: 'тагда', очень: 'очинь',
};
const RU_CLITIC = new Set(('и а но да или же бы ли ни не в во на с со к ко по за из о об от до у для при про над под ' +
  'без через это то вот вон как так уж ну ка мне мой моя моё мои тебе твой твоя твоё ты я он она оно мы вы они ' +
  'его её их нам вам им ему ей меня тебя нас вас ним нее нее что чтобы если когда где').split(' '));
// the prepositions said together with the next word (so "в доме" is one word to the voicing rules)
const RU_PROCLITIC = new Set(['в', 'к', 'с', 'о', 'у', 'и', 'а', 'на', 'по', 'за', 'из', 'от', 'до', 'во', 'со', 'ко', 'не', 'ни', 'об']);

function ruPrepare(word) {
  let w = word.toLowerCase().replace(/ё/g, 'ё');
  if (RU_SAID[w]) w = RU_SAID[w];
  w = w.replace(/(ого|его)$/, (m) => (m === 'ого' ? 'ова' : 'ева'))
    .replace(/ться$/, 'цца').replace(/тся$/, 'ца')
    .replace(/здравств/g, 'здраств').replace(/стн/g, 'сн').replace(/здн/g, 'зн').replace(/стл/g, 'сл')
    .replace(/лнц/g, 'нц').replace(/сч/g, 'щ').replace(/тс(?=[кт])/g, 'ц');
  return w;
}

function ruLetters(w) {
  const out = [];
  const isVowel = (c) => c && RU_VOWEL_LETTERS.includes(c);
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    const prev = w[i - 1];
    const next = w[i + 1];
    if (c === 'ь' || c === 'ъ') continue;
    if (isVowel(c)) {
      const iot = 'яюеё'.includes(c) && (i === 0 || isVowel(prev) || prev === 'ь' || prev === 'ъ');
      if (iot) out.push({ p: 'j', iot: true });
      const afterHardAlways = prev && 'жшц'.includes(prev);
      let p;
      if (c === 'а' || c === 'я') p = 'a';
      else if (c === 'о' || c === 'ё') p = 'o';
      else if (c === 'у' || c === 'ю') p = 'u';
      else if (c === 'ы') p = 'y';
      else if (c === 'э') p = 'E';
      else if (c === 'е') p = afterHardAlways ? 'E' : 'e';
      else p = afterHardAlways ? 'y' : 'i'; // и
      out.push({ p, vowel: true, yo: c === 'ё' });
      continue;
    }
    const base = RU_CONS[c];
    if (!base) continue;
    const soft = !'жшц'.includes(c) && (RU_SOFT_VOWELS.includes(next) || next === 'ь');
    const p = soft && SOFTENABLE.has(base) ? `${base}'` : base;
    const last = out[out.length - 1];
    if (last && last.p === p && !last.vowel) last.long = true; // double letters: one longer sound
    else out.push({ p, long: c === 'щ' });
  }
  return out;
}

// Where the stress goes: ё, a single vowel, else by the ending (how many vowels from the end it falls
// on; learned from running Russian text, right about half the time: it only shapes her tune, no vowel
// is reduced by it), else the one before the last.
const RU_STRESS_END = {
  ться: 1, ется: 2, ешь: 1, ься: 1, ния: 2, тно: 1, ая: 2, та: 1, шь: 1, ки: 1, ий: 1, ый: 1, ка: 1, ия: 2, ло: 1,
  жу: 0, ёт: 0, то: 1, ие: 2, ри: 0, ер: 1, ше: 1, ии: 2, ы: 1,
};
function ruStress(word, vowels) {
  const n = vowels.length;
  const yo = vowels.findIndex((v) => v.yo);
  if (yo >= 0) return yo;
  const w = word.toLowerCase();
  if (RU_CLITIC.has(w)) return -1;
  if (n <= 1) return 0;
  for (let len = 4; len >= 1; len--) {
    const off = w.length > len ? RU_STRESS_END[w.slice(-len)] : undefined;
    if (off !== undefined) return Math.max(0, n - 1 - off);
  }
  return Math.max(0, n - 2);
}

// voicing rules over a whole group of letters (a word, or a preposition and its word): right to left, a
// voiced obstruent before a voiceless one loses its voice, a voiceless one before a voiced one (not в)
// gains it, and a voiced obstruent at the very end is devoiced
function ruAssimilate(phones) {
  const base = (p) => p.replace("'", '');
  const obstruent = (b) => VOICED[b] || DEVOICED[b] || ['x', 'ts', 'tC', 'C'].includes(b);
  for (let i = phones.length - 1; i >= 0; i--) {
    const ph = phones[i];
    if (VOWELS.has(ph.p) || ph.p === 'j') continue;
    const b = base(ph.p);
    const soft = ph.p.endsWith("'") ? "'" : '';
    const nx = phones[i + 1];
    const nb = nx && !VOWELS.has(nx.p) ? base(nx.p) : null;
    const trigger = nb && obstruent(nb);
    if (VOICED[b] && (i === phones.length - 1 || (trigger && !VOICED[nb] && nb !== 'v'))) ph.p = VOICED[b] + soft;
    else if (DEVOICED[b] && trigger && VOICED[nb] && nb !== 'v') ph.p = DEVOICED[b] + soft;
  }
}

function ruWord(raw) {
  const w = ruPrepare(raw);
  const letters = ruLetters(w);
  const vowels = letters.filter((l) => l.vowel);
  const at = ruStress(w, vowels);
  vowels.forEach((v, i) => { v.stress = i === at; });
  return letters.map(({ p, long, stress }) => ({ p, ...(long && { long }), ...(stress && { stress }) }));
}

// ---------- Spanish ----------

function esWord(w) {
  w = w.toLowerCase();
  const out = [];
  const V = 'aeiouáéíóúü';
  const stressed = /[áéíóú]/.test(w);
  const norm = w.replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i').replace(/ó/g, 'o').replace(/ú/g, 'u');
  const vowelIdx = [];
  for (let i = 0; i < norm.length; i++) {
    const c = norm[i];
    const n = norm[i + 1];
    const n2 = norm[i + 2];
    const front = n && 'eiy'.includes(n);
    const push = (p, extra) => out.push({ p, ...extra, _src: i });
    if ('iu'.includes(c) && !/[íú]/.test(w.slice(0, i + 1).slice(-1) === c ? '' : '')) {
      // a weak vowel beside a strong one is a glide: bien, gracias, cuando; after one it is a short end: hay, muy
      const before = norm[i - 1];
      const strongBefore = before && 'aeo'.includes(before);
      const vowelAfter = n && 'aeiou'.includes(n);
      const accented = [...w][i] !== c; // written í / ú
      if (!accented && vowelAfter && !strongBefore) { push(c === 'i' ? 'j' : 'w'); continue; }
      if (!accented && strongBefore && !vowelAfter) { push(`${c}~`); continue; }
    }
    if ('aeiou'.includes(c)) { vowelIdx.push(out.length); push(c); continue; }
    if (c === 'ü') { push('u'); continue; }
    switch (c) {
      case 'c':
        if (n === 'h') { push('tS'); i++; } else if (front) push('s'); else push('k');
        break;
      case 'q': push('k'); if (n === 'u') i++; break;
      case 'g':
        if (front) push('x');
        else if (n === 'u' && n2 && 'ei'.includes(n2)) { push('g'); i++; } else push('g');
        break;
      case 'j': push('x'); break;
      case 'h': break;
      case 'l': if (n === 'l') { push('j'); i++; } else push('l'); break;
      case 'ñ': push('J'); break;
      case 'r': if (i === 0 || n === 'r' || 'nls'.includes(norm[i - 1] || '')) { push('r', { long: n === 'r' }); if (n === 'r') i++; } else push('R'); break;
      case 'v': case 'b': push('b'); break;
      case 'z': push('s'); break;
      case 'x': push('k'); push('s'); break;
      case 'y': if (!n || !V.includes(n)) { if (norm[i - 1] && 'aeou'.includes(norm[i - 1])) push('i~'); else { vowelIdx.push(out.length); push('i'); } } else push('j'); break;
      case 'w': push('w'); break;
      case 'd': push('d'); break;
      default: if (/[a-z]/.test(c)) push(c);
    }
  }
  // stress: a written accent, else the last syllable when the word ends in a consonant (not n, s), else the one before
  const syl = out.map((p, i) => (vowelIdx.includes(i) ? i : -1)).filter((i) => i >= 0);
  let at = syl.length - 1;
  if (syl.length > 1) {
    if (stressed) {
      const acc = [...w].findIndex((ch) => /[áéíóú]/.test(ch));
      at = syl.findIndex((ix) => out[ix]._src >= acc);
      if (at < 0) at = syl.length - 1;
    } else at = /[aeiouns]$/.test(norm) ? syl.length - 2 : syl.length - 1;
  }
  if (syl[at] !== undefined) out[syl[at]].stress = true;
  return out.map(({ p, long, stress }) => ({ p, ...(long && { long }), ...(stress && { stress }) }));
}

// ---------- Portuguese (Brazilian) ----------

function ptWord(w) {
  w = w.toLowerCase();
  const norm = w.replace(/[áâã]/g, (m) => (m === 'ã' ? 'ã' : 'a')).replace(/[éê]/g, 'e').replace(/í/g, 'i').replace(/[óô]/g, 'o').replace(/ú/g, 'u');
  const out = [];
  const vow = [];
  const accent = /[áâéêíóôú]/.test(w);
  for (let i = 0; i < norm.length; i++) {
    const c = norm[i];
    const n = norm[i + 1];
    const last = i === norm.length - 1;
    const front = n && 'eiy'.includes(n);
    const push = (p, extra) => out.push({ p, ...extra });
    if (c === 'ã' || c === 'õ') { vow.push(out.length); push(c === 'ã' ? 'a' : 'o', { nasal: true }); push('n', { short: true }); continue; }
    if ('aeiou'.includes(c)) {
      let p = c;
      if (last && c === 'e') p = 'i';
      if (last && c === 'o') p = 'u';
      if (c === 'e' && last === false && n === 's' && i + 2 === norm.length) p = 'i';
      if (c === 'o' && n === 's' && i + 2 === norm.length) p = 'u';
      vow.push(out.length);
      push(p);
      if (n && 'mn'.includes(n) && (i + 2 >= norm.length || !'aeiou'.includes(norm[i + 2] || '')) && norm[i + 2] !== 'h') { push('n', { short: true }); i++; }
      continue;
    }
    switch (c) {
      case 'c':
        if (n === 'h') { push('S'); i++; } else if (front) push('s'); else push('k');
        break;
      case 'ç': push('s'); break;
      case 'q': push('k'); if (n === 'u') i++; break;
      case 'g':
        if (front) push('Z'); else if (n === 'u' && norm[i + 2] && 'ei'.includes(norm[i + 2])) { push('g'); i++; } else push('g');
        break;
      case 'j': push('Z'); break;
      case 'h': break;
      case 'l': if (n === 'h') { push('l\''); push('j', { short: true }); i++; } else push(last ? 'w' : 'l'); break;
      case 'n': if (n === 'h') { push('J'); i++; } else push('n'); break;
      case 'r': if (i === 0 || n === 'r') { push('x'); if (n === 'r') i++; } else push('R'); break;
      case 's': if (n === 's') { push('s'); i++; } else if (out.length && 'aeiou'.includes(norm[i - 1] || '') && n && 'aeiou'.includes(n)) push('z'); else push(last ? 'S' : 's'); break;
      case 'x': push('S'); break;
      case 'z': push('z'); break;
      case 't': if (n === 'i' || (last === false && n === 'e' && i + 2 === norm.length)) { push('tS'); } else push('t'); break;
      case 'd': if (n === 'i' || (n === 'e' && i + 2 === norm.length)) { push('dZ'); } else push('d'); break;
      case 'v': push('v'); break;
      case 'y': push('i'); break;
      default: if (/[a-z]/.test(c)) push(c);
    }
  }
  const syl = out.map((p, i) => (vow.includes(i) ? i : -1)).filter((i) => i >= 0);
  let at = syl.length - 1;
  if (syl.length > 1 && !accent && /(a|e|o|as|es|os|am|em)$/.test(norm)) at = syl.length - 2;
  else if (syl.length > 1 && accent) {
    const pos = [...w].findIndex((ch) => /[áâéêíóôú]/.test(ch));
    const ratio = pos / w.length;
    at = Math.min(syl.length - 1, Math.round(ratio * (syl.length - 1)));
  }
  if (syl[at] !== undefined) out[syl[at]].stress = true;
  return out.map(({ p, long, stress, short }) => ({ p: short && /^[aeiouAEIOU]$/.test(p) ? `${p}~` : p, ...(short && !/^[aeiouAEIOU]$/.test(p) && { short: true }), ...(long && { long }), ...(stress && { stress }) }));
}

// ---------- French ----------

function frWord(raw) {
  let w = raw.toLowerCase();
  // silent endings: s t d x z p (not c r f l), a final e
  const out = [];
  const vowel = [];
  w = w.replace(/(?<=[a-zàâéèêëîïôûùç])(es|ent)$/, (m, e) => (m === 'ent' && w.length > 4 ? 'e' : 'e'));
  const rules = [
    [/^eau/, ['o']], [/^au/, ['o']], [/^ou/, ['u']], [/^oi/, ['w', 'a']], [/^ai|^ei|^è|^ê/, ['E']], [/^é|^er$|^ez$/, ['e']],
    [/^eu|^œu/, ['2']], [/^ch/, ['S']], [/^gn/, ['J']], [/^qu/, ['k']], [/^ph/, ['f']], [/^th/, ['t']], [/^ill/, ['j']],
    [/^(an|am|en|em)(?![aeiouyéèêàâîïôû])/, ['a', 'n~']], [/^(on|om)(?![aeiouyéèêàâîïôû])/, ['o', 'n~']],
    [/^(in|im|ain|ein)(?![aeiouyéèêàâîïôû])/, ['E', 'n~']], [/^(un|um)(?![aeiouyéèêàâîïôû])/, ['9', 'n~']],
    [/^ç/, ['s']], [/^c(?=[eiyéèê])/, ['s']], [/^c/, ['k']], [/^g(?=[eiyéèê])/, ['Z']], [/^j/, ['Z']], [/^h/, []],
    [/^s(?=[aeiouyéèêàâîïôûù])/, null], [/^ss/, ['s']], [/^x/, ['k', 's']], [/^y/, ['i']], [/^u/, ['Y']], [/^û|^ù/, ['Y']],
    [/^(à|â)/, ['a']], [/^(î|ï)/, ['i']], [/^ô/, ['o']], [/^e$/, []], [/^e(?=[bcdfghjklmnpqrstvwxz]$)/, ['E']],
    [/^e/, ['@']], [/^[aio]/, null],
  ];
  if (/^[^aeiouyéèêàâîïôûù]+e[s]?$/.test(w) && w.length <= 3) return [...w.replace(/s$/, '').replace(/e$/, '')].map((c) => ({ p: c === 'r' ? 'R' : c === 'j' ? 'Z' : c === 'c' ? 'k' : c })).concat([{ p: '@', stress: true }]);
  if (/^(que|ques)$/.test(w)) return [{ p: 'k' }, { p: '@', stress: true }];
  let i = 0;
  while (i < w.length) {
    const rest = w.slice(i);
    // silent final consonants
    if (i === w.length - 1 && /[sxztpd]/.test(rest) && w.length > 2) { i++; continue; }
    if (rest === 'ent' || rest === 'es') { i += rest.length; continue; }
    let matched = false;
    for (const [re, ph] of rules) {
      const m = re.exec(rest);
      if (!m) continue;
      if (ph === null) {
        if (m[0] === 's') { out.push({ p: /[aeiouyéèêàâîïôû]/.test(w[i - 1] || '') ? 'z' : 's' }); } else { vowel.push(out.length); out.push({ p: m[0] }); }
        i += m[0].length;
      } else {
        for (const p of ph) {
          if (/^[aeEioOuY29@]$/.test(p)) vowel.push(out.length);
          out.push({ p: p.endsWith('~') ? 'n' : p, ...(p.endsWith('~') && { short: true }) });
        }
        i += m[0].length;
      }
      matched = true;
      break;
    }
    if (!matched) {
      const c = w[i];
      if (/[aeiouyéèêàâîïôûù]/.test(c)) { vowel.push(out.length); out.push({ p: c === 'y' ? 'i' : c }); } else if (c === 'r') out.push({ p: 'R' }); else if (/[a-z]/.test(c)) out.push({ p: c });
      i++;
    }
  }
  const syl = out.map((p, ix) => (vowel.includes(ix) ? ix : -1)).filter((ix) => ix >= 0);
  if (syl.length) out[syl[syl.length - 1]].stress = true; // French stresses the last syllable of a group
  return out.map(({ p, long, stress, short }) => ({ p: short && /^[aeiouAEIOU]$/.test(p) ? `${p}~` : p, ...(short && !/^[aeiouAEIOU]$/.test(p) && { short: true }), ...(long && { long }), ...(stress && { stress }) }));
}

// ---------- English (plain rules, and the commonest words) ----------

const EN_WORDS = {
  the: ['D', '@'], a: ['@'], an: ['@', 'n'], to: ['t', 'u'], of: ['@', 'v'], and: ['@', 'n', 'd'], is: ['i', 'z'], was: ['w', '@', 'z'],
  you: ['j', 'u'], your: ['j', 'O', 'r'], i: ['a', 'i~'], are: ['A', 'r'], what: ['w', '@', 't'], that: ['D', 'Q', 't'],
  this: ['D', 'I', 's'], they: ['D', 'e', 'i~'], with: ['w', 'I', 'D'], have: ['h', 'Q', 'v'], has: ['h', 'Q', 'z'], do: ['d', 'u'],
  does: ['d', 'V', 'z'], not: ['n', 'O', 't'], for: ['f', 'O', 'r'], on: ['O', 'n'], it: ['I', 't'], in: ['I', 'n'], be: ['b', 'i'],
  me: ['m', 'i'], my: ['m', 'a', 'i~'], we: ['w', 'i'], he: ['h', 'i'], she: ['S', 'i'], who: ['h', 'u'], how: ['h', 'a', 'u~'],
  now: ['n', 'a', 'u~'], know: ['n', 'o', 'u~'], so: ['s', 'o', 'u~'], no: ['n', 'o', 'u~'], go: ['g', 'o', 'u~'], hi: ['h', 'a', 'i~'],
  hey: ['h', 'e', 'i~'], yes: ['j', 'E', 's'], okay: ['o', 'u~', 'k', 'e', 'i~'], ok: ['o', 'u~', 'k', 'e', 'i~'], one: ['w', 'V', 'n'],
  two: ['t', 'u'], there: ['D', 'E', 'r'], here: ['h', 'i', 'r'], where: ['w', 'E', 'r'], when: ['w', 'E', 'n'], why: ['w', 'a', 'i~'],
  from: ['f', 'r', 'V', 'm'], would: ['w', 'U', 'd'], could: ['k', 'U', 'd'], should: ['S', 'U', 'd'], good: ['g', 'U', 'd'],
  love: ['l', 'V', 'v'], some: ['s', 'V', 'm'], come: ['k', 'V', 'm'], done: ['d', 'V', 'n'], said: ['s', 'E', 'd'], people: ['p', 'i', 'p', '@', 'l'],
  claude: ['k', 'l', 'O', 'd'], capri: ['k', 'Q', 'p', 'r', 'i'], ollama: ['O', 'l', 'A', 'm', '@'], openai: ['o', 'u~', 'p', '@', 'n', 'a', 'e', 'i~'],
  night: ['n', 'a', 'i~', 't'], city: ['s', 'I', 't', 'i'], choom: ['tS', 'u', 'm'], please: ['p', 'l', 'i', 'z'], thanks: ['T', 'Q', 'N', 'k', 's'],
  thank: ['T', 'Q', 'N', 'k'], sorry: ['s', 'O', 'r', 'i'], computer: ['k', '@', 'm', 'p', 'j', 'u', 't', '@', 'r'], work: ['w', '@', 'r', 'k'],
  done_: [], again: ['@', 'g', 'E', 'n'], also: ['O', 'l', 's', 'o', 'u~'], only: ['o', 'u~', 'n', 'l', 'i'], over: ['o', 'u~', 'v', '@', 'r'],
};

// grapheme rules, tried in order at each position: [letters, phones, (what must follow), (what must precede)]
const EN_RULES = [
  ['tch', ['tS']], ['dge', ['dZ']], ['igh', ['a', 'i~']], ['ough', ['O']], ['augh', ['O']], ['eigh', ['e', 'i~']],
  ['tion', ['S', '@', 'n']], ['sion', ['Z', '@', 'n']], ['cian', ['S', '@', 'n']], ['ture', ['tS', '@', 'r']],
  ['ing', ['I', 'N']], ['ang', ['Q', 'N']], ['ong', ['O', 'N']], ['ung', ['V', 'N']], ['ank', ['Q', 'N', 'k']], ['ink', ['I', 'N', 'k']],
  ['ch', ['tS']], ['sh', ['S']], ['th', ['T']], ['ph', ['f']], ['wh', ['w']], ['ck', ['k']], ['ng', ['N']], ['kn', ['n']], ['wr', ['r']],
  ['gh', []], ['qu', ['k', 'w']], ['ee', ['i']], ['ea', ['i']], ['oo', ['u']], ['ou', ['a', 'u~']], ['ow', ['o', 'u~']], ['oa', ['o', 'u~']],
  ['oi', ['O', 'i~']], ['oy', ['O', 'i~']], ['ai', ['e', 'i~']], ['ay', ['e', 'i~']], ['au', ['O']], ['aw', ['O']], ['ew', ['j', 'u']],
  ['ie', ['i']], ['ei', ['e', 'i~']], ['ey', ['e', 'i~']], ['ar', ['A', 'r']], ['or', ['O', 'r']], ['er', ['@', 'r']], ['ir', ['@', 'r']], ['ur', ['@', 'r']],
  ['ce', ['s']], ['ci', ['s', 'I']], ['cy', ['s', 'i']], ['ge', ['dZ']], ['gi', ['dZ', 'I']],
  ['a', ['Q']], ['b', ['b']], ['c', ['k']], ['d', ['d']], ['e', ['E']], ['f', ['f']], ['g', ['g']], ['h', ['h']], ['i', ['I']],
  ['j', ['dZ']], ['k', ['k']], ['l', ['l']], ['m', ['m']], ['n', ['n']], ['o', ['O']], ['p', ['p']], ['q', ['k']], ['r', ['r']],
  ['s', ['s']], ['t', ['t']], ['u', ['V']], ['v', ['v']], ['w', ['w']], ['x', ['k', 's']], ['y', ['j']], ['z', ['z']],
];

function enWord(raw) {
  const w = raw.toLowerCase().replace(/[^a-z']/g, '');
  const word = w.replace(/'s$/, 's').replace(/'/g, '');
  let phones;
  if (EN_WORDS[word]) phones = EN_WORDS[word].slice();
  else {
    // a final silent e makes the vowel before it long: make -> m a(i) k
    const magic = /^(.*?)([aeiou])([^aeiou ]{1,2})e$/.exec(word);
    let src = word;
    let longVowel = null;
    if (magic && !/(ve|ce|se|ge)$/.test(word) || (magic && word.length > 3)) {
      src = `${magic[1]}${magic[2]}${magic[3]}`;
      longVowel = { index: magic[1].length, v: magic[2] };
    }
    phones = [];
    let i = 0;
    while (i < src.length) {
      if (longVowel && i === longVowel.index) {
        const v = longVowel.v;
        phones.push(...({ a: ['e', 'i~'], e: ['i'], i: ['a', 'i~'], o: ['o', 'u~'], u: ['j', 'u'] })[v]);
        i++;
        continue;
      }
      if (/ed$/.test(word) && i === src.length - 2 && src.length > 3) {
        const before = src[i - 1];
        if ('td'.includes(before)) phones.push('I', 'd');
        else phones.push('pkfsx'.includes(before) ? 't' : 'd');
        break;
      }
      let done = false;
      if (i === src.length - 1 && /s$/.test(src) && /[bdgvzmnlraeiouy]/.test(src[i - 1] || '')) { phones.push('z'); break; }
      for (const [g, ph] of EN_RULES) {
        if (src.startsWith(g, i)) {
          if (i === 0 && g === 'ge' && /^get/.test(src)) continue;
          // a final -y is a vowel, as in "happy"; in a short word it is "ai"
          phones.push(...ph);
          i += g.length;
          done = true;
          break;
        }
      }
      if (!done) i++;
    }
    if (/y$/.test(word) && phones[phones.length - 1] === 'j') phones[phones.length - 1] = word.length <= 3 ? 'a' : 'i';
    if (/y$/.test(word) && word.length <= 3 && phones[phones.length - 1] === 'a') phones.push('i~');
  }
  // one stress: the first vowel of a short word, the penultimate of a long one
  const isV = (p) => /^[aeEiIoOuUyV@QA29Y]/.test(p) && !/^[wj]/.test(p);
  const idx = phones.map((p, i) => (isV(p) && !p.endsWith('~') ? i : -1)).filter((i) => i >= 0);
  const stressAt = idx.length <= 2 ? idx[0] : idx[idx.length - 2];
  return phones.map((p, i) => ({
    p: p.endsWith('~') ? p : p,
    ...(i === stressAt && { stress: true }),
  }));
}

// ---------- numbers ----------

const NUM = {
  ru: {
    units: ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'],
    tens: ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'],
    hundreds: ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'],
    thousand: (n) => (n % 10 === 1 && n % 100 !== 11 ? 'тысяча' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'тысячи' : 'тысяч'),
    thousandUnits: { 1: 'одна', 2: 'две' },
  },
  en: {
    units: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'],
    tens: ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'],
    hundred: 'hundred', thousand: 'thousand',
  },
};

function numberWords(n, lang) {
  if (lang === 'ru') {
    const t = NUM.ru;
    if (n < 20) return [t.units[n]];
    if (n < 100) return [t.tens[Math.floor(n / 10)], ...(n % 10 ? [t.units[n % 10]] : [])];
    if (n < 1000) return [t.hundreds[Math.floor(n / 100)], ...(n % 100 ? numberWords(n % 100, 'ru') : [])];
    if (n < 1e6) {
      const k = Math.floor(n / 1000);
      const head = k < 3 ? [t.thousandUnits[k]] : numberWords(k, 'ru');
      return [...(k === 1 ? [] : head), t.thousand(k), ...(n % 1000 ? numberWords(n % 1000, 'ru') : [])];
    }
    return String(n).split('').map((d) => t.units[Number(d)]);
  }
  if (lang === 'en') {
    const t = NUM.en;
    if (n < 20) return [t.units[n]];
    if (n < 100) return [t.tens[Math.floor(n / 10)], ...(n % 10 ? [t.units[n % 10]] : [])];
    if (n < 1000) return [t.units[Math.floor(n / 100)], t.hundred, ...(n % 100 ? numberWords(n % 100, 'en') : [])];
    if (n < 1e6) return [...numberWords(Math.floor(n / 1000), 'en'), t.thousand, ...(n % 1000 ? numberWords(n % 1000, 'en') : [])];
  }
  return String(n).split('').map((d) => ({ ru: NUM.ru, en: NUM.en })[lang === 'ru' ? 'ru' : 'en'].units[Number(d)]);
}

// ---------- text to phrases ----------

const ENDS = { '.': '.', '!': '!', '?': '?', '…': '…', ',': ',', ';': ',', ':': ',', '—': ',', '–': ',', '(': ',', ')': ',', '\n': '.' };
const LAUGH = /^(?:(?:ха|хе|хи|ах|ох|ха-)+х?|(?:ha)+h?|(?:he)+h?|(?:ja)+j?|(?:ji)+j?|(?:ra)+|k{3,}|mdr|lol|лол|ахах\p{L}*|хах\p{L}*)$/iu;

function wordPhones(text, lang) {
  if (CYR.test(text)) return ruWord(text.replace(/[^а-яёА-ЯЁ]/g, ''));
  const w = text.replace(/[^\p{L}']/gu, '');
  if (!w) return [];
  const fn = { en: enWord, es: esWord, pt: ptWord, fr: frWord }[lang === 'ru' ? 'en' : lang] || enWord;
  return fn(w);
}

export function phonemize(text, lang = 'ru') {
  const src = String(text || '')
    .replace(/[«»“”"„]/g, ' ')
    .replace(/%/g, lang === 'ru' ? ' процентов ' : ' percent ')
    .replace(/&/g, lang === 'ru' ? ' и ' : ' and ')
    .replace(/\+/g, lang === 'ru' ? ' плюс ' : ' plus ')
    .replace(/(\d)\.(\d)/g, '$1 $2')
    .replace(/\.{3}|…/g, '…')
    .replace(/(\p{L})-(\p{L})/gu, '$1 $2');
  const tokens = src.match(/[\p{L}']+|\d+|[.!?…,;:—–()\n]/gu) || [];
  const phrases = [];
  let words = [];
  let pending = []; // a preposition waiting for the word it is said with
  const flush = () => {
    if (!pending.length) return;
    const phones = pending.flatMap((x) => x.phones.map((p) => ({ ...p, stress: false })));
    ruAssimilate(phones);
    words.push({ text: pending.map((x) => x.text).join(' '), phones });
    pending = [];
  };
  const close = (end) => {
    flush();
    if (words.length) phrases.push({ words, end });
    else if (phrases.length && end && !phrases[phrases.length - 1].end) phrases[phrases.length - 1].end = end;
    words = [];
  };
  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t].replace(/’/g, "'");
    if (ENDS[tok] !== undefined) {
      close(ENDS[tok]);
      continue;
    }
    if (/^\d+$/.test(tok)) {
      flush();
      for (const word of numberWords(Number(tok), lang)) {
        const phones = wordPhones(word, lang === 'ru' ? 'ru' : 'en');
        if (lang === 'ru') ruAssimilate(phones);
        words.push({ text: word, phones });
      }
      continue;
    }
    if (LAUGH.test(tok)) {
      flush();
      words.push({ text: tok, phones: [], laugh: Math.min(5, Math.max(2, Math.round(tok.length / 2.5))) });
      continue;
    }
    const phones = wordPhones(tok, lang);
    if (!phones.length) continue;
    const cyr = CYR.test(tok);
    if (!cyr) {
      flush();
      words.push({ text: tok, phones });
      continue;
    }
    const proclitic = RU_PROCLITIC.has(tok.toLowerCase()) && CYR.test(tokens[t + 1] || '');
    pending.push({ text: tok, phones });
    if (!proclitic) {
      // the group ends with this word: its own stress stays, the prepositions before it have none
      const group = pending.map((x, i) => (i === pending.length - 1 ? x.phones : x.phones.map((p) => ({ ...p, stress: false }))));
      const all = group.flat().map((p) => ({ ...p }));
      ruAssimilate(all);
      words.push({ text: pending.map((x) => x.text).join(' '), phones: all });
      pending = [];
    }
  }
  close('');
  return phrases;
}

export const VOWELS = new Set(['a', 'e', 'E', 'i', 'I', 'o', 'O', 'u', 'U', 'y', '@', 'V', 'Q', 'A', '2', '9', 'Y']);
