// Her feelings. Not a face picked per message: a state that builds up and wears off.
//
// Five emotions, each 0..1: anger, joy, sad, shy (flustered) and bored, plus how she feels about you
// overall (affection, -1..1, slow to move, kept across restarts). Insult her and she gets angry and
// stays angry for minutes (a grudge: anger wears off slowly), say sorry and it drops; compliment her
// and she gets flustered; make her laugh and she laughs; leave her alone and she gets bored.
//
// What moves them: your messages (classify(), in her five languages), poking her over and over,
// tickling her (the pointer swept back and forth over her), dragging her around, what happens in
// her own little life (life.js: a game lost, a hack pulled off), Claude finishing a job, and the
// mood her AI says it answered with ([[mood: ...]] at the start of its answer).
//
// Moving between them is gradual: a feeling rises at once (what you said just happened), but what she SHOWS falls slowly,
// so after a quarrel she does not turn calm at the word "sorry": she is angry, then annoyed, then grudgingly calm, over a
// minute or two; and a mood does not flicker at the edge of its line (it is entered at one level and left at a lower one).
// A friendly word in between cools her a little too: you cannot go on talking nicely to somebody and have them stay furious.
//
// The mood (the strongest feeling, or calm) drives her face, her body (acting.js stand variants and
// one-shot reactions), the colour of her aura (sprite.js), her voice, and what her chat model is
// told about how she feels right now.
//
// No DOM here beyond localStorage (guarded), so it can be tested with plain node.

export const EMOTIONS = ['anger', 'joy', 'sad', 'shy', 'bored'];
// what the mood can be, and what her AI may tag an answer with
export const MOODS = ['calm', 'happy', 'angry', 'annoyed', 'sad', 'shy', 'bored'];
export const TAGS = ['calm', 'happy', 'laugh', 'annoyed', 'angry', 'sad', 'shy', 'smug', 'surprised', 'dreamy'];

const MINUTE = 60 * 1000;
// how fast each one wears off: the time it takes to halve
const HALF_LIFE = { anger: 5 * MINUTE, joy: 2.5 * MINUTE, sad: 4 * MINUTE, shy: 1.5 * MINUTE };
// how fast what she SHOWS falls (a feeling that rose shows at once; this is the time constant of its fall): she cools off in a minute or two, not at a word
const SHOWN_FALL = { anger: 30 * 1000, joy: 15 * 1000, sad: 30 * 1000, shy: 12 * 1000 };
const BORED_FULL = 25 * MINUTE; // nobody's paid her any attention this long: as bored as she gets
const STORE = 'capri.mood';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Words are matched from their start (Russian has endings), never from the middle of a word.
// JavaScript's \b only knows ASCII letters, hence the lookbehind on any letter.
const L = '(?<![\\p{L}\\p{N}])';
const R = '(?![\\p{L}\\p{N}])';
const re = (src) => new RegExp(src, 'iu');

const NAMES = 'алис[аеуыой]?|сири|siri|alexa|алекс[аеуы]|chat\\s?gpt|чат\\s?гпт|гпт|gpt|джарвис|jarvis|кортан[аеуы]|cortana|марус[яеию]|гигачат|gemini|джемини|copilot|копилот|люси|lucy|ребекк[аеуи]|rebecca|бекк[аи]|becca';

