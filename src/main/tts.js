'use strict';

// Her voice, when it's a speech service and not the system's own (that one is in the overlay,
// speech.js): her line read out with how she feels passed along, and the audio handed back to
// the overlay, which plays it through her "many minds" effect. Keys stay here.
//
// OpenAI (gpt-4o-mini-tts takes instructions: her tone and mood), ElevenLabs (any voice of your
// library; with an eleven_v3 model her mood goes in as an audio tag), Chatterbox (a model on your own PC,
// started and kept by her: chatterbox.js; her mood goes in as its dials), Piper (a light model for a PC with
// no card, run by her: piper.js), or any OpenAI-compatible server (a local one like openedai-speech:
// /v1/audio/speech).

const { moodDials } = require('./chatterbox');

const ENGINES = {
  system: { label: 'System (offline)' },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1', key: 'openai', env: 'OPENAI_API_KEY' },
  elevenlabs: { label: 'ElevenLabs', url: 'https://api.elevenlabs.io/v1', key: 'elevenlabs', env: 'ELEVENLABS_API_KEY' },
  chatterbox: { label: 'Chatterbox (on this PC, started by her)' },
  piper: { label: 'Piper (on this PC, light, run by her)' },
  custom: { label: 'OpenAI-compatible server', key: 'tts' },
};

// Where to get a key, by engine
const KEY_PAGES = {
  openai: 'https://platform.openai.com/api-keys',
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
};

const DEFAULTS = {
  openai: { model: 'gpt-4o-mini-tts', voice: 'nova' },
  // "Domi", one of ElevenLabs' premade voices: young, confident. Any voice id of yours works.
  elevenlabs: { model: 'eleven_multilingual_v2', voice: 'AZnzlk1XvdvUeBnXmlld' },
  custom: { model: 'tts-1', voice: 'af_bella' },
};

// how she sounds in each mood, for a model that takes instructions
const STYLE = {
  calm: 'easygoing and a little mischievous',
  happy: 'bubbly and playful, smiling as she speaks',
  laugh: 'laughing through the words, giddy',
  angry: 'angry: sharp, clipped, a growl under it, barely holding it in',
  annoyed: 'annoyed: flat, sarcastic, eye-rolling',
  sad: 'sad and quiet, wistful, a little slower',
  shy: 'flustered and embarrassed, a bit breathless, trying to sound cool',
  smug: 'smug and teasing, drawing words out',
  surprised: 'surprised, quick, rising',
  dreamy: 'dreamy and soft, far away',
  bored: 'bored, drawling, sighing',
};

// ElevenLabs v3 audio tags
const V3_TAG = {
  happy: 'excited', laugh: 'laughs', angry: 'angry', annoyed: 'annoyed', sad: 'sad', shy: 'nervous',
  smug: 'mischievously', surprised: 'surprised', dreamy: 'whispers', bored: 'sighs',
};

function instructions(mood) {
  return 'Voice: a young woman, a playful, mischievous cyberpunk AI ghost made of dozens of minds; quick, confident, '
    + `teasing, warm underneath. Emotion right now: ${STYLE[mood] || STYLE.calm}. Natural, not theatrical.`;
}

const withCode = (err, code) => Object.assign(err, { code });

async function failure(res) {
  const body = await res.text().catch(() => '');
  let message = body.slice(0, 200) || `answered ${res.status}`;
  try {
    const parsed = JSON.parse(body);
    const err = parsed.error || parsed.detail;
    if (err) message = typeof err === 'string' ? err : err.message || JSON.stringify(err).slice(0, 200);
  } catch {
    // not JSON
  }
  return withCode(new Error(message), res.status === 401 || res.status === 403 ? 'badkey' : null);
}

// The audio of `text` said by the engine picked in her config, as a Buffer (mp3, or wav from Chatterbox and
// Piper). keys: the opened API keys ({ openai, elevenlabs, tts }); lang: what she speaks; base: where
// Chatterbox is listening (chatterbox.js knows); piper: her Piper (piper.js); sample: the name of the recording she was
// given as her voice ('' none; voice-sample.js), which Chatterbox speaks with; without one, the voice named in her settings.
// sampleLang: the language spoken in that recording, if it is known.
async function speak(cfg, keys, { text, mood = 'calm', lang = 'en', base: chatterboxBase = '', piper = null, sample = '', sampleLang = '' }) {
  const input = String(text || '').trim().slice(0, 1500);
  if (!input) throw new Error('nothing to say');
  const engine = ENGINES[cfg.ttsEngine] ? cfg.ttsEngine : 'system';
  if (engine === 'system') throw withCode(new Error('this voice is made and played by the overlay'), engine);
  if (engine === 'piper') {
    if (!piper) throw withCode(new Error('Piper is not running'), 'nourl');
    return piper.speak(cfg, { text: input, lang: String(lang || 'en').slice(0, 2) });
  }
  const def = DEFAULTS[engine] || {};
  const model = cfg.ttsModel || def.model;
  const voice = cfg.ttsVoice || def.voice;
  const e = ENGINES[engine];
  const key = keys[e.key] || (e.env && process.env[e.env]) || '';
  let res;
  if (engine === 'chatterbox') {
    const base = String(chatterboxBase || '').replace(/\/+$/, '');
    if (!base) throw withCode(new Error('Chatterbox is not running'), 'nourl');
    // (the extras are for her own server around Chatterbox; any other one ignores what it does not know)
    const body = { model: 'chatterbox', input, response_format: 'wav', language: String(lang || 'en').slice(0, 2), ...moodDials(mood), mood };
    const named = sample || cfg.ttsVoice; // (the recording she was given is her voice; a name in her settings is for when she has none)
    if (named) body.voice = named;
    // a recording in another language than she speaks: Chatterbox carries the accent of the recording into the speech,
    // unless the guidance towards the recording's own delivery is switched off (its own advice for this case)
    if (sample && sampleLang && sampleLang !== body.language) body.cfg_weight = 0;
    res = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000), // (a slow card, a long answer)
    });
  } else if (engine === 'elevenlabs') {
    if (!key) throw withCode(new Error('no ElevenLabs key'), 'nokey');
    const tag = /v3/.test(model) && V3_TAG[mood] ? `[${V3_TAG[mood]}] ` : '';
    const lively = ['angry', 'laugh', 'happy', 'surprised'].includes(mood);
    res = await fetch(`${e.url}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'audio/mpeg', 'xi-api-key': key },
      body: JSON.stringify({
        text: tag + input,
        model_id: model,
        voice_settings: { stability: lively ? 0.32 : 0.5, similarity_boost: 0.75, style: lively ? 0.55 : 0.3, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(30000),
    });
  } else {
    const base = (engine === 'custom' ? String(cfg.ttsUrl || '') : e.url).replace(/\/+$/, '');
    if (!base) throw withCode(new Error('no address set for the voice server'), 'nourl');
    if (engine === 'openai' && !key) throw withCode(new Error('no OpenAI key'), 'nokey');
    const body = { model, voice, input, response_format: 'mp3' };
    if (/gpt-4o/.test(model)) body.instructions = instructions(mood);
    res = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  }
  if (!res.ok) throw await failure(res);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { ENGINES, KEY_PAGES, DEFAULTS, speak };
