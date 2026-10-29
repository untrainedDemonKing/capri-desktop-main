// What you ask of the web, read plainly from your message (Russian and English), and from the tag her AI may add:
//   "загугли рецепт борща", "найди в яндексе погоду на завтра", "найди на ютубе обзор айфона", "включи видео про котов",
//   "включи Дудя на ютубе", "search youtube for lofi beats", "play a video about black holes"
// -> { kind: 'search', engine, query } (the page of results of that engine) or { kind: 'video', query } (the first video of
// YouTube's results, played). A request is read only when it starts like one (a verb first), so that a sentence that merely has
// "найди" or "включи" somewhere in it is not taken for a command. main.js (web.js) builds the address and opens it.

const END = '(?![\\p{L}\\p{N}])';

// the engines, by the words that name them (more specific first)
const ENGINE_WORDS = [
  ['maps', `(?:(?:гугл|яндекс|google)\\s+)?(?:карт[аеуыой]|картах)${END}|(?:google\\s+)?maps${END}`],
  ['images', `картинк\\p{L}*|изображени\\p{L}*|images?${END}`],
  ['youtube', `ютуб\\p{L}*|ютьюб\\p{L}*|youtube${END}|you\\s?tube${END}`],
  ['yandex', `яндекс\\p{L}*|yandex${END}`],
  ['google', `гугл\\p{L}*|гугол\\p{L}*|google${END}`],
  ['bing', `бинг\\p{L}*|bing${END}`],
  ['duckduckgo', `duckduckgo${END}|дакдакго`],
  ['wikipedia', `википеди\\p{L}*|wikipedia${END}|вики${END}`],
  ['github', `гитхаб\\p{L}*|github${END}`],
];
const ENGINE = `(?:${ENGINE_WORDS.map(([, w]) => w).join('|')})`;
export const ENGINE_NAMES = { google: 'Google', yandex: 'Яндекс', bing: 'Bing', duckduckgo: 'DuckDuckGo', youtube: 'YouTube', wikipedia: 'Wikipedia', github: 'GitHub', maps: 'Google Maps', images: 'Google Images' };

// which engine a word names
export function engineOf(word) {
  const w = String(word || '').trim();
  for (const [name, words] of ENGINE_WORDS) if (new RegExp(`^(?:${words})$`, 'iu').test(w)) return name;
  return null;
}

// the start of a request: "Капри, пожалуйста, ..." is not part of it
const LEAD = /^\s*(?:(?:капри|capri|эй|слушай|ну|а|и|давай|пожалуйста|please|можешь(?:\s+ли\s+ты)?|could\s+you|can\s+you|would\s+you|hey)[,!:\s]+)*/iu;
const TAIL = /\s*(?:,?\s*(?:пожалуйста|пожалуйста\s+пожалуйста|please|плиз|pls|ладно|спасибо))?[\s.!?…]*$/iu;

// "play" and "look for" verbs (each says what to do with a video: play it, or only look)
const PLAY_VERB = '(?:включи|включить|запусти|запустить|поставь|поставить|покажи|показать|play|watch|put\\s+on|show(?:\\s+me)?)';
const FIND_VERB = '(?:найди|найти|поищи|ищи|искать|открой|find|search(?:\\s+for)?|look\\s+up|open)';
const SEARCH_VERB = '(?:найди|найти|поищи|ищи|искать|поиск|find|search(?:\\s+for)?|look\\s+up)';
const KIND = `(?:видео|видос\\p{L}*|ролик\\p{L}*|клип\\p{L}*|трейлер\\p{L}*|стрим\\p{L}*|фильм\\p{L}*|сериал\\p{L}*|серию|video|videos|clip|trailer|stream|movie)${END}`;
const ABOUT = '(?:про|о|об|обо|с|со|где|от|по|about|on|of|by|with|from)';
const ME = '(?:мне\\s+|для\\s+меня\\s+|me\\s+|for\\s+me\\s+)?';

