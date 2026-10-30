// All sound is synthesized with the Web Audio API: no files to download or license.
//
//   effects ─┐                 ┌─► reverb (small room) ─┐
//   music  ──┼─► buses ────────┤                        ├─► compressor ─► speakers
//   ambience ┘                 └────────────────────────┘
//
// Browsers only allow audio after the user interacts, so `unlock()` runs on the first tap.

export type SoundName = 'card' | 'flip' | 'chip' | 'chips' | 'shuffle' | 'click' | 'turn' | 'win' | 'lose' | 'blackjack';

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// Lounge progression in F: | Fmaj9 | Dm9 | Gm9 | C13 | Am9 | D13 | Gm9 | C13 |
const CHORDS: { voicing: number[]; bass: [number, number, number] }[] = [
  { voicing: [57, 60, 64, 67], bass: [41, 45, 48] },
  { voicing: [53, 57, 60, 64], bass: [38, 41, 45] },
  { voicing: [58, 62, 65, 69], bass: [43, 46, 50] },
  { voicing: [58, 62, 64, 69], bass: [36, 40, 43] },
  { voicing: [60, 64, 67, 71], bass: [45, 48, 52] },
  { voicing: [60, 64, 66, 71], bass: [38, 42, 45] },
  { voicing: [58, 62, 65, 69], bass: [43, 46, 50] },
  { voicing: [58, 62, 64, 69], bass: [36, 40, 43] },
];
const BPM = 84;
const BEAT = 60 / BPM;
const SWING = 0.64; // where the off-beat eighth falls within the beat

export interface SoundSettings {
  muted: boolean;
  music: number; // 0–1
  sfx: number; // 0–1
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private ambientBus!: GainNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private settings: SoundSettings;
  private musicTimer: ReturnType<typeof setInterval> | undefined;
  private ambientTimer: ReturnType<typeof setTimeout> | undefined;
  private nextBeat = 0;
  private beat = 0;

  constructor(settings: SoundSettings) {
    this.settings = { ...settings };
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  set muted(m: boolean) {
    this.settings.muted = m;
    this.applyLevels();
  }

  setMusicVolume(v: number): void {
    this.settings.music = v;
    this.applyLevels();
  }

  setSfxVolume(v: number): void {
    this.settings.sfx = v;
    this.applyLevels();
  }

  private applyLevels(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 1, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
    this.ambientBus.gain.setTargetAtTime(this.settings.sfx * 0.6, t, 0.2);
    this.musicBus.gain.setTargetAtTime(this.settings.music * 0.55, t, 0.3);
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(1.8, 2.6);
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.5;
    reverb.connect(reverbOut).connect(this.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(reverb);

    const bus = (send: number) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.reverbSend);
      return g;
    };
    this.sfxBus = bus(0.12);
    this.musicBus = bus(0.3);
    this.ambientBus = bus(0.2);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.applyLevels();
    this.startAmbience();
    this.startMusic();
  }

  dispose(): void {
    clearInterval(this.musicTimer);
    clearTimeout(this.ambientTimer);
    void this.ctx?.close();
    this.ctx = null;
  }

  /** A soft, decaying stereo noise tail: the "room". */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  private get live(): boolean {
    return Boolean(this.ctx && this.ctx.state === 'running' && !this.settings.muted);
  }

  // ---------- Effects ----------

