/** Radar plan view: base reflectivity or storm-relative velocity, with feature labels and tornado signatures. */
import { KT, MPH, clamp } from '../../physics/constants';
import { type ComputeResult } from '../../physics/compute';
import { type Environment } from '../../physics/environment';
import { type StormDiag, type TornadoParams } from '../../physics/storm';
import { dbzRGB, fit, hex, NWS } from '../../ui/canvas';

const VEL = ([[-60, '#00e4ff'], [-45, '#0094ff'], [-35, '#00c800'], [-25, '#00a000'], [-15, '#006e00'], [-5, '#2e4a32'],
  [5, '#4a2e30'], [15, '#8a0000'], [25, '#c80000'], [35, '#ff3030'], [45, '#ff9a9a'], [60, '#ffe0a0']] as const)
  .map(([v, c]) => [v, hex(c)] as const);
function velRGB(k: number): [number, number, number] {
  if (k < -55) return VEL[0][1];
  for (let i = 1; i < VEL.length; i++) if (k < VEL[i][0]) return VEL[i - 1][1];
  return VEL[VEL.length - 1][1];
}

export interface RadarOptions { prod: 'dbz' | 'vel'; labels: boolean }

const off = document.createElement('canvas');

/** Returns the caption for the stage tag. */
export function drawRadar(c: HTMLCanvasElement, res: ComputeResult | null, E: Environment | null, S: StormDiag | null,
  tor: TornadoParams | null, opt: RadarOptions): string {
  const { ctx, w, h } = fit(c);
  ctx.fillStyle = '#11171a'; ctx.fillRect(0, 0, w, h);
  if (!res || !S || !E) return 'Building the storm…';
  if (!S.forms) return 'Clear skies: no storm in this environment';
  const g = res.geo, N = g.N, R = g.R, dx = g.dx;
  off.width = N; off.height = N;
  const octx = off.getContext('2d')!, img = octx.createImageData(N, N), d = img.data;
  const tx = g.mesoX, ty = g.mesoY, tpk = tor ? tor.peakMph : 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, p = ((N - 1 - j) * N + i) * 4;
    let z = res.dbz[k];
    const x = -R + (i + 0.5) * dx, y = -R + (j + 0.5) * dx;
    // debris ball: lofted debris shows as a small reflectivity maximum at the hook tip for EF2+ tornadoes
    if (tor && tpk >= 111) { const dd = Math.hypot(x - tx, y - ty); if (dd < 1500) z = Math.max(z, 52 + 10 * (1 - dd / 1500)); }
    let rgb: [number, number, number] | null = null;
    if (opt.prod === 'dbz') rgb = dbzRGB(z);
    else if (z >= 5) {
      let vr = res.vr[k] / KT;
      if (tor) {
        // tornadic vortex signature: a tight couplet, gate-to-gate at radar resolution
        const ddx = x - tx, ddy = y - ty, dd = Math.hypot(ddx, ddy), rr = 600;
        if (dd < 3000) {
          const vt = (tpk * MPH / KT) * 0.55 * (dd < rr ? dd / rr : rr / dd);
          const ux = -ddy / (dd + 1), uy = ddx / (dd + 1), rxv = x - g.radar[0], ryv = y - g.radar[1], rd = Math.hypot(rxv, ryv);
          vr += vt * (ux * rxv + uy * ryv) / rd;
        }
      }
      rgb = velRGB(vr);
    }
    if (rgb) { d[p] = rgb[0]; d[p + 1] = rgb[1]; d[p + 2] = rgb[2]; d[p + 3] = 255; }
  }
  octx.putImageData(img, 0, 0);

  // frame: 80 km across the long side, centred between the updraft and the echo centroid
  let sx = 0, sy = 0, sn = 0;
  for (let j = 0; j < N; j += 2) for (let i = 0; i < N; i += 2) if (res.dbz[j * N + i] > 25) { sx += -R + (i + 0.5) * dx; sy += -R + (j + 0.5) * dx; sn++; }
  const vcx = sn ? 0.5 * sx / sn : 8000, vcy = sn ? 0.5 * sy / sn : 4000;
  const kmPx = Math.max(w, h) / 80;
  const X = (xm: number) => w / 2 + (xm - vcx) / 1000 * kmPx, Y = (ym: number) => h / 2 - (ym - vcy) / 1000 * kmPx;
  ctx.strokeStyle = '#243034'; ctx.lineWidth = 1;
  for (let k = -60; k <= 60; k += 10) {
    ctx.beginPath(); ctx.moveTo(X(k * 1000), 0); ctx.lineTo(X(k * 1000), h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, Y(k * 1000)); ctx.lineTo(w, Y(k * 1000)); ctx.stroke();
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, X(-R), Y(R), (2 * R / 1000) * kmPx, (2 * R / 1000) * kmPx);

  if (opt.prod === 'dbz') {   // anvil edge: ice aloft, as a faint outline
    ctx.strokeStyle = 'rgba(220,230,235,.35)'; ctx.lineWidth = 1; ctx.beginPath();
    let amax = 0; for (const a of res.anv) amax = Math.max(amax, a);
    const thr = amax * 0.04, cell = dx / 1000 * kmPx;
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = res.anv[j * N + i] > thr;
      if (a !== (res.anv[j * N + i + 1] > thr)) { const xx = X(-R + (i + 1) * dx), yy = Y(-R + j * dx); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy - cell); }
      if (a !== (res.anv[(j + 1) * N + i] > thr)) { const xx = X(-R + i * dx), yy = Y(-R + (j + 1) * dx); ctx.moveTo(xx, yy); ctx.lineTo(xx + cell, yy); }
    }
    ctx.stroke();
  }

  ctx.font = '11.5px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
  if (opt.labels) {
    const lab = (xm: number, ym: number, text: string, ax: number, ay: number) => {
      const tw = ctx.measureText(text).width, x0 = X(xm), y0 = Y(ym);
      let left = ax < 0, x1 = x0 + ax;
      const y1 = clamp(y0 + ay, 40, h - 46);
      if (left && x1 - tw - 8 < 4) { left = false; x1 = x0 + Math.abs(ax); }
      if (!left && x1 + tw + 8 > w - 4) { left = true; x1 = x0 - Math.abs(ax); }
      x1 = left ? Math.max(x1, tw + 12) : Math.min(x1, w - tw - 12);
      ctx.strokeStyle = 'rgba(240,244,242,.85)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.textAlign = left ? 'right' : 'left';
      ctx.fillStyle = 'rgba(12,16,18,.72)'; ctx.fillRect(left ? x1 - tw - 8 : x1, y1 - 9, tw + 8, 18);
      ctx.fillStyle = '#eef2f0'; ctx.fillText(text, left ? x1 - 4 : x1 + 4, y1);
    };
    const rot = S.mode === 'supercell' || S.mode === 'split' || S.mode === 'weak-super';
    lab(g.Ru * 0.15, -g.Ru * 0.1, rot ? 'Updraft · inflow notch' : 'Updraft', 70, 46);
    if (rot) lab(g.mesoX, g.mesoY, tor ? 'Tornado' : 'Mesocyclone · hook', -60, 40);
    if (g.core && g.core[2] > 30) lab(g.core[0], g.core[1], S.hailIn >= 1 ? 'Hail core' : 'Heaviest rain', 40, -44);
    if (rot) lab(g.rfdX * 1.4, g.rfdY * 1.4, 'Rear-flank downdraft', -50, -36);
  }
  // storm motion (ground-relative) from the updraft
  const rm = E.bk.rm, sp = Math.hypot(rm[0], rm[1]);
  if (sp > 1) {
    const L = 46, ux = rm[0] / sp, uy = -rm[1] / sp, x0 = X(0), y0 = Y(0), ex = x0 + ux * L, ey = y0 + uy * L;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - ux * 8 - uy * 5, ey - uy * 8 + ux * 5); ctx.lineTo(ex - ux * 8 + uy * 5, ey - uy * 8 - ux * 5); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
  }
  ctx.fillStyle = '#dfe6e3'; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('N ↑', w - 10, 34);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const bar = 10 * kmPx;
  ctx.strokeStyle = '#dfe6e3'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(12, h - 14); ctx.lineTo(12 + bar, h - 14); ctx.stroke();
  ctx.fillText('10 km', 14, h - 20);
  legend(ctx, w, h, opt.prod);
  return opt.prod === 'dbz'
    ? 'Base reflectivity, lowest scan · white arrow: storm motion · outline: anvil'
    : 'Storm-relative velocity, lowest scan · radar 70 km SE · green toward, red away';
}

function legend(ctx: CanvasRenderingContext2D, w: number, h: number, prod: 'dbz' | 'vel'): void {
  const n = prod === 'dbz' ? 14 : VEL.length, bw = 14, x0 = w - n * bw - 12, y0 = h - 26;
  ctx.font = '10px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) { ctx.fillStyle = prod === 'dbz' ? NWS[i] : `rgb(${VEL[i][1].join(',')})`; ctx.fillRect(x0 + i * bw, y0, bw, 8); }
  ctx.fillStyle = '#dfe6e3';
  if (prod === 'dbz') { for (const v of [5, 25, 45, 65]) ctx.fillText(String(v), x0 + (v - 5) / 5 * bw, y0 + 19); ctx.textAlign = 'right'; ctx.fillText('dBZ', x0 - 4, y0 + 8); }
  else { ctx.fillText('−50', x0 + bw, y0 + 19); ctx.fillText('0', x0 + 6 * bw, y0 + 19); ctx.fillText('+50 kt', x0 + 11 * bw, y0 + 19); }
  ctx.textAlign = 'left';
}
