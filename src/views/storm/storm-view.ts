/** Storm view: environment sliders -> sounding, hodograph, storm, radar, chaser view and tornado outlook. */
import { clamp, FT, KT, MPH } from '../../physics/constants';
import { type ComputeOptions, type ComputeResult } from '../../physics/compute';
import { environment, type Environment } from '../../physics/environment';
import { mulberry } from '../../physics/random';
import { storm, tornadoFrom, type StormDiag, type TornadoParams } from '../../physics/storm';
import { PRESETS, type EnvSliders } from '../../presets';
import { createChaserRenderer, type Camera, type ChaserRenderer } from '../../render/chaser';
import { app } from '../../state';
import { onThemeChange } from '../../ui/canvas';
import { toEnv } from '../../units';
import type { WorkerRequest, WorkerResponse } from '../../workers/storm.worker';
import { drawEF } from './efchart';
import { drawHodograph } from './hodograph';
import { drawRadar } from './radar';
import { drawSkewT } from './skewt';
import { SimPanel } from './sim-panel';
import { drawSimRadar } from './sim-radar';
import { SLIDERS, STORM_HTML } from './template';

const EFT = [65, 86, 111, 136, 166, 201];
const efOf = (m: number) => { let k = 0; for (let i = 0; i < 6; i++) if (m >= EFT[i]) k = i; return k; };
const kt = (ms: number) => Math.round(ms / KT), mph = (ms: number) => Math.round(ms / MPH);
const compass = (u: number, v: number) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((Math.atan2(u, v) * 180 / Math.PI + 360) % 360) / 22.5) % 16];
function hailName(inch: number): [string, string] {
  if (inch >= 4) return ['Softball+', `${inch.toFixed(1)} in`];
  if (inch >= 2.75) return ['Baseball', `${inch.toFixed(1)} in`];
  if (inch >= 1.75) return ['Golf ball', `${inch.toFixed(1)} in`];
  if (inch >= 1) return ['Quarter', `${inch.toFixed(1)} in`];
  if (inch >= 0.5) return ['Small hail', `${inch.toFixed(1)} in`];
  return ['None', 'Updraft too weak to grow hail'];
}

