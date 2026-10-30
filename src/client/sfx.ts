// Realistic sound effects, synthesized once into audio buffers from small physical models:
//  - cards: paper-on-felt friction (a dense spray of tiny filtered impulses) and a soft landing
//  - chips: clay chips knocking (a few inharmonic resonances that ring for a few milliseconds)
//  - shuffle: a riffle of ~50 card flicks speeding up, the bridge cascade, the deck squared
//  - people: knuckle taps on felt, applause, a crowd "ooh", casino room tone
// Each sound has several variations so repeats never sound identical.

type Mono = Float32Array;

const SR = 44100;

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** RBJ biquad filter applied in place. */
function biquad(x: Mono, type: 'bandpass' | 'lowpass' | 'highpass', freq: number, q: number): Mono {
  const w = (2 * Math.PI * freq) / SR;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number;
  if (type === 'lowpass') {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
  } else if (type === 'highpass') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i]!;
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    x[i] = y0;
  }
  return x;
}

/** Decaying sine partials: how small hard objects (chips, a card edge) ring. */
function modal(out: Mono, at: number, modes: [freq: number, decayMs: number, amp: number][], gain: number): void {
  const start = Math.floor(at * SR);
  for (const [f, decayMs, amp] of modes) {
    const tau = (decayMs / 1000) * SR;
    const len = Math.min(out.length - start, Math.floor(tau * 6));
    const phase = Math.random() * Math.PI * 2;
    const k = (2 * Math.PI * f) / SR;
    for (let i = 0; i < len; i++) out[start + i]! += gain * amp * Math.exp(-i / tau) * Math.sin(k * i + phase);
  }
}

/** A short noise burst with an exponential tail, filtered, added at `at` seconds. */
function burst(
  out: Mono,
  at: number,
  ms: number,
  gain: number,
  filter?: { type: 'bandpass' | 'lowpass' | 'highpass'; freq: number; q: number },
): void {
  const len = Math.floor((ms / 1000) * SR * 4);
  let b: Mono = new Float32Array(len);
  const tau = (ms / 1000) * SR;
  for (let i = 0; i < len; i++) b[i] = (Math.random() * 2 - 1) * Math.exp(-i / tau);
  if (filter) b = biquad(b, filter.type, filter.freq, filter.q);
  const start = Math.floor(at * SR);
  for (let i = 0; i < len && start + i < out.length; i++) out[start + i]! += b[i]! * gain;
}

function normalize(x: Mono, peak: number): Mono {
  let max = 0;
  for (const v of x) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < x.length; i++) x[i] = (x[i]! / max) * peak;
  return x;
}

function fade(x: Mono, inMs: number, outMs: number): Mono {
  const fi = Math.floor((inMs / 1000) * SR);
  const fo = Math.floor((outMs / 1000) * SR);
  for (let i = 0; i < fi && i < x.length; i++) x[i]! *= i / fi;
  for (let i = 0; i < fo && i < x.length; i++) x[x.length - 1 - i]! *= i / fo;
  return x;
}

// ---------- The sounds ----------

/** A card sliding across felt, then settling. */
function cardSlide(): Mono {
  const dur = rand(0.2, 0.28);
  const x = new Float32Array(Math.floor((dur + 0.12) * SR));
  const slideEnd = dur;
  // Friction: thousands of tiny impulses, denser in the middle of the slide.
  for (let i = 0; i < slideEnd * SR; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.02) * Math.min(1, (slideEnd - t) / 0.06);
    if (Math.random() < 0.09 * env) x[i]! += (Math.random() * 2 - 1) * env;
  }
  biquad(x, 'highpass', 1200, 0.7);
  biquad(x, 'bandpass', rand(2800, 3800), 0.6);
  // The card settling on the felt: a muffled pat.
  burst(x, slideEnd - 0.01, 9, 0.5, { type: 'lowpass', freq: 900, q: 0.7 });
  modal(x, slideEnd - 0.008, [[rand(160, 210), 18, 1]], 0.25);
  return fade(normalize(x, 0.7), 2, 20);
}

/** A card flipped over: the snap of the edge and a light slap on the felt. */
function cardFlip(): Mono {
  const x = new Float32Array(Math.floor(0.14 * SR));
  burst(x, 0.002, 2.5, 1, { type: 'highpass', freq: 2500, q: 0.7 });
  modal(x, 0.002, [[rand(1500, 1900), 7, 1], [rand(2600, 3000), 5, 0.6], [rand(4000, 4600), 4, 0.4]], 0.35);
  burst(x, 0.045, 6, 0.6, { type: 'lowpass', freq: 1100, q: 0.7 });
  modal(x, 0.045, [[rand(140, 180), 22, 1]], 0.3);
  return fade(normalize(x, 0.65), 0.5, 15);
}

