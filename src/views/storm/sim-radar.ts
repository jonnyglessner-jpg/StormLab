/** Radar view of the running simulation: reflectivity or storm-relative velocity at about 600 m. */
import { KT } from '../../physics/constants';
import { D, ND, type TornadoEvent } from '../../sim/diag';
import { type DiagFrame } from '../../sim/driver';
import { dbzRGB, fit, hex, NWS } from '../../ui/canvas';

const VEL = ([[-60, '#00e4ff'], [-45, '#0094ff'], [-35, '#00c800'], [-25, '#00a000'], [-15, '#006e00'], [-5, '#2e4a32'],
  [5, '#4a2e30'], [15, '#8a0000'], [25, '#c80000'], [35, '#ff3030'], [45, '#ff9a9a'], [60, '#ffe0a0']] as const).map(([v, c]) => [v, hex(c)] as const);
const velRGB = (k: number) => { if (k < -55) return VEL[0][1]; for (let i = 1; i < VEL.length; i++) if (k < VEL[i][0]) return VEL[i - 1][1]; return VEL[VEL.length - 1][1]; };
const off = document.createElement('canvas');

export function drawSimRadar(c: HTMLCanvasElement, fr: DiagFrame | null, prod: 'dbz' | 'vel', torNow: TornadoEvent | null, events: TornadoEvent[]): string {
  const { ctx, w, h } = fit(c);
  ctx.fillStyle = '#11171a'; ctx.fillRect(0, 0, w, h);
  if (!fr) return 'Waiting for the first model output…';
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