export function mountStorm(root: HTMLElement): () => void {
  root.innerHTML = STORM_HTML;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const all = <T extends HTMLElement = HTMLElement>(sel: string) => Array.from(root.querySelectorAll<T>(sel));
  let alive = true;
  const cleanup: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, ev: K, fn: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
    el.addEventListener(ev, fn, o); cleanup.push(() => el.removeEventListener(ev, fn, o));
  };

  const st = app.stormView;
  const { name: _n, ...plains } = PRESETS.plains; void _n;
  const o: EnvSliders = { ...(app.env ?? plains) };
  let E: Environment | null = null, S: StormDiag | null = null, RES: ComputeResult | null = null, tor: TornadoParams | null = null;
  let renderer: ChaserRenderer | null = null, need3D = true, needRadar = true;

  /* ---------- worker ---------- */
  const worker = new Worker(new URL('./storm.worker.js', import.meta.url), { type: 'module' });
  cleanup.push(() => worker.terminate());
  let reqId = 0, busy = false, queued: ComputeOptions | null = null;
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    busy = false;
    if (alive) take(e.data.result);
    if (queued) { const q = queued; queued = null; request(q); }
  };
  worker.onerror = (e) => { busy = false; console.error('storm worker', e.message); };
  function request(opt: ComputeOptions) {
    if (busy) { queued = opt; return; }
    busy = true;
    const msg: WorkerRequest = { id: ++reqId, env: toEnv(o), opt };
    worker.postMessage(msg);
  }
  const fullOpt = (): ComputeOptions => ({ volume: true, nRel: 3000, cpuLighting: renderer ? renderer.needsCpuLighting : true });
  function take(r: ComputeResult) {
    const keep = RES?.vol ?? null;
    RES = r;
    if (r.vol) { if (st.mode === 'instant') renderer?.setVolume(r.vol); } else RES.vol = keep;
    need3D = needRadar = true;
  }

  /* ---------- controls ---------- */
  function syncInputs() {
    for (const s of SLIDERS) { $<HTMLInputElement>('e_' + s.k).value = String(o[s.k]); $('o_' + s.k).textContent = s.fmt(o[s.k]); }
  }
  let settleT = 0;
  function changed(full: boolean) {
    app.env = { ...o };
    diagnose();
    if (E) panel.envChanged(E);
    tor = null; $('tRes').textContent = '';
    clearTimeout(settleT);
    if (full) request(fullOpt());
    else { request({ volume: false, nRel: 900, cpuLighting: false }); settleT = window.setTimeout(() => request(fullOpt()), 350); }
  }
  for (const s of SLIDERS) {
    const inp = $<HTMLInputElement>('e_' + s.k);
    on(inp, 'input', () => {
      o[s.k] = +inp.value;
      if (o.TdF > o.T0F) { o.TdF = o.T0F; $<HTMLInputElement>('e_TdF').value = String(o.TdF); $('o_TdF').textContent = `${o.TdF} °F`; }
      $('o_' + s.k).textContent = s.fmt(o[s.k]);
      all('[data-pre]').forEach(b => b.setAttribute('aria-pressed', 'false'));
      changed(false);
    });
  }
  all('[data-pre]').forEach(b => on(b, 'click', () => {
    const { name: _x, ...p } = PRESETS[b.dataset.pre!]; void _x;
    Object.assign(o, p);
    all('[data-pre]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    syncInputs(); changed(true);
  }));
  function setView(v: '3d' | 'radar') {
    st.view = v;
    all('[data-v]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false'));
    (renderer?.canvas ?? $('svGL')).hidden = v !== '3d'; $('svRadar').hidden = v !== 'radar';
    $('svProd').style.display = v === 'radar' ? '' : 'none'; $('svLabWrap').style.display = v === 'radar' ? '' : 'none'; $('svSave').style.display = v === '3d' ? '' : 'none';
    need3D = needRadar = true;
  }
  all('[data-v]').forEach(b => on(b, 'click', () => setView(b.dataset.v as '3d' | 'radar')));

  /* ---------- instant model vs full simulation ---------- */
  const panel = new SimPanel({
    root, env: () => E, storm: () => S, renderer: () => renderer,
    redraw3D: () => { need3D = true; }, redrawRadar: () => { needRadar = true; }
  });
  cleanup.push(() => panel.destroy());
  function setMode(m: 'instant' | 'sim') {
    st.mode = m;
    all('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false'));
    $('simBar').hidden = m !== 'sim'; $('simCard').hidden = m !== 'sim'; $('torCard').hidden = m === 'sim';
    $('svLabWrap').style.visibility = m === 'sim' ? 'hidden' : '';
    $('svModeCap').textContent = m === 'sim'
      ? 'Full simulation: a 3-D cloud model grows the storm minute by minute. Press Run.'
      : 'Instant: the storm this environment supports, worked out in a second.';
    if (m === 'sim') { if (panel.driver) panel.attach(); }
    else { if (panel.driver?.running) void panel.toggle(); if (RES?.vol) renderer?.setVolume(RES.vol); cam.tx = undefined; cam.ty = undefined; }
    need3D = needRadar = true;
    panel.redrawCharts();
  }
  all('[data-mode]').forEach(b => on(b, 'click', () => setMode(b.dataset.mode as 'instant' | 'sim')));
  all('[data-p]').forEach(b => on(b, 'click', () => {
    st.prod = b.dataset.p as 'dbz' | 'vel';
    all('[data-p]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    needRadar = true;
  }));
  const lab = $<HTMLInputElement>('svLab');
  on(lab, 'change', () => { st.labels = lab.checked; needRadar = true; });

  /* ---------- diagnosis and readouts ---------- */
  function diagnose() {
    E = environment(toEnv(o)); S = storm(E);
    const pc = E.pc;
    $('eCAPE').innerHTML = `${Math.round(pc.cape).toLocaleString()}<small>J/kg</small>`;
    $('eCIN').innerHTML = `${Math.round(pc.cin)}<small>${pc.cin < -200 ? 'J/kg · cap holds' : pc.cin < -75 ? 'J/kg · strong cap' : 'J/kg'}</small>`;
    $('eLCL').innerHTML = `${(Math.round(pc.lcl / FT / 100) * 100).toLocaleString()} ft<small>${Math.round(pc.lcl).toLocaleString()} m</small>`;
    $('eS1').innerHTML = `${Math.round(E.srh1)}<small>m²/s²</small>`;
    $('eSCP').textContent = E.scp.toFixed(1);
    $('eSTP').textContent = E.stp.toFixed(1);
    $('hS6').innerHTML = `${kt(E.shear6)} kt`;
    $('hS3').innerHTML = `${Math.round(E.srh3)}<small>m²/s²</small>`;
    $('hSRA').innerHTML = `${kt(E.srAnvil)} kt`;
    let ty: string, sub: string;
    const sra = kt(E.srAnvil);
    if (!S.forms) {
      if (S.capped) { ty = 'Capped: no storms'; sub = `The inversion is too strong (CIN ${Math.round(pc.cin)} J/kg) for surface air to break through. A front or dryline might still force a storm, but nothing forms on its own.`; }
      else { ty = 'No storms'; sub = pc.cape < 150 ? 'Too little instability for deep convection.' : 'The rising air doesn’t get deep enough to build a thunderstorm.'; }
    } else {
      const names = { lp: 'LP supercell', classic: 'Classic supercell', hp: 'HP supercell', ordinary: 'Supercell' };
      const why = {
        lp: `Strong storm-relative wind aloft (${sra} kt) carries the rain far from the updraft, leaving a sculpted, visible updraft with little rain.`,
        classic: `Storm-relative wind aloft of ${sra} kt puts heavy rain and hail just ahead of the updraft, with a hook wrapping behind it.`,
        hp: `Weak storm-relative wind aloft (${sra} kt) lets rain wrap around the mesocyclone. Tornadoes can be hidden in rain.`,
        ordinary: ''
      };
      switch (S.mode) {
        case 'pulse': ty = 'Pulse storms'; sub = 'Little shear. Each updraft rains back into itself and collapses within an hour: brief heavy rain, small hail, possible downbursts.'; break;
        case 'multicell': ty = 'Multicell cluster'; sub = 'Moderate shear. New cells keep forming along the outflow edge, but none lasts long enough to rotate.'; break;
        case 'marginal': ty = 'Marginal supercell'; sub = 'Shear is just enough for transient rotation. Storms cycle between organized and messy.'; break;
        case 'split': ty = 'Splitting supercells'; sub = `Strong shear with a nearly straight hodograph (0–3 km SRH ${Math.round(E.srh3)}). The storm splits into right- and left-moving supercells of similar strength. Shown: the right-mover.`; break;
        case 'weak-super': ty = 'Weak supercell'; sub = 'Plenty of shear, but too little instability for a strong updraft. Rotation stays modest.'; break;
        default: ty = names[S.precip]; sub = why[S.precip];
      }
    }
    $('rType').textContent = ty; $('rTypeSub').textContent = sub;
    if (S.forms) {
      $('rW').textContent = `${Math.round(S.w)} m/s · ${mph(S.w)} mph`;
      $('rWSub').textContent = `Parcel theory gives √(2·CAPE) = ${Math.round(Math.sqrt(2 * pc.cape))} m/s. Entrainment and the weight of rain and hail cut that about in half; rotation adds lift back.`;
      $('rMid').innerHTML = `${kt(S.vMid)} kt<small>${S.vMid >= 15 ? 'Mesocyclone, 3–6 km' : 'Weak, 3–6 km'}</small>`;
      $('rLow').innerHTML = `${kt(S.vLow)} kt<small>${S.vLow >= 15 ? 'Strong, near 1 km' : S.vLow >= 9 ? 'Moderate, near 1 km' : 'Weak, near 1 km'}</small>`;
      const [hn, hs] = hailName(S.hailIn); $('rHail').innerHTML = `${hn}<small>${hs}</small>`;
      const rm = E.bk.rm; $('rMove').innerHTML = `${mph(Math.hypot(rm[0], rm[1]))} mph<small>Toward the ${compass(rm[0], rm[1])}</small>`;
    } else {
      $('rW').textContent = '—'; $('rWSub').textContent = '';
      for (const id of ['rMid', 'rLow', 'rHail', 'rMove']) $(id).innerHTML = '—';
    }
    const pt = S.forms ? S.ptor : 0;
    $('tPct').textContent = S.forms ? `${Math.round(pt * 100)}%` : '—';
    $('tHead').textContent = S.forms ? 'Chance this storm produces a tornado' : 'No storm, no tornado';
    let why: string;
    if (!S.forms) why = 'Change the environment until a storm forms.';
    else if (pt === 0) why = 'Without a rotating updraft, tornadoes are very unlikely. Brief landspouts need different ingredients.';
    else {
      const lim: string[] = [];
      if (pc.lcl > 1500) lim.push(`high cloud base (${Math.round(pc.lcl).toLocaleString()} m) gives a cold, dry rear-flank downdraft`);
      if (E.srh1 < 100) lim.push(`weak low-level helicity (${Math.round(E.srh1)} m²/s²)`);
      if (pc.cin < -100) lim.push(`a strong cap (CIN ${Math.round(pc.cin)})`);
      if (pc.cape < 800) lim.push('limited instability');
      why = `STP ${E.stp.toFixed(1)}. ` + (lim.length ? 'Held back by ' + lim.join(', ') + '.' : 'Low cloud base, strong low-level helicity and enough instability: a favourable setup.');
    }
    $('tWhy').textContent = why;
    $<HTMLButtonElement>('tTyp').disabled = $<HTMLButtonElement>('tRoll').disabled = !(S.forms && pt > 0);
    drawEF($<HTMLCanvasElement>('tEF'), S); drawSkewT($<HTMLCanvasElement>('skewT'), E); drawHodograph($<HTMLCanvasElement>('hodo'), E);
  }

  /* ---------- tornado buttons ---------- */
  const rng = mulberry((Date.now() & 0xffff) + 7);
  function sendTornado(tp: TornadoParams, label: 'typical' | 'roll') {
    tor = tp;
    app.link = { params: tp, label, env: { ...o }, stp: E!.stp, ptor: S!.ptor };
    needRadar = true;
  }
  on($('tTyp'), 'click', () => {
    const tp = S && tornadoFrom(S, rng, true);
    if (!tp) return;
    sendTornado(tp, 'typical');
    $('tRes').innerHTML = `The typical tornado here peaks near ${tp.peakMph} mph. <a href="#tornado">Open it in the Tornado Lab →</a>`;
  });
  on($('tRoll'), 'click', () => {
    const tp = S && tornadoFrom(S, rng, false);
    if (!tp) { tor = null; app.link = null; needRadar = true; $('tRes').textContent = 'This time the storm stayed tornado-free, as most supercells do. Roll again.'; return; }
    sendTornado(tp, 'roll');
    $('tRes').innerHTML = `A tornado formed: ${tp.peakMph} mph peak winds, EF${efOf(tp.peakMph)}. <a href="#tornado">Open it in the Tornado Lab →</a>`;
  });

  /* ---------- chaser view ---------- */
  const cam: Camera = { az: -72, dist: 40, h: 2.5, tz: 5 };
  // ?capture-only: automated tests in headless browsers, where presenting a WebGPU canvas loses the device.
  // Frames are then only drawn offscreen through captureImage().
  const captureOnly = new URLSearchParams(location.search).has('capture-only');
  // draft resolution while the camera moves, full resolution once it stops
  let moving = false, settleCam = 0;
  const settleView = () => { clearTimeout(settleCam); settleCam = window.setTimeout(() => { moving = false; need3D = true; }, 160); };
  cleanup.push(() => clearTimeout(settleCam));
  function bindOrbit(c: HTMLCanvasElement) {
    let drag: { x: number; y: number; az: number; h: number } | null = null;
    on(c, 'pointerdown', e => { drag = { x: e.clientX, y: e.clientY, az: cam.az, h: cam.h }; c.setPointerCapture(e.pointerId); c.style.cursor = 'grabbing'; });
    on(c, 'pointermove', e => {
      if (!drag) return;
      cam.az = drag.az - (e.clientX - drag.x) * 0.3;
      cam.h = clamp(drag.h + (e.clientY - drag.y) * 0.08, 0.3, 40);
      cam.tz = cam.h > 12 ? 2 : 5; need3D = true; moving = true;
    });
    const end = () => { drag = null; c.style.cursor = 'grab'; settleView(); };
    on(c, 'pointerup', end); on(c, 'pointercancel', end);
    on(c, 'wheel', e => { e.preventDefault(); cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.001), 16, 110); need3D = true; moving = true; settleView(); }, { passive: false });
  }
  function draw3D() {
    const tag = $('svTagL');
    if (!renderer) { tag.textContent = 'Starting the renderer…'; return; }
    if (st.mode === 'sim' && panel.driver) {
      // ease the camera toward the simulated storm's main updraft
      const fx = panel.focus?.[0] ?? -5, fy = panel.focus?.[1] ?? 0;
      cam.tx = (cam.tx ?? fx) + (fx - (cam.tx ?? fx)) * 0.08; cam.ty = (cam.ty ?? fy) + (fy - (cam.ty ?? fy)) * 0.08;
      if (Math.hypot(fx - cam.tx, fy - cam.ty) > 0.05) need3D = true;
      const az = cam.az * Math.PI / 180;
      tag.textContent = `Simulated storm · ${Math.round(panel.driver.t / 60)} min · looking ${compass(-Math.cos(az), -Math.sin(az))} · drag to orbit, scroll to zoom`;
      if (!captureOnly) renderer.render(cam, moving ? 0.5 : undefined);
      return;
    }
    if (st.mode === 'sim') tag.textContent = 'Press Run to grow this storm from scratch in the cloud model. Shown until then: the instant model.';
    else if (S && !S.forms) tag.textContent = 'Clear skies: no storm in this environment';
    else if (!RES?.vol) { tag.textContent = 'Building the storm…'; return; }
    else if (st.mode === 'instant') {
      const az = cam.az * Math.PI / 180;
      tag.textContent = `Looking ${compass(-Math.cos(az), -Math.sin(az))} from ${Math.round(cam.dist)} km · ${cam.h < 1 ? 'ground level' : Math.round(cam.h) + ' km up'} · drag to orbit, scroll to zoom`;
    }
    if (!captureOnly) renderer.render(cam, moving ? 0.5 : undefined);
  }

  async function captureImage(W: number, H: number): Promise<ImageData | null> {
    return renderer && (RES?.vol || panel.driver) ? renderer.capture(cam, W, H) : null;
  }
  on($('svSave'), 'click', async () => {
    const img = await captureImage(1920, 1200);
    if (!img) return;
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
    const a = document.createElement('a');
    a.download = `supercell-${(S?.precip ?? 'storm')}-${Date.now()}.png`; a.href = c.toDataURL('image/png'); a.click();
  });
  // hook for automated tests: render a frame offscreen
  (window as unknown as { __stormlab?: unknown }).__stormlab = {
    captureImage, kind: () => renderer?.kind,
    sim: () => ({ t: panel.driver?.t ?? 0, kind: panel.driver?.kind, series: panel.series, events: panel.tracker?.events ?? [] })
  };
  cleanup.push(() => { delete (window as unknown as { __stormlab?: unknown }).__stormlab; });

  /* ---------- loop ---------- */
  let lastFrame = performance.now();
  function loop(now: number) {
    if (!alive) return;
    const wallDt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
    if (st.mode === 'sim') panel.tick(wallDt);
    $('svTagR').textContent = busy && st.mode === 'instant' ? 'Computing…' : (S && S.forms && E ? `CAPE ${Math.round(E.pc.cape).toLocaleString()} · 0–6 km shear ${kt(E.shear6)} kt · STP ${E.stp.toFixed(1)}` : '');
    if (st.view === '3d' && need3D) { draw3D(); need3D = false; }
    if (st.view === 'radar' && needRadar) {
      $('svTagL').textContent = st.mode === 'sim'
        ? drawSimRadar($<HTMLCanvasElement>('svRadar'), panel.frame, st.prod, panel.torNow, panel.tracker?.events ?? [])
        : drawRadar($<HTMLCanvasElement>('svRadar'), RES, E, S, tor, st);
      needRadar = false;
    }
    requestAnimationFrame(loop);
  }
  const redraw = () => { if (E && S) { drawSkewT($<HTMLCanvasElement>('skewT'), E); drawHodograph($<HTMLCanvasElement>('hodo'), E); drawEF($<HTMLCanvasElement>('tEF'), S); } panel.redrawCharts(); };
  const ro = new ResizeObserver(() => { need3D = needRadar = true; redraw(); });
  ro.observe(root); cleanup.push(() => ro.disconnect());
  cleanup.push(onThemeChange(redraw));

  syncInputs();
  const match = Object.entries(PRESETS).find(([, p]) => SLIDERS.every(s => p[s.k] === o[s.k]));
  all('[data-pre]').forEach(b => b.setAttribute('aria-pressed', match && match[0] === b.dataset.pre ? 'true' : 'false'));
  lab.checked = st.labels;
  all('[data-p]').forEach(x => x.setAttribute('aria-pressed', x.dataset.p === st.prod ? 'true' : 'false'));
  setView(st.view);
  diagnose();
  setMode(st.mode);
  if (app.link && SLIDERS.every(s => app.link!.env[s.k] === o[s.k])) tor = app.link.params;
  requestAnimationFrame(loop);

  createChaserRenderer($<HTMLCanvasElement>('svGL')).then(r => {
    if (!alive) { r?.destroy(); return; }
    renderer = r;
    $('svGpu').textContent = r ? (r.kind === 'webgpu' ? 'Rendering with WebGPU' : 'Rendering with WebGL2') : 'No 3-D graphics available';
    if (r) { bindOrbit(r.canvas); r.canvas.hidden = st.view !== '3d'; }
    request(fullOpt());
  });

  return () => { alive = false; clearTimeout(settleT); cleanup.forEach(f => { try { f(); } catch { /* ignore */ } }); renderer?.destroy(); };
}