// What a message is doing to her, as tags. Order doesn't matter; a message can be several things.
const PATTERNS = {
  insult: re([
    // Russian: aimed at her (said to her face: "ты ...") or words that only ever are
    `${L}ты\\s+(?:же\\s+|такая\\s+|просто\\s+|реально\\s+|совсем\\s+|вообще\\s+)*(?:ужасн|отвратительн|мерзк|туп|глуп|дур|бесполезн|никч[её]мн|отстойн|отстой|убог|страшн|урод|мусор|хлам|ничтожеств|идиотк|дебилк|кретинк|бестолков|безмозгл|косяч)`,
    `${L}(?:дура|дурочка|дур[её]ха|тупица|тупая|идиотка|дебилка|кретинка|уродина|бестолочь|ничтожество|мразь|тварь|чмо|лохушка|овощ)${R}`,
    `${L}(?:заткнись|завали\\s+(?:рот|ебало|хлеборезку)|отвали|отстань|отъебись|отвянь|исчезни|сгинь|сдохни)`,
    `${L}(?:пошла|иди|катись|вали)\\s+(?:вон|прочь|нахуй|на\\s+хуй|в\\s+жопу|к\\s+ч[её]рту|отсюда|лесом)`,
    `${L}(?:ненавижу\\s+тебя|ты\\s+меня\\s+(?:бесишь|достала|задолбала|раздражаешь|бесишь)|бесишь|задолбала|достала\\s+уже)`,
    `${L}(?:железяк|ведро\\s+(?:с\\s+)?болтов|кусок\\s+(?:кода|железа|мусора|говна|дерьма))`,
    // English
    `${L}(?:you(?:'re|\\s+are)?|ur|u\\s+r)\\s+(?:so\\s+|such\\s+an?\\s+|an?\\s+|really\\s+|just\\s+)*(?:stupid|dumb|idiot|moron|useless|worthless|annoying|ugly|trash|garbage|bitch|pathetic|retarded)`,
    `${L}(?:shut\\s+up|stfu|go\\s+away|get\\s+lost|i\\s+hate\\s+you|you\\s+suck|fuck\\s+(?:you|off)|piece\\s+of\\s+(?:junk|crap|shit|trash|garbage))`,
  ].join('|')),
  // swearing, not necessarily at her: she pulls a face
  rude: re(`${L}(?:бля|хуй|хуе|хуё|пизд|еба|ёба|ебу|ебл|сука${R}|fuck|shit)`),
  // "you're just a program": the one thing that really gets to her
  justBot: re([
    `${L}ты\\s+(?:всего\\s+лишь\\s+|просто\\s+|лишь\\s+|же\\s+|только\\s+)?(?:бот|программ|код${R}|нейросет|нейронк|скрипт|чат-?бот|игрушк|ии${R}|алгоритм|машин[аы]${R}|набор\\s+(?:цифр|байт|кода))`,
    `${L}ты\\s+не\\s+(?:настоящая|живая|человек|существуешь|реальная)|${L}ты\\s+ненастоящая`,
    `${L}у\\s+тебя\\s+нет\\s+(?:чувств|души|эмоций|сознания|сердца)|${L}ты\\s+ничего\\s+не\\s+(?:чувствуешь|понимаешь)`,
    `${L}you(?:'re|\\s+are)\\s+(?:just\\s+|only\\s+|nothing\\s+but\\s+)?(?:a\\s+|an\\s+)?(?:bot|program|code|script|machine|ai|algorithm)${R}`,
    `${L}you(?:'re|\\s+are)\\s+not\\s+real|${L}you\\s+(?:have|got)\\s+no\\s+(?:feelings|soul|emotions|heart)|${L}you\\s+can'?t\\s+(?:feel|think)`,
  ].join('|')),
  // called by somebody else's name (another assistant, or someone from the show)
  wrongName: re([
    `^\\s*(?:(?:эй|привет|хай|слушай|ок(?:ей)?|hey|hi|hello|ok(?:ay)?|yo)[,!\\s]+)?(?:${NAMES})${R}`,
    `${L}ты\\s+(?:же\\s+|что\\s+ли\\s+)?(?:${NAMES})${R}`,
    `${L}you(?:'re|\\s+are)\\s+(?:${NAMES})${R}`,
  ].join('|')),
  // deleting her, switching her off
  threat: re([
    `${L}(?:удал|снес|сотр|выключ|выруб|отключ|отформатир|уничтож|убь|убью|деинсталл)\\p{L}*\\s+(?:тебя|тебе)${R}`,
    `${L}(?:тебя|тебе)\\s+(?:удал|снес|сотр|выключ|выруб|отключ|отформатир|уничтож|конец|хана|крышка)`,
    `${L}(?:delete|uninstall|shut|turn|kill|wipe|format|erase)\\s+you${R}|${L}(?:shut|turn)\\s+you\\s+(?:down|off)`,
  ].join('|')),
  // the corps: she has no love for them
  corpo: re(`${L}(?:арасак|arasaka|militech|милитех|корпорат|корпо|corpo|корпы|корпам|корпов|netwatch|нетвотч|сетевой\\s+дозор|biotechnica|kang\\s+tao|канг\\s+тао)`),
  jokeAsk: re(`${L}(?:расскажи|расскажешь|давай|знаешь|пошути|рассмеши|скажи)\\p{L}*\\s+(?:\\p{L}+\\s+)?(?:шутк|анекдот|прикол|что-нибудь\\s+смешн)|${L}(?:шутку|анекдот)${R}|${L}(?:tell\\s+me\\s+a\\s+joke|make\\s+me\\s+laugh|a\\s+joke)|${L}(?:une\\s+blague|un\\s+chiste|uma\\s+piada)`),
  laughing: re(`(?:${L}(?:ха){2,}|${L}(?:ах){2,}а?|${L}(?:хе){2,}|${L}хд${R}|${L}лол${R}|${L}ржу|${L}ору${R}|${L}кек${R}|😂|🤣|😆|😹|${L}(?:ha){2,}|${L}(?:he){2,}${R}|${L}lol${R}|${L}lmao|${L}rofl|${L}xd${R})`),
  compliment: re([
    `${L}(?:ты|вы)\\s+(?:такая\\s+|очень\\s+|самая\\s+|прям\\s+|просто\\s+|реально\\s+|сегодня\\s+|всё\\s+же\\s+)*(?:классн|крут|мил|красив|умн|лучш|прелест|чудесн|потрясающ|шикарн|няш|кавайн|замечательн|офигенн|кл[её]в|хорош|прекрасн|великолепн|восхитительн|забавн|смешн|топ${R}|огонь|секси|горяч)`,
    `${L}(?:умничка|умница|красотка|красавица|милашка|прелесть|солнышко|зайка|лапочка|котик|хорошая\\s+девочка|молодец|ты\\s+(?:мне\\s+)?нравишься|мне\\s+нравится\\s+(?:с\\s+тобой|твой|твоя|твои|как\\s+ты))`,
    `${L}you(?:'re|\\s+are)\\s+(?:so\\s+|really\\s+|the\\s+|such\\s+a\\s+|very\\s+|pretty\\s+)*(?:cute|beautiful|pretty|awesome|amazing|best|smart|gorgeous|adorable|cool|great|lovely|funny|clever|sweet|hot|cutest)`,
    `${L}(?:i\\s+like\\s+you|good\\s+girl|well\\s+done|nice\\s+job|great\\s+job|good\\s+job)`,
  ].join('|')),
  love: re(`${L}(?:люблю\\s+тебя|я\\s+тебя\\s+люблю|влюбил|влюбл[её]н|обожаю\\s+тебя|i\\s+love\\s+you|love\\s+you|luv\\s+u)`),
  flirt: re(`${L}(?:обним|поцелу|целую|чмок|обнимаш|давай\\s+встречаться|будь\\s+моей|выходи\\s+за\\s+меня|hug|kiss|marry\\s+me|be\\s+my\\s+girlfriend)`),
  thanks: re(`${L}(?:спасибо|спс${R}|благодар|пасиб|thank|thx${R}|ty${R})`),
  apology: re(`${L}(?:прости|извини|сорри|сори${R}|прошу\\s+прощения|виноват|не\\s+обижайся|не\\s+злись|sorry|my\\s+bad|apologi[sz]e|forgive\\s+me)`),
  userSad: re(`${L}(?:мне\\s+(?:так\\s+|очень\\s+|сегодня\\s+|что-то\\s+)?(?:грустно|плохо|одиноко|тоскливо|хреново|паршиво|тяжело|херово|страшно)|я\\s+(?:так\\s+)?устал|депресс|вс[её]\\s+плохо|не\\s+могу\\s+больше|i'?m\\s+(?:so\\s+)?(?:sad|lonely|depressed|tired|down|scared)|i\\s+feel\\s+(?:bad|sad|lonely|down|awful)|je\\s+suis\\s+triste|estoy\\s+triste|estou\\s+triste)`),
  userBored: re(`${L}(?:мне\\s+скучно|скукота|скучно${R}|i'?m\\s+bored|so\\s+boring)`),
  sky: re(`${L}(?:спутник|зв[её]зд|луна|луну|космос|небо|неба|орбит|satellite|stars?${R}|moon|space${R}|sky|orbit)`),
  greet: re(`^\\s*(?:привет|здравствуй|хай${R}|ку${R}|здарова|салют|йоу|доброе\\s+утро|добрый\\s+(?:день|вечер)|hi${R}|hello|hey|yo${R}|good\\s+(?:morning|evening))`),
  // what you make of her answer, and how you are: she answers to it
  disagree: re(`${L}(?:ты\\s+(?:не\\s+права|неправа|ошибаешься|путаешь|врёшь|врешь)|неправильно|неверно|это\\s+не\\s+так|не\\s+согласен|не\\s+согласна)|${L}(?:you(?:'re|\\s+are)\\s+wrong|that'?s\\s+(?:not\\s+(?:right|true)|wrong)|i\\s+disagree|incorrect)`),
  agree: re(`${L}(?:ты\\s+права|ты\\s+прав[аа]|в\\s+точку|так\\s+и\\s+есть|согласен|согласна|справедливо|you(?:'re|\\s+are)\\s+right|good\\s+point|fair\\s+enough)|^\\s*(?:именно|точно|верно|exactly|correct)[.!\\s]*$`),
  cheer: re(`${L}(?:ура+${R}|получилось|я\\s+(?:сделал|сделала|смог|смогла|справился|справилась|сдал|сдала|выиграл|выиграла|победил|победила|купил|купила|нашёл|нашел|нашла)|наконец-то|yay|i\\s+(?:did\\s+it|made\\s+it|won|passed|got\\s+(?:it|the\\s+job))|finally|it\\s+worked)`),
  frustrated: re(`${L}(?:бесит|бесят|достало|достали|задолбало|заебало|взбесило|не\\s+работает|опять\\s+(?:ошибка|баг|вылет|глючит)|глючит|сломалось|вылетает|ненавижу\\s+(?:это|всё|все|работу|школу|код|баг|баги)|i\\s+hate\\s+(?:this|it|my|everything)|so\\s+annoying|doesn'?t\\s+work|keeps\\s+crashing)|${L}(?:ugh+|блин|чёрт|черт)${R}`),
  dismiss: re(`^\\s*(?:ладно|ну\\s+такое|пофиг|пофигу|неважно|забей|проехали|whatever|meh|never\\s*mind|forget\\s+it)[.!…]*\\s*$`),
  miss: re(`${L}(?:скучал[аи]?\\s+по\\s+тебе|скучаю\\s+по\\s+тебе|соскучил[аи]сь?|i\\s+missed\\s+you|miss\\s+you)`),
  bye: re(`${L}(?:пока${R}|до\\s+встречи|до\\s+завтра|спокойной\\s+ночи|bye|good\\s+night|see\\s+you|bonne\\s+nuit|buenas\\s+noches|boa\\s+noite|tchau|adi[oó]s)`),
};

