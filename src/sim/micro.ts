/**
 * Bulk microphysics with ice: a single-moment, six-class scheme (vapour, cloud water, rain, cloud ice, snow, hail)
 * in the style of Lin, Farley & Orville (1983, "LFO") as used by Gilmore et al. (2004), with Kessler (1969) warm
 * rain and the mixed-phase saturation adjustment of Tao et al. (1989).
 *
 * The process code is written ONCE, in a small subset of syntax that is valid both as JavaScript and as WGSL:
 * `const`/`let`/`var` declarations without types, float literals with a decimal point, `if` blocks with braces,
 * C-style `for` loops, and only the functions exp, pow, sqrt, log, abs, max, min, clamp, qsw and qsi. The CPU
 * reference compiles it with `new Function`; the WebGPU kernels paste it into their shaders. Both models therefore
 * run literally the same physics, and the browser comparison test checks that they agree.
 *
 * Processes (rates in kg/kg/s; "→" is where the mass goes):
 *   warm rain    cloud → rain by autoconversion and accretion (Kessler); rain evaporation (Klemp & Wilhelmson 1978)
 *   cloud ice    produced by the saturation adjustment: between 0 and −40 °C condensate is split between cloud
 *                water and ice in proportion to temperature, vapour is held at the matching blend of water and ice
 *                saturation, and below −40 °C all of it is ice (homogeneous freezing)
 *   snow         ice → snow (aggregation, Psaut), snow collects ice (Psaci) and cloud water (riming, Psacw),
 *                deposition and sublimation (Psdep), melting (Psmlt)
 *   hail         snow → hail (Pgaut), hail collects cloud water (Pgacw), ice (Pgaci) and supercooled rain (Pgacr),
 *                rain freezes (Bigg freezing Pgfr, and on contact with ice crystals Piacr + Praci; the number of
 *                crystals follows Fletcher (1962), because the temperature split of the condensate would otherwise
 *                imply thousands per litre just above the freezing level), sublimation, melting
 *                (Pgmlt, slowed in dry air by evaporative cooling of the stone)
 *   fall         rain, snow and hail fall at their own mass-weighted speeds; hail fastest, snow at about 1 m/s
 * Hail uses an exponential size distribution with N0 = 4×10⁴ m⁻⁴ and density 900 kg/m³, the "hail" end of
 * Gilmore et al.'s range: it falls fast and much of it reaches the ground, rather than melting and evaporating aloft.
 */

/** Constants shared by every snippet (module scope in WGSL, function scope in JS). */
export const MP_CONST = `
const T0 = 273.15;
const LV = 2.5e6;
const LF = 3.34e5;
const LS = 2.834e6;
const CPD = 1004.0;
const RV = 461.5;
const CW = 4187.0;
const PI_ = 3.14159265;
const RHOW = 1000.0;
const RHOSN = 100.0;
const RHOH = 900.0;
const N0R = 8.0e6;
const N0S = 3.0e6;
const N0H = 4.0e4;
const SA = 11.72;
const SB = 0.41;
const AR = 842.0;
const BR = 0.8;
const KA = 2.43e-2;
const DV = 2.26e-5;
const MU = 1.718e-5;
const SC3 = 0.843433;
const MI = 4.19e-13;
const G3B = 3.013315;
const G4B = 10.275404;
const G5B2 = 1.550861;
const G35 = 3.323351;
const G275 = 1.608359;
const G45 = 11.631728;
const G3BR = 4.694174;
const G6BR = 496.60608;
const G48 = 17.837862;
const G29 = 1.827355;
const HAILN = 1.0e-4;
`;

/**
 * Mass-weighted fall speeds (m/s) of rain (Klemp & Wilhelmson 1978), snow (LFO, V = 11.72 D^0.41) and hail
 * (V = sqrt(4 g rho_h D / (3 Cd rho)), Cd = 0.6). In: qr, qs, qh, rho, rhoS. Out: vr, vs, vh.
 */
export const VT_BODY = `
var vr = 0.0;
var vs = 0.0;
var vh = 0.0;
if (qr > 1e-9) { vr = min(10.0, 842.0 * G48 / 6.0 * pow(PI_ * RHOW * N0R / (rho * qr), -0.2) * sqrt(rhoS / rho)); }
if (qs > 1e-9) { vs = SA * G4B / 6.0 * pow(PI_ * RHOSN * N0S / (rho * qs), -0.25 * SB) * sqrt(rhoS / rho); }
if (qh > 1e-9) { vh = sqrt(4.0 * 9.81 * RHOH / (1.8 * rho)) * G45 / 6.0 * pow(PI_ * RHOH * N0H / (rho * qh), -0.125); }
`;

