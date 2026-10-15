/**
 * Hydrometeor trajectories. A deterministic sample of the steady storm: particles are released through the
 * updraft, carried by the flow, fall at their terminal speeds, melt below the freezing level, sublimate or
 * evaporate in dry air. Every step a particle spends in a cell adds to that cell's precipitation content, which
 * becomes radar reflectivity (low levels) and the precipitation/ice part of the cloud volume.
 */
import { clamp, lerp } from './constants';
import { flowModel, type FlowModel } from './flow';
import { mulberry } from './random';
import { type StormDiag } from './storm';
import { layerMean } from './winds';

export interface Grid2 { N: number; R: number; dx: number }
export interface Grid3 { NV: number; NZv: number; Rv: number; ZT: number; dxv: number; dzv: number }

export interface TrajOptions {
  /** radar grid: N x N cells over +/-R m */
  N: number; R: number;
  /** number of particles released through the updraft */
  nRel: number;
  /** also accumulate the 3-D volume on this grid */
  volume?: Grid3;
}

export interface TrajResult extends Grid2 {
  F: FlowModel;
  /** precipitation content below 1.6 km, reflectivity-weighted */
  low: Float32Array;
  /** ice carried above 8 km (anvil footprint) */
  anvil: Float32Array;
  /** 3-D precipitation and ice content on the volume grid, if requested */
  vol: Float32Array | null;
  grid3: Grid3 | null;
  nRel: number;
  /** direction (rad) the main precipitation leaves the updraft */
  ffAng: number;
}

const isSupercellish = (m: string) => m === 'supercell' || m === 'split' || m === 'weak-super';