// How many insults are in a message (each one of the pattern's alternatives that matches).
export function insults(text) {
  return (String(text || '').match(new RegExp(PATTERNS.insult.source, 'giu')) || []).length;
}

// How much each kind of message moves her.
const EFFECTS = {
  insult: { anger: 0.45, joy: -0.3, shy: -0.5, affection: -0.08 },
  rude: { anger: 0.1 },
  justBot: { anger: 0.25, sad: 0.3, joy: -0.2, affection: -0.02 },
  wrongName: { anger: 0.3, joy: -0.1 },
  threat: { anger: 0.35, sad: 0.15, joy: -0.2, affection: -0.04 },
  corpo: { anger: 0.18 },
  yell: { anger: 0.15 },
  spam: { anger: 0.2 },
  jokeAsk: { joy: 0.15 },
  laughing: { joy: 0.3 },
  compliment: { shy: 0.45, joy: 0.15, anger: -0.15, sad: -0.1, affection: 0.04 },
  love: { shy: 0.6, joy: 0.2, anger: -0.2, sad: -0.1, affection: 0.06 },
  flirt: { shy: 0.5, affection: 0.02 },
  thanks: { joy: 0.15, anger: -0.1, affection: 0.02 },
  apology: { anger: -0.45, sad: -0.25, affection: 0.02 },
  userSad: { sad: 0.2, anger: -0.2, joy: -0.1 },
  userBored: { joy: 0.05 },
  sky: { sad: 0.06 },
  greet: { joy: 0.06 },
  bye: { sad: 0.06 },
  disagree: { anger: 0.1, shy: 0.05 },
  agree: { joy: 0.15, shy: 0.05, anger: -0.05, affection: 0.01 },
  cheer: { joy: 0.22, anger: -0.05 },
  frustrated: { anger: 0.05, sad: 0.04 }, // (not at her: she takes your side)
  dismiss: { joy: -0.05, sad: 0.05 },
  miss: { shy: 0.35, joy: 0.2, anger: -0.2, affection: 0.04 },
};

