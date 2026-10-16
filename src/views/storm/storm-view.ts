/**
 * Storm view: pick a setup and watch its storm live out its life in 3-D, with the setup's sounding and hodograph
 * below. The storm is the designed supercell (src/storm3d): its anatomy and life cycle follow the conceptual model,
 * driven by the setup's environment.
 */
import { FT, KT } from '../../physics/constants';
import { environment, type Environment } from '../../physics/environment';
import { storm, tornadoParams, type StormDiag } from '../../physics/storm';
import { envOf, PRESETS, type EnvSliders } from '../../presets';
import { type Camera } from '../../render/chaser';
import { planStorm, stormAt, type StormFrame, type StormPlan } from '../../storm3d/design';
import { QUALITY_HIGH, QUALITY_LOW, StormRenderer } from '../../storm3d/renderer';
import { app } from '../../state';
import { onThemeChange } from '../../ui/canvas';
import { toEnv } from '../../units';
import { CameraRig } from './camera-rig';
import { drawHodograph } from './hodograph';
import { drawSkewT } from './skewt';
import { STORM_HTML } from './template';

const kt = (ms: number) => Math.round(ms / KT);
const compass = (u: number, v: number) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((Math.atan2(u, v) * 180 / Math.PI + 360) % 360) / 22.5) % 16];

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
  let E: Environment | null = null, S: StormDiag | null = null, plan: StormPlan | null = null, frame: StormFrame | null = null;
  let renderer: StormRenderer | null = null;

  /* ---------- the storm's clock ---------- */
  let t = 0, playing = true, speed = 1, lastBuilt = -1, lastBuildWall = 0;
  const timeEl = $<HTMLInputElement>('plTime');
  const setPlaying = (p: boolean) => { playing = p; $('plPlay').textContent = p ? 'Pause' : 'Play'; };
  on($('plPlay'), 'click', () => { if (plan && t >= plan.duration) t = 0; setPlaying(!playing); });
  on(timeEl, 'input', () => { t = +timeEl.value; });
  all('[data-speed]').forEach(b => on(b, 'click', () => {
    speed = +b.dataset.speed!;
    all('[data-speed]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
  }));
  let quality: 'high' | 'low' = 'high', qualityChosen = false;
  function setQualityMode(q: 'high' | 'low') {
    quality = q;
    renderer?.setQuality(q === 'low' ? QUALITY_LOW : QUALITY_HIGH);
    all('[data-q]').forEach(x => x.setAttribute('aria-pressed', x.dataset.q === q ? 'true' : 'false'));
    lastBuilt = -1;
  }
  all('[data-q]').forEach(b => on(b, 'click', () => { qualityChosen = true; setQualityMode(b.dataset.q === 'low' ? 'low' : 'high'); }));

  /* ---------- keeping the frame rate up on whatever hardware this is ----------
   * The render resolution follows the measured frame time: it drops while frames run long and creeps back up when
   * there is headroom. If it bottoms out and frames are still slow, the volume drops to the low-detail grid. */
  let resScale = 1, ftAvg = 16, govAt = 0, slowSince = 0;
  const governor = (now: number, ft: number) => {
    ftAvg += (Math.min(ft, 200) - ftAvg) * 0.12;
    if (now - govAt < 400) return;
    govAt = now;
    if (ftAvg > 34) resScale = Math.max(0.3, resScale * 0.85);
    else if (ftAvg < 21 && resScale < 1) resScale = Math.min(1, resScale * 1.08);
    if (resScale <= 0.3 && ftAvg > 40) { if (!slowSince) slowSince = now; } else slowSince = 0;
    if (slowSince && now - slowSince > 2500 && quality === 'high' && !qualityChosen) { setQualityMode('low'); slowSince = 0; resScale = 0.6; }
  };
  // no need to draw while the view is scrolled off the screen
  let onScreen = true;
  const io = new IntersectionObserver(es => { onScreen = es.some(e => e.isIntersecting); }, { threshold: 0.02 });
  io.observe($('svGL')); cleanup.push(() => io.disconnect());

  /* ---------- camera: free look in ground coordinates ---------- */
  // the storm travels with its motion; the camera stays put unless "Move with the storm" is on
  // from the south-south-east, 24 km out, the storm side-lit by the evening sun
  const rig = new CameraRig({ az: -70, dist: 24, h: 0.1, tz: 2.9, tx: 0, ty: 0 });
  let aimed = false, lastOff: [number, number] = [0, 0];
  const offset = (): [number, number] => plan ? [plan.motion[0] * t * 0.06, plan.motion[1] * t * 0.06] : [0, 0];   // km
  function stormPoint(): [number, number] {
    const [ox, oy] = offset(), ux = frame ? frame.params[64] : 0, uy = frame ? frame.params[65] : 0;
    return [ux + ox, uy + oy];
  }
  /** Find the storm: fly there, or jump on first use. */
  function aimAtStorm(jump = false) {
    const [x, y] = stormPoint();
    if (jump) rig.jumpTo(x, y); else rig.lookAt(x, y);
    lastOff = offset(); aimed = true;
  }

  /* ---------- setups ---------- */
  function selectPreset(key: string) {
    st.preset = key;
    Object.assign(o, envOf(PRESETS[key]));
    all('[data-pre]').forEach(x => x.setAttribute('aria-pressed', x.dataset.pre === key ? 'true' : 'false'));
    $('pName').textContent = PRESETS[key].name; $('pWatch').textContent = PRESETS[key].watch;
    app.env = { ...o };
    E = environment(toEnv(o)); S = storm(E); plan = planStorm(E, S);
    timeEl.max = String(plan.duration);
    t = 0; lastBuilt = -1; aimed = false; frame = null;
    setPlaying(true);
    readouts();
  }
  all('[data-pre]').forEach(b => on(b, 'click', () => { if (b.dataset.pre !== st.preset) selectPreset(b.dataset.pre!); }));

  function readouts() {
    if (!E) return;
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

  /* ---------- tornado to the Tornado Lab ---------- */
  on($('svTorLink'), 'click', () => {
    if (!S || !E) return;
    app.link = { params: tornadoParams(S, S.vMed), label: 'typical', env: { ...o }, stp: E.stp, ptor: S.ptor };
    location.hash = 'tornado';
  });

  const captureOnly = new URLSearchParams(location.search).has('capture-only');
  // the camera: city-builder controls (see camera-rig.ts)
  let viewActive = false;
  function bindOrbit(c: HTMLCanvasElement) {
    c.tabIndex = 0;
    let drag: { x: number; y: number; pan: boolean } | null = null;
    // touch: one finger rotates, two fingers pinch to zoom and drag to pan
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; cx: number; cy: number } | null = null;
    on(c, 'contextmenu', e => e.preventDefault());
    on(c, 'pointerenter', () => { viewActive = true; });
    on(c, 'pointerleave', () => { viewActive = false; });
    on(c, 'pointerdown', e => {
      c.focus({ preventScroll: true });
      c.setPointerCapture(e.pointerId);
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; drag = null; }
        else if (touches.size === 1) drag = { x: e.clientX, y: e.clientY, pan: false };
        return;
      }
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 };
      c.style.cursor = drag.pan ? 'move' : 'grabbing';
      if (e.button === 1) e.preventDefault();
    });
    on(c, 'pointermove', e => {
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size >= 2 && pinch) {
          const [a, b] = [...touches.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
          const r = c.getBoundingClientRect();
          rig.zoom(-Math.log(d / Math.max(pinch.d, 1)) * 800, ((cx - r.left) / r.width) * 2 - 1, 1 - ((cy - r.top) / r.height) * 2, r.width / Math.max(r.height, 1));
          rig.dragPan(cx - pinch.cx, cy - pinch.cy, c.clientHeight);
          pinch = { d, cx, cy };
          return;
        }
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) rig.dragPan(dx, dy, c.clientHeight); else rig.dragRotate(dx, dy);
    });
    const end = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
      if (touches.size === 1) { const [a] = [...touches.values()]; drag = { x: a.x, y: a.y, pan: false }; }
      else drag = null;
      c.style.cursor = 'grab';
    };
    on(c, 'pointerup', end); on(c, 'pointercancel', end);
    on(c, 'wheel', e => {
      e.preventDefault();
      const b = c.getBoundingClientRect();
      const nx = ((e.clientX - b.left) / b.width) * 2 - 1, ny = 1 - ((e.clientY - b.top) / b.height) * 2;
      rig.zoom(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY, nx, ny, b.width / Math.max(b.height, 1));
    }, { passive: false });
    on(c, 'dblclick', () => aimAtStorm());
  }
  // keys move the camera while the pointer is over the view (or in full screen); typing in a field is left alone
  let shift = false;
  const camKeys = (e: KeyboardEvent, down: boolean) => {
    shift = e.shiftKey;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!CameraRig.KEYS.has(e.code)) return;
    if (down && !(viewActive || document.fullscreenElement)) return;
    e.preventDefault();
    if (down) rig.keyDown(e.code); else rig.keyUp(e.code);
  };
  const kd = (e: KeyboardEvent) => camKeys(e, true), ku = (e: KeyboardEvent) => camKeys(e, false), blur = () => rig.clearKeys();
  document.addEventListener('keydown', kd); document.addEventListener('keyup', ku); window.addEventListener('blur', blur);
  cleanup.push(() => { document.removeEventListener('keydown', kd); document.removeEventListener('keyup', ku); window.removeEventListener('blur', blur); });

  /** The renderer works in the storm's frame: shift the camera back by how far the storm has travelled. */
  function viewCam(): Camera {
    const [ox, oy] = offset();
    if (!aimed) aimAtStorm(true);
    if ($<HTMLInputElement>('plFollow').checked) rig.translate(ox - lastOff[0], oy - lastOff[1]);
    lastOff = [ox, oy];
    const cam = rig.camera();
    return { ...cam, tx: cam.tx! - ox, ty: cam.ty! - oy, gx: ox, gy: oy };
  }

  function currentFrame(): StormFrame | null {
    if (!plan) return null;
    frame = stormAt(plan, t, performance.now() / 1000);
    return frame;
  }
  async function captureImage(W: number, H: number): Promise<ImageData | null> {
    const f = currentFrame();
    if (!renderer || !f) return null;
    renderer.update(f.params); lastBuilt = t;
    return renderer.capture(viewCam(), W, H);
  }
  /* ---------- full screen ---------- */
  const col = $('svCol');
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void col.requestFullscreen?.(); };
  on($('svFull'), 'click', toggleFull);
  const onFs = () => { $('svFull').textContent = document.fullscreenElement === col ? 'Exit full screen' : 'Full screen'; };
  document.addEventListener('fullscreenchange', onFs); cleanup.push(() => document.removeEventListener('fullscreenchange', onFs));
  // F11 puts the storm view (not the whole page) in full screen where the browser allows it; F is the camera's tilt
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'F11') { e.preventDefault(); toggleFull(); }
  };
  document.addEventListener('keydown', onKey); cleanup.push(() => document.removeEventListener('keydown', onKey));
  cleanup.push(() => { if (document.fullscreenElement === col) void document.exitFullscreen(); });

  on($('svSave'), 'click', async () => {
    const img = await captureImage(1920, 1200);
    if (!img) return;
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
    const a = document.createElement('a');
    a.download = `stormlab-${st.preset}-${Math.round(t)}min.png`; a.href = c.toDataURL('image/png'); a.click();
  });
  // hook for automated tests
  (window as unknown as { __stormlab?: unknown }).__stormlab = {
    captureImage, kind: () => renderer?.kind ?? null, rig, renderer: () => renderer, frame: () => frame, viewCam: () => viewCam(),
    setTime: (m: number) => { t = m; setPlaying(false); timeEl.value = String(t); currentFrame(); aimed = false; },
    setPreset: (k: string) => selectPreset(k),
    state: () => ({ t, stage: frame?.stage, tornado: frame?.tornado, preset: st.preset })
  };
  cleanup.push(() => { delete (window as unknown as { __stormlab?: unknown }).__stormlab; });

  /* ---------- loop ---------- */
  let lastFrame = performance.now();
  function loop(now: number) {
    if (!alive) return;
    const ft = now - lastFrame;
    const wallDt = Math.min(0.1, Math.max(0, ft / 1000)); lastFrame = now;
    if (plan) {
      if (playing) {
        t = Math.min(plan.duration, t + speed * wallDt);
        if (t >= plan.duration) setPlaying(false);
        timeEl.value = String(t);
      }
      $('plClock').textContent = `${Math.floor(t)} min`;
      const f = currentFrame()!;
      $('svStageName').textContent = f.stage; $('svStageText').textContent = f.caption;
      $('svTorLink').hidden = !(f.tornado > 0.15);
      rig.update(wallDt, shift);
      if (renderer && !captureOnly && onScreen) {
        governor(now, ft);
        // repaint the volume when storm time moves, a few times a second (the storm changes over minutes, so this
        // is plenty), less often still when the frame rate is struggling; otherwise just advance the spin
        // The rebuild is spread over several frames (see StormRenderer.step), so its cost per frame stays small.
        const rebuildEvery = resScale < 0.6 ? 400 : 200;
        if (lastBuilt < 0) { renderer.update(f.params); lastBuilt = t; lastBuildWall = now; }
        else if (!renderer.rebuilding && Math.abs(t - lastBuilt) > 0.05 && now - lastBuildWall > rebuildEvery) { renderer.beginUpdate(f.params); lastBuilt = t; lastBuildWall = now; }
        renderer.step();
        renderer.setClock(f.params, now / 1000);
        renderer.render(viewCam(), undefined, resScale * (rig.moving ? 0.7 : 1));
        const az = rig.cur.yaw * Math.PI / 180;
        $('svTagL').textContent = `Looking ${compass(-Math.cos(az), -Math.sin(az))} · ${Math.round(rig.cur.dist)} km`;
      }
    }
    requestAnimationFrame(loop);
  }
  const redraw = () => { if (E) { drawSkewT($<HTMLCanvasElement>('skewT'), E); drawHodograph($<HTMLCanvasElement>('hodo'), E); } };
  const ro = new ResizeObserver(redraw);
  ro.observe(root); cleanup.push(() => ro.disconnect());
  cleanup.push(onThemeChange(redraw));

  selectPreset(st.preset);
  requestAnimationFrame(loop);

  // the GPU can drop the device (driver reset, sleep): make a new renderer a couple of times before giving up
  let retries = 0;
  function makeRenderer() {
    StormRenderer.create($<HTMLCanvasElement>('svGL')).then(r => {
      if (!alive) { r?.destroy(); return; }
      renderer = r; lastBuilt = -1;
      $('svGpu').textContent = r ? 'Rendering with WebGPU' : '';
      $('svNoGPU').hidden = !!r;
      if (!r) return;
      r.device.lost.then(info => {
        if (!alive || info.reason === 'destroyed' || renderer !== r) return;
        renderer = null;
        if (retries++ < 2) setTimeout(makeRenderer, 500); else $('svNoGPU').hidden = false;
      });
    }).catch(e => { console.error(e); $('svNoGPU').hidden = false; });
  }
  bindOrbit($<HTMLCanvasElement>('svGL'));
  makeRenderer();

  return () => { alive = false; cleanup.forEach(f => { try { f(); } catch { /* ignore */ } }); renderer?.destroy(); };
}
