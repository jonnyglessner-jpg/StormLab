/** Storm diagnosis from the environment, and the tornado outlook. */
import { MPH, clamp } from './constants';
import { type Environment } from './environment';
import { freezingLevel } from './thermo';

export type StormMode = 'none' | 'capped' | 'pulse' | 'multicell' | 'marginal' | 'split' | 'supercell' | 'weak-super';
export type Precip = 'ordinary' | 'lp' | 'classic' | 'hp';

export interface StormDiag {
  E: Environment;
  forms: boolean;
  capped: boolean;
  mode: StormMode;
  /** peak updraft and low-level (about 1 km) updraft, m/s */
  w: number; wLow: number;
  /** mesocyclone rotational velocity at 3-6 km and near 1 km, m/s */
  vMid: number; vLow: number;
  /** -1 (LP) .. 0 (classic) .. 1 (HP) */
  hpness: number;
  precip: Precip;
  /** freezing level, m */
  fzl: number;
  /** largest hail the updraft can suspend, inches */
  hailIn: number;
  /** chance this storm produces a tornado */
  ptor: number;
  /** median and log-spread of tornado peak wind if one forms (m/s) */
  vMed: number; vSig: number;
  /** probability of EF0..EF5 given a tornado */
  efProb: number[];
}

export const isRotating = (m: StormMode): boolean => m === 'supercell' || m === 'split' || m === 'weak-super' || m === 'marginal';

export function storm(E: Environment): StormDiag {
  const { pc } = E;
  const base: StormDiag = {
    E, forms: false, capped: false, mode: 'none', w: 0, wLow: 0, vMid: 0, vLow: 0, hpness: 0, precip: 'ordinary',
    fzl: freezingLevel(E.s), hailIn: 0, ptor: 0, vMed: 0, vSig: 0.3, efProb: [0, 0, 0, 0, 0, 0]
  };
  base.forms = pc.cape >= 150 && pc.cin > -200 && pc.el !== null && pc.el - pc.lcl > 3000;
  base.capped = pc.cape >= 150 && pc.cin <= -200;
  if (!base.forms) { base.mode = base.capped ? 'capped' : 'none'; return base; }

  const out = base;
  const wpar = Math.sqrt(2 * pc.cape);
  // Updraft: about half the parcel-theory value (entrainment, water loading), plus dynamic lift from rotation
  // in strongly sheared, helical environments
  const dyn = clamp(E.srh3 / 300, 0, 1) * clamp((E.shear6 - 12) / 15, 0, 1);
  out.w = clamp(0.5 * wpar * (1 + 0.35 * dyn), 5, 0.8 * wpar);
  out.wLow = 0.3 * out.w * (0.8 + 0.4 * dyn);

  // Storm mode from 0-6 km shear (about 20 and 40 kt thresholds), splitting when the hodograph is nearly straight
  const sh = E.shear6;
  let mode: StormMode;
  if (sh < 10) mode = 'pulse';
  else if (sh < 17.5) mode = 'multicell';
  else if (sh < 20) mode = 'marginal';
  else mode = E.srh3 < 90 ? 'split' : 'supercell';
  if (out.w < 12 && mode !== 'pulse') mode = sh >= 20 ? 'weak-super' : 'multicell';
  out.mode = mode;
  const rotating = isRotating(mode);
  const rf = mode === 'marginal' ? 0.6 : mode === 'weak-super' ? 0.8 : rotating ? 1 : 0.25;

  // Mesocyclone rotational velocity scales with sqrt(SRH): the updraft tilts streamwise vorticity into the vertical
  out.vMid = rf * 1.25 * Math.sqrt(Math.max(E.srh3, 0)) * Math.sqrt(clamp(out.w / 30, 0.25, 1.5));
  const lclF = clamp((2300 - pc.lcl) / 1300, 0.25, 1);
  out.vLow = rf * 1.05 * Math.sqrt(Math.max(E.srh1, 0)) * Math.sqrt(clamp(out.wLow / 10, 0.3, 1.6)) * (0.55 + 0.45 * lclF);

  // Precipitation character from storm-relative anvil-level wind (Rasmussen & Straka 1998), wetter in very moist air
  const sra = E.srAnvil, moist = clamp((E.o.TdF - 68) / 8, 0, 1);
  out.hpness = clamp((24 - sra) / 10 + 0.35 * moist, 0, 1) - clamp((sra - 28) / 8, 0, 1);
  out.precip = !rotating ? 'ordinary' : out.hpness > 0.5 ? 'hp' : out.hpness < -0.35 ? 'lp' : 'classic';

  // Largest hail the updraft can suspend, D ~ (w/14)^2 cm, trimmed for melting below a high freezing level
  out.hailIn = Math.max(0, Math.pow(0.75 * out.w * (rotating ? 1 : 0.8) / 14, 2) / 2.54 - Math.max(0, (out.fzl - 3800) / 1000) * 0.4);

  // Tornado outlook, scaled from STP to match supercell tornado frequency in SPC climatology
  const stp = E.stp;
  out.ptor = rotating && mode !== 'marginal'
    ? 0.65 * (1 - Math.exp(-0.45 * stp)) * (mode === 'weak-super' ? 0.7 : 1)
    : mode === 'marginal' ? 0.15 * (1 - Math.exp(-0.45 * stp)) : 0;
  // Intensity if one forms: lognormal in peak wind, median rising with STP
  // (matches the EF2+ share: about 10% below STP 1, about 50% at STP 10 and above; Smith et al. 2015)
  out.vMed = (72 + 16 * Math.log(1 + stp)) * MPH;
  out.vSig = 0.3;
  out.efProb = efDist(out.vMed, out.vSig);
  return out;
}