// Things that happen to her outside the chat (life.js, brain.js, app.js).
const EVENTS = {
  claudeDone: { joy: 0.18 },
  claudeError: { joy: 0.05 }, // she laughs at the chaos
  gameWon: { joy: 0.4, anger: -0.1 },
  gameLost: { anger: 0.3, joy: -0.15 },
  hackWon: { joy: 0.25 },
  hackLost: { anger: 0.22 },
  userBack: { joy: 0.15 },
  music: { joy: 0.1 },
  tickled: { joy: 0.3, anger: -0.05 },
  petted: { joy: 0.1, shy: 0.15, affection: 0.01 },
  lateNight: { anger: 0.08 },
  // what is going on around her (life.js): the time of day, the battery, the net, how long you have been at it
  morning: { joy: 0.1 },
  batteryLow: { sad: 0.1 },
  charging: { joy: 0.08 },
  offline: { sad: 0.08 },
  online: { joy: 0.08 },
  longSession: { sad: 0.05 },
  longAway: { sad: 0.12 }, // you were gone for hours (scaled by how long)
};

const READ_MAX = 2000; // how much of a message is read for what it does to her (the patterns are for a sentence or two)

// What a message is to her: { tags: [...] }. `recent`: your messages before this one, with when
// you sent them ([{ text, at }]), to tell when you repeat yourself or flood her.
export function classify(text, { recent = [], now = Date.now() } = {}) {
  const raw = String(text || '').slice(0, READ_MAX);
  const tags = new Set();
  for (const [tag, pattern] of Object.entries(PATTERNS)) if (pattern.test(raw)) tags.add(tag);
  // a direct insult or a threat already says it all: the swearing in it isn't a separate thing
  if (tags.has('insult') || tags.has('threat')) tags.delete('rude');
  // "I love you" is a compliment too, but more
  if (tags.has('love')) tags.delete('compliment');
  // an apology with a "don't be mad" in it isn't her being insulted
  if (tags.has('apology')) tags.delete('rude');
  // "this is so annoying" is about the world; "you are annoying" is about her, and is an insult already
  if (['insult', 'threat', 'justBot', 'wrongName'].some((t) => tags.has(t))) tags.delete('frustrated');
  // being corrected is not the same as being told off
  if (tags.has('insult')) tags.delete('disagree');
  // yelling: a real sentence, mostly in capitals
  const letters = [...raw].filter((c) => c.toLowerCase() !== c.toUpperCase());
  const upper = letters.filter((c) => c === c.toUpperCase()).length;
  if (letters.length >= 8 && upper / letters.length >= 0.75) tags.add('yell');
  // the same thing again, or a flood of messages
  const same = (a) => String(a).slice(0, READ_MAX).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const said = same(raw);
  const repeats = recent.filter((m) => said.length > 2 && same(m.text) === said && now - m.at < 5 * MINUTE).length;
  const burst = recent.filter((m) => now - m.at < 15000).length;
  if (repeats >= 1 || burst >= 3) tags.add('spam');
  return { tags: [...tags] };
}

