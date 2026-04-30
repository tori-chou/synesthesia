/**
 * Sketch — persistent drawing surface backed by an offscreen canvas.
 *
 * Color → timbre mapping (read by readColumn):
 * luminance  →  oscillator amplitude
 * max(0, R−B)/255  →  FM modulation depth  (warm = buzzy, cool = pure)
 */

import { N_BANDS } from './constants.js';

export class Sketch {
  constructor(w, h) {
    this._el = document.createElement('canvas');
    this._ctx = this._el.getContext('2d');
    this.brushSize = 18;
    this.brushRgb = { r: 255, g: 255, b: 255 };
    this._lastX = 0;
    this._lastY = 0;
    this._resize(w, h, false);
  }

  /** Expose the offscreen canvas so app.js can drawImage() it. */
  get element() { return this._el; }

  clear() {
    this._ctx.globalCompositeOperation = 'source-over';
    this._ctx.fillStyle = '#000';
    this._ctx.fillRect(0, 0, this._el.width, this._el.height);
  }

  resize(w, h) { this._resize(w, h, true); }

  /** Begin a stroke (called on mousedown). */
  startStroke(x, y) {
    this._lastX = x;
    this._lastY = y;
    this._dot(x, y);
  }

  /** Continue a stroke (called on mousemove while button is held). */
  continueStroke(x, y) {
    this._line(this._lastX, this._lastY, x, y);
    this._lastX = x;
    this._lastY = y;
  }

  /**
   * Sample one pixel column and return per-band audio parameters.
   * @returns {{ amplitudes: Float32Array, fmAmounts: Float32Array }}
   */
  readColumn(x) {
    const col = Math.max(0, Math.min(Math.floor(x), this._el.width - 1));
    const pixels = this._ctx.getImageData(col, 0, 1, this._el.height).data;
    return pixelsToBands(pixels, this._el.height);
  }

  _resize(w, h, preserve) {
    if (preserve) {
      const saved = this._ctx.getImageData(0, 0, this._el.width, this._el.height);
      this._el.width = w;
      this._el.height = h;
      this.clear();
      this._ctx.putImageData(saved, 0, 0);
    } else {
      this._el.width = w;
      this._el.height = h;
      this.clear();
    }
  }

  _dot(x, y) {
    const g = this._ctx;
    const { r, g: cg, b } = this.brushRgb;
    const isErasing = r === 0 && cg === 0 && b === 0;

    g.globalCompositeOperation = isErasing ? 'source-over' : 'lighter';

    const grad = g.createRadialGradient(x, y, 0, x, y, this.brushSize);
    grad.addColorStop(0, `rgba(${r},${cg},${b},0.45)`);
    grad.addColorStop(1, `rgba(${r},${cg},${b},0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, this.brushSize, 0, Math.PI * 2);
    g.fill();

    g.globalCompositeOperation = 'source-over';
  }

  _line(x0, y0, x1, y1) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / (this.brushSize * 0.3)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this._dot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  }
}

// Amplitudes + FM modulation amount determined according to color
function pixelsToBands(pixels, canvasHeight) {
  const amplitudes = new Float32Array(N_BANDS);
  const fmAmounts = new Float32Array(N_BANDS);
  const bandH = canvasHeight / N_BANDS;

  for (let b = 0; b < N_BANDS; b++) {
    // Band 0 = lowest freq = bottom of canvas (large row index)
    const rowStart = Math.floor((N_BANDS - 1 - b) * bandH);
    const rowEnd = Math.min(Math.ceil((N_BANDS - b) * bandH), canvasHeight);
    const count = rowEnd - rowStart;
    if (count === 0) continue;

    let lumSum = 0, fmSum = 0;
    for (let row = rowStart; row < rowEnd; row++) {
      const i = row * 4;
      const r = pixels[i], g = pixels[i + 1], bl = pixels[i + 2];
      lumSum += (r + g + bl) / (3 * 255);
      fmSum += Math.max(0, (r - bl) / 255);
    }
    amplitudes[b] = lumSum / count;
    fmAmounts[b] = fmSum / count;
  }

  return { amplitudes, fmAmounts };
}