  play(name: SoundName, delay = 0): void {
    if (!this.live || this.settings.sfx <= 0) return;
    const t = this.ctx!.currentTime + delay + 0.005;
    const out = this.sfxBus;
    switch (name) {
      case 'card':
        // A card sliding on felt: a soft filtered swish that darkens, then a gentle landing tap.
        this.noiseHit(out, t, { type: 'bandpass', from: 2400, to: 1100, q: 0.7, attack: 0.008, decay: 0.15, gain: 0.32 });
        this.noiseHit(out, t + 0.12, { type: 'lowpass', from: 900, to: 500, q: 0.5, attack: 0.002, decay: 0.035, gain: 0.16 });
        break;
      case 'flip':
        this.noiseHit(out, t, { type: 'highpass', from: 3000, to: 2200, q: 0.8, attack: 0.001, decay: 0.035, gain: 0.22 });
        this.tone(out, t + 0.005, 190, 0.05, 0.08, 'sine', 120);
        break;
      case 'chip':
        this.chipClack(t, 1);
        break;
      case 'chips':
        for (let i = 0; i < 4; i++) this.chipClack(t + i * (0.035 + Math.random() * 0.02), 0.85 - i * 0.12);
        break;
      case 'shuffle': {
        // Riffle: quick clicks that speed up and swell, then the bridge, then the deck squared.
        const n = 42;
        for (let i = 0; i < n; i++) {
          const k = i / n;
          const at = t + 0.85 * Math.sqrt(k);
          this.noiseHit(out, at, {
            type: 'bandpass',
            from: 3500 + Math.random() * 1500,
            to: 3000,
            q: 2.2,
            attack: 0.001,
            decay: 0.014,
            gain: 0.1 + 0.12 * Math.sin(Math.PI * k),
          });
        }
        this.noiseHit(out, t + 0.95, { type: 'bandpass', from: 900, to: 3200, q: 0.8, attack: 0.08, decay: 0.3, gain: 0.14 });
        this.noiseHit(out, t + 1.35, { type: 'lowpass', from: 700, to: 300, q: 0.6, attack: 0.003, decay: 0.08, gain: 0.3 });
        break;
      }
      case 'click':
        this.tone(out, t, 1600, 0.03, 0.045, 'sine', 900);
        break;
      case 'turn':
        this.bell(out, t, midi(76), 0.09);
        this.bell(out, t + 0.12, midi(81), 0.08);
        break;
      case 'win':
        [72, 76, 79, 84].forEach((n, i) => this.bell(out, t + i * 0.085, midi(n), 0.07));
        break;
      case 'blackjack':
        [72, 76, 79, 84, 88].forEach((n, i) => this.bell(out, t + i * 0.07, midi(n), 0.08));
        this.noiseHit(out, t + 0.35, { type: 'highpass', from: 7000, to: 9000, q: 0.5, attack: 0.05, decay: 0.6, gain: 0.05 });
        break;
      case 'lose':
        this.bell(out, t, midi(64), 0.06);
        this.bell(out, t + 0.16, midi(60), 0.05);
        break;
    }
  }

  private noiseHit(
    out: AudioNode,
    t: number,
    o: { type: BiquadFilterType; from: number; to: number; q: number; attack: number; decay: number; gain: number },
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.Q.value = o.q;
    f.frequency.setValueAtTime(o.from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t + o.attack + o.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + o.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.attack + o.decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + o.attack + o.decay + 0.05);
  }

