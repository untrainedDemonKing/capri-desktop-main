'use strict';

// Straight requests to the web, from her chat: a search in the engine you named, or a video played (the first result of a
// YouTube search, opened on its own page, so that it starts to play in your browser). What she opens is always an address she
// built herself from the words you said: the browser is told only an https address of these sites.

const ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  yandex: { name: 'Яндекс', url: 'https://yandex.ru/search/?text=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  youtube: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
  wikipedia: { name: 'Wikipedia', url: (lang) => `https://${lang === 'ru' ? 'ru' : 'en'}.wikipedia.org/w/index.php?search=` },
  github: { name: 'GitHub', url: 'https://github.com/search?q=' },
  maps: { name: 'Google Maps', url: 'https://www.google.com/maps/search/' },
  images: { name: 'Google Images', url: 'https://www.google.com/search?tbm=isch&q=' },
};
const QUERY_MAX = 300;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// The address of a search, or null (no such engine, or nothing to look for).
function searchUrl(engine, query, lang = 'en') {
  const e = ENGINES[String(engine || '').toLowerCase()];
  const q = String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX);
  if (!e || !q) return null;
  const base = typeof e.url === 'function' ? e.url(lang) : e.url;
  return `${base}${encodeURIComponent(q)}`;
}

// The first video in a YouTube results page: { id, title }, or null. (The page carries its results as JSON in the HTML; the first
// "videoRenderer" is the first real video, not an ad or a channel or a playlist.)
function firstVideo(html) {
  const text = String(html || '');
  const at = text.indexOf('"videoRenderer":{"videoId":"');
  if (at < 0) return null;
  const chunk = text.slice(at, at + 4000);
  const id = /^"videoRenderer":\{"videoId":"([\w-]{11})"/.exec(chunk)?.[1];
  if (!id) return null;
  const title = /"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(chunk)?.[1];
  let said = '';
  try {
    said = title ? JSON.parse(`"${title}"`) : '';
  } catch {
    said = title || '';
  }
  return { id, title: said.slice(0, 120) };
}

// What to open for "play a video about ...": the video itself when it can be found, else the page of results.
async function videoUrl(query, { fetch: fetchFn = fetch, timeout = 8000 } = {}) {
  const results = searchUrl('youtube', query);
  if (!results) return null;
  try {
    const res = await fetchFn(results, { headers: { 'user-agent': UA, 'accept-language': 'ru,en;q=0.8' }, signal: AbortSignal.timeout(timeout) });
    if (res.ok) {
      const found = firstVideo(await res.text());
      if (found) return { url: `https://www.youtube.com/watch?v=${found.id}`, title: found.title, exact: true };
    }
  } catch {
    // no net, or the page is not what it was: the results page, then
  }
  return { url: results, title: '', exact: false };
}

// Opens it in the browser. `open(url)` is the one that does (the shell's), and only an https address of a site above is handed to it.
const HOSTS = /^https:\/\/(?:www\.google\.com|yandex\.ru|www\.bing\.com|duckduckgo\.com|www\.youtube\.com|(?:ru|en)\.wikipedia\.org|github\.com)\//;
async function open(url, opener) {
  if (!HOSTS.test(String(url))) return false;
  await opener(url);
  return true;
}

module.exports = { ENGINES, searchUrl, firstVideo, videoUrl, open, QUERY_MAX };
