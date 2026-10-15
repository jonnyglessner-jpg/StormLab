/**
 * Base state for the cloud model: a horizontally uniform, hydrostatic environment on the model's levels,
 * with the storm motion subtracted from the winds so the storm stays near the middle of the domain.
 */
import { CP, G, P00, RD } from '../physics/constants';
import { type Environment } from '../physics/environment';
import { at } from '../physics/winds';
import { type GridSpec } from './grid';

export interface BaseState {
  /** at cell-centre levels k = 0..NZ-1 */
  th0: Float32Array; qv0: Float32Array; pi0: Float32Array; rho0: Float32Array; p0: Float32Array; u0: Float32Array; v0: Float32Array;
  /** density at w levels k = 0..NZ */
  rhoW: Float32Array;
  /** storm motion removed from the winds (m/s) */
  cu: number; cv: number;
}

export interface Profile {
  /** functions of height z (m) */
  theta(z: number): number;
  qv(z: number): number;
  u(z: number): number;
  v(z: number): number;
  /** surface pressure, Pa */
  psfc: number;
}

/** Build a base state from any profile, integrating the hydrostatic Exner equation with virtual temperature. */
export function baseFromProfile(g: GridSpec, prof: Profile, cu: number, cv: number): BaseState {
  const NZ = g.NZ, dz = g.dz;
  const th0 = new Float32Array(NZ), qv0 = new Float32Array(NZ), pi0 = new Float32Array(NZ), rho0 = new Float32Array(NZ);
  const p0 = new Float32Array(NZ), u0 = new Float32Array(NZ), v0 = new Float32Array(NZ), rhoW = new Float32Array(NZ + 1);
  // fine hydrostatic integration (20 m) from the surface
  const thv = (z: number) => prof.theta(z) * (1 + 0.608 * prof.qv(z));
  let pi = Math.pow(prof.psfc / P00, RD / CP), z = 0;
  const piAt = (zt: number) => { while (z < zt - 1e-6) { const h = Math.min(20, zt - z); pi -= G / (CP * thv(z + 0.5 * h)) * h; z += h; } return pi; };
  const rhoFrom = (zz: number, p: number) => {
    const T = prof.theta(zz) * Math.pow(p / P00, RD / CP);
    return p / (RD * T * (1 + 0.608 * prof.qv(zz)));
  };
  const rhoAtW: number[] = [];
  for (let k = 0; k <= NZ; k++) {
    // w levels and centre levels interleaved, both increasing in height
    const zw = k * dz, piw = piAt(zw), pw = P00 * Math.pow(piw, CP / RD);
    rhoAtW.push(rhoFrom(zw, pw));
    if (k < NZ) {
      const zc = (k + 0.5) * dz, pic = piAt(zc), pc = P00 * Math.pow(pic, CP / RD);
      th0[k] = prof.theta(zc); qv0[k] = prof.qv(zc); pi0[k] = pic; p0[k] = pc; rho0[k] = rhoFrom(zc, pc);
      u0[k] = prof.u(zc) - cu; v0[k] = prof.v(zc) - cv;
    }
  }
  for (let k = 0; k <= NZ; k++) rhoW[k] = rhoAtW[k];
  return { th0, qv0, pi0, rho0, p0, u0, v0, rhoW, cu, cv };
}

/** Base state from the app's environment (sounding and winds), moving with the Bunkers right-mover. */
export function baseFromEnvironment(g: GridSpec, E: Environment): BaseState {
  const s = E.s;
  const theta = new Float64Array(s.z.length);
  for (let k = 0; k < s.z.length; k++) theta[k] = s.T[k] * Math.pow(P00 / s.p[k], RD / CP);
  return baseFromProfile(g, {
    theta: z => at(theta, z), qv: z => at(s.q, z), u: z => at(E.w.u, z), v: z => at(E.w.v, z), psfc: s.p[0]
  }, E.bk.rm[0], E.bk.rm[1]);
}

/**
 * Weisman & Klemp (1982) analytic sounding, with a quarter-circle hodograph (Weisman & Rotunno 2000). Used to
 * check the model against the CM1 reference run made with the same environment.
 */
export function weismanKlempProfile(qvPbl: number, shear: number): Profile {
  const zt = 12000, tht = 343, Ttr = 213, ths = 300;
  const theta = (z: number) => z < zt ? ths + (tht - ths) * Math.pow(z / zt, 1.25) : tht * Math.exp(G / (CP * Ttr) * (z - zt));
  const rh = (z: number) => z < zt ? 1 - 0.75 * Math.pow(z / zt, 1.25) : 0.25;
  // pressure for the RH-to-mixing-ratio conversion: dry hydrostatic estimate is accurate enough here
  const pAt = (z: number) => { let pi = 1, zz = 0; while (zz < z) { const h = Math.min(50, z - zz); pi -= G / (CP * theta(zz + h / 2)) * h; zz += h; } return P00 * Math.pow(pi, CP / RD); };
  const cache = new Map<number, number>();
  const qv = (z: number) => {
    const key = Math.round(z / 10);
    let q = cache.get(key);
    if (q === undefined) {
      const p = pAt(z), T = theta(z) * Math.pow(p / P00, RD / CP), es = 611.2 * Math.exp(17.67 * (T - 273.15) / (T - 29.65));
      q = Math.min(rh(z) * 0.622 * es / (p - es), qvPbl);
      cache.set(key, q);
    }
    return q;
  };
  const R = 7 * shear / 31.8, U6 = Math.sqrt(Math.max(shear * shear - R * R, 0));
  const u = (z: number) => z <= 2000 ? R - R * Math.cos(Math.PI / 2 * z / 2000) : R + (Math.min(z, 6000) - 2000) / 4000 * (U6 - R);
  const v = (z: number) => z <= 2000 ? R * Math.sin(Math.PI / 2 * z / 2000) : R;
  return { theta, qv, u, v, psfc: 1e5 };
}
