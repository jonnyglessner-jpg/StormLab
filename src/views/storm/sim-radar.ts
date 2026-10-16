/**
 * Radar view of the running simulation, drawn like a radar app: a fixed, scrollable and zoomable map (counties,
 * highways, towns and a radar site) with the storm moving across it. The model runs in a frame that moves with the
 * storm, so every model column is placed on the map at its position plus the storm motion times the model time.
 * Products: reflectivity or storm-relative velocity at about 600 m, or the ground-relative hail swath.
 * The map is fictional: the setups are idealised environments, not real places.
 */
import { KT } from '../../physics/constants';
import { D, ND, type HailSwath, type TornadoEvent } from '../../sim/diag';
import { type DiagFrame } from '../../sim/driver';
import { type GridSpec } from '../../sim/grid';
import { dbzRGB, fit, hex, NWS } from '../../ui/canvas';

const MI = 1609.34;
const VEL = ([[-60, '#00e4ff'], [-45, '#0094ff'], [-35, '#00c800'], [-25, '#00a000'], [-15, '#006e00'], [-5, '#2e4a32'],
  [5, '#4a2e30'], [15, '#8a0000'], [25, '#c80000'], [35, '#ff3030'], [45, '#ff9a9a'], [60, '#ffe0a0']] as const).map(([v, c]) => [v, hex(c)] as const);
const velRGB = (k: number) => { if (k < -55) return VEL[0][1]; for (let i = 1; i < VEL.length; i++) if (k < VEL[i][0]) return VEL[i - 1][1]; return VEL[VEL.length - 1][1]; };
/** hail size classes, mm (lower bounds), with labels in inches */
const HAILC = ([[6, '#a5d6a7', '¼'], [13, '#43a047', '½'], [19, '#fdd835', '¾'], [25, '#fb8c00', '1'], [38, '#e53935', '1½'],
  [44, '#ad1457', '1¾'], [51, '#8e24aa', '2'], [64, '#4527a0', '2½'], [70, '#e8eaf6', '2¾']] as const).map(([v, c, l]) => [v, hex(c), l] as const);
const hailRGB = (mm: number) => { if (mm < HAILC[0][0]) return null; let k = 0; for (let i = 0; i < HAILC.length; i++) if (mm >= HAILC[i][0]) k = i; return HAILC[k][1]; };
const off = document.createElement('canvas');

/* ---------- the map: fictional geography in ground metres (origin: the model domain's corner at t = 0) ---------- */

/** where the storm is started: the map is laid out around it */
const startOf = (g: GridSpec): [number, number] => [g.NX * g.dx * 0.45, g.NY * g.dy * 0.5];
/** the radar site, north-east of the start so the storm passes within range */
export const radarSite = (g: GridSpec): [number, number] => { const [x, y] = startOf(g); return [x + 45000, y + 8000]; };

