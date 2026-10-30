// All sounds are synthesized with the Web Audio API: no audio files to download or license.
// Browsers only allow audio after the user interacts, so `unlock()` is called on the first tap/click.

type SoundName = 'card' | 'flip' | 'chip' | 'chips' | 'shuffle' | 'click' | 'turn' | 'win' | 'lose';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private ambientTimer: ReturnType<typeof setTimeout> | undefined;
  private _muted: boolean;

  constructor(muted: boolean) {
    this._muted = muted;
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(m: boolean) {
    this._muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this._muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    // Two seconds of white noise, reused by every noisy sound.
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.startAmbient();
  }

  dispose(): void {
    clearTimeout(this.ambientTimer);
    void this.ctx?.close();
    this.ctx = null;
  }

  play(name: SoundName, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || this._muted || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay;
    switch (name) {
      case 'card':
        this.noiseBurst(t, { freq: 2600 + Math.random() * 800, q: 0.8, attack: 0.012, decay: 0.13, gain: 0.35 });
        break;
      case 'flip':
        this.noiseBurst(t, { freq: 4200, q: 1.2, attack: 0.002, decay: 0.05, gain: 0.35, type: 'highpass' });
        break;
      case 'chip':
        this.chipClick(t);
        break;
      case 'chips':
        for (let i = 0; i < 4; i++) this.chipClick(t + i * 0.045 + Math.random() * 0.02, 0.6);
        break;
      case 'shuffle':
        // A riffle: many tiny clicks speeding up, then the deck squared on the table.
        for (let i = 0; i < 34; i++) {
          const at = t + 0.9 * Math.sqrt(i / 34);
          this.noiseBurst(at, { freq: 3000 + Math.random() * 2000, q: 2, attack: 0.001, decay: 0.02, gain: 0.18 });
        }
        this.noiseBurst(t + 1.05, { freq: 500, q: 0.7, attack: 0.004, decay: 0.12, gain: 0.5 });
        break;
      case 'click':
        this.tone(t, 1400, 0.03, 0.08, 'triangle');
        break;
      case 'turn':
        this.tone(t, 880, 0.18, 0.12, 'sine');
        this.tone(t + 0.1, 1320, 0.22, 0.1, 'sine');
        break;
      case 'win':
        this.tone(t, 660, 0.3, 0.1, 'sine');
        this.tone(t + 0.09, 990, 0.35, 0.09, 'sine');
        this.tone(t + 0.18, 1320, 0.45, 0.08, 'sine');
        break;
      case 'lose':
        this.tone(t, 330, 0.3, 0.07, 'sine');
        this.tone(t + 0.12, 262, 0.4, 0.06, 'sine');
        break;
    }
  }

  private noiseBurst(
    t: number,
    o: { freq: number; q: number; attack: number; decay: number; gain: number; type?: BiquadFilterType },
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type ?? 'bandpass';
    filter.frequency.value = o.freq;
    filter.Q.value = o.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain, t + o.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.attack + o.decay);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + o.attack + o.decay + 0.05);
  }

  private tone(t: number, freq: number, decay: number, gain: number, type: OscillatorType): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  /** Clay chips: a short bright "tick" plus two inharmonic pings. */
  private chipClick(t: number, level = 1): void {
    this.noiseBurst(t, { freq: 6000, q: 1.5, attack: 0.001, decay: 0.025, gain: 0.25 * level, type: 'highpass' });
    const base = 3200 + Math.random() * 900;
    this.tone(t, base, 0.06, 0.05 * level, 'sine');
    this.tone(t, base * 1.57, 0.04, 0.03 * level, 'sine');
  }

  /** Quiet room tone: low rumble, plus occasional distant chips and murmurs. */
  private startAmbient(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 380;
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0.05;
    src.connect(low).connect(this.ambientGain).connect(this.master!);
    src.start();

    const murmur = () => {
      if (!this.ctx) return;
      if (!this._muted && this.ctx.state === 'running') {
        const t = this.ctx.currentTime;
        if (Math.random() < 0.55) {
          // Distant voices: band-passed noise with a slow swell.
          this.noiseBurst(t, { freq: 350 + Math.random() * 500, q: 3, attack: 0.5, decay: 1.4, gain: 0.035 });
        } else {
          for (let i = 0; i < 3; i++) this.chipClick(t + i * 0.06, 0.12);
        }
      }
      this.ambientTimer = setTimeout(murmur, 1500 + Math.random() * 3500);
    };
    murmur();
  }
}