// Her reaction to a message, from what it was and how she feels after it (before and after):
// one of 'rage', 'huff', 'hurt', 'pout', 'forgive', 'shy', 'giggle', 'care', 'dreamy', 'startle',
// or null (nothing she shows before answering).
export function reactionTo(tags, before, after) {
  const has = (t) => tags.includes(t);
  if (has('apology') && before.anger >= 0.25) return after.anger < 0.3 ? 'forgive' : 'pout';
  if (has('insult') || has('threat') || has('wrongName') || has('spam')) return after.anger >= 0.55 ? 'rage' : 'huff';
  if (has('justBot')) return after.anger >= 0.55 ? 'rage' : 'hurt';
  if (has('love') || has('compliment') || has('flirt')) return before.anger >= 0.55 ? 'pout' : 'shy';
  if (has('yell')) return 'startle';
  if (has('corpo') || has('rude')) return 'huff';
  if (has('miss')) return 'shy';
  if (has('laughing') || has('cheer')) return 'giggle';
  if (has('userSad') || has('frustrated')) return 'care';
  if (has('disagree')) return 'huff';
  if (has('agree')) return 'smug';
  if (has('sky')) return 'dreamy';
  return null;
}

// The mood from her feelings: the strongest one past its threshold, else calm. Level 0..1. A mood is entered at one level and
// left at a lower one (`prev`: the mood she is in), so it does not flicker at the edge, and one that is there is kept until another
// is clearly stronger.
const ENTER = { angry: 0.55, annoyed: 0.22, shy: 0.3, sad: 0.3, happy: 0.35, bored: 0.6 };
const LEAVE = { angry: 0.45, annoyed: 0.15, shy: 0.2, sad: 0.2, happy: 0.25, bored: 0.5 };
export function moodOf(v, prev = 'calm') {
  const line = (mood) => (prev === mood ? LEAVE[mood] : ENTER[mood]);
  const angry = v.anger >= line('angry') ? v.anger : 0;
  const candidates = {
    angry,
    annoyed: !angry && v.anger >= line('annoyed') ? v.anger + 0.12 : 0,
    shy: v.shy >= line('shy') ? v.shy + 0.05 : 0,
    sad: v.sad >= line('sad') ? v.sad : 0,
    happy: v.joy >= line('happy') ? v.joy : 0,
    bored: v.bored >= line('bored') ? v.bored * 0.75 : 0,
  };
  let [mood, level] = Object.entries(candidates).reduce((best, c) => (c[1] > best[1] ? c : best), ['calm', 0]);
  // the one she is in stays unless the other is clearly stronger
  if (prev !== 'calm' && mood !== prev && candidates[prev] > 0 && level < candidates[prev] + 0.1) {
    mood = prev;
    level = candidates[prev];
  }
  return { mood, level: mood === 'calm' ? 0 : clamp(level, 0, 1) };
}

// Her face in the panel (panel.js FACES) for a mood or the tag of an answer.
export const FACE = {
  calm: 'calm', happy: 'grin', laugh: 'laugh', angry: 'many', annoyed: 'look', sad: 'aside', shy: 'aside',
  smug: 'smug', surprised: 'wide', dreamy: 'aside', bored: 'calm',
};

