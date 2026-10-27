'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  scale: 0.6,        // sprite scale, 0.6 ≈ 250px tall
  muted: false,
  volume: 0.7,
  lang: 'auto',      // 'auto' follows the system language, or 'fr' / 'en'
  displayId: null,   // null = primary display
  wander: true,      // random teleports when idle
  possess: true,     // now and then she dives into the window she sits on and takes it over
  visible: true,
  welcomed: false,   // she has introduced herself (her welcome panel)
  assistant: 'auto', // the coding assistant she watches: 'claude' or 'codex' ('auto': whichever has her hooks)
  linked: false,     // a Claude Code event has reached her at least once
  chatModel: null,   // the model she talks with (null: the provider's first one)
  provider: 'ollama', // who answers her chat: a key of llm.js PROVIDERS
  apiKeys: {},       // { openai: 'sk-...' }, else the provider's env variable
  customUrl: '',     // the 'custom' provider: any OpenAI-compatible base URL (http://host:port/v1)
  claudeCwd: null,   // the folder Claude Code works in (null: your home folder)
  userName: '',      // what she calls you
  persona: '',       // how you want her, in your words (her chat)
  myLines: [],       // lines of yours she says now and then, with hers
  memories: [],      // things you asked her to remember (her chat)
  claudeMode: 'default', // Claude Code's permission mode in her chat: 'default' only reads, 'acceptEdits' edits without asking
  claude: true,      // she watches Claude Code (off: she just keeps you company, no word of it)
  rest: 'corner',    // where she rests when nothing's going on: 'corner', or 'taskbar' (sitting on it)
  motion: 'auto',    // her animations: 'auto' (like Windows' animation effects), 'full' or 'reduced'
  motionAsked: false, // she asked once, Windows' animations being off, whether to move anyway
  render: 'auto',   // how her window is drawn: 'auto', 'gl' (OpenGL) or 'software' (no graphics card), for PCs that show it black
  // her character (mood.js, life.js, themes.js, speech.js)
  emotions: true,    // she has moods: she gets angry, laughs, sulks, gets flustered
  theme: 'classic',  // her colours: a key of themes.js THEMES, or 'mood' (they follow how she feels)
  life: true,        // she finds things to do on her own (hacking, games, graffiti...)
  dj: true,          // DJ mode: while music plays she skips a track herself now and then
  musicAware: true,  // she knows what's playing (title and artist, from Windows' media controls)
  learn: true,       // she gets to know you and adapts to you (bond.js, kept in bond.json on this PC)
  voiceMode: 'chat', // her voice: 'off', 'chat' (her chat answers) or 'all' (everything she says)
  ttsEngine: 'system', // 'system' (Windows' voices, offline), 'capri' (her own, built in, offline), 'openai', 'elevenlabs' or 'custom' (tts.js)
  ttsVoice: '',      // the speech service's voice (empty: tts.js DEFAULTS)
  ttsModel: '',      // its model (empty: tts.js DEFAULTS)
  ttsUrl: '',        // 'custom': an OpenAI-compatible speech server (http://127.0.0.1:8880/v1)
  ttsFx: true,       // her "many minds" effect on a speech service's voice
  ttsRate: 1,        // how fast she talks
  // her senses and her hands (all off by default: each one is a permission you turn on)
  vision: false,     // she can take a picture of your screen and react to it (screen.js, eyes.js)
  visionModel: '',   // the vision model (empty: her chat model if it can see, else a default)
  visionEvery: 45,   // at most once this many seconds she glances on her own (0: only when asked)
  rhythm: false,     // she moves to your music, from the real sound (loopback audio, rhythm.js)
  hands: false,      // she can work your windows and type for you when you ask (control.js, hands.js)
  handsType: true,   // she may type (messages, text); off: only open/close/arrange windows
  ears: false,       // she listens to your microphone and writes down what you say (stt.js, ears.js)
  sttEngine: 'groq', // who turns your voice into text: 'groq', 'openai' or 'custom' (OpenAI-compatible)
  sttUrl: '',        // 'custom': http://127.0.0.1:8000/v1 (whisper.cpp, faster-whisper…)
  sttModel: '',      // its model (empty: the engine's default)
  pushToTalk: 'Control+Alt+Space', // hold it to talk to her
  converse: false,   // conversation mode: she keeps listening and you talk back and forth
  micDevice: '',     // which microphone ('' the system's default; an id from her ring menu › Microphone)
  micSensitivity: 0.4, // 0..1: how quietly you can speak and still be heard (ears.js micThreshold)
  micMeter: true,    // the live level in the mic badge by the clock
  audioOut: '',      // where her sounds and voice go ('' the system's default; her ring menu › Voice › Output)
};

let cache = null;
let pending = false; // changes not written yet (they're written a moment after the last one, or by flush())
let writeTimer = 0;

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load(fresh = false) {
  if (fresh) flush(); // (a change not written yet would be lost to the read)
  if (cache && (!fresh || pending)) return cache; // (pending still: the write failed, the file is older than what we hold)
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

const same = (a, b) => a === b || (typeof a === 'object' && a !== null && JSON.stringify(a) === JSON.stringify(b));

// Puts the changes in. Returns the keys that really changed (none: nothing was new and nothing is
// written). The file follows within a quarter of a second, once, whatever the number of changes: a
// slider dragged in her ring menu is dozens of them a second.
function save(patch) {
  const before = load();
  const changed = Object.keys(patch).filter((k) => !same(before[k], patch[k]));
  if (!changed.length) return changed;
  cache = { ...before, ...patch };
  pending = true;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, 250);
  return changed;
}

// Writes what's waiting, now (before reading it back, and before she quits or restarts). Whole or
// not at all: a crash in the middle never leaves half a file.
function flush() {
  clearTimeout(writeTimer);
  writeTimer = 0;
  if (!pending) return;
  pending = false;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, file());
  } catch (err) {
    console.error('[capri] could not save config:', err.message);
    // (a file held by another program, a full disk): not lost, tried again with the next change or at exit
    pending = true;
  }
}

module.exports = { load, save, flush, file, DEFAULTS };
