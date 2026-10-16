/** Wind profile (hodograph), layer means, Bunkers storm motion and storm-relative helicity. */
import { DZ, NZ, clamp, type Vec2 } from './constants';

export interface WindInput {
  /** 1 km wind speed (low-level jet), m/s */
  llj: number;
  /** 0-6 km bulk shear magnitude, m/s */
  shear: number;
  /** wind speed at 10 km, m/s */
  upper: number;
}
export interface Winds { u: Float64Array; v: Float64Array }

/** Vector (u, v) for a wind blowing FROM `deg` at `spd`. */
export const fromDir = (deg: number, spd: number): Vec2 => {
  const a = deg * Math.PI / 180;
  return [-spd * Math.sin(a), -spd * Math.cos(a)];
};

/**
 * Classic south-west flow: a south-easterly surface wind veering through a southerly low-level jet to
 * south-westerlies through the mid and upper troposphere, so storms move to the north-east.
 * The 6 km wind speed is solved so the 0-6 km bulk shear equals the requested value.
 */
export function winds(o: WindInput): Winds {
  const s0 = 2.5 + 0.35 * o.llj;
  const V0 = fromDir(150, s0), V05 = fromDir(170, 0.75 * o.llj + 1.5), V1 = fromDir(190, o.llj);
  const e = fromDir(240, 1), bq = -(e[0] * V0[0] + e[1] * V0[1]), cq = V0[0] * V0[0] + V0[1] * V0[1] - o.shear * o.shear;
  const disc = bq * bq - cq, s6 = Math.max(0, -bq + Math.sqrt(Math.max(disc, 0)));
  const V6: Vec2 = [s6 * e[0], s6 * e[1]];
  const s1 = Math.hypot(V1[0], V1[1]), V3 = fromDir(215, 0.5 * (s1 + s6));
  const V10 = fromDir(245, o.upper), V12 = fromDir(247, o.upper * 0.95), V16 = fromDir(250, o.upper * 0.5);
  const ctrl: [number, Vec2][] = [[0, V0], [500, V05], [1000, V1], [3000, V3], [6000, V6], [10000, V10], [12000, V12], [16000, V16]];
  const u = new Float64Array(NZ), v = new Float64Array(NZ);
  // cubic Hermite (Catmull-Rom style tangents) between control heights
  for (let k = 0; k < NZ; k++) {
    const zz = k * DZ;
    let i = 0; while (i < ctrl.length - 2 && zz > ctrl[i + 1][0]) i++;
    const [za, A] = ctrl[i], [zb, Bv] = ctrl[i + 1], t = (zz - za) / (zb - za);
    const Pm = ctrl[Math.max(0, i - 1)][1], Pn = ctrl[Math.min(ctrl.length - 1, i + 2)][1];
    for (let c = 0; c < 2; c++) {
      const m0 = 0.5 * (Bv[c] - Pm[c]) * (i > 0 ? 1 : 2) * 0.5, m1 = 0.5 * (Pn[c] - A[c]) * (i < ctrl.length - 2 ? 1 : 2) * 0.5;
      const t2 = t * t, t3 = t2 * t;
      const val = (2 * t3 - 3 * t2 + 1) * A[c] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * Bv[c] + (t3 - t2) * m1;
      (c ? v : u)[k] = val;
    }
  }
  return { u, v };
}

/** Linear interpolation of a profile array at height zz (m). */
export const at = (arr: ArrayLike<number>, zz: number): number => {
  const f = clamp(zz / DZ, 0, NZ - 1), k = Math.min(NZ - 2, Math.floor(f));
  return arr[k] + (arr[k + 1] - arr[k]) * (f - k);
};

export function layerMean(w: Winds, z0: number, z1: number): Vec2 {
  let su = 0, sv = 0, n = 0;
  for (let zz = z0; zz <= z1 + 1e-6; zz += 50) { su += at(w.u, zz); sv += at(w.v, zz); n++; }
  return [su / n, sv / n];
}

export interface Bunkers { rm: Vec2; lm: Vec2; mw: Vec2 }

/** Bunkers et al. (2000) internal-dynamics method: 0-6 km mean wind plus 7.5 m/s normal to the shear. */
export function bunkers(w: Winds): Bunkers {
  const mw = layerMean(w, 0, 6000), lo = layerMean(w, 0, 500), hi = layerMean(w, 5500, 6000);
  const su = hi[0] - lo[0], sv = hi[1] - lo[1], m = Math.hypot(su, sv) || 1;
  return {
    rm: [mw[0] + 7.5 * sv / m, mw[1] - 7.5 * su / m],
    lm: [mw[0] - 7.5 * sv / m, mw[1] + 7.5 * su / m],
    mw
  };
}

/** Storm-relative helicity (m^2/s^2) from the ground to `top` (m) for storm motion c. */
export function srh(w: Winds, c: Vec2, top: number): number {
  let h = 0;
  for (let zz = 0; zz < top; zz += 50) {
    const u0 = at(w.u, zz) - c[0], v0 = at(w.v, zz) - c[1], u1 = at(w.u, zz + 50) - c[0], v1 = at(w.v, zz + 50) - c[1];
    h += u1 * v0 - u0 * v1;
  }
  return h;
}
