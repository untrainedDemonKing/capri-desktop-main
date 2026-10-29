// Which language a text is in, so that she answers in the one you speak (and reads her answer in it), whatever her
// menus are set to: Russian when it has Russian words in it as many as English ones, English when it is English, and
// `fallback` (the language of her menus) when it is too short or has no letters to tell by.

const WORD = /[\p{L}][\p{L}'’-]*/gu;
const CYRILLIC = /[Ѐ-ӿ]/;
const LATIN = /[A-Za-z]/;

export function languageOf(text, fallback = 'en') {
  const plain = String(text || '')
    .replace(/https?:\/\/\S+|\b[\w.+-]+@[\w-]+\.[\w.]+\b|`[^`]*`|\[\[[^\]]*\]\]/g, ' '); // links, addresses, code and her tags are no language
  let russian = 0;
  let english = 0;
  for (const word of plain.match(WORD) || []) {
    if (CYRILLIC.test(word)) russian += 1;
    else if (LATIN.test(word) && word.length > 1) english += 1; // ("a", "I": they say nothing)
  }
  // (a Russian who writes "открой Spotify" is still speaking Russian; one English word alone says nothing)
  if (russian && russian >= english) return 'ru';
  if (english >= 2) return 'en';
  return fallback;
}
