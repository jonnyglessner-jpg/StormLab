/** The environment summary: sounding, parcel, winds, storm motion and the SPC composite parameters. */
import { type Vec2 } from './constants';
import { parcel, sounding, type Parcel, type Sounding, type ThermoInput } from './thermo';
import { at, bunkers, layerMean, srh, winds, type Bunkers, type WindInput, type Winds } from './winds';

export type EnvInput = ThermoInput & WindInput;

export interface Environment {
  o: EnvInput;
  s: Sounding;
  pc: Parcel;
  w: Winds;
  bk: Bunkers;
  /** bulk shear magnitudes, m/s */
  shear6: number; shear1: number;
  /** storm-relative helicity relative to the right-mover, m^2/s^2 */
  srh1: number; srh3: number;
  /** storm-relative wind speeds (right-mover), m/s: 9-11 km, 4-6 km, 0-1 km */
  srAnvil: number; srMid: number; srLow: number;
  /** 3-6 km lapse rate, C/km */
  lapse36: number;
  scp: number; stp: number;
  /** bulk Richardson number */
  brn: number;
}

const srSpeed = (m: Vec2, c: Vec2) => Math.hypot(m[0] - c[0], m[1] - c[1]);

export function environment(o: EnvInput): Environment {
  const s = sounding(o), pc = parcel(s), w = winds(o), bk = bunkers(w);
  const shear6 = Math.hypot(at(w.u, 6000) - w.u[0], at(w.v, 6000) - w.v[0]);
  const shear1 = Math.hypot(at(w.u, 1000) - w.u[0], at(w.v, 1000) - w.v[0]);
  const srh1 = srh(w, bk.rm, 1000), srh3 = srh(w, bk.rm, 3000);
  const srAnvil = srSpeed(layerMean(w, 9000, 11000), bk.rm);
  const srMid = srSpeed(layerMean(w, 4000, 6000), bk.rm);
  const srLow = srSpeed(layerMean(w, 0, 1000), bk.rm);
  const lapse36 = (s.T[30] - s.T[60]) / 3;
  // Supercell Composite Parameter (Thompson et al. 2003): shear term 0 below 10 m/s, capped at 1.5
  const shTermS = shear6 < 10 ? 0 : Math.min(shear6, 30) / 20;
  const scp = Math.max(0, (pc.cape / 1000) * (srh3 / 50) * shTermS);
  // Significant Tornado Parameter: fixed-layer form with the CIN term from the effective-layer version
  const lclT = pc.lcl < 1000 ? 1 : pc.lcl > 2000 ? 0 : (2000 - pc.lcl) / 1000;
  const shT = shear6 < 12.5 ? 0 : Math.min(shear6, 30) / 20;
  const cinT = pc.cin > -50 ? 1 : pc.cin < -200 ? 0 : (200 + pc.cin) / 150;
  const stp = Math.max(0, (pc.cape / 1500) * lclT * (srh1 / 150) * shT * cinT);
  const mw = layerMean(w, 0, 6000), lo = layerMean(w, 0, 500);
  const brn = pc.cape / Math.max(0.5 * Math.pow(Math.hypot(mw[0] - lo[0], mw[1] - lo[1]), 2), 1);
  return { o, s, pc, w, bk, shear6, shear1, srh1, srh3, srAnvil, srMid, srLow, lapse36, scp, stp, brn };
}
