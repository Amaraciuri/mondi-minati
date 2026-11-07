// Every sound is synthesized with WebAudio: no audio files.
const PENTA = [0, 3, 5, 7, 10]; // minor pentatonic steps
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Sound {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.hapticsOn = true;
    this.musicTimer = null;
    this.nextChordAt = 0;
    this.chordIdx = 0;
    this.nextPingAt = 0;
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(ctx.destination);
        this.sfx = ctx.createGain();
        this.sfx.gain.value = this.sfxOn ? 0.8 : 0;
        this.sfx.connect(this.master);
        this.music = ctx.createGain();
        this.music.gain.value = 0;
        this.music.connect(this.master);
        // shared echo for music and some sfx
        this.delay = ctx.createDelay(1.0);
        this.delay.delayTime.value = 0.36;
        const fb = ctx.createGain();
        fb.gain.value = 0.38;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2600;
        this.delay.connect(lp);
        lp.connect(fb);
        fb.connect(this.delay);
        this.delayOut = ctx.createGain();
        this.delayOut.gain.value = 0.5;
        lp.connect(this.delayOut);
        this.delayOut.connect(this.master);
        // white noise buffer
        const len = ctx.sampleRate * 1.5;
        this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (this.musicOn) this.startMusic();
    } catch (e) {
      this.ctx = null;
    }
  }

  setSfx(on) {
    this.sfxOn = on;
    if (this.sfx) this.sfx.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.02);
  }
  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  vibrate(pattern) {
    if (!this.hapticsOn) return;
    try {
      navigator.vibrate?.(pattern);
    } catch (e) {
      /* not allowed here */
    }
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.12, vol = 0.2, attack = 0.005, when = 0, dest = null, echo = 0, q = 0, cutoff = 0 }) {
    if (!this.ctx || (!this.sfxOn && !dest)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      f.Q.value = q;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(dest || this.sfx);
    if (echo) {
      const e = ctx.createGain();
      e.gain.value = echo;
      g.connect(e);
      e.connect(this.delay);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.3, vol = 0.3, f0 = 2000, f1 = 200, when = 0, type = 'lowpass', q = 0.8 }) {
    if (!this.ctx || !this.sfxOn) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  // --- effects ---------------------------------------------------------
  ui() {
    this.tone({ f0: 1250, dur: 0.035, vol: 0.06 });
  }
  press() {
    this.tone({ f0: 300, f1: 240, dur: 0.05, vol: 0.06 });
  }
  dig(levels = 1) {
    this.tone({ type: 'sine', f0: 560, f1: 250, dur: 0.09, vol: 0.22 });
    this.noise({ dur: 0.05, vol: 0.06, f0: 4000, f1: 1500, type: 'bandpass', q: 1.2 });
    const n = Math.min(14, levels - 1);
    for (let i = 0; i < n; i++) {
      const step = PENTA[i % 5] + 12 * Math.floor(i / 5);
      this.tone({ type: 'triangle', f0: midi(76 + step), dur: 0.16, vol: 0.09 * (1 - i / 20), when: 0.05 + i * 0.045, echo: 0.25 });
    }
  }
  flag() {
    this.tone({ type: 'square', f0: 330, f1: 150, dur: 0.1, vol: 0.08, cutoff: 1400 });
    this.tone({ type: 'sine', f0: 880, f1: 1320, dur: 0.08, vol: 0.06, when: 0.03 });
    this.vibrate(14);
  }
  unflag() {
    this.tone({ type: 'square', f0: 160, f1: 300, dur: 0.08, vol: 0.06, cutoff: 1200 });
    this.vibrate(8);
  }
  chord() {
    this.tone({ type: 'sine', f0: 620, f1: 300, dur: 0.08, vol: 0.18 });
    this.tone({ type: 'sine', f0: 780, f1: 380, dur: 0.08, vol: 0.12, when: 0.04 });
  }
  boom() {
    this.noise({ dur: 1.4, vol: 0.7, f0: 2400, f1: 60, q: 0.6 });
    this.tone({ type: 'sine', f0: 90, f1: 32, dur: 0.9, vol: 0.6 });
    this.tone({ type: 'sawtooth', f0: 140, f1: 40, dur: 0.5, vol: 0.12, cutoff: 500 });
    for (let i = 0; i < 6; i++) this.noise({ dur: 0.08, vol: 0.12, f0: 3000, f1: 800, when: 0.25 + i * 0.11 + Math.random() * 0.05, type: 'bandpass', q: 2 });
    this.vibrate([60, 40, 120]);
  }
  smallBoom(when = 0) {
    this.noise({ dur: 0.35, vol: 0.14, f0: 1600, f1: 120, when });
  }
  win() {
    const notes = [72, 76, 79, 84, 88];
    notes.forEach((m, i) => {
      this.tone({ type: 'triangle', f0: midi(m), dur: 0.5, vol: 0.14, when: i * 0.09, echo: 0.4 });
      this.tone({ type: 'sine', f0: midi(m + 12), dur: 0.35, vol: 0.05, when: i * 0.09 + 0.02 });
    });
    this.tone({ type: 'sine', f0: midi(96), f1: midi(91), dur: 1.4, vol: 0.05, when: 0.5, echo: 0.5 });
    this.vibrate([20, 40, 20]);
  }
  star(i) {
    this.tone({ type: 'triangle', f0: midi(84 + i * 4), dur: 0.4, vol: 0.12, echo: 0.4 });
  }
  hint() {
    for (let i = 0; i < 3; i++) this.tone({ type: 'sine', f0: 1400 + i * 400, f1: 2600 + i * 400, dur: 0.18, vol: 0.05, when: i * 0.07, echo: 0.3 });
  }
  whoosh() {
    this.noise({ dur: 0.9, vol: 0.18, f0: 300, f1: 3200, type: 'bandpass', q: 1.5 });
  }
  denied() {
    this.tone({ type: 'square', f0: 200, f1: 180, dur: 0.12, vol: 0.05, cutoff: 900 });
  }

  // --- ambient music ----------------------------------------------------
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const ctx = this.ctx;
    this.music.gain.cancelScheduledValues(ctx.currentTime);
    this.music.gain.setTargetAtTime(0.16, ctx.currentTime, 1.5);
    this.nextChordAt = ctx.currentTime + 0.1;
    this.nextPingAt = ctx.currentTime + 2;
    this.musicTimer = setInterval(() => this._schedule(), 250);
    this._schedule();
  }
  stopMusic() {
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
  _schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const chords = [
      [57, 60, 64, 69],
      [53, 57, 60, 64],
      [48, 55, 60, 64],
      [55, 59, 62, 67],
    ];
    while (this.nextChordAt < ctx.currentTime + 1) {
      const ch = chords[this.chordIdx % chords.length];
      this.chordIdx++;
      const t = this.nextChordAt;
      const dur = 9.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.linearRampToValueAtTime(1100, t + 4);
      lp.frequency.linearRampToValueAtTime(500, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + 2.5);
      g.gain.setValueAtTime(0.05, t + dur - 3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      lp.connect(g);
      g.connect(this.music);
      for (const m of ch) {
        for (const det of [-6, 6]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = midi(m - 12);
          o.detune.value = det;
          o.connect(lp);
          o.start(t);
          o.stop(t + dur + 0.1);
        }
      }
      this.nextChordAt += 8;
    }
    while (this.nextPingAt < ctx.currentTime + 1) {
      const t = this.nextPingAt;
      const root = 69;
      const m = root + PENTA[Math.floor(Math.random() * 5)] + (Math.random() < 0.4 ? 12 : 0);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = midi(m);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g);
      g.connect(this.music);
      const e = ctx.createGain();
      e.gain.value = 0.6;
      g.connect(e);
      e.connect(this.delay);
      o.start(t);
      o.stop(t + 1.7);
      this.nextPingAt += 0.9 + Math.random() * 2.6;
    }
  }
}
