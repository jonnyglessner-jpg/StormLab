/** Thermodynamics: the idealized afternoon sounding and the mixed-layer parcel. */
import { CP, DZ, EPS, G, LV, NZ, P00, RD, clamp, lerp } from './constants';

/** Saturation vapour pressure (Pa), Bolton (1980). T in K. */
export const esat = (T: number): number => 611.2 * Math.exp(17.67 * (T - 273.15) / (T - 29.65));
/** Saturation mixing ratio (kg/kg). */
export const qsat = (p: number, T: number): number => { const e = esat(T); return EPS * e / Math.max(p - e, 1); };
/** Dewpoint (K) from pressure (Pa) and mixing ratio (kg/kg). */
export const tdFromQ = (p: number, q: number): number => {
  const e = q * p / (EPS + q), l = Math.log(e / 611.2);
  return 273.15 + 243.5 * l / (17.67 - l);
};
export const F2K = (f: number): number => (f - 32) / 1.8 + 273.15;

export interface ThermoInput {
  /** Surface temperature, deg F */
  T0F: number;
  /** Surface dewpoint, deg F */
  TdF: number;
  /** 3-6 km lapse rate, C/km */
  lapse: number;
  /** Strength of the capping inversion, C of warming across 300 m */
  cap: number;
}

export interface Sounding {
  z: Float64Array; T: Float64Array; q: Float64Array; p: Float64Array;
  /** index of the tropopause level */
  kt: number;
  ztrop: number;
}

/**
 * Afternoon sounding. A well-mixed boundary layer reaches roughly the surface-parcel LCL (cumulus form at its top),
 * a capping inversion sits on it, then 6.5 C/km to 3 km, the user's lapse rate to 6 km, 7.2 C/km above, and an
 * isothermal-then-warming stratosphere. Pressure is hydrostatic with moisture.
 */
export function sounding(o: ThermoInput): Sounding {
  const z = new Float64Array(NZ), T = new Float64Array(NZ), q = new Float64Array(NZ), p = new Float64Array(NZ);
  const T0 = F2K(o.T0F), Td0 = Math.min(F2K(o.TdF), T0), P0 = 98000;
  const zml = clamp(125 * (T0 - Td0), 700, 3000), capD = 300, zcap = zml + capD, ztrop0 = 12500;
  const z3 = Math.max(3000, zcap + 200);
  const Tml = T0 - 0.0095 * zml, Tcap = Tml + o.cap, T3 = Tcap - 0.0065 * (z3 - zcap), T6 = T3 - o.lapse / 1000 * (6000 - z3);
  for (let k = 0; k < NZ; k++) {
    const zz = k * DZ; z[k] = zz;
    let t: number;
    if (zz <= zml) t = T0 - 0.0095 * zz;
    else if (zz <= zcap) t = Tml + o.cap * (zz - zml) / capD;
    else if (zz <= z3) t = Tcap - 0.0065 * (zz - zcap);
    else if (zz <= 6000) t = T3 - o.lapse / 1000 * (zz - z3);
    else t = T6 - 0.0072 * (zz - 6000);
    T[k] = t;
  }
  let kt = NZ - 1;
  for (let k = 0; k < NZ; k++) if (T[k] <= 213 || z[k] >= ztrop0) { kt = k; break; }
  for (let k = kt + 1; k < NZ; k++) T[k] = T[kt] + 0.0015 * (z[k] - z[kt]);
  const q0 = qsat(P0, Td0);
  for (let it = 0; it < 3; it++) {
    p[0] = P0;
    for (let k = 1; k < NZ; k++) {
      const tv = 0.5 * (T[k] * (1 + 0.61 * q[k]) + T[k - 1] * (1 + 0.61 * q[k - 1]));
      p[k] = p[k - 1] * Math.exp(-G * DZ / (RD * tv));
    }
    for (let k = 0; k < NZ; k++) {
      const zz = z[k];
      if (zz <= zml) { q[k] = Math.min(q0, qsat(p[k], T[k]) * 0.98); continue; }
      // free troposphere: relative humidity falling off with height, drier above a strong cap
      const rh = zz <= zcap ? lerp(0.85, 0.65, (zz - zml) / capD)
        : zz <= z3 ? lerp(0.65 - 0.04 * o.cap, 0.5, (zz - zcap) / (z3 - zcap))
          : zz <= 6000 ? lerp(0.5, 0.35 - 0.02 * (o.lapse - 6.5), (zz - z3) / (6000 - z3))
            : Math.max(0.15, 0.3 - 0.02 * (zz - 6000) / 1000);
      q[k] = Math.min(q0, rh * qsat(p[k], T[k]));
    }
  }
  return { z, T, q, p, kt, ztrop: z[kt] };
}

