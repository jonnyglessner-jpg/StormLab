/**
 * Storm view: pick a setup and watch its storm live out its life in 3-D, with the setup's sounding and hodograph
 * below. The storm is the designed supercell (src/storm3d): its anatomy and life cycle follow the conceptual model,
 * driven by the setup's environment.
 */
import { clamp, FT, KT } from '../../physics/constants';
import { environment, type Environment } from '../../physics/environment';
import { storm, tornadoParams, type StormDiag } from '../../physics/storm';
import { envOf, PRESETS, type EnvSliders } from '../../presets';
import { type Camera } from '../../render/chaser';
import { planStorm, stormAt, type StormFrame, type StormPlan } from '../../storm3d/design';
import { QUALITY_HIGH, QUALITY_LOW, StormRenderer } from '../../storm3d/renderer';
import { app } from '../../state';
import { onThemeChange } from '../../ui/canvas';
import { toEnv } from '../../units';
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
  all('[data-q]').forEach(b => on(b, 'click', () => {
    renderer?.setQuality(b.dataset.q === 'low' ? QUALITY_LOW : QUALITY_HIGH);
    all('[data-q]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    lastBuilt = -1;
  }));

  /* ---------- camera: free look in ground coordinates ---------- */
  // the storm travels with its motion; the camera stays put unless "Move with the storm" is on
  const cam: Camera = { az: -70, dist: 24, h: 0.1, tz: 3 };   // from the south-south-east, the storm side-lit by the late sun
  let aimed = false, lastOff: [number, number] = [0, 0];
  const offset = (): [number, number] => plan ? [plan.motion[0] * t * 0.06, plan.motion[1] * t * 0.06] : [0, 0];   // km
  function aimAtStorm() {
    const [ox, oy] = offset(), ux = frame ? frame.params[64] : 0, uy = frame ? frame.params[65] : 0;
    cam.tx = ux + ox; cam.ty = uy + oy; lastOff = [ox, oy]; aimed = true;
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
  let moving = false, settleCam = 0;
  const settleView = () => { clearTimeout(settleCam); settleCam = window.setTimeout(() => { moving = false; }, 160); };
  cleanup.push(() => clearTimeout(settleCam));
  function bindOrbit(c: HTMLCanvasElement) {
    let drag: { x: number; y: number; az: number; h: number; pan: boolean; tx: number; ty: number } | null = null;
    on(c, 'contextmenu', e => e.preventDefault());
    on(c, 'pointerdown', e => {
      const pan = e.button === 2 || e.button === 1 || e.shiftKey;
      drag = { x: e.clientX, y: e.clientY, az: cam.az, h: cam.h, pan, tx: cam.tx ?? 0, ty: cam.ty ?? 0 };
      c.setPointerCapture(e.pointerId); c.style.cursor = pan ? 'move' : 'grabbing';
    });
    on(c, 'pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.pan) {
        const az = cam.az * Math.PI / 180, k = cam.dist * 0.0025;
        const fx = -Math.cos(az), fy = -Math.sin(az), rx = -Math.sin(az), ry = Math.cos(az);
        cam.tx = drag.tx - rx * dx * k + fx * dy * k; cam.ty = drag.ty - ry * dx * k + fy * dy * k;
      } else {
        cam.az = drag.az - dx * 0.3;
        cam.h = clamp(drag.h + dy * 0.01, 0.02, 30);
      }
      moving = true;
    });
    const end = () => { drag = null; c.style.cursor = 'grab'; settleView(); };
    on(c, 'pointerup', end); on(c, 'pointercancel', end);
    on(c, 'wheel', e => { e.preventDefault(); cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.001), 3, 120); moving = true; settleView(); }, { passive: false });
    on(c, 'dblclick', () => aimAtStorm());
  }
  /** The renderer works in the storm's frame: shift the camera back by how far the storm has travelled. */
  function viewCam(): Camera {
    const [ox, oy] = offset();
    if (!aimed) aimAtStorm();
    if ($<HTMLInputElement>('plFollow').checked) { cam.tx! += ox - lastOff[0]; cam.ty! += oy - lastOff[1]; }
    lastOff = [ox, oy];
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
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFull(); }
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
    captureImage, kind: () => renderer?.kind ?? null, camera: cam, renderer: () => renderer, frame: () => frame, viewCam: () => viewCam(),
    setTime: (m: number) => { t = m; setPlaying(false); timeEl.value = String(t); currentFrame(); aimed = false; },
    setPreset: (k: string) => selectPreset(k),
    state: () => ({ t, stage: frame?.stage, tornado: frame?.tornado, preset: st.preset })
  };
  cleanup.push(() => { delete (window as unknown as { __stormlab?: unknown }).__stormlab; });

  /* ---------- loop ---------- */
  let lastFrame = performance.now();
  function loop(now: number) {
    if (!alive) return;
    const wallDt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
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
      if (renderer && !captureOnly) {
        // repaint the volume when storm time moves (at most about 15 times a second); otherwise just advance the spin
        if ((lastBuilt < 0 || Math.abs(t - lastBuilt) > 0.02) && now - lastBuildWall > 66) { renderer.update(f.params); lastBuilt = t; lastBuildWall = now; }
        else renderer.setClock(f.params, now / 1000);
        renderer.render(viewCam(), moving ? 0.5 : undefined);
        const az = cam.az * Math.PI / 180;
        $('svTagL').textContent = `Looking ${compass(-Math.cos(az), -Math.sin(az))} · ${Math.round(cam.dist)} km`;
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
  let retries = 0, orbitBound = false;
  function makeRenderer() {
    StormRenderer.create($<HTMLCanvasElement>('svGL')).then(r => {
      if (!alive) { r?.destroy(); return; }
      renderer = r; lastBuilt = -1;
      $('svGpu').textContent = r ? 'Rendering with WebGPU' : '';
      $('svNoGPU').hidden = !!r;
      if (!r) return;
      if (!orbitBound) { bindOrbit(r.canvas); orbitBound = true; }
      r.device.lost.then(info => {
        if (!alive || info.reason === 'destroyed' || renderer !== r) return;
        renderer = null;
        if (retries++ < 2) setTimeout(makeRenderer, 500); else $('svNoGPU').hidden = false;
      });
    }).catch(e => { console.error(e); $('svNoGPU').hidden = false; });
  }
  makeRenderer();

  return () => { alive = false; cleanup.forEach(f => { try { f(); } catch { /* ignore */ } }); renderer?.destroy(); };
}
