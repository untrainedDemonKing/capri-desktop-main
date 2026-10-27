// Her voice: her chat answers (or everything she says) read out loud, the way she feels.
//
// Two ways. The system's own voices (free, offline: Windows' voices, Irina / Svetlana in Russian),
// pitched and paced by her mood. Or a speech service (main.js tts.js: OpenAI, ElevenLabs, or an
// OpenAI-compatible server on your PC), told her mood, and played here through her "many minds"
// effect: a chorus of slightly delayed copies of her, like the dozens of minds she's made of, and a
// little digital edge. Her body nods along while she talks.

const LOCALES = { ru: 'ru-RU', en: 'en-US', fr: 'fr-FR', es: 'es-ES', pt: 'pt-BR' };
// female system voices she'd rather use, by language (Windows, macOS, Edge's names)
const PREFERRED = {
  ru: ['svetlana', 'dariya', 'irina', 'ekaterina', 'milena', 'anna', 'elena', 'alena'],
  en: ['aria', 'jenny', 'ava', 'emma', 'zira', 'samantha', 'susan', 'hazel', 'libby', 'sonia', 'michelle'],
  fr: ['denise', 'eloise', 'julie', 'hortense', 'vivienne', 'amelie', 'audrey'],
  es: ['elvira', 'helena', 'laura', 'dalia', 'sabina', 'paloma', 'monica'],
  pt: ['francisca', 'thalita', 'maria', 'luciana', 'fernanda'],
};
const MALE = /pavel|dmitry|david|mark|guy|george|james|paul|pablo|daniel|antonio|henri|thomas|raul|ryan|eric|roger|christopher/i;
// pitch and pace by mood (the system voice): higher and quicker when she's up, lower when she's down
const PROSODY = {
  calm: [1.2, 1.02], happy: [1.32, 1.08], laugh: [1.38, 1.1], angry: [0.95, 1.14], annoyed: [1.05, 1.06],
  sad: [1.0, 0.88], shy: [1.4, 0.96], smug: [1.15, 0.98], surprised: [1.35, 1.12], dreamy: [1.15, 0.9], bored: [1.0, 0.9],
};