export interface Parcel {
  /** parcel temperature (K) and virtual temperature (K) on the profile levels */
  Tp: Float64Array; Tvp: Float64Array;
  /** buoyancy, m/s^2 */
  B: Float64Array;
  cape: number; cin: number; cape3: number;
  /** heights (m AGL) */
  lcl: number; lfc: number | null; el: number | null;
  /** mixed-layer potential temperature (K) and mixing ratio (kg/kg) */
  thm: number; qm: number;
}

/** Lift the lowest-1-km mixed-layer parcel: dry to its LCL, then pseudoadiabatically. Virtual temperature throughout. */
export function parcel(s: Sounding): Parcel {
  const { z, T, q, p } = s;
  const n = Math.round(1000 / DZ);
  let thm = 0, qm = 0;
  for (let k = 0; k <= n; k++) { thm += T[k] * Math.pow(P00 / p[k], RD / CP); qm += q[k]; }
  thm /= n + 1; qm /= n + 1;
  const Tp = new Float64Array(NZ), Tvp = new Float64Array(NZ), Tve = new Float64Array(NZ);
  const gam = (t: number, pp: number) => {
    const qs = qsat(pp, t);
    return G * (1 + LV * qs / (RD * t)) / (CP + LV * LV * qs * EPS / (RD * t * t));
  };
  let tp = thm * Math.pow(p[0] / P00, RD / CP), qp = qm, klcl = -1;
  for (let k = 0; k < NZ; k++) {
    if (k > 0) {
      if (klcl < 0) {
        tp -= G / CP * DZ;
        if (qm >= qsat(p[k], tp)) klcl = k;
      } else {
        const pm = Math.sqrt(p[k] * p[k - 1]), g1 = gam(tp, p[k - 1]), g2 = gam(tp - g1 * DZ, pm);
        tp -= 0.5 * (g1 + g2) * DZ;
      }
      qp = klcl < 0 ? qm : Math.min(qm, qsat(p[k], tp));
    }
    Tp[k] = tp; Tvp[k] = tp * (1 + 0.61 * qp); Tve[k] = T[k] * (1 + 0.61 * q[k]);
  }
  // LCL height from the dewpoint depression (125 m per K), more precise than the 100 m grid
  const tdm = tdFromQ(p[0], qm), t0 = thm * Math.pow(p[0] / P00, RD / CP);
  const lcl = clamp(125 * (t0 - tdm), 0, 6000);
  const B = new Float64Array(NZ);
  for (let k = 0; k < NZ; k++) B[k] = G * (Tvp[k] - Tve[k]) / Tve[k];
  let cape = 0, cin = 0, klfc = -1, kel = -1, cape3 = 0;
  for (let k = 1; k < NZ; k++) {
    const b = 0.5 * (B[k] + B[k - 1]) * DZ;
    if (b > 0) {
      if (klfc < 0 && z[k] >= lcl - DZ) klfc = k - 1;
      if (klfc >= 0) { cape += b; kel = k; if (z[k] <= 3000) cape3 += b; }
    } else if (klfc < 0) cin += b;
    else if (kel >= 0 && z[k] > z[kel] + 1500) break;
  }
  if (cape < 1) { cape = 0; klfc = -1; }
  if (klfc < 0) cin = Math.min(cin, 0);
  return { Tp, Tvp, B, cape, cin, cape3, lcl, lfc: klfc >= 0 ? z[klfc] : null, el: kel >= 0 ? z[kel] : null, thm, qm };
}

/** Lowest height (m) where the environment is at or below 0 C. */
export function freezingLevel(s: Sounding): number {
  for (let k = 0; k < NZ; k++) if (s.T[k] <= 273.15) return s.z[k];
  return 0;
}
