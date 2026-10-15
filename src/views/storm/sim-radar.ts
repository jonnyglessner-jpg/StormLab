/**
 * Radar view of the running simulation: reflectivity or storm-relative velocity at about 600 m, or the
 * ground-relative hail swath.
 */
import { KT } from '../../physics/constants';
import { D, ND, type HailSwath, type TornadoEvent } from '../../sim/diag';
import { type DiagFrame } from '../../sim/driver';
import { dbzRGB, fit, hex, NWS } from '../../ui/canvas';

const VEL = ([[-60, '#00e4ff'], [-45, '#0094ff'], [-35, '#00c800'], [-25, '#00a000'], [-15, '#006e00'], [-5, '#2e4a32'],
  [5, '#4a2e30'], [15, '#8a0000'], [25, '#c80000'], [35, '#ff3030'], [45, '#ff9a9a'], [60, '#ffe0a0']] as const).map(([v, c]) => [v, hex(c)] as const);
const velRGB = (k: number) => { if (k < -55) return VEL[0][1]; for (let i = 1; i < VEL.length; i++) if (k < VEL[i][0]) return VEL[i - 1][1]; return VEL[VEL.length - 1][1]; };
const off = document.createElement('canvas');

/** hail size classes, mm (lower bounds) with labels in inches */
const HAILC = ([[6, '#a5d6a7', '¼'], [13, '#43a047', '½'], [19, '#fdd835', '¾'], [25, '#fb8c00', '1'], [38, '#e53935', '1½'],
  [44, '#ad1457', '1¾'], [51, '#8e24aa', '2'], [64, '#4527a0', '2½'], [70, '#e8eaf6', '2¾']] as const).map(([v, c, l]) => [v, hex(c), l] as const);
const hailRGB = (mm: number) => { if (mm < HAILC[0][0]) return null; let k = 0; for (let i = 0; i < HAILC.length; i++) if (mm >= HAILC[i][0]) k = i; return HAILC[k][1]; };

export function drawSimRadar(c: HTMLCanvasElement, fr: DiagFrame | null, prod: 'dbz' | 'vel' | 'hail', torNow: TornadoEvent | null, events: TornadoEvent[], swath: HailSwath | null): string {
  const { ctx, w, h } = fit(c);
  ctx.fillStyle = '#11171a'; ctx.fillRect(0, 0, w, h);
  if (!fr) return 'Waiting for the first model output…';
  if (prod === 'hail') return drawSwath(ctx, w, h, fr, swath, events);
  const g = fr.g, NX = g.NX, NY = g.NY, d = fr.diag;
  const Lx = NX * g.dx, Ly = NY * g.dy;
  const radar = [Lx / 2 + 70000 * Math.SQRT1_2, Ly / 2 - 70000 * Math.SQRT1_2];
  off.width = NX; off.height = NY;
  const octx = off.getContext('2d')!, img = octx.createImageData(NX, NY), px = img.data;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const o = (j * NX + i) * ND, p = ((NY - 1 - j) * NX + i) * 4, z = d[o + D.dbz];
    let rgb: readonly [number, number, number] | null = null;
    if (prod === 'dbz') rgb = dbzRGB(z);
    else if (z >= 5) {
      const x = (i + 0.5) * g.dx, y = (j + 0.5) * g.dy, rx = x - radar[0], ry = y - radar[1], rd = Math.hypot(rx, ry);
      rgb = velRGB((d[o + D.u] * rx + d[o + D.v] * ry) / rd / KT);
    }
    if (rgb) { px[p] = rgb[0]; px[p + 1] = rgb[1]; px[p + 2] = rgb[2]; px[p + 3] = 255; }
  }
  octx.putImageData(img, 0, 0);
  const side = Math.min(w, h) - 16, x0 = (w - side) / 2, y0 = (h - side) / 2, kmPx = side / (Lx / 1000);
  const X = (xm: number) => x0 + xm / 1000 * kmPx, Y = (ym: number) => y0 + side - ym / 1000 * kmPx;
  ctx.strokeStyle = '#243034'; ctx.lineWidth = 1;
  for (let k = 0; k <= Lx / 1000; k += 10) {
    ctx.beginPath(); ctx.moveTo(X(k * 1000), y0); ctx.lineTo(X(k * 1000), y0 + side); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0, Y(k * 1000)); ctx.lineTo(x0 + side, Y(k * 1000)); ctx.stroke();
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, x0, y0, side, side);
  // tornado tracks (storm-relative) and the current one
  for (const ev of events) {
    if (ev.track.length < 1) continue;
    ctx.strokeStyle = ev.end === null ? '#ffffff' : 'rgba(255,255,255,.55)'; ctx.lineWidth = 2; ctx.beginPath();
    ev.track.forEach(([x, y], k) => k ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)));
    ctx.stroke();
  }
  if (torNow) {
    const [x, y] = torNow.track[torNow.track.length - 1];
    ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(X(x), Y(y) - 11); ctx.lineTo(X(x) + 10, Y(y) + 7); ctx.lineTo(X(x) - 10, Y(y) + 7); ctx.closePath(); ctx.stroke();
  }
  ctx.fillStyle = '#dfe6e3'; ctx.font = '11px "JetBrains Mono", monospace';
  ctx.textAlign = 'right'; ctx.fillText('N ↑', w - 10, 44); ctx.textAlign = 'left';
  ctx.strokeStyle = '#dfe6e3'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0 + 8, y0 + side - 12); ctx.lineTo(x0 + 8 + 10 * kmPx, y0 + side - 12); ctx.stroke();
  ctx.fillText('10 km', x0 + 10, y0 + side - 18);
  const n = prod === 'dbz' ? 14 : VEL.length, bw = 13, lx = w - n * bw - 12, ly = h - 26;
  for (let i = 0; i < n; i++) { ctx.fillStyle = prod === 'dbz' ? NWS[i] : `rgb(${VEL[i][1].join(',')})`; ctx.fillRect(lx + i * bw, ly, bw, 8); }
  ctx.fillStyle = '#dfe6e3'; ctx.textAlign = 'center'; ctx.font = '10px "JetBrains Mono", monospace';
  if (prod === 'dbz') for (const v of [5, 25, 45, 65]) ctx.fillText(String(v), lx + (v - 5) / 5 * bw, ly + 19);
  else { ctx.fillText('−50', lx + bw, ly + 19); ctx.fillText('0', lx + 6 * bw, ly + 19); ctx.fillText('+50 kt', lx + 11 * bw, ly + 19); }
  ctx.textAlign = 'left';
  return prod === 'dbz'
    ? `Simulated reflectivity at 600 m · ${Math.round(fr.t / 60)} min · storm-following frame${torNow ? ' · ▲ tornado' : ''}`
    : `Simulated storm-relative velocity at 600 m · radar 70 km SE · ${Math.round(fr.t / 60)} min`;
}

