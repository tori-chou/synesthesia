export const N_BANDS = 32;

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