const hash = (i: number, j: number, k = 0) => { const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
const TOWNS = ['Harlan', 'Wheatland', 'Carver', 'Ashby', 'Elk Point', 'Milford', 'Prairie View', 'Lindell', 'Corwin', 'Osage Springs',
  'Belmont', 'Fairview', 'Kessler', 'Red Willow', 'Dunmore', 'Hollis', 'Pawnee Rock', 'Stanton', 'Gibbon', 'Clay Center',
  'Arcadia', 'Bluffton', 'Quinter', 'Lone Tree', 'Sedgwick', 'Haddam', 'Bison', 'Alden', 'Marion', 'Galva', 'Tipton', 'Winfield',
  'Oakley', 'Burdett', 'Plainville', 'Ransom', 'Garfield', 'Hope', 'Ellis', 'Morland', 'Delphos', 'Agra', 'Bucklin', 'Jetmore',
  'Sylvan Grove', 'Kanopolis', 'Cedar Bluff', 'Larned'];
interface Town { x: number; y: number; name: string; big: boolean }
const townCache = new Map<string, Town | null>();
/** one town per 28 km cell where the hash allows, jittered inside the cell */
function townIn(i: number, j: number, ox: number, oy: number): Town | null {
  const key = `${i},${j},${ox},${oy}`;
  if (townCache.has(key)) return townCache.get(key)!;
  const C = 28000, h = hash(i, j);
  const t = h < 0.72 ? {
    x: ox + (i + 0.15 + 0.7 * hash(i, j, 1)) * C, y: oy + (j + 0.15 + 0.7 * hash(i, j, 2)) * C,
    name: TOWNS[(((i * 7 + j * 17) % TOWNS.length) + TOWNS.length) % TOWNS.length], big: hash(i, j, 4) > 0.6
  } : null;
  townCache.set(key, t);
  return t;
}

/** Scrollable, zoomable map view: centre (ground m) and metres per CSS pixel. */
export class MapView {
  cx = NaN; cy = NaN; mpp = 380;
  /** first frame of a run: centre between the storm's start and the radar */
  ensure(g: GridSpec): void {
    if (Number.isFinite(this.cx)) return;
    const [sx, sy] = startOf(g), [rx, ry] = radarSite(g);
    this.cx = 0.5 * (sx + rx) + 10000; this.cy = 0.5 * (sy + ry) + 10000;
  }
  reset(): void { this.cx = this.cy = NaN; this.mpp = 380; }
  pan(dxPx: number, dyPx: number): void { this.cx -= dxPx * this.mpp; this.cy += dyPx * this.mpp; }
  /** zoom by `f` keeping the point under (px, py) in place; w, h the canvas size in CSS pixels */
  zoom(f: number, px: number, py: number, w: number, h: number): void {
    const gx = this.cx + (px - w / 2) * this.mpp, gy = this.cy - (py - h / 2) * this.mpp;
    this.mpp = Math.min(1500, Math.max(60, this.mpp * f));
    this.cx = gx - (px - w / 2) * this.mpp; this.cy = gy + (py - h / 2) * this.mpp;
  }
}

export function drawSimRadar(c: HTMLCanvasElement, fr: DiagFrame | null, prod: 'dbz' | 'vel' | 'hail', torNow: TornadoEvent | null,
  events: TornadoEvent[], swath: HailSwath | null, view: MapView): string {
  const { ctx, w, h } = fit(c);
  ctx.fillStyle = '#11171a'; ctx.fillRect(0, 0, w, h);
  if (!fr) return 'Waiting for the first model output…';
  const g = fr.g, NX = g.NX, NY = g.NY, d = fr.diag;
  view.ensure(g);
  const m = view.mpp, X = (gx: number) => w / 2 + (gx - view.cx) / m, Y = (gy: number) => h / 2 - (gy - view.cy) / m;
  const shiftX = fr.cu * fr.t, shiftY = fr.cv * fr.t;            // how far the model domain has moved over the ground
  const [rx, ry] = radarSite(g);

  // counties: a 30-mile grid, offset from the domain
  const CO = 30 * MI, cox = -13000, coy = -7000;
  const gxMin = view.cx - w / 2 * m, gxMax = view.cx + w / 2 * m, gyMin = view.cy - h / 2 * m, gyMax = view.cy + h / 2 * m;
  ctx.strokeStyle = '#26343a'; ctx.lineWidth = 1; ctx.beginPath();
  for (let k = Math.ceil((gxMin - cox) / CO); cox + k * CO <= gxMax; k++) { const x = X(cox + k * CO); ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let k = Math.ceil((gyMin - coy) / CO); coy + k * CO <= gyMax; k++) { const y = Y(coy + k * CO); ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();

  // radar data
  ctx.imageSmoothingEnabled = prod !== 'hail';
  if (prod === 'hail') {
    if (swath) {
      off.width = swath.nx; off.height = swath.ny;
      const octx = off.getContext('2d')!, img = octx.createImageData(swath.nx, swath.ny), px = img.data;
      for (let j = 0; j < swath.ny; j++) for (let i = 0; i < swath.nx; i++) {
        const rgb = hailRGB(swath.d[j * swath.nx + i]);
        if (!rgb) continue;
        const p = ((swath.ny - 1 - j) * swath.nx + i) * 4; px[p] = rgb[0]; px[p + 1] = rgb[1]; px[p + 2] = rgb[2]; px[p + 3] = 235;
      }
      octx.putImageData(img, 0, 0);
      ctx.drawImage(off, X(swath.x0), Y(swath.y0 + swath.ny * g.dy), swath.nx * g.dx / m, swath.ny * g.dy / m);
    }
  } else {
    off.width = NX; off.height = NY;
    const octx = off.getContext('2d')!, img = octx.createImageData(NX, NY), px = img.data;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const o = (j * NX + i) * ND, p = ((NY - 1 - j) * NX + i) * 4, z = d[o + D.dbz];
      let rgb: readonly [number, number, number] | null = null;
      if (prod === 'dbz') rgb = dbzRGB(z);
      else if (z >= 5) {
        // storm-relative velocity along the beam from the fixed radar site
        const gx = (i + 0.5) * g.dx + shiftX, gy = (j + 0.5) * g.dy + shiftY, bx = gx - rx, by = gy - ry, rd = Math.hypot(bx, by) || 1;
        rgb = velRGB((d[o + D.u] * bx + d[o + D.v] * by) / rd / KT);
      }
      if (rgb) { px[p] = rgb[0]; px[p + 1] = rgb[1]; px[p + 2] = rgb[2]; px[p + 3] = 235; }
    }
    octx.putImageData(img, 0, 0);
    ctx.drawImage(off, X(shiftX), Y(shiftY + NY * g.dy), NX * g.dx / m, NY * g.dy / m);
  }
  ctx.imageSmoothingEnabled = true;

  // highways over the echoes, as radar apps draw them
  const [sx0, sy0] = startOf(g);
  const road = (fn: (s: number) => [number, number], s0: number, s1: number, width: number, col: string) => {
    ctx.strokeStyle = col; ctx.lineWidth = width; ctx.beginPath();
    for (let s = s0, k = 0; s <= s1; s += 2000, k++) { const [x, y] = fn(s); if (k) ctx.lineTo(X(x), Y(y)); else ctx.moveTo(X(x), Y(y)); }
    ctx.stroke();
  };
  const span = 400000;
  road(s => [sx0 + s, sy0 - 22000 + 6000 * Math.sin(s / 70000)], -span, span, 2.2, '#8a7a52');            // interstate, east-west
  road(s => [sx0 + 28000 + 4000 * Math.sin(s / 50000), sy0 + s], -span, span, 1.4, '#5d6a6e');            // highway, north-south
  road(s => [sx0 - 30000 + 0.86 * s, sy0 - 50000 + 0.5 * s], -span, span, 1.4, '#5d6a6e');                // highway, south-west to north-east
  road(s => [sx0 - 70000 + 2500 * Math.sin(s / 40000), sy0 + s], -span, span, 1.2, '#4b575a');            // highway, north-south

  // model domain (radar data only exists inside it)
  ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(223,230,227,.28)'; ctx.lineWidth = 1;
  ctx.strokeRect(X(shiftX), Y(shiftY + NY * g.dy), NX * g.dx / m, NY * g.dy / m); ctx.setLineDash([]);

  // range rings and the radar site
  ctx.strokeStyle = 'rgba(160,190,200,.35)'; ctx.lineWidth = 1;
  for (const r of [25, 50, 75, 100]) { ctx.beginPath(); ctx.arc(X(rx), Y(ry), r * MI / m, 0, 2 * Math.PI); ctx.stroke(); }
  ctx.fillStyle = '#dfe6e3'; ctx.fillRect(X(rx) - 3, Y(ry) - 3, 6, 6);
  ctx.font = '10px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
  ctx.fillText('RADAR', X(rx) + 6, Y(ry) + 3);
  ctx.fillStyle = 'rgba(160,190,200,.6)';
  for (const r of [25, 50, 75]) ctx.fillText(`${r} mi`, X(rx) + 3, Y(ry) - r * MI / m - 3);

  // towns
  const C = 28000, ox = sx0 - 14000, oy = sy0 - 9000;
  ctx.font = '12px Barlow, system-ui, sans-serif';
  for (let i = Math.floor((gxMin - ox) / C) - 1; ox + i * C <= gxMax; i++) for (let j = Math.floor((gyMin - oy) / C) - 1; oy + j * C <= gyMax; j++) {
    const t = townIn(i, j, ox, oy);
    if (!t) continue;
    const x = X(t.x), y = Y(t.y);
    if (x < -40 || x > w + 40 || y < -20 || y > h + 20) continue;
    if (!t.big && m > 250) continue;          // small towns only when zoomed in
    ctx.fillStyle = '#dfe6e3'; ctx.beginPath(); ctx.arc(x, y, t.big ? 3 : 2, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = t.big ? '#eef3f1' : '#b9c4c1'; ctx.fillText(t.name, x + 5, y - 4);
  }

  // tornado tracks on the ground, and the current tornado
  const ground = (x: number, y: number, t: number): [number, number] => [x + fr.cu * t, y + fr.cv * t];
  for (const ev of events) {
    if (ev.track.length < 1) continue;
    ctx.strokeStyle = ev.end === null ? '#ffffff' : 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.beginPath();
    ev.track.forEach(([x, y, t], k) => { const [a, b] = ground(x, y, t); if (k) ctx.lineTo(X(a), Y(b)); else ctx.moveTo(X(a), Y(b)); });
    ctx.stroke();
  }
  if (torNow) {
    const [x, y, t] = torNow.track[torNow.track.length - 1], [a, b] = ground(x, y, t);
    ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(X(a), Y(b) - 11); ctx.lineTo(X(a) + 10, Y(b) + 7); ctx.lineTo(X(a) - 10, Y(b) + 7); ctx.closePath(); ctx.stroke();
  }

  // scale bar, north arrow, legend
  ctx.fillStyle = '#dfe6e3'; ctx.font = '11px "JetBrains Mono", monospace';
  ctx.textAlign = 'right'; ctx.fillText('N ↑', w - 10, 44); ctx.textAlign = 'left';
  const barMi = m * 120 / MI > 20 ? 50 : m * 120 / MI > 8 ? 20 : 10, barPx = barMi * MI / m;
  ctx.strokeStyle = '#dfe6e3'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(12, h - 12); ctx.lineTo(12 + barPx, h - 12); ctx.stroke();
  ctx.fillText(`${barMi} mi`, 14, h - 18);
  ctx.font = '10px "JetBrains Mono", monospace';
  if (prod === 'hail') {
    const bw = 18, lx = w - HAILC.length * bw - 12, ly = h - 26;
    HAILC.forEach(([, col], i) => { ctx.fillStyle = `rgb(${col.join(',')})`; ctx.fillRect(lx + i * bw, ly, bw, 8); });
    ctx.fillStyle = '#dfe6e3'; ctx.textAlign = 'center';
    HAILC.forEach(([, , l], i) => ctx.fillText(l, lx + i * bw + 2, ly + 19));
    ctx.textAlign = 'right'; ctx.fillText('in', lx - 4, ly + 8);
  } else {
    const n = prod === 'dbz' ? 14 : VEL.length, bw = 13, lx = w - n * bw - 12, ly = h - 26;
    for (let i = 0; i < n; i++) { ctx.fillStyle = prod === 'dbz' ? NWS[i] : `rgb(${VEL[i][1].join(',')})`; ctx.fillRect(lx + i * bw, ly, bw, 8); }
    ctx.fillStyle = '#dfe6e3'; ctx.textAlign = 'center';
    if (prod === 'dbz') for (const v of [5, 25, 45, 65]) ctx.fillText(String(v), lx + (v - 5) / 5 * bw, ly + 19);
    else { ctx.fillText('−50', lx + bw, ly + 19); ctx.fillText('0', lx + 6 * bw, ly + 19); ctx.fillText('+50 kt', lx + 11 * bw, ly + 19); }
  }
  ctx.textAlign = 'left';
  const when = `${Math.round(fr.t / 60)} min`, how = 'drag, scroll to zoom, double-click: storm';
  if (prod === 'hail') return `Hail swath · ${when} · ${how}`;
  return prod === 'dbz' ? `Reflectivity · ${when}${torNow ? ' · ▲ tornado' : ''} · ${how}` : `Storm-relative velocity · ${when} · ${how}`;
}

/** Ground position (m) of a storm-frame point (m) at model time t (s), for centring the map on the storm. */
export const toGround = (fr: DiagFrame, x: number, y: number): [number, number] => [x + fr.cu * fr.t, y + fr.cv * fr.t];
