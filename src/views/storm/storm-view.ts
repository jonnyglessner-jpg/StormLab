/**
 * Storm view: pick a setup, grow the storm in the cloud model, and watch it in 3-D (chaser view) or on a radar map,
 * with the setup's sounding and hodograph below.
 */
import { clamp, FT, KT } from '../../physics/constants';
import { environment, type Environment } from '../../physics/environment';
import { storm, type StormDiag } from '../../physics/storm';
import { lightVolumeCPU, type VolumeData } from '../../physics/volume';
import { envOf, PRESETS, type EnvSliders } from '../../presets';
import { createChaserRenderer, TARGET, type Camera, type ChaserRenderer } from '../../render/chaser';
import { app } from '../../state';
import { onThemeChange } from '../../ui/canvas';
import { toEnv } from '../../units';
import { drawHodograph } from './hodograph';
import { drawSkewT } from './skewt';
import { SimPanel } from './sim-panel';
import { drawSimRadar, MapView, toGround } from './sim-radar';
import { STORM_HTML } from './template';

const kt = (ms: number) => Math.round(ms / KT);
const compass = (u: number, v: number) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((Math.atan2(u, v) * 180 / Math.PI + 360) % 360) / 22.5) % 16];

/** An empty sky, so the 3-D view shows the ground and sky before a run starts. */
function emptyVolume(lit: boolean): VolumeData {
  const NV = 8, NZv = 8, grid = { NV, NZv, Rv: 48000, ZT: 16000, dxv: 12000, dzv: 2000 }, beta = new Float32Array(NV * NV * NZv);
  return { ...grid, beta, lit: lit ? lightVolumeCPU(beta, grid) : null };
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
  if (!PRESETS[st.preset]) st.preset = 'plains';
  const o: EnvSliders = envOf(PRESETS[st.preset]);
  let E: Environment | null = null, S: StormDiag | null = null;
  let renderer: ChaserRenderer | null = null, need3D = true, needRadar = true;

  /* ---------- the simulation ---------- */
  const panel = new SimPanel({
    root, env: () => E, storm: () => S, renderer: () => renderer,
    redraw3D: () => { need3D = true; }, redrawRadar: () => { needRadar = true; },
    clearVolume: () => { renderer?.setVolume(emptyVolume(renderer.needsCpuLighting)); need3D = true; }
  });
  cleanup.push(() => panel.destroy());
  on($('svStartBtn'), 'click', () => { void panel.toggle(); });

  /* ---------- setups ---------- */
  function selectPreset(key: string) {
    st.preset = key;
    Object.assign(o, envOf(PRESETS[key]));
    all('[data-pre]').forEach(x => x.setAttribute('aria-pressed', x.dataset.pre === key ? 'true' : 'false'));
    $('pName').textContent = PRESETS[key].name; $('pWatch').textContent = PRESETS[key].watch;
    app.env = { ...o };
    diagnose();
  }
  all('[data-pre]').forEach(b => on(b, 'click', () => {
    if (b.dataset.pre === st.preset) return;
    selectPreset(b.dataset.pre!);
    if (panel.driver) panel.restart();          // a new setup is a new run
    need3D = needRadar = true;
  }));

  /** Environment numbers, sounding and hodograph. S is kept for sending a simulated tornado to the Tornado Lab. */
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
    drawSkewT($<HTMLCanvasElement>('skewT'), E); drawHodograph($<HTMLCanvasElement>('hodo'), E);
  }

  /* ---------- views ---------- */
  function setView(v: '3d' | 'radar') {
    st.view = v;
    all('[data-v]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false'));
    (renderer?.canvas ?? $('svGL')).hidden = v !== '3d'; $('svRadar').hidden = v !== 'radar';
    $('svProd').style.display = v === 'radar' ? '' : 'none'; $('svSave').style.display = v === '3d' ? '' : 'none';
    need3D = needRadar = true;
  }
  all('[data-v]').forEach(b => on(b, 'click', () => setView(b.dataset.v as '3d' | 'radar')));
  all('[data-p]').forEach(b => on(b, 'click', () => {
    st.prod = b.dataset.p as 'dbz' | 'vel' | 'hail';
    all('[data-p]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    needRadar = true;
  }));

  /* ---------- radar: a fixed map you scroll and zoom ---------- */
  const mapView = new MapView();
  {
    const rc = $<HTMLCanvasElement>('svRadar');
    let drag: { x: number; y: number } | null = null, lastT = 0;
    on(rc, 'pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; rc.setPointerCapture(e.pointerId); rc.style.cursor = 'grabbing'; });
    on(rc, 'pointermove', e => {
      if (!drag) return;
      mapView.pan(e.clientX - drag.x, e.clientY - drag.y); drag = { x: e.clientX, y: e.clientY }; needRadar = true;
    });
    const end = () => { drag = null; rc.style.cursor = 'grab'; };
    on(rc, 'pointerup', end); on(rc, 'pointercancel', end);
    on(rc, 'wheel', e => {
      e.preventDefault();
      const r = rc.getBoundingClientRect();
      mapView.zoom(Math.exp(e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top, r.width, r.height); needRadar = true;
    }, { passive: false });
    on(rc, 'dblclick', () => {
      const fr = panel.frame;
      if (!fr || !panel.focus) return;
      const [x, y] = toGround(fr, (panel.focus[0] + fr.g.NX * fr.g.dx / 2000) * 1000, (panel.focus[1] + fr.g.NY * fr.g.dy / 2000) * 1000);
      mapView.cx = x; mapView.cy = y; needRadar = true;
    });
    // a new run starts with a fresh map view
    const iv = window.setInterval(() => { const t = panel.frame?.t ?? 0; if (t < lastT) mapView.reset(); lastT = t; }, 1000);
    cleanup.push(() => clearInterval(iv));
    rc.style.cursor = 'grab';
  }

  /* ---------- chaser view ---------- */
  const cam: Camera = { az: -72, dist: 40, h: 2.5, tz: 5 };
  // ?capture-only: automated tests in headless browsers, where presenting a WebGPU canvas loses the device.
  // Frames are then only drawn offscreen through captureImage().
  const captureOnly = new URLSearchParams(location.search).has('capture-only');
  // draft resolution while the camera moves, full resolution once it stops
  let moving = false, settleCam = 0;
  const settleView = () => { clearTimeout(settleCam); settleCam = window.setTimeout(() => { moving = false; need3D = true; }, 160); };
  cleanup.push(() => clearTimeout(settleCam));
  /** Free look: drag to orbit, right-drag (or shift-drag) to pan across the ground, scroll to zoom. */
  function bindOrbit(c: HTMLCanvasElement) {
    let drag: { x: number; y: number; az: number; h: number; pan: boolean; tx: number; ty: number } | null = null;
    on(c, 'contextmenu', e => e.preventDefault());
    on(c, 'pointerdown', e => {
      const pan = e.button === 2 || e.button === 1 || e.shiftKey;
      drag = { x: e.clientX, y: e.clientY, az: cam.az, h: cam.h, pan, tx: cam.tx ?? TARGET[0], ty: cam.ty ?? TARGET[1] };
      c.setPointerCapture(e.pointerId); c.style.cursor = pan ? 'move' : 'grabbing';
    });
    on(c, 'pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.pan) {
        // move the look-at point across the ground: sideways with the mouse, toward or away with up/down
        const az = cam.az * Math.PI / 180, k = cam.dist * 0.0025;
        const fx = -Math.cos(az), fy = -Math.sin(az), rx = -Math.sin(az), ry = Math.cos(az);
        cam.tx = clamp(drag.tx - rx * dx * k + fx * dy * k, -300, 300);
        cam.ty = clamp(drag.ty - ry * dx * k + fy * dy * k, -300, 300);
      } else {
        cam.az = drag.az - dx * 0.3;
        cam.h = clamp(drag.h + dy * 0.08, 0.3, 40);
        cam.tz = cam.h > 12 ? 2 : 5;
      }
      need3D = true; moving = true;
    });
    const end = () => { drag = null; c.style.cursor = 'grab'; settleView(); };
    on(c, 'pointerup', end); on(c, 'pointercancel', end);
    on(c, 'wheel', e => { e.preventDefault(); cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.001), 16, 110); need3D = true; moving = true; settleView(); }, { passive: false });
    // double-click: jump to the storm's main updraft
    on(c, 'dblclick', () => {
      const d = panel.driver;
      if (panel.focus && d) { cam.tx = panel.focus[0] + d.base.cu * d.t / 1000; cam.ty = panel.focus[1] + d.base.cv * d.t / 1000; need3D = true; }
    });
  }
  /**
   * The camera as the renderer needs it. The viewer's camera lives in ground coordinates while the model runs in a
   * frame moving with the storm, so the storm drives across the fields; with "Move with the storm" on, the camera
   * travels along with it.
   */
  let lastG: [number, number] | null = null, lastT = 0;
  function viewCam(): Camera {
    const d = panel.driver;
    if (!d) { lastG = null; lastT = 0; return { ...cam, tx: cam.tx ?? -5, ty: cam.ty ?? 0 }; }
    if (d.t < lastT) { cam.tx = cam.ty = undefined; lastG = null; }    // a restarted run: aim at the new storm
    lastT = d.t;
    const gx = d.base.cu * d.t / 1000, gy = d.base.cv * d.t / 1000;
    if (cam.tx === undefined || cam.ty === undefined) { cam.tx = -5 + gx; cam.ty = gy; }
    if (lastG && $<HTMLInputElement>('simFollow').checked) { cam.tx += gx - lastG[0]; cam.ty += gy - lastG[1]; }
    lastG = [gx, gy];
    return { ...cam, tx: cam.tx - gx, ty: cam.ty - gy, gx, gy };
  }
  function draw3D() {
    const tag = $('svTagL');
    if (!renderer) { tag.textContent = 'Starting the renderer…'; return; }
    const az = cam.az * Math.PI / 180, look = `looking ${compass(-Math.cos(az), -Math.sin(az))}`;
    tag.textContent = panel.driver
      ? `${Math.round(panel.driver.t / 60)} min · ${look} · drag to orbit, right-drag to pan, double-click to find the storm`
      : `${PRESETS[st.preset].name} · ${look}`;
    if (!captureOnly) renderer.render(viewCam(), moving ? 0.5 : undefined);
  }

  async function captureImage(W: number, H: number): Promise<ImageData | null> {
    return renderer ? renderer.capture(viewCam(), W, H) : null;
  }
  on($('svSave'), 'click', async () => {
    const img = await captureImage(1920, 1200);
    if (!img) return;
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
    const a = document.createElement('a');
    a.download = `stormlab-${st.preset}-${Math.round((panel.driver?.t ?? 0) / 60)}min.png`; a.href = c.toDataURL('image/png'); a.click();
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
    panel.tick(wallDt);
    $('svStart').hidden = !!panel.driver;
    $('svTagR').textContent = E ? `CAPE ${Math.round(E.pc.cape).toLocaleString()} · 0–6 km shear ${kt(E.shear6)} kt · STP ${E.stp.toFixed(1)}` : '';
    if (st.view === '3d' && need3D) { draw3D(); need3D = false; }
    if (st.view === 'radar' && needRadar) {
      $('svTagL').textContent = panel.frame
        ? drawSimRadar($<HTMLCanvasElement>('svRadar'), panel.frame, st.prod, panel.torNow, panel.tracker?.events ?? [], panel.swath, mapView)
        : (drawSimRadar($<HTMLCanvasElement>('svRadar'), null, st.prod, null, [], null, mapView), 'Radar · press Grow the storm to start');
      needRadar = false;
    }
    requestAnimationFrame(loop);
  }
  const redraw = () => { if (E) { drawSkewT($<HTMLCanvasElement>('skewT'), E); drawHodograph($<HTMLCanvasElement>('hodo'), E); } panel.redrawCharts(); };
  const ro = new ResizeObserver(() => { need3D = needRadar = true; redraw(); });
  ro.observe(root); cleanup.push(() => ro.disconnect());
  cleanup.push(onThemeChange(redraw));

  selectPreset(st.preset);
  all('[data-p]').forEach(x => x.setAttribute('aria-pressed', x.dataset.p === st.prod ? 'true' : 'false'));
  setView(st.view);
  requestAnimationFrame(loop);

  createChaserRenderer($<HTMLCanvasElement>('svGL')).then(r => {
    if (!alive) { r?.destroy(); return; }
    renderer = r;
    $('svGpu').textContent = r ? (r.kind === 'webgpu' ? 'Rendering with WebGPU' : 'Rendering with WebGL2') : 'No 3-D graphics available';
    if (r) { bindOrbit(r.canvas); r.canvas.hidden = st.view !== '3d'; if (!panel.driver) r.setVolume(emptyVolume(r.needsCpuLighting)); }
    need3D = true;
  });

  return () => { alive = false; cleanup.forEach(f => { try { f(); } catch { /* ignore */ } }); renderer?.destroy(); };
}