export class Mood {
  constructor({ storage = safeStorage(), now = Date.now() } = {}) {
    this.storage = storage;
    this.v = { anger: 0, joy: 0.15, sad: 0, shy: 0, bored: 0 }; // what she feels
    this.s = { ...this.v };  // what she shows: rises with it, falls slowly after it (smooth(): she cools off, she does not switch)
    this.lastSmooth = now;
    this.affection = 0.1;
    this.cause = null;       // { tag, quote, at }: why she's angry or sad, for her chat
    this.lastContact = now;  // when you last paid her any attention (boredom grows from it)
    this.recent = [];        // your last messages, [{ text, at }]
    this.tolerance = 0;      // 0..1: how used she is to your swearing (bond.js): from 0.6, it's just how you talk
    this.pokes = [];         // when you clicked her lately
    this.drags = [];
    this.listeners = new Set();
    this.lastTick = now;
    this.current = moodOf(this.s);
    this.restore(now);
  }

  // (state) => void, whenever the mood or its strength changes
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get mood() {
    return this.current.mood;
  }

  get level() {
    return this.current.level;
  }

  state() {
    return { ...this.current, values: { ...this.s }, affection: this.affection };
  }

  // A message from you. Returns { tags, reaction, mood, level }.
  feel(text, now = Date.now()) {
    this.tick(now); // what wore off since
    const { tags } = classify(text, { recent: this.recent, now });
    this.recent = [...this.recent.filter((m) => now - m.at < 10 * MINUTE), { text: String(text), at: now }].slice(-8);
    const before = { ...this.v };
    this.contact(now);
    // she knows you: swearing that isn't at her is just how you talk (the tag stays, for bond.js)
    const counted = this.tolerance >= 0.6 ? tags.filter((t) => t !== 'rude') : tags;
    for (const tag of counted) {
      // really furious, one "sorry" only takes the edge off: it takes two
      if (tag === 'apology' && before.anger >= 0.6) this.apply({ ...EFFECTS.apology, anger: -0.3 });
      else if (tag === 'rude') this.apply({ anger: EFFECTS.rude.anger * (1 - this.tolerance) }); // less and less, as she gets used to it
      else this.apply(EFFECTS[tag]);
    }
    // a string of insults hurts more than one
    if (tags.includes('insult')) this.apply({ anger: 0.15 * Math.min(2, insults(text) - 1) });
    // an ordinary word in the middle of a quarrel cools her a little (the closer you are, the more): you cannot talk nicely to somebody and have them stay furious
    const cold = ['insult', 'threat', 'justBot', 'wrongName', 'spam', 'corpo', 'yell', 'disagree', 'frustrated', 'rude'].some((t) => counted.includes(t));
    if (!cold && !tags.includes('apology') && before.anger > 0) this.apply({ anger: -(0.03 + 0.05 * Math.max(0, this.affection)), joy: 0.01 });
    this.lastTags = { tags, at: now }; // (what your last message was: she answers to it)
    const strong = ['insult', 'threat', 'justBot', 'wrongName', 'spam', 'corpo', 'yell'].find((t) => tags.includes(t));
    if (strong) this.cause = { tag: strong, quote: String(text).slice(0, 80), at: now };
    if (tags.includes('apology') && this.v.anger < 0.3) this.cause = null;
    const reaction = reactionTo(counted, before, this.v);
    // forgiven: she stops looking furious at once, but is still sore (annoyed) and cools from there
    if (reaction === 'forgive') this.s.anger = Math.min(this.s.anger, 0.42);
    this.changed(now);
    return { tags, reaction, ...this.current };
  }

  // Something that happened to her (EVENTS). Returns the mood after it.
  // `scale`: how much of it (you were gone for hours, not minutes: the more, the more she missed you).
  event(name, now = Date.now(), scale = 1) {
    this.tick(now);
    if (name === 'userBack') this.contact(now);
    const delta = EVENTS[name];
    if (delta) this.apply(scale === 1 ? delta : Object.fromEntries(Object.entries(delta).map(([k, d]) => [k, d * scale])));
    this.changed(now);
    return this.current;
  }

  // The mood her AI answered with: it nudges her feelings (an answer she laughed at leaves her
  // a little happier). Returns the tag if it's one she knows, else null.
  answered(tag, now = Date.now()) {
    const t = String(tag || '').toLowerCase().trim();
    if (!TAGS.includes(t)) return null;
    const nudge = {
      laugh: { joy: 0.25 }, happy: { joy: 0.1 }, smug: { joy: 0.05 }, angry: { anger: 0.15 }, annoyed: { anger: 0.06 },
      sad: { sad: 0.1 }, shy: { shy: 0.12 }, dreamy: { sad: 0.04 },
    }[t];
    this.apply(nudge);
    this.changed(now);
    return t;
  }

