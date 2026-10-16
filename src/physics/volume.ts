/**
 * Cloud volumes for the 3-D view: the shared grid description, the extinction scale, and CPU lighting for the
 * WebGL fallback (the WebGPU renderer lights the volume on the GPU).
 */
import { clamp } from './constants';

/** Peak extinction the 8-bit volume encodes, 1/km. */
export const BMAX = 24;

/** A cubic volume grid: NV x NV columns over +/-Rv m, NZv levels up to ZT m, spacing dxv, dzv m. */
export interface Grid3 { NV: number; NZv: number; Rv: number; ZT: number; dxv: number; dzv: number }

export interface VolumeData extends Grid3 {
  /** extinction, 1/km */
  beta: Float32Array;
  /** packed RGBA8 with CPU lighting, when requested */
  lit: Uint8Array | null;
}

/** Sun direction (unit vector toward the sun): low in the west, 22 deg up. */
export const SUN_ELEVATION_DEG = 22;

/**
 * CPU lighting for the WebGL fallback: optical depth toward a sun in the west (marching along +x with the
 * elevation shift) and skylight occlusion from above. Packs RGBA8: density (sqrt-encoded), sun transmittance,
 * sky visibility. The WebGPU renderer does this on the GPU instead.
 */
export function lightVolumeCPU(beta: Float32Array, g: Grid3): Uint8Array {
  const { NV, NZv } = g, dx = g.dxv / 1000, dz = g.dzv / 1000, NN = NV * NV * NZv;
  const el = SUN_ELEVATION_DEG * Math.PI / 180, tau = new Float32Array(NN), shift = dx * Math.tan(el) / dz, ds = dx / Math.cos(el);
  for (let i = 1; i < NV; i++) for (let j = 0; j < NV; j++) for (let k = 0; k < NZv; k++) {
    const sk = Math.min(NZv - 1, k + shift), k0 = Math.floor(sk), k1 = Math.min(NZv - 1, k0 + 1), fr = sk - k0;
    const p0 = (k0 * NV + j) * NV + i - 1, p1 = (k1 * NV + j) * NV + i - 1, here = (k * NV + j) * NV + i;
    tau[here] = tau[p0] * (1 - fr) + tau[p1] * fr + 0.5 * (beta[here - 1] + beta[here]) * ds;
  }
  const up = new Float32Array(NN);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
    let acc = 0;
    for (let k = NZv - 1; k >= 0; k--) { const p = (k * NV + j) * NV + i; acc += beta[p] * dz; up[p] = acc; }
  }
  const out = new Uint8Array(NN * 4);
  for (let k = 0; k < NN; k++) {
    out[k * 4] = Math.round(255 * Math.sqrt(clamp(beta[k] / BMAX, 0, 1)));
    out[k * 4 + 1] = Math.round(255 * (0.75 * Math.exp(-0.35 * tau[k]) + 0.25 * Math.exp(-0.08 * tau[k])));
    out[k * 4 + 2] = Math.round(255 * Math.exp(-0.12 * up[k]));
    out[k * 4 + 3] = 255;
  }
  return out;
}
