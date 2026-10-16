/** Browser check: render the designed storm at several stages and setups, offscreen. */
import { environment } from '../../src/physics/environment';
import { storm } from '../../src/physics/storm';
import { PRESETS } from '../../src/presets';
import { planStorm, stormAt } from '../../src/storm3d/design';
import { QUALITY_HIGH, QUALITY_LOW, StormRenderer } from '../../src/storm3d/renderer';
import { toEnv } from '../../src/units';

const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; console.log(s); };
(async () => {
  const q = new URLSearchParams(location.search);
  const preset = q.get('preset') ?? 'plains', times = (q.get('t') ?? '8,20,35,46,50,60').split(',').map(Number);
  const az = +(q.get('az') ?? -100), dist = +(q.get('dist') ?? 30), h = +(q.get('h') ?? 0.4), tz = +(q.get('tz') ?? 2);
  const W = +(q.get('w') ?? 720), H = +(q.get('hgt') ?? 450);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; document.body.appendChild(canvas);
  const r = await StormRenderer.create(canvas, q.has('hi') ? QUALITY_HIGH : QUALITY_LOW);
  if (!r) { log('no webgpu'); document.title = 'ERROR'; return; }
  const E = environment(toEnv(PRESETS[preset])), S = storm(E), P = planStorm(E, S);
  log(`${preset}: kind ${P.kind} tornadic ${P.tornadic} type ${P.torType} R ${P.R.toFixed(1)} zb ${P.zb.toFixed(2)} el ${P.el.toFixed(1)}`);
  (window as unknown as { shots: string[] }).shots = [];
  for (const t of times) {
    const f = stormAt(P, t, 30);
    if (q.has('nearonly')) for (const k of [2 * 4 + 2, 4 * 4 + 3, 12 * 4 + 2, 9 * 4 + 3, 10 * 4 + 3, 11 * 4 + 2]) f.params[k] = 0;
    r.update(f.params);
    // look at the updraft base from the given azimuth (degrees: 0 = from the east, -90 = from the south)
    const up = [f.params[16 * 4], f.params[16 * 4 + 1]];
    const tor = [f.params[13 * 4], f.params[13 * 4 + 1]], wall = [f.params[6 * 4], f.params[6 * 4 + 1]], aim = q.get('target') === 'tor' ? tor : q.get('target') === 'wall' ? wall : up;
    const tx = q.has('tx') ? +q.get('tx')! : aim[0], ty = q.has('ty') ? +q.get('ty')! : aim[1];
    const img = await r.capture({ az, dist, h, tz, tx, ty }, W, H);
    const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d')!.putImageData(img, 0, 0);
    (window as unknown as { shots: string[] }).shots.push(c.toDataURL('image/png'));
    log(`t ${t}: ${f.stage}`);
  }
  document.title = 'DONE';
})().catch(e => { log('ERROR ' + (e as Error).message); document.title = 'ERROR'; });