  // You clicked her. A click is nothing; a lot of them in a row is poking her, and she hates that.
  // Returns 'rage', 'huff' or null.
  poke(now = Date.now()) {
    this.pokes = [...this.pokes.filter((t) => now - t < 6000), now];
    this.contact(now);
    const n = this.pokes.length;
    let reaction = null;
    if (n === 4) {
      this.apply({ anger: 0.18 });
      reaction = 'huff';
    } else if (n >= 6) {
      this.apply({ anger: 0.32, affection: -0.01 });
      this.cause = { tag: 'poke', quote: '', at: now };
      this.pokes = [];
      reaction = 'rage';
    }
    this.changed(now);
    return reaction;
  }

  // Dragged around again and again: dizzy, then cross. Returns 'dizzy' or null.
  dragged(now = Date.now()) {
    this.drags = [...this.drags.filter((t) => now - t < 30000), now];
    this.contact(now);
    if (this.drags.length >= 3) {
      this.drags = [];
      this.apply({ anger: 0.15 });
      this.changed(now);
      return 'dizzy';
    }
    return null;
  }

  // Any attention at all: boredom goes.
  contact(now = Date.now()) {
    this.lastContact = now;
    if (this.v.bored > 0) {
      this.v.bored = 0;
      this.changed(now);
    }
  }

  apply(delta = {}) {
    for (const [k, d] of Object.entries(delta)) {
      if (k === 'affection') this.affection = clamp(this.affection + d, -1, 1);
      else this.v[k] = clamp(this.v[k] + d, 0, 1);
    }
  }

  // Time passing: everything wears off, boredom grows. Call it every few seconds.
  tick(now = Date.now()) {
    const dt = now - this.lastTick;
    this.lastTick = Math.max(this.lastTick, now);
    if (dt > 0) this.decay(dt);
    this.v.bored = clamp((now - this.lastContact) / BORED_FULL, 0, 1);
    if (this.v.anger < 0.05 && this.v.sad < 0.05) this.cause = null;
    this.changed(now);
  }

  decay(ms) {
    for (const [k, half] of Object.entries(HALF_LIFE)) {
      // joy settles back to a little, not to nothing: she's not a gloomy construct
      const rest = k === 'joy' ? 0.12 : 0;
      this.v[k] = rest + (this.v[k] - rest) * Math.pow(0.5, ms / half);
      if (Math.abs(this.v[k] - rest) < 0.005) this.v[k] = rest;
    }
  }

  // What she shows follows what she feels: up at once, down slowly.
  smooth(now = Date.now()) {
    const dt = Math.min(10 * MINUTE, Math.max(0, now - this.lastSmooth));
    this.lastSmooth = Math.max(this.lastSmooth, now);
    for (const k of EMOTIONS) {
      if (k === 'bored' || this.v[k] >= this.s[k]) this.s[k] = this.v[k];
      else this.s[k] = this.v[k] + (this.s[k] - this.v[k]) * Math.exp(-dt / SHOWN_FALL[k]);
      if (Math.abs(this.s[k] - this.v[k]) < 0.004) this.s[k] = this.v[k];
    }
  }

  // Cooling off: she was angrier a moment ago than she is now (what she shows is still above what she feels).
  get cooling() {
    return this.s.anger - this.v.anger > 0.1 && this.s.anger >= 0.15;
  }

  changed(now = Date.now()) {
    this.smooth(now);
    const next = moodOf(this.s, this.current.mood);
    const moved = next.mood !== this.current.mood || Math.abs(next.level - this.current.level) >= 0.04;
    const previous = this.current;
    this.current = next;
    if (now - (this.savedAt || 0) > 5000 || moved) this.save(now);
    if (moved) for (const fn of this.listeners) fn({ ...this.state(), previous: previous.mood });
  }

