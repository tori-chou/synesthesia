import { Synth, BAND_FREQS } from './synth.js';
import { Sketch } from './sketch.js';
import { N_BANDS, SCALES, buildFreqs } from './constants.js';

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const btnPlay = document.getElementById('btn-play');
const btnClear = document.getElementById('btn-clear');
const brushInput = document.getElementById('brush-size');
const speedInput = document.getElementById('speed');
const scaleInput = document.getElementById('scale');
const btnInfo = document.getElementById('btn-info');
const infoOverlay = document.getElementById('info-overlay');
const btnCloseInfo = document.getElementById('btn-close-info');

// --- State ---
let audioCtx = null;
let synth = null;
let sketch = null;
let playing = false;
let cursorX = 0;
let speed = 100;
let lastTime = 0;
let raf = null;

// Tick lines at each A note in the pentatonic scale (exact band positions)
const FREQ_TICKS = BAND_FREQS
  .map((freq, b) => ({ freq, b }))
  .filter(({ freq }) => Math.abs(freq / 55 - Math.round(freq / 55)) < 0.01)
  .map(({ freq, b }) => ({
    normY: (N_BANDS - 1 - b) / (N_BANDS - 1),
    label: freq < 1000 ? `${Math.round(freq)} Hz` : `${(freq / 1000).toFixed(1)}k`,
  }));

// --- Sizing ---
const TOOLBAR_H = 52;

function stageSize() {
  return [window.innerWidth, window.innerHeight - TOOLBAR_H];
}

function resize() {
  const [w, h] = stageSize();
  canvas.width = w;
  canvas.height = h;
  sketch?.resize(w, h);
}

window.addEventListener('resize', resize);

// Defer init one frame so the browser has painted and window dimensions are stable
requestAnimationFrame(() => {
  const [w, h] = stageSize();
  canvas.width = w;
  canvas.height = h;
  sketch = new Sketch(w, h);
  sketch.brushSize = Number(brushInput.value);
  raf = requestAnimationFrame(renderIdle);
});

// --- Mouse / touch ---
let isDown = false;

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

canvas.addEventListener('mousedown', e => {
  if (!sketch) return;
  isDown = true;
  sketch.startStroke(...canvasPos(e));
});
canvas.addEventListener('mousemove', e => {
  if (!sketch || !isDown) return;
  sketch.continueStroke(...canvasPos(e));
});
canvas.addEventListener('mouseup', () => { isDown = false; });
canvas.addEventListener('mouseleave', () => { isDown = false; });

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  isDown = true;
  sketch.startStroke(...canvasPos(e.touches[0]));
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (isDown) sketch.continueStroke(...canvasPos(e.touches[0]));
}, { passive: false });
canvas.addEventListener('touchend', () => { isDown = false; });

// --- UI controls ---
document.querySelectorAll('.swatch').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sketch.brushRgb = {
      r: Number(btn.dataset.r),
      g: Number(btn.dataset.g),
      b: Number(btn.dataset.b),
    };
  });
});

brushInput.addEventListener('input', () => { sketch.brushSize = Number(brushInput.value); });
speedInput.addEventListener('input', () => { speed = Number(speedInput.value); });
scaleInput.addEventListener('change', () => { synth?.retune(buildFreqs(SCALES[scaleInput.value])); });
btnClear.addEventListener('click', () => { sketch.clear(); });
btnPlay.addEventListener('click', () => playing ? pause() : play());
btnInfo.addEventListener('click', () => { infoOverlay.classList.remove('hidden'); });
btnCloseInfo.addEventListener('click', () => { infoOverlay.classList.add('hidden'); });
infoOverlay.addEventListener('click', e => { if (e.target === infoOverlay) infoOverlay.classList.add('hidden'); });

// --- Playback ---
async function play() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    synth = new Synth(audioCtx);
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  playing = true;
  lastTime = performance.now();
  btnPlay.textContent = 'Pause';
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(playLoop);
}

function pause() {
  playing = false;
  btnPlay.textContent = 'Play';
  cancelAnimationFrame(raf);
  synth?.silence();
  raf = requestAnimationFrame(renderIdle);
}

// --- Render loops ---
function playLoop(timestamp) {
  if (!playing) return;
  raf = requestAnimationFrame(playLoop);
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;
  cursorX = (cursorX + speed * dt) % canvas.width;
  const { amplitudes, fmAmounts, vibratoAmounts } = sketch.readColumn(cursorX);
  synth.update(amplitudes, fmAmounts, vibratoAmounts);
  render(amplitudes);
}

function renderIdle() {
  render(null);
  raf = requestAnimationFrame(renderIdle);
}

// --- Drawing ---
function render(amplitudes) {
  const W = canvas.width;
  const H = canvas.height;
  if (!W || !H || !sketch) return;

  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(sketch.element, 0, 0);

  // Frequency axis grid lines
  ctx.save();
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  for (const { normY, label } of FREQ_TICKS) {
    const y = normY * H;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillText(label, 6, y - 3);
  }
  ctx.restore();

  // Playback cursor
  if (amplitudes) {
    const bandH = H / N_BANDS;
    for (let b = 0; b < N_BANDS; b++) {
      const amp = amplitudes[b];
      if (amp < 0.015) continue;
      const y = (N_BANDS - 1 - b) * bandH;
      const glow = ctx.createLinearGradient(cursorX - 30, 0, cursorX + 30, 0);
      glow.addColorStop(0, 'rgba(255,255,255,0)');
      glow.addColorStop(0.5, `rgba(255,255,255,${(amp * 0.8).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(cursorX - 30, y, 60, bandH + 1);
    }
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