/**
 * One cell, one time step. In/out: th, qv, qc, qr, qi, qs, qh. In: pi (Exner), pr (Pa), rho, rhoS (surface
 * density), dt, K1, QCCRIT, K2 (Kessler parameters).
 */
export const MICRO_BODY = `
qc = max(qc, 0.0);
qr = max(qr, 0.0);
qi = max(qi, 0.0);
qs = max(qs, 0.0);
qh = max(qh, 0.0);
var T = th * pi;
let tc = T - T0;
let dens = sqrt(rhoS / rho);
let nu = MU / rho;
let ah = sqrt(4.0 * 9.81 * RHOH / (1.8 * rho));
let lr = pow(PI_ * RHOW * N0R / (rho * max(qr, 1e-12)), 0.25);
let ls = pow(PI_ * RHOSN * N0S / (rho * max(qs, 1e-12)), 0.25);
let lh = pow(PI_ * RHOH * N0H / (rho * max(qh, 1e-12)), 0.25);
${VT_BODY}
let praut = K1 * max(qc - QCCRIT, 0.0);
let pracw = K2 * qc * pow(max(qr, 1e-12), 0.875);
let psacw = PI_ * SA * qc * N0S * G3B / 4.0 * pow(ls, -3.0 - SB) * dens;
let pgacw = PI_ / 4.0 * qc * N0H * G35 * ah * pow(lh, -3.5);
var psaut = 0.0;
var psaci = 0.0;
var pgaut = 0.0;
var pgaci = 0.0;
var praci = 0.0;
var piacr = 0.0;
var pgacr = 0.0;
var pgfr = 0.0;
var psmlt = 0.0;
var pgmlt = 0.0;
if (tc < 0.0) {
  let ei = exp(0.025 * tc);
  psaut = 1e-3 * ei * max(qi - 1e-3, 0.0);
  psaci = PI_ * ei * SA * qi * N0S * G3B / 4.0 * pow(ls, -3.0 - SB) * dens;
  pgaut = 1e-3 * exp(0.09 * tc) * max(qs - 6e-4, 0.0);
  pgaci = PI_ / 4.0 * 0.1 * qi * N0H * G35 * ah * pow(lh, -3.5);
  praci = PI_ * AR * qi * N0R * G3BR / 4.0 * pow(lr, -3.0 - BR) * dens;
  let nci = min(qi / MI, 1.0e-2 * exp(0.6 * min(-tc, 40.0)) / rho);
  piacr = PI_ * PI_ * AR * N0R * RHOW * nci / 24.0 * G6BR * pow(lr, -6.0 - BR) * dens;
  pgacr = PI_ * PI_ * N0R * N0H * abs(vh - vr) * (RHOW / rho) * (5.0 * pow(lr, -6.0) / lh + 2.0 * pow(lr, -5.0) / (lh * lh) + 0.5 * pow(lr, -4.0) / (lh * lh * lh));
  pgfr = 20.0 * PI_ * PI_ * 100.0 * N0R * (RHOW / rho) * (exp(0.66 * min(-tc, 40.0)) - 1.0) * pow(lr, -7.0);
}
if (tc > 0.0) {
  psmlt = 2.0 * PI_ / (rho * LF) * KA * tc * N0S * (0.78 * pow(ls, -2.0) + 0.31 * SC3 * G5B2 * sqrt(SA * dens / nu) * pow(ls, -2.705)) + CW * tc / LF * psacw;
  let qs0 = qsw(T0, pr);
  pgmlt = max(0.0, 2.0 * PI_ / (rho * LF) * (KA * tc - LV * DV * rho * (qs0 - qv)) * N0H * (0.78 * pow(lh, -2.0) + 0.31 * SC3 * G275 * sqrt(ah / nu) * pow(lh, -2.75)) + CW * tc / LF * pgacw);
}
let sc = (praut + pracw + psacw + pgacw) * dt;
var cl = 1.0;
if (sc > qc) { cl = qc / sc; }
let si = (psaut + psaci + pgaci + praci) * dt;
var il = 1.0;
if (si > qi) { il = qi / si; }
let sr = (pgacr + pgfr + piacr) * dt;
var rl = 1.0;
if (sr > qr) { rl = qr / sr; }
let ss = (pgaut + psmlt) * dt;
var sl = 1.0;
if (ss > qs) { sl = qs / ss; }
let sh = pgmlt * dt;
var hl = 1.0;
if (sh > qh) { hl = qh / sh; }
let mlt = (psmlt * sl + pgmlt * hl) * dt;
var frz = 0.0;
var toR = (praut + pracw) * cl * dt + mlt;
var toS = (psaut + psaci) * il * dt - (pgaut + psmlt) * sl * dt;
var toH = pgaut * sl * dt + (pgaci + praci) * il * dt + sr * rl - pgmlt * hl * dt;
if (tc < 0.0) {
  toS += psacw * cl * dt;
  toH += pgacw * cl * dt;
  frz = (psacw + pgacw) * cl * dt + sr * rl;
} else {
  toR += (psacw + pgacw) * cl * dt;
}
qc = max(qc - sc * cl, 0.0);
qi = max(qi - si * il, 0.0);
qr = max(qr + toR - sr * rl, 0.0);
qs = max(qs + toS, 0.0);
qh = max(qh + toH, 0.0);
th += LF * (frz - mlt) / (CPD * pi);
for (var it = 0; it < 2; it++) {
  T = th * pi;
  let ws = qsw(T, pr);
  let wi = qsi(T, pr);
  let fi = clamp((T0 - T) / 40.0, 0.0, 1.0);
  let qsm = (1.0 - fi) * ws + fi * wi;
  let lm = LV + fi * LF;
  let dqdt = ((1.0 - fi) * LV * ws + fi * LS * wi) / (RV * T * T);
  var dq = (qv - qsm) / (1.0 + lm * dqdt / CPD);
  let ct = qc + qi;
  if (dq < 0.0) { dq = max(dq, -ct); }
  let cn = ct + dq;
  let qcn = (1.0 - fi) * cn;
  let qin = fi * cn;
  th += (LV * (qcn - qc) + LS * (qin - qi)) / (CPD * pi);
  qv -= dq;
  qc = qcn;
  qi = qin;
}
T = th * pi;
if (qr > 1e-9) {
  let ws2 = qsw(T, pr);
  if (qv < ws2) {
    let lrn = pow(PI_ * RHOW * N0R / (rho * qr), 0.25);
    let abw = rho * (LV * LV / (KA * RV * T * T) + 1.0 / (rho * ws2 * DV));
    let gw = 1.0 + LV * LV * ws2 / (CPD * RV * T * T);
    let prevp = 2.0 * PI_ * (1.0 - qv / ws2) / abw * N0R * (0.78 * pow(lrn, -2.0) + 0.31 * SC3 * G29 * sqrt(AR * dens / nu) * pow(lrn, -2.9));
    let ern = min(min(dt * prevp, qr), (ws2 - qv) / gw);
    qr -= ern;
    qv += ern;
    th -= LV / (CPD * pi) * ern;
  }
}
T = th * pi;
if (T < T0) {
  let wi2 = qsi(T, pr);
  let ab = rho * (LS * LS / (KA * RV * T * T) + 1.0 / (rho * wi2 * DV));
  let gam = 1.0 + LS * LS * wi2 / (CPD * RV * T * T);
  if (qs > 1e-9) {
    let lsn = pow(PI_ * RHOSN * N0S / (rho * qs), 0.25);
    let psdep = 2.0 * PI_ * (qv / wi2 - 1.0) / ab * N0S * (0.78 * pow(lsn, -2.0) + 0.31 * SC3 * G5B2 * sqrt(SA * dens / nu) * pow(lsn, -2.705));
    var dd = psdep * dt;
    if (dd > 0.0) { dd = min(dd, max(qv - wi2, 0.0) / gam); } else { dd = max(dd, max(-qs, (qv - wi2) / gam)); }
    qs += dd;
    qv -= dd;
    th += LS * dd / (CPD * pi);
  }
  if (qh > 1e-9 && qv < wi2) {
    let lhn = pow(PI_ * RHOH * N0H / (rho * qh), 0.25);
    let pgsub = 2.0 * PI_ * (qv / wi2 - 1.0) / ab * N0H * (0.78 * pow(lhn, -2.0) + 0.31 * SC3 * G275 * sqrt(ah / nu) * pow(lhn, -2.75));
    let dh = max(pgsub * dt, max(-qh, (qv - wi2) / gam));
    qh += dh;
    qv -= dh;
    th += LS * dh / (CPD * pi);
  }
}
qs = max(qs, 0.0);
qh = max(qh, 0.0);
`;