export function trajectories(St: StormDiag, opt: TrajOptions): TrajResult {
  const F = flowModel(St), E = St.E;
  const { R, N } = opt, dx = 2 * R / N;
  const g3 = opt.volume ?? null;
  const low = new Float32Array(N * N), anvil = new Float32Array(N * N);
  const vol = g3 ? new Float32Array(g3.NV * g3.NV * g3.NZv) : null;
  const rotating = isSupercellish(St.mode);
  const up = layerMean(E.w, 6000, 10000);
  const ffAng = Math.atan2(up[1] - E.bk.rm[1], up[0] - E.bk.rm[0]) + (rotating ? 0.7 : 0);
  const result: TrajResult = { F, low, anvil, vol, grid3: g3, N, R, dx, nRel: opt.nRel, ffAng };
  if (!St.forms) return result;

  const fzl = St.fzl || 4000, o = [0, 0, 0], rnd = mulberry(12345), dt = 15;
  const nRel = opt.nRel;
  const hailFrac = clamp((St.hailIn - 0.5) / 2.5, 0.03, 0.25);
  const evapT = clamp(2400 - 1.1 * E.pc.lcl, 500, 2400);
  const fRear = rotating ? clamp(0.12 + 0.15 * St.hpness + 0.15 * clamp((St.vMid - 15) / 15, 0, 1), 0.05, 0.4) : 0;
  const mid = layerMean(E.w, 4000, 6000);
  const rearAng = Math.atan2(-(mid[1] - E.bk.rm[1]), -(mid[0] - E.bk.rm[0])) - 0.5;
  const Rv = g3?.Rv ?? 0, dxv = g3?.dxv ?? 1, dzv = g3?.dzv ?? 1, NV = g3?.NV ?? 0, NZv = g3?.NZv ?? 0;

  for (let n = 0; n < nRel; n++) {
    let x: number, y: number, zz: number;
    if (rnd() < fRear) {
      // Precipitation carried around the north side by the mid-level mesocyclone collects at the rear stagnation
      // point, where the storm-relative flow meets the updraft, and is brought down by the rear-flank downdraft
      zz = lerp(2500, 6000, rnd());
      const a = rearAng + (rnd() - 0.5) * 1.6, rr = F.Ru * lerp(0.7, 1.3, rnd());
      x = rr * Math.cos(a); y = rr * Math.sin(a);
    } else {
      // Hydrometeors grow on the way up and leave the updraft on its downstream flank, deflected cyclonically
      let th = 0;
      for (let tries = 0; tries < 20; tries++) { th = rnd() * 2 * Math.PI; if (rnd() < Math.pow(0.5 + 0.5 * Math.cos(th - ffAng), 1.5)) break; }
      const rr = F.Ru * lerp(0.5, 1.25, Math.sqrt(rnd()));
      zz = lerp(Math.max(4000, E.pc.lcl + 1500), 0.8 * F.el, rnd());
      x = rr * Math.cos(th) + F.tiltX * 0.25 * zz; y = rr * Math.sin(th) + F.tiltY * 0.25 * zz;
    }
    const kind = rnd();
    const type = kind < hailFrac ? 2 : kind < 0.5 ? 1 : 0;   // 0 ice/snow aloft, 1 rain/graupel, 2 hail
    let age = 0, mass = 1;
    const vHail = 10 + Math.min(25, 14 * Math.sqrt(Math.max(St.hailIn, 0.3) * 2.54) * (0.4 + 0.6 * rnd()));
    for (let s = 0; s < 400; s++) {
      F.vel(x, y, zz, o);
      const vt = type === 2 ? Math.min(vHail, 5 + 0.04 * age)        // hail grows as it cycles in the updraft
        : type === 1 ? (zz > fzl ? 4 : 7)
          : zz > fzl ? 1.0 : zz > fzl - 400 ? 3 : 6.5;                 // snow melts into rain below the freezing level
      const xm = x + 0.5 * dt * o[0], ym = y + 0.5 * dt * o[1], zm = zz + 0.5 * dt * (o[2] - vt);
      F.vel(xm, ym, zm, o);
      x += dt * o[0]; y += dt * o[1]; zz = Math.min(F.zTop, zz + dt * (o[2] - vt));
      age += dt;
      const inCloud = Math.hypot(x - F.tiltX * 0.25 * zz, y - F.tiltY * 0.25 * zz) < 1.3 * F.Ru;
      if (type === 0 && zz > fzl && !inCloud) mass *= Math.exp(-dt / 600);   // sublimation outside the cloud
      if (zz < E.pc.lcl) mass *= Math.exp(-dt / evapT);                        // evaporation below cloud base
      if (zz <= 0 || mass < 0.03) break;
      if (Math.abs(x) > 96000 || Math.abs(y) > 96000) break;
      // reflectivity weights: hail >> rain > dry snow (Z ~ N D^6; dry snow also has a lower dielectric factor)
      const zw = type === 2 ? (zz < fzl ? 14 : 9) : type === 1 ? 1 : zz > fzl ? 0.12 : 0.9;
      const i = Math.floor((x + R) / dx), j = Math.floor((y + R) / dx);
      if (i >= 0 && j >= 0 && i < N && j < N) {
        const c = j * N + i;
        if (zz < 1600) low[c] += zw * dt * mass;
        if (zz > 8000 && type === 0) anvil[c] += dt * mass;
      }
      if (vol) {
        const iv = Math.floor((x + Rv) / dxv), jv = Math.floor((y + Rv) / dxv), kv = Math.floor(zz / dzv);
        if (iv >= 0 && jv >= 0 && iv < NV && jv < NV && kv >= 0 && kv < NZv) vol[(kv * NV + jv) * NV + iv] += (type === 0 && zz > fzl ? 1.0 : 0.55) * dt * mass;
      }
    }
  }

  // Hook echo. Below about 2.5 km, precipitation reaching the rear flank is caught in the low-level mesocyclone's
  // converging swirl. A particle in a vortex with inflow follows a logarithmic spiral, r = r0 exp(-theta u_r/v_theta);
  // integrating that flow traces the hook around the inflow notch.
  const nHook = rotating ? Math.round(nRel * clamp(0.08 + 0.25 * clamp((St.vLow - 6) / 20, 0, 1) + 0.12 * St.hpness, 0.03, 0.4)) : 0;
  const vl = Math.max(St.vLow, 4), Rl = F.RmLow, mxc = F.mesoX, myc = F.mesoY;
  for (let n = 0; n < nHook; n++) {
    const a0 = rearAng + 0.3 + (rnd() - 0.5) * 1.0, r0 = F.Ru * lerp(0.6, 1.2, rnd());
    let x = mxc + r0 * Math.cos(a0), y = myc + r0 * Math.sin(a0), zz = lerp(1500, 3500, rnd());
    for (let s = 0; s < 200; s++) {
      const qx = x - mxc, qy = y - myc, d = Math.hypot(qx, qy) + 1;
      const vt = d < Rl ? vl * d / Rl : vl * Math.pow(Rl / d, 0.3);
      const ur = -0.22 * vt * clamp(d / Rl, 0, 1);
      x += dt * (-vt * qy / d + ur * qx / d); y += dt * (vt * qx / d + ur * qy / d); zz -= dt * 6;
      if (zz <= 0 || d < 0.25 * Rl) break;
      const i = Math.floor((x + R) / dx), j = Math.floor((y + R) / dx);
      if (i >= 0 && j >= 0 && i < N && j < N && zz < 1600) low[j * N + i] += dt * 1.6 * (St.precip === 'lp' ? 0.4 : 1);
    }
  }

  // Weak-echo region: precipitation can't fall through the strong low-level updraft
  const o2 = [0, 0, 0];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -R + (i + 0.5) * dx, y = -R + (j + 0.5) * dx;
    if (x * x + y * y > 4 * F.Ru * F.Ru) continue;
    F.vel(x, y, 1500, o2);
    if (o2[2] > 2) low[j * N + i] *= Math.exp(-(o2[2] - 2) / 3);
  }
  return result;
}

/** Separable Gaussian blur of an N x N field, radius in cells. */
export function blur(a: Float32Array, N: number, rad: number): Float32Array {
  if (rad < 0.5) return a;
  const k = Math.ceil(rad * 2.5), wts: number[] = [];
  let sw = 0;
  for (let i = -k; i <= k; i++) { const w = Math.exp(-i * i / (2 * rad * rad)); wts.push(w); sw += w; }
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let s = 0; for (let q = -k; q <= k; q++) { const ii = i + q; if (ii >= 0 && ii < N) s += a[j * N + ii] * wts[q + k]; }
    tmp[j * N + i] = s / sw;
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let s = 0; for (let q = -k; q <= k; q++) { const jj = j + q; if (jj >= 0 && jj < N) s += tmp[jj * N + i] * wts[q + k]; }
    out[j * N + i] = s / sw;
  }
  return out;
}

/**
 * Convert accumulated precipitation content to dBZ. The constant places a mature classic-supercell core near
 * 60-65 dBZ; the absolute level is calibrated, the pattern is what the trajectories produce.
 */
export function toDbz(a: Float32Array, nRel: number): Float32Array {
  const out = new Float32Array(a.length), k = 2600 / nRel;
  for (let c = 0; c < a.length; c++) { const z = a[c] * k; out[c] = z > 0 ? 10 * Math.log10(z) + 17 : -99; }
  return out;
}
