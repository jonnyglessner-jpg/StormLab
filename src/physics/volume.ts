/**
 * Cloud volume for the chaser view: extinction coefficient (1/km) on a 3-D grid.
 * The updraft tower (with its overshooting dome), the anvil canopy, the wall cloud and the flanking line are
 * shaped from the storm's flow geometry; precipitation shafts and anvil ice come from the trajectories.
 */
import { clamp } from './constants';
import { type StormDiag } from './storm';
import { blur, type Grid3, type TrajResult } from './trajectories';

/** Peak extinction the 8-bit volume encodes, 1/km. */
export const BMAX = 24;

export function cloudVolume(St: StormDiag, T: TrajResult): Float32Array {
  const g = T.grid3;
  if (!g || !T.vol) throw new Error('cloudVolume needs trajectories run with a volume grid');
  const { NV, NZv, Rv, dxv, dzv } = g, F = T.F, E = St.E, N = NV * NV * NZv;
  const beta = new Float32Array(N);
  if (!St.forms) return beta;
  const lcl = E.pc.lcl, fzl = St.fzl || 4000;
  // normalise trajectory content by a high percentile of occupied cells so one dense spot doesn't set the scale
  const occ: number[] = [];
  for (let k = 0; k < N; k += 3) if (T.vol[k] > 0) occ.push(T.vol[k]);
  occ.sort((a, b) => a - b);
  const vs = 1 / (occ.length ? occ[Math.floor(occ.length * 0.98)] : 1);
  const X = (i: number) => -Rv + (i + 0.5) * dxv;

  for (let k = 0; k < NZv; k++) {
    const zz = (k + 0.5) * dzv;
    for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
      const x = X(i), y = X(j), p = (k * NV + j) * NV + i;
      let b = 0;
      const tv = T.vol[p] * vs;
      if (tv > 0.08) b += zz > fzl ? Math.min(4, 3 * (tv - 0.08)) : zz > lcl ? Math.min(3, 2.2 * (tv - 0.08)) : Math.min(1.6, 1.6 * (tv - 0.08));
      if (zz > lcl - 150 && x * x + y * y < 400e6) {
        // main updraft tower, cloud base to equilibrium level, capped by the overshooting dome
        const cx = F.tiltX * 0.25 * zz, cy = F.tiltY * 0.25 * zz, rr = Math.hypot(x - cx, y - cy), elv = F.el;
        const rt = zz <= elv ? F.Ru * (0.8 + 0.15 * Math.sin(Math.PI * clamp((zz - lcl) / (elv - lcl), 0, 1)))
          : F.Ru * 0.65 * Math.sqrt(Math.max(0, 1 - Math.pow((zz - elv) / (F.zTop - elv + 1), 2)));
        if (rr < rt) b += 14 * clamp((rt - rr) / 900, 0, 1);
      }
      beta[p] = b;
    }
  }

  // Anvil canopy: the updraft's outflow spreads as a flat-topped ice layer just under the equilibrium level over
  // the area the trajectories carry ice, thickest near the storm and thinning downstream
  {
    const el = E.pc.el ?? 10000, A = T.anvil, NA = T.N, RA = T.R, dA = T.dx;
    let amax = 0; for (let c = 0; c < A.length; c++) amax = Math.max(amax, A[c]);
    const Ab = blur(A, NA, 3);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
      const ia = Math.floor((X(i) + RA) / dA), ja = Math.floor((X(j) + RA) / dA);
      const a = ia >= 0 && ja >= 0 && ia < NA && ja < NA ? Ab[ja * NA + ia] / (amax || 1) : 0;
      if (a < 0.01) continue;
      const thick = clamp(1200 + 9000 * a, 1200, 3200), top = el + 300 * Math.min(1, 6 * a), bot = top - thick;
      for (let k = 0; k < NZv; k++) {
        const zz = (k + 0.5) * dzv; if (zz < bot - dzv || zz > top + dzv) continue;
        const edge = clamp((top - zz) / 400, 0, 1) * clamp((zz - bot) / 600, 0, 1);
        beta[(k * NV + j) * NV + i] += edge * clamp(1.5 + 30 * a, 0, 8);
      }
    }
  }

  const rot = St.mode === 'supercell' || St.mode === 'split' || St.mode === 'weak-super';
  if (rot) {
    // wall cloud: a lowered base under the low-level mesocyclone, where rain-cooled moist inflow condenses lower
    const Rw = F.RmLow * 1.1, drop = clamp(150 + 12 * St.vLow, 150, 600);
    for (let k = 0; k < NZv; k++) {
      const zz = (k + 0.5) * dzv; if (zz < lcl - drop || zz > lcl + 200) continue;
      for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
        const d = Math.hypot(X(i) - F.mesoX * 0.6, X(j) - F.mesoY * 0.6);
        if (d < Rw) beta[(k * NV + j) * NV + i] += 14 * (1 - d / Rw);
      }
    }
    // flanking line: towers stepping down along the rear-flank gust front
    const ang = Math.atan2(F.rfdY, F.rfdX) - 0.5, top = E.pc.el ?? 10000;
    for (let n = 1; n <= 4; n++) {
      const cx = Math.cos(ang) * F.Ru * (0.9 + 0.75 * n), cy = Math.sin(ang) * F.Ru * (0.9 + 0.75 * n);
      const h = lcl + (top - lcl) * (0.75 - 0.15 * n), rr = F.Ru * (0.55 - 0.07 * n);
      for (let k = 0; k < NZv; k++) {
        const zz = (k + 0.5) * dzv; if (zz < lcl || zz > h + rr) continue;
        const rz = zz > h ? Math.sqrt(Math.max(0, rr * rr - (zz - h) * (zz - h))) : rr * (0.7 + 0.3 * (zz - lcl) / (h - lcl + 1));
        for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
          const d = Math.hypot(X(i) - cx, X(j) - cy);
          if (d < rz) beta[(k * NV + j) * NV + i] += 10 * clamp((rz - d) / 800, 0, 1);
        }
      }
    }
  }
  return blur3(beta, NV, NZv);
}

/** 3x3x3 weighted smoothing. */
export function blur3(a: Float32Array, n: number, nz: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let k = 0; k < nz; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let s = 0, w = 0;
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const kk = k + dk, jj = j + dj, ii = i + di;
      if (kk < 0 || jj < 0 || ii < 0 || kk >= nz || jj >= n || ii >= n) continue;
      const ww = (dk ? 0.5 : 1) * (dj ? 0.5 : 1) * (di ? 0.5 : 1);
      s += a[(kk * n + jj) * n + ii] * ww; w += ww;
    }
    out[(k * n + j) * n + i] = s / w;
  }
  return out;
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