  private tone(out: AudioNode, t: number, freq: number, decay: number, gain: number, type: OscillatorType, endFreq?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  /** A soft bell/vibraphone note: fundamental plus a quieter overtone. */
  private bell(out: AudioNode, t: number, freq: number, gain: number, decay = 0.9): void {
    this.tone(out, t, freq, decay, gain, 'sine');
    this.tone(out, t, freq * 2.01, decay * 0.5, gain * 0.25, 'sine');
    this.tone(out, t, freq * 3.98, decay * 0.2, gain * 0.08, 'sine');
  }

  /** Clay chips touching: a short bright knock with two body resonances. */
  private chipClack(t: number, level: number): void {
    const out = this.sfxBus;
    const base = 2300 + Math.random() * 500;
    this.noiseHit(out, t, { type: 'bandpass', from: 5200, to: 4200, q: 1.6, attack: 0.0008, decay: 0.012, gain: 0.16 * level });
    this.tone(out, t, base, 0.045, 0.06 * level, 'sine', base * 0.97);
    this.tone(out, t, base * 1.73, 0.028, 0.028 * level, 'sine');
  }

  // ---------- Music: a little lounge-jazz trio ----------

  private startMusic(): void {
    const ctx = this.ctx!;
    this.nextBeat = ctx.currentTime + 0.3;
    this.beat = 0;
    // Schedule a little ahead of time so timing stays tight.
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      while (this.nextBeat < this.ctx.currentTime + 0.35) {
        if (this.settings.music > 0 && !this.settings.muted) this.scheduleBeat(this.beat, this.nextBeat);
        this.nextBeat += BEAT;
        this.beat++;
      }
    }, 90);
  }

  private scheduleBeat(beat: number, t: number): void {
    const bar = Math.floor(beat / 4) % CHORDS.length;
    const inBar = beat % 4;
    const chord = CHORDS[bar]!;
    const next = CHORDS[(bar + 1) % CHORDS.length]!;
    const off = t + BEAT * SWING;
    const out = this.musicBus;

    // Walking bass: root, a chord tone, the fifth, then a step into the next chord.
    const bassNote =
      inBar === 0
        ? chord.bass[0]
        : inBar === 1
          ? chord.bass[1 + Math.floor(Math.random() * 2)]!
          : inBar === 2
            ? chord.bass[2]
            : next.bass[0] + (Math.random() < 0.5 ? -1 : 1);
    this.bass(out, t, midi(bassNote), inBar === 0 ? 0.2 : 0.16);

    // Electric piano comping: on 1, and often on the swung "and" of 2 or 4.
    if (inBar === 0) this.keys(out, t, chord.voicing, 0.035);
    if (inBar === 1 && Math.random() < 0.6) this.keys(out, off, chord.voicing, 0.028, 0.5);
    if (inBar === 3 && Math.random() < 0.35) this.keys(out, off, next.voicing, 0.024, 0.35);

    // Brushes: ride pattern "ding, ding-a-ding", soft kick on 1 and 3, a swish on 2 and 4.
    this.ride(out, t, inBar % 2 === 0 ? 0.03 : 0.04);
    if (inBar === 1 || inBar === 3) this.ride(out, off, 0.022);
    if (inBar === 0 || inBar === 2) this.tone(out, t, 70, 0.22, 0.09, 'sine', 45);
    if (inBar === 1 || inBar === 3) {
      this.noiseHit(out, t, { type: 'bandpass', from: 2500, to: 1800, q: 0.6, attack: 0.03, decay: 0.18, gain: 0.03 });
    }

    // Now and then, a few vibraphone notes over the top.
    if (inBar === 0 && bar % 2 === 0 && Math.random() < 0.45) {
      const notes = chord.voicing.map((n) => n + 12);
      for (let i = 0; i < 3; i++) {
        const n = notes[Math.floor(Math.random() * notes.length)]!;
        this.bell(out, t + BEAT * (1 + i * SWING + (i > 0 ? 0.36 : 0)), midi(n), 0.025, 1.4);
      }
    }
  }

  private bass(out: AudioNode, t: number, freq: number, gain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(gain * 0.35, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + BEAT * 0.95);
    osc.connect(f);
    sub.connect(f);
    f.connect(g).connect(out);
    osc.start(t);
    sub.start(t);
    osc.stop(t + BEAT);
    sub.stop(t + BEAT);
  }

  /** Electric piano chord: sine tones with a bell-like overtone and a slow tremolo. */
  private keys(out: AudioNode, t: number, notes: number[], gain: number, length = 1.6): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(gain * 0.4, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length * BEAT * 2);
    const trem = ctx.createGain();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.15;
    lfo.connect(lfoGain).connect(trem.gain);
    trem.gain.value = 0.85;
    g.connect(trem).connect(out);
    const end = t + length * BEAT * 2 + 0.1;
    notes.forEach((n, i) => {
      const at = t + i * 0.008; // a slight roll, like real fingers
      const f = midi(n);
      for (const [mult, level] of [
        [1, 1],
        [2, 0.18],
        [4.01, 0.04],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f * mult;
        const lg = ctx.createGain();
        lg.gain.value = level;
        osc.connect(lg).connect(g);
        osc.start(at);
        osc.stop(end);
      }
    });
    lfo.start(t);
    lfo.stop(end);
  }

  private ride(out: AudioNode, t: number, gain: number): void {
    this.noiseHit(out, t, { type: 'bandpass', from: 8000, to: 6500, q: 1.2, attack: 0.001, decay: 0.16, gain });
  }

  // ---------- Room ambience ----------

  private startAmbience(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    src.connect(low).connect(g).connect(this.ambientBus);
    src.start();

    const murmur = () => {
      if (!this.ctx) return;
      if (this.live) {
        const t = this.ctx.currentTime;
        if (Math.random() < 0.6) {
          // Distant voices: a slow swell of band-passed noise.
          this.noiseHit(this.ambientBus, t, { type: 'bandpass', from: 450 + Math.random() * 300, to: 380, q: 2.5, attack: 0.6, decay: 1.6, gain: 0.03 });
        } else {
          // Someone stacking chips at another table.
          for (let i = 0; i < 3; i++) {
            const at = t + i * 0.05;
            this.tone(this.ambientBus, at, 2400 + Math.random() * 400, 0.04, 0.012, 'sine');
          }
        }
      }
      this.ambientTimer = setTimeout(murmur, 1800 + Math.random() * 3500);
    };
    murmur();
  }
}