// What gets read out: no tags, no emoji, no links, no markdown, not too long.
export function speakable(text, max = 600) {
  let out = String(text || '')
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[*_`#>~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (out.length > max) {
    const cut = out.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    out = end > max * 0.5 ? cut.slice(0, end + 1) : `${cut}…`;
  }
  return out;
}

export class Speech {
  constructor({ voice, host }) {
    this.voice = voice; // voice.js: her AudioContext and master volume, and her blips (hushed while she speaks)
    this.host = host;
    this.mode = 'off';  // 'off', 'chat' (her chat answers) or 'all' (everything she says)
    this.engine = 'system';
    this.fx = true;     // her many-minds effect on a speech service's audio
    this.lang = 'en';
    this.current = null;
    this.source = null;
    this.onTalk = null;  // () => void, a beat of her talking (her body nods)
    this.onError = null; // (message) => void, the speech service failed (she falls back to the system voice)
    this.systemVoices = [];
    if (typeof speechSynthesis !== 'undefined') {
      const load = () => { this.systemVoices = speechSynthesis.getVoices(); };
      load();
      speechSynthesis.addEventListener?.('voiceschanged', load);
    }
  }

  configure(cfg) {
    this.mode = cfg.voiceMode || 'off';
    this.engine = cfg.ttsEngine || 'system';
    this.fx = cfg.ttsFx !== false;
    this.muted = Boolean(cfg.muted);
    this.lang = cfg.lang || 'en';
    this.rate = Number(cfg.ttsRate) || 1;
    if (this.mode === 'off' || this.muted) this.stop();
  }

  // Whether she reads this kind of line: 'chat' (her answers), anything else ('line').
  wants(kind) {
    if (this.muted || this.mode === 'off') return false;
    return this.mode === 'all' || kind === 'chat';
  }

  get speaking() {
    return Boolean(this.current);
  }

  // Says it. Resolves once she's done (or cut off by the next thing she says, or stop()).
  async say(text, { mood = 'calm', kind = 'chat', force = false } = {}) {
    if (force ? this.muted : !this.wants(kind)) return; // force: testing her voice from her menu
    const words = speakable(text);
    if (!words) return;
    this.stop();
    const token = {};
    this.current = token;
    this.voice.speaking = true;
    try {
      if (this.engine !== 'system') {
        const ok = await this.cloud(words, mood, token);
        if (ok) return;
      }
      if (this.current === token) await this.system(words, mood, token);
    } finally {
      if (this.current === token) {
        this.current = null;
        this.voice.speaking = false;
      }
    }
  }

  stop() {
    this.current = null;
    this.voice.speaking = false;
    try {
      this.source?.stop();
    } catch {
      // already over
    }
    this.source = null;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  // ---------- the system's voice ----------

  pickVoice() {
    const locale = LOCALES[this.lang] || 'en-US';
    const base = locale.slice(0, 2);
    const voices = this.systemVoices.filter((v) => v.lang?.toLowerCase().startsWith(base));
    if (!voices.length) return null;
    const names = PREFERRED[base] || [];
    const score = (v) => {
      const n = v.name.toLowerCase();
      const rank = names.findIndex((p) => n.includes(p));
      return (rank >= 0 ? 100 - rank : 0) + (/natural|online|neural/.test(n) ? 50 : 0) - (MALE.test(n) ? 80 : 0);
    };
    return [...voices].sort((a, b) => score(b) - score(a))[0];
  }

  system(text, mood, token) {
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = LOCALES[this.lang] || 'en-US';
      const v = this.pickVoice();
      if (v) u.voice = v;
      const [pitch, rate] = PROSODY[mood] || PROSODY.calm;
      u.pitch = Math.min(2, pitch);
      u.rate = Math.min(2, rate * this.rate);
      u.volume = Math.min(1, (this.voice.volume ?? 0.7) * 1.3);
      u.onboundary = () => this.current === token && this.onTalk?.();
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
      // some systems never say they're done: she doesn't wait forever
      setTimeout(resolve, 2000 + text.length * 120);
    });
  }

  // ---------- a speech service ----------

  // True once played (or cut off), false if the service couldn't (she says it with the system voice then).
  async cloud(text, mood, token) {
    const res = await this.host.ttsSpeak({ text, mood }).catch((err) => ({ ok: false, error: err.message }));
    if (this.current !== token) return true;
    if (!res?.ok) {
      this.onError?.(res?.error || 'failed', res?.code);
      return false;
    }
    const ctx = this.voice.ensure();
    if (ctx.state === 'suspended') await ctx.resume();
    let buffer;
    try {
      const bytes = res.audio instanceof ArrayBuffer ? res.audio : res.audio.buffer.slice(res.audio.byteOffset, res.audio.byteOffset + res.audio.byteLength);
      buffer = await ctx.decodeAudioData(bytes);
    } catch (err) {
      this.onError?.(err.message);
      return false;
    }
    if (this.current !== token) return true;
    await this.play(ctx, buffer, mood, token);
    return true;
  }

  // Through her effect: a gentle high-pass and presence, a chorus of two copies of her a few
  // milliseconds behind, wavering (the other minds), and a little drive when she's angry.
  play(ctx, buffer, mood, token) {
    return new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = this.rate;
      this.source = src;
      const out = ctx.createGain();
      out.gain.value = 1.4;
      out.connect(this.voice.master);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      out.connect(analyser);
      if (!this.fx) {
        src.connect(out);
      } else {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 110;
        const presence = ctx.createBiquadFilter();
        presence.type = 'peaking';
        presence.frequency.value = 3200;
        presence.gain.value = 3;
        let chain = src.connect(hp).connect(presence);
        if (mood === 'angry') {
          const drive = ctx.createWaveShaper();
          const curve = new Float32Array(512);
          for (let i = 0; i < curve.length; i++) {
            const x = (i / (curve.length - 1)) * 2 - 1;
            curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
          }
          drive.curve = curve;
          chain = chain.connect(drive);
        }
        chain.connect(out);
        // the other minds: two delayed copies, their delay wavering slowly, a little thinner
        for (const [delayMs, depth, rate, level] of [[13, 4, 0.23, 0.32], [22, 6, 0.31, 0.2]]) {
          const d = ctx.createDelay(0.1);
          d.delayTime.value = delayMs / 1000;
          const lfo = ctx.createOscillator();
          lfo.frequency.value = rate;
          const lfoGain = ctx.createGain();
          lfoGain.gain.value = depth / 1000;
          lfo.connect(lfoGain).connect(d.delayTime);
          const thin = ctx.createBiquadFilter();
          thin.type = 'highpass';
          thin.frequency.value = 400;
          const g = ctx.createGain();
          g.gain.value = level;
          chain.connect(d).connect(thin).connect(g).connect(out);
          lfo.start();
          src.addEventListener('ended', () => lfo.stop());
        }
      }
      // her body nods with the loud bits
      const data = new Uint8Array(analyser.fftSize);
      const beat = setInterval(() => {
        if (this.current !== token) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        if (Math.sqrt(sum / data.length) > 0.08) this.onTalk?.();
      }, 220);
      src.addEventListener('ended', () => {
        clearInterval(beat);
        if (this.source === src) this.source = null;
        resolve();
      });
      src.start();
    });
  }
}