/**
 * Radar reflectivity (dBZ) from rain, snow and hail with exponential size distributions (Smith et al. 1975):
 * Z = 720 N0 λ⁻⁷, dry ice scaled by 0.224 (ρx/ρw)², wet (above freezing) by (ρx/ρw)². In: qr, qs, qh, rho, T.
 * Out: zdb (−99 for no echo).
 */
export const DBZ_BODY = `
var zl = 0.0;
var fs = 0.224 * 0.01;
var fh = 0.224 * 0.81;
if (T > T0) { fs = 0.01; fh = 0.81; }
if (qr > 1e-8) { zl += exp(log(720.0 * N0R) + 41.44653 - 1.75 * log(PI_ * RHOW * N0R / (rho * qr))); }
if (qs > 1e-8) { zl += fs * exp(log(720.0 * N0S) + 41.44653 - 1.75 * log(PI_ * RHOSN * N0S / (rho * qs))); }
if (qh > 1e-8) { zl += fh * exp(log(720.0 * N0H) + 41.44653 - 1.75 * log(PI_ * RHOH * N0H / (rho * qh))); }
var zdb = -99.0;
if (zl > 1e-3) { zdb = 10.0 * log(zl) / 2.302585; }
`;

/**
 * Largest hailstone (mm): the size at which the number of larger stones falls to HAILN per m³ (one stone in
 * 10,000 m³ of air, about one per square metre over ten minutes of hailfall). In: qh, rho. Out: hd.
 */
