/** Skew-T log-p diagram with the rising parcel and CAPE/CIN shading. */
import { DZ, NZ } from '../../physics/constants';
import { type Environment } from '../../physics/environment';
import { qsat, tdFromQ } from '../../physics/thermo';
import { at } from '../../physics/winds';
import { fit, tok } from '../../ui/canvas';

export function drawSkewT(c: HTMLCanvasElement, E: Environment | null): void {
  const { ctx, w, h } = fit(c);
  ctx.clearRect(0, 0, w, h);
  if (!E) return;
  const ml = 38, mr = 10, mt = 10, mb = 26, pw = w - ml - mr, ph = h - mt - mb;
  const pB = 1050, pT = 150, Tmin = -40, Tmax = 50, skew = 35;
  const lnr = Math.log(pB / pT);
  const Y = (p: number) => mt + ph * Math.log(pB / p) / lnr;
  const X = (Tc: number, p: number) => ml + pw * ((Tc - Tmin) + skew * Math.log(pB / p) / lnr * (Tmax - Tmin) / 90) / (Tmax - Tmin);
  const line = tok('--line'), muted = tok('--muted');
  ctx.save(); ctx.beginPath(); ctx.rect(ml, mt, pw, ph); ctx.clip();
  ctx.lineWidth = 1; ctx.strokeStyle = line;
  for (let T = -100; T <= 50; T += 10) { ctx.beginPath(); ctx.moveTo(X(T, pB), Y(pB)); ctx.lineTo(X(T, pT), Y(pT)); ctx.stroke(); }
  ctx.setLineDash([2, 4]);
  for (let th = 250; th <= 450; th += 10) {
    ctx.beginPath();
    for (let p = pB; p >= pT; p -= 10) { const T = th * Math.pow(p / 1000, 0.286) - 273.15; p === pB ? ctx.moveTo(X(T, p), Y(p)) : ctx.lineTo(X(T, p), Y(p)); }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const s = E.s, pc = E.pc;
  // CAPE (red) and CIN (blue) between parcel and environment virtual temperature
  const kel = pc.el ? Math.round(pc.el / DZ) : 0;
  for (let k = 1; k < NZ && k <= kel + 1; k++) {
    const pa = s.p[k - 1] / 100, pb = s.p[k] / 100;
    const ea = s.T[k - 1] * (1 + 0.61 * s.q[k - 1]) - 273.15, eb = s.T[k] * (1 + 0.61 * s.q[k]) - 273.15;
    const qa = pc.Tvp[k - 1] - 273.15, qb = pc.Tvp[k] - 273.15;
    const pos = pc.B[k] > 0;
    if (!pos && (!pc.lfc || s.z[k] > pc.lfc)) continue;
    ctx.fillStyle = pos ? 'rgba(224,83,61,.28)' : 'rgba(70,120,220,.28)';
    ctx.beginPath(); ctx.moveTo(X(ea, pa), Y(pa)); ctx.lineTo(X(qa, pa), Y(pa)); ctx.lineTo(X(qb, pb), Y(pb)); ctx.lineTo(X(eb, pb), Y(pb)); ctx.closePath(); ctx.fill();
  }
  const path = (fn: (k: number) => number, col: string, wdt: number, dash: number[] = []) => {
    ctx.beginPath();
    for (let k = 0; k < NZ; k++) { const p = s.p[k] / 100; if (p < pT) break; k === 0 ? ctx.moveTo(X(fn(k), p), Y(p)) : ctx.lineTo(X(fn(k), p), Y(p)); }
    ctx.strokeStyle = col; ctx.lineWidth = wdt; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
  };
  path(k => s.T[k] - 273.15, '#e0533d', 2.4);
  path(k => tdFromQ(s.p[k], Math.max(s.q[k], 1e-6)) - 273.15, '#2f9e5a', 2.4);
  path(k => pc.Tvp[k] / (1 + 0.61 * Math.min(pc.qm, qsat(s.p[k], pc.Tp[k]))) - 273.15, tok('--ink'), 1.6, [5, 3]);
  ctx.restore();
  ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const p of [1000, 850, 700, 500, 300, 200]) {
    ctx.fillText(String(p), ml - 4, Y(p));
    ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(ml, Y(p)); ctx.lineTo(ml + pw, Y(p)); ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let T = -30; T <= 40; T += 10) { const x = X(T, pB); if (x > ml && x < ml + pw) ctx.fillText(`${T}°`, x, mt + ph + 4); }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = tok('--ink'); ctx.font = '11px "JetBrains Mono", monospace';
  const mark = (zz: number | null, label: string) => {
    if (zz == null) return;
    const p = at(s.p, zz) / 100;
    ctx.fillRect(ml + pw - 46, Y(p), 12, 1.5); ctx.fillText(label, ml + pw - 32, Y(p) + 4);
  };
  mark(pc.lcl, 'LCL'); if (pc.lfc && Math.abs(pc.lfc - pc.lcl) > 400) mark(pc.lfc, 'LFC'); mark(pc.el, 'EL');
}
