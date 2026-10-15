/**
 * Kinematic storm flow, storm-relative (x east, y north, z up; metres). Analytic fields shaped to match observed
 * supercell structure: environmental storm-relative wind, flow around the updraft, a Gaussian updraft with
 * anelastic inflow and outflow, a Rankine-type mesocyclone, a rear-flank downdraft and its outflow.
 */
import { DZ, NZ, clamp, lerp, smoothstep } from './constants';
import { type StormDiag } from './storm';
import { at, layerMean } from './winds';

export interface FlowModel {
  /** velocity (u, v, w) at a point, written into `o` */
  vel(x: number, y: number, z: number, o: number[]): void;
  /** updraft radius, m */
  Ru: number;
  /** overshooting top and equilibrium level, m */
  zTop: number; el: number;
  /** rear-flank downdraft centre, low-level mesocyclone centre (m), and its core radius */
  rfdX: number; rfdY: number; mesoX: number; mesoY: number; RmLow: number;
  /** unit vector of the 0-6 km shear (the updraft leans this way) */
  tiltX: number; tiltY: number;
  W: number;
}

export function flowModel(St: StormDiag): FlowModel {
  const E = St.E, rm = E.bk.rm, el = E.pc.el ?? 10000, W = St.w || 5;
  const Ru = 3200 + 40 * W;
  const zTop = el + Math.min(2500, (St.w || 0) * 45);
  const shU = at(E.w.u, 6000) - E.w.u[0], shV = at(E.w.v, 6000) - E.w.v[0], shm = Math.hypot(shU, shV) || 1;
  const tiltX = shU / shm, tiltY = shV / shm;
  const sru = new Float64Array(NZ), srv = new Float64Array(NZ);
  for (let k = 0; k < NZ; k++) { sru[k] = E.w.u[k] - rm[0]; srv[k] = E.w.v[k] - rm[1]; }
  const u05 = at(sru, 500), v05 = at(srv, 500);
  const H = 8000;
  // updraft profile: sine up to its peak near 0.55 EL, cosine down to the overshooting top
  const zPk = 0.55 * el;
  const gz = (zz: number) => zz <= 0 || zz >= zTop ? 0 : zz < zPk ? Math.sin(0.5 * Math.PI * zz / zPk) : Math.cos(0.5 * Math.PI * (zz - zPk) / (zTop - zPk));
  const dgz = (zz: number) => (gz(zz + 30) - gz(zz - 30)) / 60;
  const vmaxZ = (zz: number) => {
    const a = St.vLow || 0, b = St.vMid || 0;
    if (zz < 1000) return lerp(0.7 * a, a, zz / 1000);
    if (zz < 3000) return lerp(a, Math.max(a, 0.85 * b), (zz - 1000) / 2000);
    if (zz < 6000) return lerp(Math.max(a, 0.85 * b), b, (zz - 3000) / 3000);
    if (zz < 9000) return lerp(b, 0.5 * b, (zz - 6000) / 3000);
    return Math.max(0, lerp(0.5 * b, 0, (zz - 9000) / 3000));
  };
  const RmMid = 0.75 * Ru, RmLow = 0.45 * Ru, Rm = RmLow;
  // rear-flank downdraft on the upshear side, rotated cyclonically toward the south-west of the updraft
  const rfdAng = Math.atan2(-tiltY, -tiltX) + 0.6;
  const rfdX = Math.cos(rfdAng) * 0.9 * Ru, rfdY = Math.sin(rfdAng) * 0.9 * Ru;
  const rfdW = St.mode === 'pulse' || St.mode === 'multicell' ? 0 : -(4 + 0.25 * (St.vLow || 0)) * (St.precip === 'hp' ? 1.3 : St.precip === 'lp' ? 0.7 : 1);
  const mesoX = Math.cos(rfdAng) * 0.6 * Ru, mesoY = Math.sin(rfdAng) * 0.6 * Ru;
  // direction the low-level storm-relative inflow comes from (unit vector from the storm toward the inflow)
  const lo = layerMean(E.w, 0, 1000), lu = lo[0] - rm[0], lv = lo[1] - rm[1], lm = Math.hypot(lu, lv) || 1, inX = -lu / lm, inY = -lv / lm;

  function vel(x: number, y: number, zz: number, o: number[]): void {
    const cx = tiltX * 0.25 * zz, cy = tiltY * 0.25 * zz;
    const dx = x - cx, dy = y - cy, r2 = dx * dx + dy * dy, r = Math.sqrt(r2) + 1;
    const ex = Math.exp(-r2 / (Ru * Ru));
    const zc = clamp(zz, 0, (NZ - 1) * DZ);
    let ue = at(sru, zc), ve = at(srv, zc), lowMask = 1;
    // Below 1.5 km the environmental inflow reaches the storm only in the inflow sector. Behind the gust fronts the
    // low-level air is the storm's own outflow.
    if (zc < 1500 && W > 8) {
      const qx = x - mesoX, qy = y - mesoY, d = Math.sqrt(qx * qx + qy * qy) + 1;
      const cosd = (qx * inX + qy * inY) / d, far = clamp((d - 18000) / 12000, 0, 1);
      const m = Math.max(far, smoothstep(-0.35, 0.25, cosd)), hz = clamp((1500 - zc) / 700, 0, 1);
      const keep = 1 - hz * (1 - m);
      ue *= keep; ve *= keep; lowMask = keep;
      const ofl = 7 * hz * (1 - m) * smoothstep(1500, 5000, d) * Math.exp(-d / 25000);
      ue += ofl * qx / d; ve += ofl * qy / d;
    }
    // The updraft is an obstacle to the mid- and upper-level storm-relative flow (Lemon & Doswell 1979): partial
    // potential flow around a cylinder; inside it, the updraft carries low-level momentum upward
    let u = ue, v = ve;
    const U = Math.hypot(ue, ve), ob = 0.75 * clamp((zz - 800) / 1500, 0, 1) * (W > 8 ? 1 : 0);
    if (U > 0.1 && ob > 0) {
      const c = ue / U, sn = ve / U, X = dx * c + dy * sn, Y = -dx * sn + dy * c, a2 = 0.64 * Ru * Ru;
      let up = 0, vp = 0;
      if (r2 > a2) { const r4 = r2 * r2; up = U * (1 - a2 * (X * X - Y * Y) / r4); vp = -U * 2 * a2 * X * Y / r4; }
      const gu = up * c - vp * sn, gv = up * sn + vp * c;
      u = ue + ob * (gu - ue); v = ve + ob * (gv - ve);
    }
    const a = 0.6 * ex * clamp(zz / 2000, 0, 1);
    u = u * (1 - a) + u05 * a; v = v * (1 - a) + v05 * a;
    // anelastic radial flow of a Gaussian updraft (mass continuity), damped far from the storm
    const g = gz(zc), dg = dgz(zc);
    const flux = W * (dg - g / H);
    const ur = -flux * Ru * Ru / (2 * r) * (1 - ex) * Math.exp(-r / 40000) * (flux > 0 ? lowMask : 1);
    u += ur * dx / r; v += ur * dy / r;
    // mesocyclone, cyclonic; the low-level centre sits on the rear-flank side of the updraft
    const fo = clamp(1 - zc / 4000, 0, 1), mx = x - mesoX * fo - cx, my = y - mesoY * fo - cy;
    const vm = vmaxZ(zc), mr = Math.sqrt(mx * mx + my * my) + 1, Rz = lerp(RmLow, RmMid, clamp((zc - 1000) / 3000, 0, 1));
    const vt = mr < Rz ? vm * mr / Rz : vm * (Rz / mr) * Math.exp(-(mr - Rz) / (5 * Rz));
    u -= vt * my / mr; v += vt * mx / mr;
    // vertical velocity: updraft and rear-flank downdraft, with the RFD's outflow at the surface
    let w = W * g * ex;
    if (rfdW && zz < 5000) {
      const qx = x - rfdX, qy = y - rfdY, d2 = (qx * qx + qy * qy) / (1.21 * Rm * Rm);
      w += rfdW * Math.exp(-d2) * Math.sin(Math.PI * clamp(zz / 5000, 0, 1));
      if (zz < 1000) {
        const d = Math.sqrt(qx * qx + qy * qy) + 1, sp = -rfdW * 1.4 * Math.exp(-d2 * 0.5) * (1 - zz / 1000);
        u += sp * qx / d * clamp(d / Rm, 0, 1); v += sp * qy / d * clamp(d / Rm, 0, 1);
      }
    }
    o[0] = u; o[1] = v; o[2] = w;
  }
  return { vel, Ru, zTop, el, rfdX, rfdY, mesoX, mesoY, RmLow, tiltX, tiltY, W };
}
