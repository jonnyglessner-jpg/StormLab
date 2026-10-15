/** Bar chart: chance of each EF rating if a tornado forms. */
import { type StormDiag } from '../../physics/storm';
import { fit, tok } from '../../ui/canvas';

export const EF_COLORS = ['#4cc3ff', '#3ccf6e', '#ffd23f', '#ff9a2e', '#ef4040', '#e655d6'];

export function drawEF(c: HTMLCanvasElement, S: StormDiag | null): void {
  const { ctx, w, h } = fit(c);
  ctx.clearRect(0, 0, w, h);
  if (!S || !S.forms || !S.ptor) {
    ctx.fillStyle = tok('--muted'); ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText('No tornado distribution for this storm.', 4, 20);
    return;
  }
  const p = S.efProb, ml = 6, mb = 34, mt = 16, bw = (w - ml * 2) / 6, ph = h - mb - mt, top = Math.max(0.5, ...p);
  ctx.font = '11px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
  for (let k = 0; k < 6; k++) {
    const x = ml + k * bw, bh = p[k] / top * ph;
    ctx.fillStyle = EF_COLORS[k]; ctx.fillRect(x + 6, mt + ph - bh, bw - 12, bh);
    ctx.fillStyle = tok('--ink'); ctx.fillText(p[k] >= 0.005 ? `${Math.round(p[k] * 100)}%` : '<1%', x + bw / 2, mt + ph - bh - 4);
    ctx.fillStyle = tok('--muted'); ctx.fillText(`EF${k}`, x + bw / 2, h - 18);
  }
  ctx.fillText('If a tornado forms, chance of each rating', w / 2, h - 3);
  ctx.textAlign = 'left';
}
