/**
 * Synth — additive FM oscillator bank.
 * 32 bands are tuned to A minor pentatonic across 6+ octaves (A1–C8),
 * so any combination of notes the cursor reads will always sound in-key.
 *
 * Per band:
 *   modulator → modGain → carrier.frequency 
 *   carrier → outGain → dry + reverb send
 *
 * update(amplitudes, fmAmounts) is called every animation frame.
 *   amplitudes[i] 0–1 → output gain of band i
 *   fmAmounts[i] 0–1 → FM modulation depth (warm color = more FM)
 *
 * Voice limiting: only the MAX_VOICES loudest bands play at once.
 */

import { N_BANDS } from './constants.js';

const MAX_FM_DEPTH = 160; // Hz of frequency deviation at fmAmount = 1
const BAND_GAIN = 0.13; // per-band level (fewer voices → a bit louder each)
const MAX_VOICES = 6; // max simultaneous oscillators
const TC_ATTACK = 0.02; 
const TC_RELEASE = 0.20; // so notes ring out after cursor passes

// A minor pentatonic: semitone offsets 0,3,5,7,10 repeating each octave from A1=55 Hz
function buildPentatonicFreqs(n) {
  const steps = [0, 3, 5, 7, 10];
  const A1 = 55;
  const freqs = [];
  for (let oct = 0; freqs.length < n; oct++) {
    for (const st of steps) {
      freqs.push(A1 * Math.pow(2, oct + st / 12));
      if (freqs.length >= n) break;
    }
  }
  return freqs;
}

export const BAND_FREQS = buildPentatonicFreqs(N_BANDS);

export class Synth {
  constructor(ctx) {
    this.ctx = ctx;

    // --- Output chain ---
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 20;
    comp.ratio.value = 10;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);

    const dryGain = ctx.createGain();
    dryGain.gain.value = 0.62;
    dryGain.connect(comp);

    const conv = ctx.createConvolver();
    conv.buffer = makeReverbIR(ctx, 2.8, 2.2);
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.38;
    conv.connect(wetGain);
    wetGain.connect(comp);

    // --- Oscillator bands ---
    this._bands = [];
    this._lastTarget = new Float32Array(N_BANDS);

    for (let i = 0; i < N_BANDS; i++) {
      const freq = BAND_FREQS[i];

      const outGain = ctx.createGain();
      outGain.gain.value = 0;
      outGain.connect(dryGain);
      outGain.connect(conv);

      const modGain = ctx.createGain();
      modGain.gain.value = 0;

      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.value = freq * 2; // C:M ratio 1:2

      const car = ctx.createOscillator();
      car.type = 'sine';
      car.frequency.value = freq;

      mod.connect(modGain);
      modGain.connect(car.frequency);
      car.connect(outGain);

      mod.start();
      car.start();

      this._bands.push({ outGain, modGain });
    }
  }

  update(amplitudes, fmAmounts) {
    const now = this.ctx.currentTime;

    // Pick the MAX_VOICES loudest bands, silence the rest
    const order = Array.from({ length: N_BANDS }, (_, i) => i)
      .sort((a, b) => amplitudes[b] - amplitudes[a]);
    const active = new Set(order.slice(0, MAX_VOICES));

    for (let i = 0; i < N_BANDS; i++) {
      const target = active.has(i) ? amplitudes[i] : 0;
      const tc = target > this._lastTarget[i] ? TC_ATTACK : TC_RELEASE;
      this._bands[i].outGain.gain.setTargetAtTime(target * BAND_GAIN, now, tc);
      this._bands[i].modGain.gain.setTargetAtTime(fmAmounts[i] * MAX_FM_DEPTH, now, tc);
      this._lastTarget[i] = target;
    }
  }

  silence() {
    const now = this.ctx.currentTime;
    for (let i = 0; i < this._bands.length; i++) {
      this._bands[i].outGain.gain.setTargetAtTime(0, now, 0.08);
      this._lastTarget[i] = 0;
    }
  }
}

function makeReverbIR(ctx, duration, decay) {
  const n = Math.round(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
  }
  return buf;
}