/** Two clay chips knocking together. */
function chipClack(level = 1): Mono {
  const x = new Float32Array(Math.floor(0.12 * SR));
  const f = rand(2500, 3100);
  burst(x, 0.001, 0.6, 0.7, { type: 'highpass', freq: 3000, q: 0.7 });
  modal(
    x,
    0.001,
    [
      [f, rand(28, 40), 1],
      [f * 1.58, rand(18, 26), 0.6],
      [f * 2.13, rand(12, 18), 0.4],
      [f * 2.79, rand(8, 12), 0.25],
      [f * 3.5, 6, 0.15],
    ],
    0.5,
  );
  return fade(normalize(x, 0.6 * level), 0.2, 10);
}

/** A chip dropped onto a stack: a few quick bounces with a soft felt thud. */
function chipDrop(): Mono {
  const x = new Float32Array(Math.floor(0.3 * SR));
  burst(x, 0, 10, 0.35, { type: 'lowpass', freq: 500, q: 0.7 });
  let t = 0.002;
  let gap = rand(0.04, 0.055);
  let g = 1;
  const n = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const c = chipClack(g);
    for (let j = 0; j < c.length && t * SR + j < x.length; j++) x[Math.floor(t * SR) + j]! += c[j]!;
    t += gap;
    gap *= 0.62;
    g *= 0.55;
  }
  return fade(normalize(x, 0.7), 0.2, 30);
}

/** Chips pushed across the felt by the dealer. */
function chipSlide(): Mono {
  const x = new Float32Array(Math.floor(0.42 * SR));
  for (let i = 0; i < 0.3 * SR; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.03) * Math.min(1, (0.3 - t) / 0.08);
    if (Math.random() < 0.05 * env) x[i]! += (Math.random() * 2 - 1) * env;
  }
  biquad(x, 'bandpass', 1500, 0.5);
  for (let i = 0; i < 4; i++) {
    const c = chipClack(0.35);
    const at = Math.floor(rand(0.04, 0.3) * SR);
    for (let j = 0; j < c.length && at + j < x.length; j++) x[at + j]! += c[j]! * 0.4;
  }
  return fade(normalize(x, 0.55), 5, 40);
}

/** A knuckle tap on the felt (a player asking for a card). */
function tableTap(): Mono {
  const x = new Float32Array(Math.floor(0.35 * SR));
  for (const at of [0.005, rand(0.14, 0.17)]) {
    burst(x, at, 8, 0.8, { type: 'lowpass', freq: 700, q: 0.8 });
    modal(x, at, [[rand(95, 125), 40, 1], [rand(230, 280), 18, 0.4]], 0.6);
  }
  return fade(normalize(x, 0.6), 0.5, 30);
}

function stereoize(l: Mono, r: Mono, ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(2, Math.max(l.length, r.length), SR);
  buf.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
  buf.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
  return buf;
}

/** The full shuffle: riffle, bridge, then the deck squared on the table. */
function shuffle(ctx: BaseAudioContext): AudioBuffer {
  const dur = 2.2;
  const L = new Float32Array(Math.floor(dur * SR));
  const R = new Float32Array(Math.floor(dur * SR));
  const flick = (out: Mono, at: number, g: number) => {
    burst(out, at, rand(1.2, 2.2), g, { type: 'bandpass', freq: rand(3500, 6000), q: 1.2 });
    modal(out, at, [[rand(2500, 3400), 3, 1]], g * 0.15);
  };
  // Riffle: two halves interleaving, left and right, speeding up.
  let t = 0.05;
  for (let i = 0; i < 52; i++) {
    const k = i / 52;
    const g = 0.5 + 0.5 * Math.sin(Math.PI * k);
    flick(i % 2 ? L : R, t, g);
    flick(i % 2 ? R : L, t, g * 0.35);
    t += 0.022 - 0.014 * k + rand(-0.002, 0.002);
  }
  // Bridge: a fast, soft cascade as the cards fall together.
  const bridgeStart = t + 0.18;
  for (let i = 0; i < 70; i++) {
    const at = bridgeStart + (i / 70) * 0.32;
    flick(L, at, 0.25);
    flick(R, at + 0.002, 0.25);
  }
  // Squaring the deck: two soft knocks.
  for (const at of [bridgeStart + 0.55, bridgeStart + 0.72]) {
    for (const ch of [L, R]) {
      burst(ch, at, 7, 0.5, { type: 'lowpass', freq: 900, q: 0.7 });
      modal(ch, at, [[rand(180, 230), 25, 1]], 0.3);
    }
  }
  normalize(L, 0.6);
  normalize(R, 0.6);
  return stereoize(L, R, ctx);
}

