// Her ears: you talk, she writes it down and answers (chat.js handles the answer, speech.js reads it
// out, so you can talk to her hands-free). The microphone records here; the audio is turned into
// text by the service in main.js (stt.js). Off unless you turn it on (her menu › Senses › Listen to
// me); while it's on and she's actually recording, the microphone dot by the clock is lit, and the
// recording stops on its own when you go quiet.
//
// Two ways: press-to-talk (a shortcut, or the mic button when you click her) records one thing you
// say; conversation mode keeps the mic open and you go back and forth, she waits her turn while she
// talks so she doesn't hear herself.

import { lifeLines } from '../mind/lines-life.js';
import { TurnDetector, FRAME_MS, PRE_ROLL_MS, TAIL_MS, turnAudio } from './listen.js';

const VAD_MS = 40;            // how often the level is checked (25 times a second is plenty)
const ECHO_MS = 450;          // after she stops talking, a moment before her own echo is gone
const SPEAK_MIN_MS = 120;     // pressed to send: a word this short ("да") is still a word
const VOICE_LEVEL_DEFAULT = 0.012; // above this RMS counts as speech (her ring menu › Microphone moves it: micSensitivity); a noisy room raises it by itself (listen.js)

// Sensitivity 0..1 (her ring menu) -> the RMS above which a sound counts as your voice: 0 hears only
// a clear voice (0.035), 1 the faintest (0.003). The default 0.4 is the old fixed 0.012.
export function micThreshold(sensitivity = 0.4) {
  const s = Math.min(1, Math.max(0, Number.isFinite(sensitivity) ? sensitivity : 0.4));
  return 0.035 * Math.pow(0.08, s);
}

// RMS -> the 0..1 a level meter shows (a voice at normal volume lands around 0.5).
export function meterLevel(rms) {
  return Math.min(1, Math.sqrt(Math.max(0, rms) / 0.12));
}

export class Ears {
  constructor({ host, capri, panel, voice, brain, speech }) {
    this.host = host;
    this.capri = capri;
    this.panel = panel;
    this.voice = voice;
    this.brain = brain;
    this.speech = speech;
    this.enabled = false;
    this.converse = false;
    this.lang = 'ru';
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.detector = new TurnDetector({ base: VOICE_LEVEL_DEFAULT });
    this.capture = null;    // what taps the microphone's samples: { node, close() }
    this.rate = 16000;      // the rate the samples come at
    this.ring = [];         // the last moments heard (pre-roll), while no turn is on: [Float32Array]
    this.ringSamples = 0;
    this.chunks = [];       // the turn so far, from its pre-roll on
    this.preSamples = 0;    // how much of it was heard before the voice was sure
    this.turnAt = 0;
    this.clock = 0;         // how many milliseconds of the mic have been looked at (the turn is told from the samples themselves, not from when the window got round to look: a slow moment of the PC must not cost the first word)
    this.frameSum = 0;      // the frame being measured: its sum of squares
    this.frameN = 0;        // and how many samples of it
    this.state = 'off';     // 'off' | 'idle' | 'listening' | 'thinking'
    this.recording = false;
    this.speaking = false;  // she's talking: don't listen to her
    this.deviceId = '';     // the microphone picked (''= the system's)
    this.voiceLevel = VOICE_LEVEL_DEFAULT;
    this.hint = '';         // the language of her menus: for when the language heard is not one she speaks
    this.level = 0;         // how loud it is now, 0..1 (the meter in her ring menu and the badge)
    this.audioOut = '';     // where "hear yourself" plays (the output device picked in her ring menu › Voice)
    this.monitorHeld = false; // "hear yourself" is on (it keeps one watcher)
    this.monitorCtx = null;
    this.watchers = 0;      // how many things want to see the level (her ring menu's Microphone tab)
    this.metering = false;  // the mic is open only to show the level
    this.onTranscript = null; // (text) => void (chat.js sends it as if typed)
    this.onState = null;      // (state) => void (the indicator): 'off' | 'idle' | 'listening' | 'metering' | 'thinking'
    this.onLevel = null;      // (level 0..1) => void, while the mic is open
  }