const re = (src) => new RegExp(src, 'iu');
const clean = (q) => String(q || '').replace(TAIL, '').replace(/^["'«»“”]+|["'«»“”]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
const playing = (verb) => new RegExp(`^${PLAY_VERB}$`, 'iu').test(verb);

const ART = '(?:(?:a|an|the|some)\\s+)?';
const SEP = '\\s*[,:—-]?\\s+';
const FOR = '(?:for\\s+)?';
const WEBWORD = '(?:интернете|интернет|сети|(?:the\\s+)?web|(?:the\\s+)?internet|online|онлайн)';

const PATTERNS = {
  // "включи видео про котов", "покажи мне ролик, где ...", "play a video about ..."
  videoWord: re(`^(${PLAY_VERB}|${FIND_VERB})\\s+${ME}${ART}${KIND}${SEP}(?:${ABOUT}\\s+)?(.+)$`),
  // "включи Дудя на ютубе", "найди обзор айфона на ютубе", "watch the trailer of dune on youtube"
  onYoutube: re(`^(${PLAY_VERB}|${FIND_VERB})\\s+${ME}(?:${ART}${KIND}\\s+)?(?:${ABOUT}\\s+)?(.+?)\\s+(?:на|в|on|in|at)\\s+(${ENGINE})$`),
  // "включи на ютубе Дудя", "найди на ютубе обзор", "search youtube for lofi"
  youtubeFirst: re(`^(${PLAY_VERB}|${SEARCH_VERB})\\s+${ME}(?:(?:на|в|on|in|at)\\s+)?(${ENGINE})${SEP}(?:и\\s+|and\\s+)?(?:(?:найди|поищи|включи|запусти|search(?:\\s+for)?|play|find)\\s+)?${FOR}(.+)$`),
  // "открой ютуб и найди ..."
  openThen: re(`^(?:открой|open)\\s+(?:the\\s+)?(${ENGINE})${SEP}(?:и\\s+|and\\s+)(${PLAY_VERB}|${SEARCH_VERB})\\s+${FOR}(.+)$`),
  // "в гугле найди ..." (the place first)
  placeFirst: re(`^(?:в|на|in|on)\\s+(${ENGINE}|${WEBWORD})${SEP}(${SEARCH_VERB})\\s+${ME}${FOR}(.+)$`),
  google: re(`^(?:загугли|погугли|нагугли|гугли)\\s+${ME}(.+)$|^google\\s+(.+)$`),
  engineGiven: re(`^${SEARCH_VERB}\\s+${ME}(?:(?:в|на|через|по|in|on|with|using|via)\\s+)(${ENGINE})${SEP}${FOR}(.+)$`),
  engineLast: re(`^${SEARCH_VERB}\\s+${ME}(.+?)\\s+(?:в|на|через|in|on|with|using|via)\\s+(${ENGINE})$`),
  web: re(`^${SEARCH_VERB}\\s+${ME}(?:в\\s+|on\\s+|in\\s+)?${WEBWORD}${SEP}${FOR}(.+)$`),
  webLast: re(`^${SEARCH_VERB}\\s+${ME}(.+?)\\s+(?:в|on|in)\\s+${WEBWORD}$`),
};

// What the message asks of the web, or null.
export function parseWeb(text) {
  const body = String(text || '').slice(0, 400).replace(LEAD, '').trim();
  if (!body) return null;
  let m;
  // "open YouTube and find / play ..."
  if ((m = PATTERNS.openThen.exec(body))) return answer(engineOf(m[1]), m[2], m[3]);
  // "... on YouTube", "... in Yandex" (before the next: "watch the trailer of dune on youtube" names the place at its end)
  if ((m = PATTERNS.onYoutube.exec(body))) return answer(engineOf(m[3]), m[1], m[2]);
  // "play a video about ..."
  if ((m = PATTERNS.videoWord.exec(body))) return answer('youtube', m[1], m[2]);
  if ((m = PATTERNS.youtubeFirst.exec(body))) {
    const engine = engineOf(m[2]);
    // ("открой яндекс" is no request: something must follow, and it must be a request verb)
    if (engine) return answer(engine, m[1], m[3]);
  }
  if ((m = PATTERNS.placeFirst.exec(body))) return search(engineOf(m[1]) || 'google', m[3]);
  if ((m = PATTERNS.google.exec(body))) return search('google', m[1] || m[2]);
  if ((m = PATTERNS.engineGiven.exec(body))) return search(engineOf(m[1]), m[2]);
  if ((m = PATTERNS.engineLast.exec(body))) return search(engineOf(m[2]), m[1]);
  if ((m = PATTERNS.web.exec(body))) return search('google', m[1]);
  if ((m = PATTERNS.webLast.exec(body))) return search('google', m[1]);
  return null;
}

// a request for `engine` with `verb`: on YouTube a verb of playing plays the first video, anything else shows the results
function answer(engine, verb, query) {
  const q = clean(query);
  if (!engine || !q) return null;
  if (engine === 'youtube' && playing(verb)) return { kind: 'video', query: q };
  if (engine === 'youtube' || playing(verb) === false) return search(engine, q);
  return null; // ("play" something on Google: that is no request)
}

function search(engine, query) {
  const q = clean(query);
  return engine && q ? { kind: 'search', engine, query: q } : null;
}

// A tag her AI added: [[search: engine | what]], [[search: what]] (Google), [[video: what]]. Returns the intent, or null.
export function parseWebTag(raw) {
  const text = String(raw || '');
  const video = /\[\[\s*video\s*:\s*([^\]]+)\]\]/i.exec(text);
  if (video) {
    const query = clean(video[1]);
    return query ? { kind: 'video', query } : null;
  }
  const tag = /\[\[\s*search\s*:\s*([^\]]+)\]\]/i.exec(text);
  if (!tag) return null;
  const [first, ...rest] = tag[1].split('|');
  const engine = rest.length ? engineOf(first) || (ENGINE_NAMES[first.trim().toLowerCase()] ? first.trim().toLowerCase() : null) : null;
  const query = clean(rest.length ? rest.join('|') : first);
  return query ? { kind: 'search', engine: engine || 'google', query } : null;
}

// Whether your message asks for what a tag would do (a model tags answers about anything: a search or a video happens behind a
// button, and only when you did ask for one).
export const ASKS_SEARCH = /найди|найти|поищи|ищи|искать|загугли|погугли|поиск|узнай|search|look\s+up|google|find\b/i;
export const ASKS_VIDEO = /включи|запусти|поставь|покажи|видео|ролик|клип|трейлер|стрим|ютуб|youtube|video|watch|play|clip|trailer/i;
