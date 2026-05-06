# Synesthesia: a color-to-timbre synthesizer with the Web Audio API

My project, *Synesthesia*, is inspired by the incredible neurological phenomenon where one might perceive sound as color. You draw on a canvas with colored brushes, then a playback cursor scans left to right and plays what it finds. The interesting design challenge is the question of how color maps to timbre, and how to make an instrument that maps to musical intuition.

---

## The canvas as a score

The core architecture separates drawing from display. There are two canvases: an offscreen `Sketch` canvas that holds the actual painted marks, and a visible display canvas that composites the sketch with a real-time overlay. The synth reads only from the offscreen canvas.

On each animation frame, the app calls `getImageData` on a single pixel column at the cursor position:

```js
readColumn(x) {
  const col = Math.max(0, Math.min(Math.floor(x), this._el.width - 1));
  const pixels = this._ctx.getImageData(col, 0, 1, this._el.height).data;
  return pixelsToBands(pixels, this._el.height);
}
```

Reading one column per frame is cheap. `getImageData` on a 1×H slice is far less expensive than reading the full canvas, and it gives us a clean separation between the drawing surface and the audio analysis. The returned pixel data is then divided into 32 vertical bands, each mapped to a frequency in the active scale.

---

## Staying in key

The synthesizer has 32 oscillators, each tuned to a note in a musical scale. The default is A minor pentatonic, spanning about six octaves up to the top of the audible range:

```js
export const SCALES = {
  pentatonic: [0, 3, 5, 7, 10],
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  wholetone:  [0, 2, 4, 6, 8, 10],
};

export function buildFreqs(steps, n = N_BANDS, rootHz = 55) {
  const freqs = [];
  for (let oct = 0; freqs.length < n; oct++) {
    for (const st of steps) {
      freqs.push(rootHz * Math.pow(2, oct + st / 12));
      if (freqs.length >= n) break;
    }
  }
  return freqs;
}
```

The pentatonic default is a deliberate UX choice. Any combination of active bands will sound good together, which means you can draw freely without accidentally producing dissonant clusters. This removes a significant barrier for non-musicians while still giving musically literate users enough structure to work intentionally.

Bands are laid out with low frequencies at the bottom of the canvas and high frequencies at the top  like a spectrogram. When you switch scales mid-playback, `retune()` uses `setTargetAtTime` rather than an instant value jump to avoid click artifacts:

```js
retune(freqs) {
  const now = this.ctx.currentTime;
  for (let i = 0; i < N_BANDS; i++) {
    this._bands[i].car.frequency.setTargetAtTime(freqs[i], now, 0.05);
    this._bands[i].mod.frequency.setTargetAtTime(freqs[i] * 2, now, 0.05);
  }
}
```

The 50ms time constant means the retune is a brief glide rather than a hard jump.

---

## Three channels, three parameters

The most interesting design decision in the whole project is how the RGB channels map to audio parameters. Each pixel column encodes three independent synthesis dimensions:

**Luminance → amplitude.** The average of R, G, B gives perceived brightness, which maps to oscillator output gain. This is the most intuitive mapping, as bright paint is loud, and dark paint is quiet.

**R − B (warm/cool balance) → FM depth.** If a pixel has more red than blue, it drives frequency modulation deeper. Warm colors (orange, red) become rich and buzzy; cool colors (cyan, blue) stay as near-pure sines. The formula goes to zero for cool-dominant pixels so there's no "negative FM":

```js
fmSum += Math.max(0, (r - bl) / 255);
```

**G → vibrato depth.** The green values exclusively drives the depth of a per-band LFO. Green paint shimmers and wobbles; non-green paint is stable. This makes all three channels musically meaningful and gives the color picker an expressive dimension beyond aesthetics.

---

## The FM synthesis 

Each of the 32 bands is a two-operator FM voice with a Carrier-to-Modulator ratio of 1:2:

```
modulator (freq × 2) → modGain → carrier.frequency
carrier → outGain → dry bus + reverb send
```

A 1:2 ratio produces more harmonic and consonant sidebands.
```js
const MAX_FM_DEPTH = 160; // Hz of carrier frequency deviation at fmAmount = 1
```

---

## Vibrato via Per-Band LFO

Each band also has an LFO connected directly to the carrier's frequency AudioParam:

```
lfo (5.5 Hz sine) → lfoGain → carrier.frequency
```

The 5.5 Hz rate is in the classical vibrato range (typically 5–7 Hz). Depth is capped at ±8 Hz, which is subtle enough not to destabilize the pitch but clearly audible on sustained notes. Because LFOs are per-band, you can have vibrato on a mid-register note while the bass and treble remain steady.

The LFO gain is driven by the green channel the same way FM depth is driven by the warm/cool balance: smoothed through `setTargetAtTime` on each frame so rapid cursor movement doesn't cause gain discontinuities.

---

## Voice Limiting and Envelopes

With 32 oscillators all running simultaneously, a dense painting could easily overload the output bus. Voice limiting caps the polyphony at 6 simultaneous voices (the 6 bands with the highest amplitude at each frame).

```js
const order = Array.from({ length: N_BANDS }, (_, i) => i)
  .sort((a, b) => amplitudes[b] - amplitudes[a]);
const active = new Set(order.slice(0, MAX_VOICES));
```

Silencing isn't instant. Each voice uses a fast attack (20ms) and a slower release (200ms), so notes that pass under the cursor ring out briefly rather than cutting abruptly. This gives the instrument a slightly legato character.

---

## Output chain

The signal path after the oscillator bank:

1. **Per-band output gain**: scales each band by 0.13 to prevent clipping with multiple voices active
2. **Dry/wet split**: 62% goes straight to the compressor; 38% is sent through a convolution reverb
3. **Synthetic reverb IR**: the impulse response is generated procedurally at startup: two channels of exponentially-decaying noise, 2.8 seconds long
4. **Dynamics compressor**: threshold −18 dBFS, ratio 10:1, 4ms attack, 200ms release

---

## Additive Blending: Making Overdrawing Musical

The brush uses `globalCompositeOperation = 'lighter'` rather than `'source-over'`. In lighter mode, overlapping paint strokes add their RGB values together (clamped to 255). This means drawing over an existing mark increases luminance, which, through the amplitude mapping, makes that region louder. You can layer strokes to build up complex amplitude contours, and the brightness of the painting directly encodes the dynamic intensity of the sound. Erasing uses `'source-over'` with black fill to subtract paint back to silence.

---

## What I'd Do Next

A few directions I didn't have time to explore:

**Microphone input as brush.** Route mic audio through a real-time FFT and paint the spectrum onto the canvas as the sound plays, then play it back. The canvas becomes a spectrogram of something you sang or played.

**Per-band LFO rate variation.** Currently all 32 LFOs run at the same 5.5 Hz. Mapping LFO rate to, say, vertical position (faster vibrato in the treble, slower in the bass) would add a more organic quality.

The core insight of the project, that a three-channel color value maps to a complete timbral instruction, has a lot of room left to explore. I hope to implement more features in the future!