  get t() {
    return lifeLines(this.brain.lang).ears;
  }

  // the level above which a sound is your voice now: her menu's sensitivity, or higher where the room is noisy
  get listenLevel() {
    return this.detector.threshold;
  }

  configure(cfg) {
    this.enabled = cfg.ears === true;
    // (the language you picked; with "auto" none is told, and the recogniser hears which it is, with the language of her menus for when it is unsure)
    this.lang = cfg.langSetting === 'auto' || cfg.lang === 'auto' ? '' : (cfg.lang || 'ru');
    this.hint = cfg.lang && cfg.lang !== 'auto' ? cfg.lang : '';
    this.voiceLevel = micThreshold(cfg.micSensitivity);
    this.detector.base = this.voiceLevel;
    const out = typeof cfg.audioOut === 'string' ? cfg.audioOut : '';
    if (out !== this.audioOut) {
      this.audioOut = out;
      this.monitorCtx?.setSinkId?.(out).catch(() => {});
    }
    const device = typeof cfg.micDevice === 'string' ? cfg.micDevice : '';
    if (device !== this.deviceId) {
      this.deviceId = device;
      if (this.stream) this.reopen(); // another microphone: the same job on it
    }
    const converse = this.enabled && cfg.converse === true;
    if (converse !== this.converse) {
      this.converse = converse;
      if (converse) this.startConverse();
      else this.stopConverse();
    }
    if (!this.enabled) this.shutMic();
  }

  setState(s) {
    if (s === this.state) return;
    this.state = s;
    this.onState?.(s);
  }

  // She's speaking (app.js tells us): hold the mic so she doesn't transcribe herself.
  heardSelf(on) {
    this.speaking = on;
    if (!on) this.echoUntil = performance.now() + ECHO_MS;
  }

  // Press-to-talk: start recording one thing you say, or stop and send it now.
  async toggle() {
    if (!this.enabled) {
      this.panel.say({ kind: 'info', face: 'aside', line: this.t.off, hold: 4000, life: true });
      return;
    }
    if (this.recording) {
      this.finish();
      return;
    }
    await this.listenOnce();
  }

  // One utterance: open the mic, record until you stop or go quiet, transcribe, hand it over.
  async listenOnce() {
    if (!(await this.openMic())) return;
    this.capri.wake?.();
    this.single = true;
    this.startRecording({ single: true });
  }

  // Conversation mode: the mic stays open; a turn starts when you start talking (vad).
  async startConverse() {
    if (!(await this.openMic())) return;
    this.single = false;
    this.setState('idle');
  }

  stopConverse() {
    this.single = false;
    if (this.enabled && this.watchers > 0 && this.stream) {
      // her ring menu is still showing the level (or playing your mic back): the mic stays open for it
      if (!this.recording) {
        this.metering = true;
        this.setState('metering');
      }
      return;
    }
    this.shutMic();
  }

