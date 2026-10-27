// Her ears: you talk, she writes it down and answers (chat.js handles the answer, speech.js reads it
// out, so you can talk to her hands-free). The microphone records here; the audio is turned into
// text by the service in main.js (stt.js). Off unless you turn it on (her menu › Senses › Listen to
// me); while it's on and she's actually recording, the microphone dot by the clock is lit, and the
// recording stops on its own when you go quiet.
//
// Two ways: press-to-talk (a shortcut, or the mic button when you click her) records one thing you
// say; conversation mode keeps the mic open and you go back and forth, she waits her turn while she
// talks so she doesn't hear herself.

import { lifeLines } from './lines-life.js';

const SILENCE_MS = 1100;      // this long quiet after speech: your turn is over
const MAX_UTTERANCE = 15000;  // never record longer than this at a stretch
const MIN_SPEECH_MS = 300;    // shorter than this: probably nothing, ignore
const VOICE_LEVEL = 0.012;    // above this RMS counts as speech (her ring menu › Microphone moves it: micThreshold)
const VAD_MS = 40;            // how often the level is checked (25 times a second is plenty)
const ECHO_MS = 450;          // after she stops talking, a moment before her own echo is gone

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
    this.recorder = null;
    this.chunks = [];
    this.state = 'off';     // 'off' | 'idle' | 'listening' | 'thinking'
    this.recording = false;
    this.speaking = false;  // she's talking: don't listen to her
    this.deviceId = '';     // the microphone picked (''= the system's)
    this.voiceLevel = VOICE_LEVEL;
    this.level = 0;         // how loud it is now, 0..1 (the meter in her ring menu and the badge)
    this.audioOut = '';     // where "hear yourself" plays (the output device picked in her ring menu › Voice)
    this.monitorHeld = false; // "hear yourself" is on (it keeps one watcher)
    this.monitorCtx = null;
    this.watchers = 0;      // how many things want to see the level (her ring menu's Microphone tab)
    this.metering = false;  // the mic is open only to show the level
    this.onTranscript = null; // (text) => void (chat.js sends it as if typed)
    this.onState = null;      // (state) => void (the indicator): 'off' | 'idle' | 'listening' | 'metering' | 'thinking'
    this.onLevel = null;      // (level 0..1) => void, while the mic is open
    this.voiceSince = 0;
    this.silenceSince = 0;
    this.startedAt = 0;
  }

  get t() {
    return lifeLines(this.brain.lang).ears;
  }

  configure(cfg) {
    this.enabled = cfg.ears === true;
    this.lang = cfg.lang === 'auto' ? '' : (cfg.lang || 'ru');
    this.voiceLevel = micThreshold(cfg.micSensitivity);
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
    this.startRecording();
    this.single = true;
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
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.vadData = new Uint8Array(this.analyser.fftSize);
    this.vadTimer = setInterval(() => this.vad(), VAD_MS);
    return true;
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
    try {
      this.recorder?.state === 'recording' && this.recorder.stop();
    } catch {
      // already stopped
    }
    this.recorder = null;
    this.recording = false;
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.stream = null;
    this.analyser = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.setState('off');
  }

  startRecording() {
    if (!this.stream || this.recording) return;
    this.chunks = [];
    try {
      this.recorder = new MediaRecorder(this.stream, { mimeType: pickMime() });
    } catch {
      this.recorder = new MediaRecorder(this.stream);
    }
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.onstop = () => this.send();
    this.recorder.start();
    this.recording = true;
    this.startedAt = performance.now();
    this.voiceSince = 0;
    this.silenceSince = performance.now();
    this.setState('listening');
  }

  // Watches the level: in conversation mode it starts a turn when you speak and ends it when you go
  // quiet; it also won't listen while she's talking.
  vad() {
    if (!this.analyser) return;
    this.analyser.getByteTimeDomainData(this.vadData);
    let sum = 0;
    for (const v of this.vadData) sum += ((v - 128) / 128) ** 2;
    const rms = Math.sqrt(sum / this.vadData.length);
    const now = performance.now();
    // the meter: up at once, down a little slower
    const shown = meterLevel(rms);
    this.level = shown > this.level ? shown : this.level * 0.8 + shown * 0.2;
    this.onLevel?.(this.level);
    const voice = rms > this.voiceLevel && !this.speaking && now > (this.echoUntil || 0);
    if (voice) {
      this.voiceSince = this.voiceSince || now;
      this.silenceSince = now;
      if (this.recording && this.state !== 'listening') this.setState('listening');
    }
    if (!this.recording) {
      // conversation mode, between turns: start a turn when you begin to speak (not while her menu is
      // showing the level or playing your mic back: then you're testing it, not talking to her)
      if (this.converse && voice && !this.speaking && this.watchers === 0) this.startRecording();
      return;
    }
    const spoke = this.voiceSince && now - this.voiceSince > MIN_SPEECH_MS;
    const quietLong = now - this.silenceSince > SILENCE_MS;
    if (now - this.startedAt > MAX_UTTERANCE || (spoke && quietLong)) this.finish();
    else if (!spoke && now - this.startedAt > 4000 && this.single) this.finish(); // pressed to talk and said nothing
  }

  finish() {
    if (!this.recording) return;
    this.recording = false;
    try {
      this.recorder?.stop(); // fires onstop -> send()
    } catch {
      this.recorder = null;
    }
  }

  async send() {
    const blob = new Blob(this.chunks, { type: this.chunks[0]?.type || 'audio/webm' });
    this.chunks = [];
    const spoke = this.voiceSince > 0;
    this.voiceSince = 0;
    if (!spoke || blob.size < 1200) {
      this.afterTurn();
      return;
    }
    this.setState('thinking');
    const buf = await blob.arrayBuffer();
    const res = await this.host.transcribe({ audio: buf, mime: blob.type, lang: this.lang }).catch((err) => ({ ok: false, error: err.message, code: err.code }));
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

function pickMime() {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

// Whisper fills silence with its own guesses ("Субтитры сделал...", "Thank you."): drop the usual ones.
const JUNK = /^(?:you|thank you\.?|thanks for watching\.?|продолжение следует\.{0,3}|субтитры .*|редактор субтитров .*|корректор .*|амара\.орг.*|♪+|\.+|\s*)$/i;
export function clean(text) {
  const t = String(text || '').trim();
  return JUNK.test(t) ? '' : t;
}