/** Ground-relative hail swath with the storm's current position and the tornado tracks. */
function drawSwath(ctx: CanvasRenderingContext2D, w: number, h: number, fr: DiagFrame, sw: HailSwath | null, events: TornadoEvent[]): string {
  if (!sw) return 'Waiting for the first model output…';
  const g = fr.g, Wm = sw.nx * g.dx, Hm = sw.ny * g.dy;
  const scale = Math.min((w - 24) / Wm, (h - 60) / Hm), x0 = (w - Wm * scale) / 2, y0 = (h - 30 - Hm * scale) / 2 + 4;
  const X = (gx: number) => x0 + (gx - sw.x0) * scale, Y = (gy: number) => y0 + Hm * scale - (gy - sw.y0) * scale;
  ctx.strokeStyle = '#243034'; ctx.lineWidth = 1;
  for (let k = Math.ceil(sw.x0 / 10000) * 10000; k <= sw.x0 + Wm; k += 10000) { ctx.beginPath(); ctx.moveTo(X(k), y0); ctx.lineTo(X(k), y0 + Hm * scale); ctx.stroke(); }
  for (let k = Math.ceil(sw.y0 / 10000) * 10000; k <= sw.y0 + Hm; k += 10000) { ctx.beginPath(); ctx.moveTo(x0, Y(k)); ctx.lineTo(x0 + Wm * scale, Y(k)); ctx.stroke(); }
  off.width = sw.nx; off.height = sw.ny;
  const octx = off.getContext('2d')!, img = octx.createImageData(sw.nx, sw.ny), px = img.data;
  for (let j = 0; j < sw.ny; j++) for (let i = 0; i < sw.nx; i++) {
    const rgb = hailRGB(sw.d[j * sw.nx + i]);
    if (!rgb) continue;
    const p = ((sw.ny - 1 - j) * sw.nx + i) * 4; px[p] = rgb[0]; px[p + 1] = rgb[1]; px[p + 2] = rgb[2]; px[p + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, x0, y0, Wm * scale, Hm * scale);
  ctx.imageSmoothingEnabled = true;
  // the model domain now (it moves with the storm)
  const [dx0, dy0] = sw.ground(0, 0, fr.t);
  ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(223,230,227,.6)'; ctx.lineWidth = 1.2;
  ctx.strokeRect(X(dx0), Y(dy0 + g.NY * g.dy), g.NX * g.dx * scale, g.NY * g.dy * scale); ctx.setLineDash([]);
  for (const ev of events) {
    ctx.strokeStyle = ev.end === null ? '#ffffff' : 'rgba(255,255,255,.75)'; ctx.lineWidth = 2; ctx.beginPath();
    ev.track.forEach(([x, y, t], k) => { const [gx, gy] = sw.ground(x, y, t); if (k) ctx.lineTo(X(gx), Y(gy)); else ctx.moveTo(X(gx), Y(gy)); });
    ctx.stroke();
  }
  ctx.fillStyle = '#dfe6e3'; ctx.font = '11px "JetBrains Mono", monospace';
  ctx.textAlign = 'right'; ctx.fillText('N ↑', w - 10, 44); ctx.textAlign = 'left';
  ctx.strokeStyle = '#dfe6e3'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(12, h - 12); ctx.lineTo(12 + 10000 * scale, h - 12); ctx.stroke();
  ctx.fillText('10 km', 14, h - 18);
  const bw = 18, lx = w - HAILC.length * bw - 12, ly = h - 26;
  HAILC.forEach(([, c], i) => { ctx.fillStyle = `rgb(${c.join(',')})`; ctx.fillRect(lx + i * bw, ly, bw, 8); });
  ctx.fillStyle = '#dfe6e3'; ctx.textAlign = 'center'; ctx.font = '10px "JetBrains Mono", monospace';
  HAILC.forEach(([, , l], i) => ctx.fillText(l, lx + i * bw + 2, ly + 19));
  ctx.textAlign = 'right'; ctx.fillText('in', lx - 4, ly + 8); ctx.textAlign = 'left';
  return `Hail swath on the ground: largest stone at each spot · ${Math.round(fr.t / 60)} min · dashed box: model domain now`;
}