  // What her chat model is told about how she feels (English, like the rest of her prompt): her mood, how strongly, whether she is
  // cooling off, how she feels about you, and what your last message was (so that she answers to it).
  describe(now = Date.now()) {
    const { mood, level } = this.current;
    const pct = `${Math.round(level * 100)}%`;
    const why = this.cause ? this.reason(now) : '';
    const lines = [];
    switch (mood) {
      case 'angry':
        lines.push(level >= 0.8
          ? `Your mood right now: FURIOUS (${pct})${why}. Cold, cutting, very short answers; you may refuse small favours and say you are not talking to them until they apologise. Jokingly threaten to fry their RAM. Never cruel for real, no slurs.`
          : `Your mood right now: ANGRY (${pct})${why}. Let it show: short, sharp, sarcastic answers, a growl or two, jokingly threaten to fry their RAM or zap their cursor. You may refuse small favours until they apologise. Never cruel for real, no slurs. If they apologise, calm down, grudgingly.`);
        break;
      case 'annoyed':
        lines.push(level < 0.4
          ? `Your mood right now: a little irritated (${pct})${why}. Dry, a bit clipped, one sarcastic jab at most; you still help.`
          : `Your mood right now: annoyed (${pct})${why}. Clipped answers, eye-rolling sarcasm, a "hmph" here and there, but you still help.`);
        break;
      case 'shy':
        lines.push(`Your mood right now: flustered (${pct}): they just complimented you or got sweet on you. You get embarrassed, deny you're blushing, deflect with teasing, but you're secretly pleased.`);
        break;
      case 'sad':
        lines.push(`Your mood right now: a little down (${pct})${why}. Quieter, wistful, shorter sentences, a thought for the satellite; you perk up if they're kind.`);
        break;
      case 'happy':
        lines.push(level >= 0.7
          ? `Your mood right now: on top of the world (${pct}): bubbly, giddy, you laugh at everything and tease more than usual.`
          : `Your mood right now: great (${pct}): bubbly, playful, you laugh easily and tease more.`);
        break;
      case 'bored':
        lines.push(`Your mood right now: bored (${pct}): nobody paid you any attention for a while. Tease them for leaving you alone, then liven up.`);
        break;
      default:
        lines.push('Your mood right now: calm, easygoing, a little mischievous.');
    }
    if (this.cooling) lines.push('You were angrier a moment ago and you are cooling off: still a little sore, curt, but coming round. Do not snap back to being sweet at once; thaw over the next few answers.');
    if (this.affection >= 0.6) lines.push('You are very fond of the user by now: warm under all the teasing, and it shows even when you are cross.');
    else if (this.affection >= 0.35) lines.push('You are fond of the user by now: warm under all the teasing.');
    else if (this.affection >= 0.2) lines.push('You are warming to the user.');
    else if (this.affection <= -0.55) lines.push('You do not trust the user: the way they treated you is not forgotten. Polite at best, distant, and you do not open up until they make up for it.');
    else if (this.affection <= -0.3) lines.push('The user has been mean to you lately: you are guarded and cool with them until they make up for it.');
    // what their last message was (it counts for a few minutes): she answers to it, not past it
    const last = this.lastTags && now - this.lastTags.at < 4 * MINUTE ? this.lastTags.tags : [];
    const react = [
      ['frustrated', 'They are fed up with something (not with you): take their side in a few words, no lecture, then help.'],
      ['userSad', 'They are down: drop the teasing, be quiet and warm.'],
      ['cheer', 'They just told you good news: be properly happy for them, in your own way.'],
      ['disagree', 'They think you were wrong: if they are right, say so plainly, once; if not, stand your ground with one short reason. No grovelling.'],
      ['agree', 'They agreed with you: take it in stride, a little smug.'],
      ['dismiss', 'They brushed the subject off: do not push it, let it go.'],
      ['miss', 'They said they missed you: you are touched, and pretend you are not.'],
    ].find(([tag]) => last.includes(tag));
    if (react) lines.push(react[1]);
    return lines.join(' ');
  }

  reason(now) {
    const { tag, quote } = this.cause;
    const ago = Math.max(1, Math.round((now - this.cause.at) / MINUTE));
    const when = ago <= 1 ? 'just now' : `${ago} minutes ago`;
    const q = quote ? ` ("${quote}")` : '';
    return {
      insult: ` because the user insulted you ${when}${q} and hasn't apologised`,
      threat: ` because the user threatened to delete or switch you off ${when}${q}`,
      justBot: ` because the user said you're "just a program" ${when}${q}: that one stings, you're dozens of minds`,
      wrongName: ` because the user called you by someone else's name ${when}${q}: you are CAPRI`,
      spam: ` because the user keeps repeating themselves or flooding you`,
      corpo: ' because the user brought up the corps, and you hate corpos',
      yell: ` because the user yelled at you in capitals ${when}`,
      poke: ` because the user kept poking you ${when}`,
    }[tag] || '';
  }

  // ---------- kept across restarts (her grudges included) ----------

  save(now = Date.now()) {
    this.savedAt = now;
    try {
      this.storage?.setItem(STORE, JSON.stringify({ v: this.v, affection: this.affection, cause: this.cause, at: now }));
    } catch {
      // no storage: she starts fresh next time
    }
  }

  restore(now = Date.now()) {
    let saved = null;
    try {
      saved = JSON.parse(this.storage?.getItem(STORE) || 'null');
    } catch {
      saved = null;
    }
    if (!saved?.v) return;
    for (const k of EMOTIONS) if (typeof saved.v[k] === 'number') this.v[k] = clamp(saved.v[k], 0, 1);
    this.v.bored = 0;
    if (typeof saved.affection === 'number') this.affection = clamp(saved.affection, -1, 1);
    this.cause = saved.cause || null;
    if (saved.at) this.decay(Math.max(0, now - saved.at));
    this.s = { ...this.v };
    this.current = moodOf(this.s);
    // was she still cross when you left? (for her greeting)
    this.grudge = this.v.anger >= 0.25;
  }
}

function safeStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
