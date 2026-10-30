// All sound is synthesized with the Web Audio API: no files to download or license.
//
//   effects ─┐                 ┌─► reverb (small room) ─┐
//   music  ──┼─► buses ────────┤                        ├─► compressor ─► speakers
//   ambience ┘                 └────────────────────────┘
//
// Browsers only allow audio after the user interacts, so `unlock()` runs on the first tap.

import { type SfxBank, buildSfxBank } from './sfx.js';

export type SoundName =
  | 'card'
  | 'flip'
  | 'chip'
  | 'chips'
  | 'chipSlide'
  | 'tap'
  | 'shuffle'
  | 'click'
  | 'turn'
  | 'win'
  | 'lose'
  | 'twentyone'
  | 'blackjack'
  | 'applause';

export interface PlayOptions {
  /** Seconds from now. */
  delay?: number;
  /** −1 (left) … 1 (right). */
  pan?: number;
  gain?: number;
}

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
  /** The dealer speaks (browser speech synthesis). */
  voice: boolean;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private ambientBus!: GainNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private bank: SfxBank | null = null;
  private voiceChoice: SpeechSynthesisVoice | null | undefined;
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

  setVoice(on: boolean): void {
    this.settings.voice = on;
    if (!on) globalThis.speechSynthesis?.cancel();
  }

  /** The dealer says something out loud (if the voice is on). */
  speak(text: string): void {
    const synth = globalThis.speechSynthesis;
    if (!synth || !this.settings.voice || this.settings.muted || this.settings.sfx <= 0 || !this.ctx) return;
    if (this.voiceChoice === undefined) {
      const voices = synth.getVoices();
      if (voices.length) {
        const prefer = ['Daniel', 'Google UK English Male', 'Alex', 'Samantha', 'Google US English', 'Microsoft Guy', 'Microsoft Aria'];
        this.voiceChoice =
          prefer.map((n) => voices.find((v) => v.name.includes(n))).find(Boolean) ?? voices.find((v) => v.lang.startsWith('en')) ?? null;
      }
    }
    const u = new SpeechSynthesisUtterance(text);
    if (this.voiceChoice) u.voice = this.voiceChoice;
    u.rate = 1.02;
    u.pitch = 0.95;
    u.volume = Math.min(1, this.settings.sfx * 0.9);
    synth.cancel();
    synth.speak(u);
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

    try {
      this.bank = buildSfxBank(ctx);
    } catch (err) {
      console.warn('Could not build sound effects', err);
    }

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

  play(name: SoundName, opts: PlayOptions | number = {}): void {
    if (!this.live || this.settings.sfx <= 0) return;
    const o = typeof opts === 'number' ? { delay: opts } : opts;
    const t = this.ctx!.currentTime + (o.delay ?? 0) + 0.005;
    const out = this.sfxBus;
    const bank = this.bank;
    const sample = (list: AudioBuffer[] | AudioBuffer | undefined, gain = 1, rate = 1) => {
      if (!list) return;
      const buf = Array.isArray(list) ? list[Math.floor(Math.random() * list.length)]! : list;
      this.sample(buf, t, { gain: gain * (o.gain ?? 1), pan: o.pan ?? 0, rate: rate * (0.96 + Math.random() * 0.08) });
    };
    switch (name) {
      case 'card':
        sample(bank?.card, 0.9);
        break;
      case 'flip':
        sample(bank?.flip, 0.9);
        break;
      case 'chip':
        sample(bank?.chipDrop, 0.8);
        break;
      case 'chips':
        sample(bank?.chipDrop, 0.8);
        this.sample(bank!.chipDrop[0]!, t + 0.06, { gain: 0.55, pan: o.pan ?? 0, rate: 1.04 });
        break;
      case 'chipSlide':
        sample(bank?.chipSlide, 0.8);
        break;
      case 'tap':
        sample(bank?.tap, 0.9);
        break;
      case 'shuffle':
        sample(bank?.shuffle, 0.9, 1);
        break;
      case 'click':
        this.tone(out, t, 1600, 0.03, 0.035, 'sine', 900);
        break;
      case 'turn':
        this.bell(out, t, midi(76), 0.07);
        this.bell(out, t + 0.12, midi(81), 0.06);
        break;
      case 'win':
        [72, 76, 79].forEach((n, i) => this.bell(out, t + i * 0.09, midi(n), 0.05));
        sample(bank?.chipSlide, 0.6);
        break;
      case 'twentyone':
        [72, 76, 79, 84].forEach((n, i) => this.bell(out, t + i * 0.08, midi(n), 0.06));
        break;
      case 'blackjack':
        [72, 76, 79, 84, 88].forEach((n, i) => this.bell(out, t + i * 0.07, midi(n), 0.07, 1.4));
        this.sample(bank!.ooh, t + 0.05, { gain: 0.5 });
        this.sample(bank!.applause, t + 0.35, { gain: 0.55 });
        break;
      case 'applause':
        sample(bank?.applause, 0.5);
        break;
      case 'lose':
        this.bell(out, t, midi(64), 0.04);
        this.bell(out, t + 0.16, midi(60), 0.035);
        break;
    }
  }

  private sample(buf: AudioBuffer, t: number, o: { gain?: number; pan?: number; rate?: number }): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = o.gain ?? 1;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
    src.connect(g).connect(p).connect(this.sfxBus);
    src.start(t);
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
    if (this.bank) {
      // Recorded-style room tone: distant voices and air, looped.
      const src = ctx.createBufferSource();
      src.buffer = this.bank.room;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0.22;
      src.connect(g).connect(this.ambientBus);
      src.start();
    }
    // Now and then, life at other tables: chips stacking, a slot machine far away.
    const life = () => {
      if (!this.ctx) return;
      if (this.live && this.bank) {
        const t = this.ctx.currentTime;
        const pan = Math.random() * 2 - 1;
        if (Math.random() < 0.6) {
          this.sampleTo(this.ambientBus, this.bank.chipDrop[Math.floor(Math.random() * this.bank.chipDrop.length)]!, t, 0.12, pan);
        } else {
          [84, 88, 91].forEach((n, i) => this.bell(this.ambientBus, t + i * 0.11, midi(n), 0.006, 0.6));
        }
      }
      this.ambientTimer = setTimeout(life, 2500 + Math.random() * 5000);
    };
    life();
  }

  private sampleTo(out: AudioNode, buf: AudioBuffer, t: number, gain: number, pan: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p).connect(out);
    src.start(t);
  }
}