/** Applause from a small crowd. */
function applause(ctx: BaseAudioContext, seconds = 2.2): AudioBuffer {
  const L = new Float32Array(Math.floor(seconds * SR));
  const R = new Float32Array(Math.floor(seconds * SR));
  const claps = Math.floor(seconds * 70);
  for (let i = 0; i < claps; i++) {
    const at = Math.random() ** 1.6 * (seconds - 0.1);
    const env = Math.max(0.1, 1 - at / seconds);
    const freq = rand(900, 2300);
    const pan = Math.random();
    burst(L, at, rand(5, 9), env * (1 - pan * 0.7), { type: 'bandpass', freq, q: 1.4 });
    burst(R, at, rand(5, 9), env * (0.3 + pan * 0.7), { type: 'bandpass', freq, q: 1.4 });
  }
  normalize(fade(L, 30, 500), 0.45);
  normalize(fade(R, 30, 500), 0.45);
  return stereoize(L, R, ctx);
}

/** A crowd's "ooh": noise shaped by the formants of the vowel, swelling and fading. */
function ooh(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(1.3 * SR);
  const ch = () => {
    const x = new Float32Array(len);
    for (let i = 0; i < len; i++) x[i] = Math.random() * 2 - 1;
    const a = biquad(Float32Array.from(x), 'bandpass', rand(320, 380), 6);
    const b = biquad(Float32Array.from(x), 'bandpass', rand(800, 900), 8);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      x[i] = (a[i]! + b[i]! * 0.5) * Math.sin(Math.PI * Math.min(1, t * 1.6)) ** 2;
    }
    return normalize(fade(x, 50, 300), 0.35);
  };
  return stereoize(ch(), ch(), ctx);
}

/** Casino room tone: distant voices, air handling. Loops seamlessly. */
function roomTone(ctx: BaseAudioContext): AudioBuffer {
  const seconds = 8;
  const len = Math.floor(seconds * SR);
  const ch = () => {
    const x = new Float32Array(len);
    // Walla: a few "voices" — vowel-shaped noise with slow, random swells.
    for (let v = 0; v < 6; v++) {
      const n = new Float32Array(len);
      for (let i = 0; i < len; i++) n[i] = Math.random() * 2 - 1;
      biquad(n, 'bandpass', rand(250, 700), 4);
      const rate = rand(0.6, 1.6);
      const phase = Math.random() * 10;
      for (let i = 0; i < len; i++) {
        // Integer cycles over the loop so it wraps without a click.
        const t = i / len;
        const cycles = Math.round(rate * seconds);
        const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * cycles * t + phase);
        x[i]! += n[i]! * env ** 3;
      }
    }
    // Air handling: low, steady rumble.
    const air = new Float32Array(len);
    for (let i = 0; i < len; i++) air[i] = Math.random() * 2 - 1;
    biquad(air, 'lowpass', 180, 0.7);
    for (let i = 0; i < len; i++) x[i]! += air[i]! * 1.5;
    // Crossfade the end into the start for a seamless loop.
    const xf = Math.floor(0.3 * SR);
    for (let i = 0; i < xf; i++) {
      const k = i / xf;
      x[i] = x[i]! * k + x[len - xf + i]! * (1 - k);
    }
    return normalize(x.subarray(0, len - xf), 0.5);
  };
  return stereoize(ch(), ch(), ctx);
}

export interface SfxBank {
  card: AudioBuffer[];
  flip: AudioBuffer[];
  chip: AudioBuffer[];
  chipDrop: AudioBuffer[];
  chipSlide: AudioBuffer[];
  tap: AudioBuffer[];
  shuffle: AudioBuffer;
  applause: AudioBuffer;
  ooh: AudioBuffer;
  room: AudioBuffer;
}

export function buildSfxBank(ctx: BaseAudioContext): SfxBank {
  const mono = (x: Mono) => {
    const b = ctx.createBuffer(1, x.length, SR);
    b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
    return b;
  };
  const many = (n: number, make: () => Mono) => Array.from({ length: n }, () => mono(make()));
  return {
    card: many(6, cardSlide),
    flip: many(4, cardFlip),
    chip: many(6, () => chipClack()),
    chipDrop: many(5, chipDrop),
    chipSlide: many(3, chipSlide),
    tap: many(3, tableTap),
    shuffle: shuffle(ctx),
    applause: applause(ctx),
    ooh: ooh(ctx),
    room: roomTone(ctx),
  };
}