export const HAIL_BODY = `
var hd = 0.0;
if (qh > 1e-6) {
  let lhd = pow(PI_ * RHOH * N0H / (rho * qh), 0.25);
  hd = max(0.0, 1000.0 * log(N0H / (lhd * HAILN)) / lhd);
}
`;

/** Optical extinction (1/km) for the renderer from the condensate. In: qc, qr, qi, qs, qh. Out: beta. */
export const BETA_BODY = `
let beta = min(24.0, 22000.0 * max(qc, 0.0) + 7000.0 * max(qi, 0.0) + 1500.0 * max(qs, 0.0)) + 350.0 * max(qr, 0.0) + 120.0 * max(qh, 0.0);
`;

/** WGSL versions of the saturation helpers (Tetens over water and over ice). */
export const MP_WGSL_FN = /* wgsl */`
fn qsw(T: f32, p: f32) -> f32 { let es = 610.78 * exp(17.27 * (T - 273.16) / (T - 35.86)); return 0.622 * es / max(p - es, 1.0); }
fn qsi(T: f32, p: f32) -> f32 { let es = 610.78 * exp(21.875 * (T - 273.16) / (T - 7.66)); return 0.622 * es / max(p - es, 1.0); }
fn vterm(qr: f32, qs: f32, qh: f32, rho: f32, rhoS: f32) -> vec3f {
${VT_BODY}
  return vec3f(vr, vs, vh);
}
`;

/* ---------- JavaScript versions ---------- */

const JS_LIB = `
const exp = Math.exp, pow = Math.pow, sqrt = Math.sqrt, log = Math.log, abs = Math.abs, max = Math.max, min = Math.min;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const qsw = (T, p) => { const es = 610.78 * Math.exp(17.27 * (T - 273.16) / (T - 35.86)); return 0.622 * es / Math.max(p - es, 1); };
const qsi = (T, p) => { const es = 610.78 * Math.exp(21.875 * (T - 273.16) / (T - 7.66)); return 0.622 * es / Math.max(p - es, 1); };
${MP_CONST}`;

export interface MicroLib {
  /** s = [th, qv, qc, qr, qi, qs, qh], updated in place */
  micro(s: Float64Array, pi: number, pr: number, rho: number, rhoS: number, dt: number, K1: number, QCCRIT: number, K2: number): void;
  /** out = [vr, vs, vh] */
  vterm(qr: number, qs: number, qh: number, rho: number, rhoS: number, out: Float64Array): void;
  dbz(qr: number, qs: number, qh: number, rho: number, T: number): number;
  hail(qh: number, rho: number): number;
  beta(qc: number, qr: number, qi: number, qs: number, qh: number): number;
  qsi(T: number, p: number): number;
}

// eslint-disable-next-line @typescript-eslint/no-implied-eval
export const MP: MicroLib = new Function(`${JS_LIB}
return {
  micro(s, pi, pr, rho, rhoS, dt, K1, QCCRIT, K2) {
    var th = s[0], qv = s[1], qc = s[2], qr = s[3], qi = s[4], qs = s[5], qh = s[6];
${MICRO_BODY}
    s[0] = th; s[1] = qv; s[2] = qc; s[3] = qr; s[4] = qi; s[5] = qs; s[6] = qh;
  },
  vterm(qr, qs, qh, rho, rhoS, out) {
${VT_BODY}
    out[0] = vr; out[1] = vs; out[2] = vh;
  },
  dbz(qr, qs, qh, rho, T) {
${DBZ_BODY}
    return zdb;
  },
  hail(qh, rho) {
${HAIL_BODY}
    return hd;
  },
  beta(qc, qr, qi, qs, qh) {
${BETA_BODY}
    return beta;
  },
  qsi
};`)() as MicroLib;
