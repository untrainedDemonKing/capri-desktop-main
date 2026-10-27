// She moves to your music, for real: the actual sound coming out of your PC (the system's loopback
// audio) goes through a beat detector, and she bobs, sways and pops her mane on the beat, harder when
// it's loud. No file, no title: just the sound's energy, and only while you turn it on (her menu ›
// Senses › Move to my music). Nothing is recorded or sent anywhere.
//
// The low band (the bass and kick) drives the beat; a rolling average tells a real hit from the
// steady level, with a short refractory gap so one kick is one beat. The gaps between beats give a
// rough tempo, so her idle sway keeps time even through a quiet bar.

export class Rhythm {
  constructor({ host, capri }) {
    this.host = host;
    this.capri = capri;
    this.enabled = false;
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.data = null;
    this.timer = 0;
    this.paused = false;
    this.energy = [];        // recent low-band energy, for the rolling average
    this.lastBeat = 0;
    this.beats = [];         // recent beat times, for the tempo
    this.bpm = 0;
    this.level = 0;          // smoothed loudness 0..1 (she sways with it)
    this.silentSince = performance.now();
    this.onBeat = null;      // (strength 0..1) => void
    this.onLevel = null;     // (level 0..1, bpm) => void
    this.onPlaying = null;   // (playing) => void: sound started or stopped
    this.playing = false;
  }

  async configure(cfg) {
    const want = cfg.rhythm === true;
    if (want === this.enabled) return;
    this.enabled = want;
    if (want) await this.start().catch((err) => { console.warn('[capri] no ears for music:', err.message); this.enabled = false; });
    else this.stop();
  }

  // Tap the system's output. getDisplayMedia with loopback audio (main.js hands it over without a
  // picker); the video track is thrown away at once, only the sound is kept.
  async start() {
    if (this.ctx) return;
    this.stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    for (const track of this.stream.getVideoTracks()) track.stop();
    if (!this.stream.getAudioTracks().length) throw new Error('no system audio');
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    src.connect(this.analyser);
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    // 30 ms while there's sound (enough to catch a kick), a lazy 250 ms in silence, and nothing at all
    // while she's resting deeply (pause())
    const loop = () => {
      if (!this.ctx) return;
      if (!this.paused) this.step();
      this.timer = setTimeout(loop, this.paused ? 1000 : this.playing || this.level > 0.01 ? 30 : 250);
    };
    loop();
  }

  // Resting deeply (app.js): stop listening for beats, the stream kept so waking is instant.
  pause(on) {
    this.paused = Boolean(on);
    if (this.paused && this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
    if (!this.paused && this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = 0;
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.stream = null;
    this.analyser = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.energy = [];
    this.beats = [];
    this.bpm = 0;
    this.level = 0;
    if (this.playing) {
      this.playing = false;
      this.onPlaying?.(false);
    }
  }

  step() {
    const a = this.analyser;
    if (!a) return;
    a.getByteFrequencyData(this.data);
    // low band: the first ~8% of bins (bass and kick)
    const bass = Math.max(2, Math.floor(this.data.length * 0.08));
    let low = 0;
    let all = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = this.data[i] / 255;
      all += v;
      if (i < bass) low += v;
    }
    low /= bass;
    all /= this.data.length;

    // smoothed loudness, for the sway and for "is anything playing"
    this.level += (all - this.level) * 0.2;
    const now = performance.now();
    const playing = all > 0.02;
    if (playing) this.silentSince = now;
    const quietFor = now - this.silentSince;
    if (playing !== this.playing && (playing || quietFor > 1200)) {
      this.playing = playing;
      this.onPlaying?.(playing);
    }
    this.onLevel?.(Math.min(1, this.level * 2.2), this.bpm);

    // a beat: the low band jumps well above its recent average, and not too soon after the last
    this.energy.push(low);
    if (this.energy.length > 24) this.energy.shift(); // ~0.7 s at one look every 30 ms
    const avg = this.energy.reduce((s, v) => s + v, 0) / this.energy.length;
    const variance = this.energy.reduce((s, v) => s + (v - avg) ** 2, 0) / this.energy.length;
    const threshold = avg * (1.35 + variance * 12);
    const gap = this.bpm ? Math.max(180, 60000 / this.bpm * 0.6) : 230;
    if (low > threshold && low > 0.12 && now - this.lastBeat > gap) {
      const strength = Math.min(1, (low - avg) / (avg + 0.05));
      this.lastBeat = now;
      this.beats.push(now);
      if (this.beats.length > 8) this.beats.shift();
      this.updateTempo();
      this.onBeat?.(strength);
      this.capri.beat?.(strength);
    }
    // keep her sway in time even through a quiet moment
    if (this.capri.danceLevel !== undefined) this.capri.danceLevel = Math.min(1, this.level * 2.2);
  }

  updateTempo() {
    if (this.beats.length < 4) return;
    const gaps = [];
    for (let i = 1; i < this.beats.length; i++) gaps.push(this.beats[i] - this.beats[i - 1]);
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median > 0) {
      let bpm = 60000 / median;
      while (bpm < 80) bpm *= 2;
      while (bpm > 180) bpm /= 2;
      this.bpm = Math.round(bpm);
    }
  }
}
