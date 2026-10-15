/** Hodograph (knots) with helicity shading and Bunkers storm motions. */
import { KT } from '../../physics/constants';
import { type Environment } from '../../physics/environment';
import { fit, tok } from '../../ui/canvas';

export function drawHodograph(c: HTMLCanvasElement, E: Environment | null): void {
  const { ctx, w, h } = fit(c);
  ctx.clearRect(0, 0, w, h);
  if (!E) return;
  const u = E.w.u, v = E.w.v, n = 121;   // to 12 km
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  const pts: [number, number][] = [[0, 0], E.bk.rm, E.bk.lm];
  for (let k = 0; k < n; k += 5) pts.push([u[k], v[k]]);
  for (const [a, b] of pts) { x0 = Math.min(x0, a / KT); x1 = Math.max(x1, a / KT); y0 = Math.min(y0, b / KT); y1 = Math.max(y1, b / KT); }
  const pad = 10, sc = Math.min((w - 2 * pad) / (x1 - x0 + 20), (h - 2 * pad) / (y1 - y0 + 20));
  const cx = pad + (10 - x0) * sc + ((w - 2 * pad) - (x1 - x0 + 20) * sc) / 2;
  const cy = pad + (y1 + 10) * sc + ((h - 2 * pad) - (y1 - y0 + 20) * sc) / 2;
  const R = Math.hypot(Math.max(-x0, x1), Math.max(-y0, y1));
  const muted = tok('--muted'), line = tok('--line');
  ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = muted;
  for (let r = 20; r <= R + 20; r += 20) {
    ctx.beginPath(); ctx.arc(cx, cy, r * sc, 0, Math.PI * 2); ctx.stroke();
    ctx.fillText(`${r}`, cx + r * sc * 0.71 + 2, cy - r * sc * 0.71 - 2);
  }
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
  ctx.fillText('kt', w - 18, cy - 4);
  const px = (k: number) => cx + u[k] / KT * sc, py = (k: number) => cy - v[k] / KT * sc;
  const rm = E.bk.rm, rx = cx + rm[0] / KT * sc, ry = cy - rm[1] / KT * sc;
  ctx.fillStyle = 'rgba(230,85,214,.22)'; ctx.beginPath(); ctx.moveTo(rx, ry); for (let k = 0; k <= 10; k++) ctx.lineTo(px(k), py(k)); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(239,64,64,.14)'; ctx.beginPath(); ctx.moveTo(rx, ry); for (let k = 10; k <= 30; k++) ctx.lineTo(px(k), py(k)); ctx.closePath(); ctx.fill();
  const col = (k: number) => k <= 10 ? '#e655d6' : k <= 30 ? '#ef4040' : k <= 60 ? '#ffb347' : '#8a9a96';
  ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  for (let k = 1; k < n; k++) { ctx.strokeStyle = col(k); ctx.beginPath(); ctx.moveTo(px(k - 1), py(k - 1)); ctx.lineTo(px(k), py(k)); ctx.stroke(); }
  ctx.fillStyle = tok('--ink'); ctx.font = '11px "JetBrains Mono", monospace';
  for (const k of [0, 10, 30, 60, 90]) { ctx.beginPath(); ctx.arc(px(k), py(k), 2.4, 0, 7); ctx.fill(); ctx.fillText(`${k / 10}`, px(k) + 5, py(k) - 4); }
  const dot = (p: [number, number], label: string, fill: string) => {
    const x = cx + p[0] / KT * sc, y = cy - p[1] / KT * sc;
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = tok('--panel'); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = tok('--ink'); ctx.fillText(label, x + 7, y + 4);
  };
  dot(E.bk.rm, 'RM', tok('--ink')); dot(E.bk.lm, 'LM', muted); dot(E.bk.mw, 'MW', 'transparent');
  ctx.fillStyle = muted; ctx.fillText('Numbers on the curve: height in km', 6, h - 6);
}