  // `quiet`: asked for by her ring menu's level meter, which says so itself if it can't: no panel,
  // and she stays on (the next try may work: another microphone, the permission given).
  async openMic({ quiet = false } = {}) {
    if (this.stream) return true;
    const audio = { echoCancellation: true, noiseSuppression: true };
    try {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: this.deviceId ? { ...audio, deviceId: { exact: this.deviceId } } : audio });
      } catch (err) {
        // the microphone you picked is gone (unplugged): the system's default instead
        if (!this.deviceId || !['OverconstrainedError', 'NotFoundError'].includes(err.name)) throw err;
        this.stream = await navigator.mediaDevices.getUserMedia({ audio });
      }
    } catch (err) {
      if (quiet) return false;
      this.panel.say({ kind: 'error', face: 'wide', line: this.t.noMic, quote: String(err.message).slice(0, 80), hold: 6000, life: true });
      this.enabled = false;
      return false;
    }
    // (16 kHz is what a recogniser wants: the browser brings the mic's rate to it)
    try {
      this.ctx = new AudioContext({ sampleRate: 16000 });
    } catch {
      this.ctx = new AudioContext();
    }
    this.ctx.resume?.().catch?.(() => {});
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.vadData = new Uint8Array(this.analyser.fftSize);
    this.rate = this.ctx.sampleRate || 16000;
    this.ring = [];
    this.ringSamples = 0;
    this.clock = 0;
    this.frameSum = 0;
    this.frameN = 0;
    this.detector.calibrate();
    await this.tap(src);
    this.vadTimer = setInterval(() => this.vad(), VAD_MS);
    return true;
  }

  // The samples of the mic, a tenth of a second at a time, into `hear` (an audio worklet; a script processor where there is none).
  // Without it she can still show the level, but there is nothing to send.
  async tap(src) {
    const ctx = this.ctx;
    const hear = (samples) => {
      if (ctx !== this.ctx) return;
      this.hear(samples);
    };
    try {
      if (ctx.audioWorklet?.addModule && typeof AudioWorkletNode !== 'undefined') {
        await ctx.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url).href);
        if (ctx !== this.ctx) return;
        const node = new AudioWorkletNode(ctx, 'capri-pcm', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        node.port.onmessage = (e) => hear(e.data);
        const mute = ctx.createGain();
        mute.gain.value = 0;
        src.connect(node);
        node.connect(mute);
        mute.connect(ctx.destination);
        this.capture = { close: () => { node.port.onmessage = null; try { src.disconnect(node); node.disconnect(); mute.disconnect(); } catch { /* gone */ } } };
        return;
      }
      if (ctx.createScriptProcessor) {
        const node = ctx.createScriptProcessor(2048, 1, 1);
        node.onaudioprocess = (e) => hear(new Float32Array(e.inputBuffer.getChannelData(0)));
        const mute = ctx.createGain();
        mute.gain.value = 0;
        src.connect(node);
        node.connect(mute);
        mute.connect(ctx.destination);
        this.capture = { close: () => { node.onaudioprocess = null; try { src.disconnect(node); node.disconnect(); mute.disconnect(); } catch { /* gone */ } } };
      }
    } catch {
      this.capture = null;
    }
  }

  // What the mic heard: kept (as the pre-roll while no turn is on, and as the turn when there is one), and looked at frame by
  // frame for your turn (the samples come in order, so the first word is always inside what was kept, however late this runs).
  hear(samples) {
    if (this.recording) {
      this.chunks.push(samples);
    } else {
      this.ring.push(samples);
      this.ringSamples += samples.length;
      const keep = (PRE_ROLL_MS / 1000) * this.rate;
      while (this.ring.length > 1 && this.ringSamples - this.ring[0].length >= keep) this.ringSamples -= this.ring.shift().length;
    }
    const size = Math.max(1, Math.round((this.rate * FRAME_MS) / 1000));
    for (let i = 0; i < samples.length; i++) {
      this.frameSum += samples[i] * samples[i];
      if (++this.frameN === size) {
        const rms = Math.sqrt(this.frameSum / size);
        this.frameSum = 0;
        this.frameN = 0;
        this.clock += FRAME_MS;
        this.judge(rms, this.clock);
      }
    }
  }

  // Another microphone while this one is open: close it and open the new one for the same job.
  async reopen() {
    const wasEnabled = this.enabled;
    this.shutMic();
    if (!wasEnabled) return;
    if (this.converse) await this.startConverse();
    else if (this.watchers > 0) await this.watch(true, { again: true });
  }

  // The level meter (her ring menu › Microphone): asks for the level for as long as that tab is on
  // screen. The mic is opened for it if it isn't already, and the badge says so (it's live then).
  // Resolves false if the mic can't be opened (off, or no permission).
  async watch(on, { again = false } = {}) {
    if (!again) this.watchers = Math.max(0, this.watchers + (on ? 1 : -1));
    if (on) {
      if (!this.enabled) return false;
      const opened = !this.stream;
      if (!(await this.openMic({ quiet: true }))) return false;
      if (opened) {
        this.metering = true;
        this.setState('metering');
      }
      if (this.monitorHeld && !this.monitorCtx) await this.startMonitor(); // (the mic was reopened: it goes on)
      return true;
    }
    if (this.watchers === 0 && this.metering) {
      this.metering = false;
      if (!this.converse && !this.recording) this.shutMic();
      else this.setState(this.recording ? 'listening' : 'idle');
    }
    return true;
  }

  // Her ring menu › Voice › hear yourself: your mic straight to the output picked, to check where
  // the sound goes (headphones, speakers). It keeps the mic open (the badge says so) until it's let
  // go; with speakers it can whistle, so it's for a check. Resolves false if the mic won't open.
  async monitor(on) {
    if (on) {
      if (this.monitorHeld) return Boolean(this.monitorCtx);
      this.monitorHeld = true;
      if (!(await this.watch(true)) || !this.monitorCtx) {
        await this.monitor(false);
        return false;
      }
      return true;
    }
    this.dropMonitor();
    if (this.monitorHeld) {
      this.monitorHeld = false;
      await this.watch(false);
    }
    return true;
  }

  async startMonitor() {
    if (!this.stream || this.monitorCtx) return;
    const ctx = new AudioContext();
    if (this.audioOut && ctx.setSinkId) await ctx.setSinkId(this.audioOut).catch(() => {});
    const src = ctx.createMediaStreamSource(this.stream);
    const gain = ctx.createGain();
    gain.gain.value = 0.7;
    src.connect(gain);
    gain.connect(ctx.destination);
    this.monitorCtx = ctx;
  }

  dropMonitor() {
    this.monitorCtx?.close().catch(() => {});
    this.monitorCtx = null;
  }

  // The microphones there are: [{ id, label }], the system's default first. (A name only shows once
  // the mic has been opened once: the browser keeps them back until then.)
  async devices() {
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const mics = all.filter((d) => d.kind === 'audioinput' && d.deviceId && !['default', 'communications'].includes(d.deviceId));
    return [{ id: '', label: '' }, ...mics.map((d, i) => ({ id: d.deviceId, label: d.label || `#${i + 1}` }))];
  }

  shutMic() {
    this.dropMonitor();
    clearInterval(this.vadTimer);
    this.vadTimer = 0;
    this.metering = false;
    this.level = 0;
    this.capture?.close();
    this.capture = null;
    this.ring = [];
    this.ringSamples = 0;
    this.chunks = [];
    this.recording = false;
    this.detector.reset();
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.stream = null;
    this.analyser = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.setState('off');
  }

  // The turn begins: what was heard just before it (the pre-roll) is its start, and what comes goes on from it.
  startRecording({ single = false, now = this.capture ? this.clock : performance.now() } = {}) {
    if (!this.stream || this.recording) return;
    this.chunks = this.ring;
    this.preSamples = this.ringSamples;
    this.ring = [];
    this.ringSamples = 0;
    this.recording = true;
    this.turnAt = now;
    if (single) this.detector.begin(now, { single: true });
    this.setState('listening');
  }

  // The level, 25 times a second: the meter (and, where the samples of the mic cannot be had, your turn is told from this).
  vad() {
    if (!this.analyser) return;
    this.analyser.getByteTimeDomainData(this.vadData);
    let sum = 0;
    for (const v of this.vadData) sum += ((v - 128) / 128) ** 2;
    const rms = Math.sqrt(sum / this.vadData.length);
    // the meter: up at once, down a little slower
    const shown = meterLevel(rms);
    this.level = shown > this.level ? shown : this.level * 0.8 + shown * 0.2;
    this.onLevel?.(this.level);
    if (!this.capture) this.judge(rms, performance.now());
  }

  // One look at the level (turn detector, listen.js): your turn starts, ends, or was only noise. She does not listen while
  // she talks, nor to her own voice dying away, nor while her menu shows the level or plays your mic back (then you are
  // testing it, not talking to her).
  judge(rms, now) {
    const deaf = this.speaking || performance.now() < (this.echoUntil || 0);
    const event = this.detector.push(rms, now, { deaf });
    if (event === 'start') {
      if (this.converse && !deaf && this.watchers === 0 && !this.recording) this.startRecording({ now });
      else this.detector.reset();
    } else if (event === 'end') {
      if (this.recording) this.finish();
    } else if (event === 'drop') {
      if (this.recording) this.cancel();
    }
  }

  // Your turn is over (you went quiet, or pressed the button again): what was heard is sent to be written down.
  finish() {
    if (!this.recording) return;
    const d = this.detector;
    const voiced = d.voicedMs >= SPEAK_MIN_MS;
    // up to your last word and a short tail: a long quiet after it only makes the recogniser invent words
    const keep = this.preSamples / this.rate + Math.max(0, (d.lastVoiceAt || this.turnAt) - this.turnAt) / 1000 + TAIL_MS / 1000;
    const chunks = this.chunks;
    this.chunks = [];
    this.recording = false;
    d.reset();
    if (!voiced) {
      this.afterTurn();
      return;
    }
    this.send(chunks, keep);
  }

  // It was a noise (a click, a cough) or nothing: no turn.
  cancel() {
    this.chunks = [];
    this.recording = false;
    this.detector.reset();
    this.afterTurn();
  }

  async send(chunks, keep) {
    const { wav, seconds } = turnAudio(chunks, this.rate, keep);
    if (seconds < 0.15) {
      this.afterTurn();
      return;
    }
    this.setState('thinking');
    const res = await this.host.transcribe({ audio: wav, mime: 'audio/wav', lang: this.lang, hint: this.hint }).catch((err) => ({ ok: false, error: err.message, code: err.code }));
    if (!res?.ok) {
      this.panel.say({ kind: 'error', face: 'aside', line: res?.code === 'nokey' ? this.t.needKey : this.t.failed, quote: String(res?.error || '').slice(0, 80), hold: 6000, life: true });
      this.afterTurn();
      return;
    }
    const text = clean(res.text);
    if (text && text.length > 1) this.onTranscript?.(text);
    this.afterTurn(); // (nothing understood: just keep listening)
  }

  // After a turn: in conversation mode, wait for her to finish talking, then listen again (the vad
  // picks your next turn up). Otherwise (press-to-talk, or conversation was switched off meanwhile)
  // the mic closes, unless her ring menu is still showing its level.
  afterTurn() {
    this.single = false;
    if (this.converse) this.setState('idle');
    else if (this.enabled && this.watchers > 0 && this.stream) {
      this.metering = true;
      this.setState('metering');
    } else this.shutMic();
  }
}

// Whisper fills silence with its own guesses ("Субтитры сделал...", "Thank you.", "Продолжение следует..."): the usual ones
// are dropped (they are what a recogniser says when it heard a noise, not you).
const JUNK = new RegExp(`^(?:${[
  'you', 'thank you[.!]?', 'thanks for watching[.!]?', 'thanks for listening[.!]?',
  'продолжение следует\\.{0,3}', 'субтитры .*', 'редактор субтитров .*', 'корректор .*', 'амара\\.орг.*', 'спасибо за (?:просмотр|внимание)[.!]?',
  'подписывайтесь на (?:мой |наш )?канал.*', 'ставьте лайки.*', 'до новых встреч[.!]?', 'dimatorzok.*', 'сделал dimatorzok.*',
  '♪+', '[.,!?…\\s-]*',
].join('|')})$`, 'i');
export function clean(text) {
  const t = String(text || '').trim();
  return JUNK.test(t) ? '' : t;
}
