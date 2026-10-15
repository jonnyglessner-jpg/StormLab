import { mulberry } from '../physics/random';

/**
 * Tiling 3-D value noise (three octaves), N^3 bytes. The renderers use it to break cloud edges into billows
 * finer than the volume grid.
 */
export function cloudNoise(N = 48): Uint8Array {
  const acc = new Float32Array(N * N * N), rr = mulberry(99);
  for (const [Lc, amp] of [[4, 0.5], [8, 0.3], [16, 0.2]] as const) {
    const lat = new Float32Array(Lc * Lc * Lc);
    for (let q = 0; q < lat.length; q++) lat[q] = rr();
    const sm = (t: number) => t * t * (3 - 2 * t);
    const L = (a: number, b: number, c: number) => lat[((c % Lc) * Lc + (b % Lc)) * Lc + (a % Lc)];
    for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const fx = i * Lc / N, fy = j * Lc / N, fz = k * Lc / N, x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
      const tx = sm(fx - x0), ty = sm(fy - y0), tz = sm(fz - z0);
      const c00 = L(x0, y0, z0) * (1 - tx) + L(x0 + 1, y0, z0) * tx, c10 = L(x0, y0 + 1, z0) * (1 - tx) + L(x0 + 1, y0 + 1, z0) * tx;
      const c01 = L(x0, y0, z0 + 1) * (1 - tx) + L(x0 + 1, y0, z0 + 1) * tx, c11 = L(x0, y0 + 1, z0 + 1) * (1 - tx) + L(x0 + 1, y0 + 1, z0 + 1) * tx;
      acc[(k * N + j) * N + i] += amp * ((c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz);
    }
  }
  const out = new Uint8Array(N * N * N);
  for (let q = 0; q < acc.length; q++) out[q] = Math.round(255 * Math.min(1, Math.max(0, (acc[q] - 0.5) * 1.8 + 0.5)));
  return out;
}
