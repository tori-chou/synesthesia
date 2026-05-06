/**
 * Synth — additive FM oscillator bank with per-band vibrato.
 * Bands are tuned to the selected scale across 6+ octaves (A1=55 Hz root).
 *
 * Per band:
 *   modulator  → modGain  → carrier.frequency  (FM)
 *   lfo        → lfoGain  → carrier.frequency  (vibrato)
 *   carrier    → outGain  → dry + reverb send
 *
 * update(amplitudes, fmAmounts, vibratoAmounts) called every animation frame.
 *   amplitudes[i]     0–1 → output gain
 *   fmAmounts[i]      0–1 → FM modulation depth  (warm/red = buzzy)
 *   vibratoAmounts[i] 0–1 → LFO pitch wobble depth (green = shimmery)
 *
 * retune(freqs) smoothly resets all oscillator frequencies (scale change).
 * Voice limiting: only the MAX_VOICES loudest bands play at once.
 */

import { N_BANDS, SCALES, buildFreqs } from './constants.js';

const MAX_FM_DEPTH = 160;       // Hz deviation at fmAmount = 1
const MAX_VIBRATO_DEPTH = 8;    // Hz deviation at vibratoAmount = 1
const VIBRATO_RATE = 5.5;       // LFO Hz
const BAND_GAIN = 0.13;
const MAX_VOICES = 6;
const TC_ATTACK = 0.02;
const TC_RELEASE = 0.20;

export const BAND_FREQS = buildFreqs(SCALES.pentatonic);

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

    const freqs = buildFreqs(SCALES.pentatonic);

    for (let i = 0; i < N_BANDS; i++) {
      const freq = freqs[i];

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

      // Vibrato LFO
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = VIBRATO_RATE;

      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0;

      lfo.connect(lfoGain);
      lfoGain.connect(car.frequency);

      mod.start();
      car.start();
      lfo.start();

      this._bands.push({ outGain, modGain, lfoGain, car, mod });
    }
  }

  update(amplitudes, fmAmounts, vibratoAmounts) {
    const now = this.ctx.currentTime;

    const order = Array.from({ length: N_BANDS }, (_, i) => i)
      .sort((a, b) => amplitudes[b] - amplitudes[a]);
    const active = new Set(order.slice(0, MAX_VOICES));

    for (let i = 0; i < N_BANDS; i++) {
      const target = active.has(i) ? amplitudes[i] : 0;
      const tc = target > this._lastTarget[i] ? TC_ATTACK : TC_RELEASE;
      this._bands[i].outGain.gain.setTargetAtTime(target * BAND_GAIN, now, tc);
      this._bands[i].modGain.gain.setTargetAtTime(fmAmounts[i] * MAX_FM_DEPTH, now, tc);
      this._bands[i].lfoGain.gain.setTargetAtTime(vibratoAmounts[i] * MAX_VIBRATO_DEPTH, now, tc);
      this._lastTarget[i] = target;
    }
  }

  retune(freqs) {
    const now = this.ctx.currentTime;
    for (let i = 0; i < N_BANDS; i++) {
      this._bands[i].car.frequency.setTargetAtTime(freqs[i], now, 0.05);
      this._bands[i].mod.frequency.setTargetAtTime(freqs[i] * 2, now, 0.05);
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