/** EF-scale lower bounds, m/s (65, 86, 111, 136, 166, 201 mph). */
export const EFT = [65, 86, 111, 136, 166, 201].map(m => m * MPH);

function ncdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
  const pr = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - pr : pr;
}

/** Probability of each EF rating given a tornado. Winds below EF0 are lumped into EF0. */
export function efDist(vmed: number, sig: number): number[] {
  const cdf = (v: number) => ncdf(Math.log(v / vmed) / sig), out: number[] = [];
  for (let k = 0; k < 6; k++) out.push((k < 5 ? cdf(EFT[k + 1]) : 1) - (k === 0 ? 0 : cdf(EFT[k])));
  return out;
}

export interface TornadoParams {
  peakMph: number;
  /** core radius aloft, yd */
  rc: number;
  /** swirl ratio */
  sw: number;
  /** cloud base, ft */
  zc: number;
  /** forward speed, mph */
  vt: number;
  precip: 'lp' | 'classic' | 'hp';
}

/** Draw a tornado (or none) from the storm's distributions. `typical` returns the median tornado. */
export function tornadoFrom(St: StormDiag, rnd: () => number, typical: boolean): TornadoParams | null {
  if (!St.forms || St.ptor <= 0) return null;
  if (!typical && rnd() > St.ptor) return null;
  const g = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) * Math.SQRT2; };
  const V = typical ? St.vMed : St.vMed * Math.exp(St.vSig * g());
  return tornadoParams(St, Math.max(V, 70 * MPH), typical ? 0 : g(), typical ? 0 : g());
}

/** Map a target peak wind (m/s) to vortex-model parameters. n1, n2 are standard-normal draws for variety. */
export function tornadoParams(St: StormDiag, V: number, n1 = 0, n2 = 0): TornadoParams {
  const E = St.E, mph = V / MPH;
  const lcl = clamp(E.pc.lcl, 150, 1520);
  // width: stronger tornadoes are wider (Brooks 2004); moist, low-LCL, strongly rotating storms favour wedges
  const wet = clamp((1300 - E.pc.lcl) / 800, 0, 1), meso = clamp((St.vLow - 12) / 15, 0, 1);
  const rcYd = clamp((35 + 1.5 * (mph - 65)) * (0.75 + 0.55 * wet + 0.4 * meso) * Math.exp(0.35 * n1), 20, 450);
  const rc = rcYd * 0.9144;
  // swirl ratio S = r0 Gamma / 2Q ~ (core radius x rotational speed) / (updraft radius x updraft speed)
  const sw = clamp(1.2 * rc * V * 0.75 / (400 * Math.max(St.wLow, 6)) * Math.exp(0.25 * n2), 0.08, 3.0);
  const vt = Math.hypot(E.bk.rm[0], E.bk.rm[1]) / MPH;
  const precip = St.precip === 'ordinary' ? 'classic' : St.precip;
  return {
    peakMph: Math.round(mph), rc: Math.round(rcYd / 5) * 5, sw: Math.round(sw * 100) / 100,
    zc: Math.round(lcl / 0.3048 / 50) * 50, vt: Math.round(clamp(vt, 0, 60)), precip
  };
}
