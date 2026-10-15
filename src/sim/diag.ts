/**
 * Simulation diagnostics: per-column fields (CPU version of the DIAG kernel), domain summaries, and a tornado
 * tracker driven by the simulated near-ground rotation.
 */
import { type BaseState } from './base';
import { type GridSpec } from './grid';
import { type SimFields } from './model-cpu';

/** values per column; must match ND in model-gpu.ts */
export const ND = 10;
export const D = { dbz: 0, u: 1, v: 2, wmax: 3, zeta0: 4, zeta1: 5, w1: 6, thp0: 7, rain: 8, comp: 9 } as const;

/** CPU implementation of the DIAG kernel. */
export function diagCPU(g: GridSpec, b: BaseState, f: SimFields): Float32Array {
  const { NX, NY, NZ } = g, plane = NX * NY, out = new Float32Array(plane * ND);
  const uAt = (i: number, j: number, k: number) => f.u[(k * NY + j) * (NX + 1) + i];
  const vAt = (i: number, j: number, k: number) => f.v[(k * (NY + 1) + j) * NX + i];
  const zeta = (i: number, j: number, k: number) => (i === 0 || j === 0) ? 0 : (vAt(i, j, k) - vAt(i - 1, j, k)) / g.dx - (uAt(i, j, k) - uAt(i, j - 1, k)) / g.dy;
  const dbz = (c: number, k: number) => { const rq = b.rho0[k] * Math.max(f.qr[c], 0) * 1000; return rq < 1e-3 ? -99 : 43.1 + 17.5 * Math.log10(rq); };
  const kl = Math.min(Math.floor(600 / g.dz), NZ - 1), k1 = Math.min(Math.floor(1000 / g.dz), NZ - 1);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const c2 = j * NX + i, o = c2 * ND;
    let wmax = 0, comp = -99;
    for (let k = 0; k < NZ; k++) { wmax = Math.max(wmax, f.w[k * plane + c2]); comp = Math.max(comp, dbz(k * plane + c2, k)); }
    out[o] = dbz(kl * plane + c2, kl);
    out[o + 1] = 0.5 * (uAt(i, j, kl) + uAt(i + 1, j, kl));
    out[o + 2] = 0.5 * (vAt(i, j, kl) + vAt(i, j + 1, kl));
    out[o + 3] = wmax;
    out[o + 4] = zeta(i, j, 0);
    out[o + 5] = zeta(i, j, k1);
    out[o + 6] = f.w[k1 * plane + c2];
    out[o + 7] = f.th[c2] - b.th0[0];
    out[o + 8] = f.rain[c2];
    out[o + 9] = comp;
  }
  return out;
}

export interface SimSummary {
  /** model time, s */
  t: number;
  wmax: number;
  /** strongest vertical vorticity near the ground and at about 1 km, 1/s */
  zeta0: number; zeta1: number;
  /** coldest surface air relative to the environment, K */
  coldPool: number;
  dbzMax: number;
  /** most rain at any point, mm */
  rainMax: number;
  /** column of the strongest updraft, cells */
  upI: number; upJ: number;
}

export function summarize(t: number, g: GridSpec, d: Float32Array): SimSummary {
  const n = g.NX * g.NY;
  const s: SimSummary = { t, wmax: 0, zeta0: 0, zeta1: 0, coldPool: 0, dbzMax: -99, rainMax: 0, upI: 0, upJ: 0 };
  for (let c = 0; c < n; c++) {
    const o = c * ND;
    if (d[o + D.wmax] > s.wmax) { s.wmax = d[o + D.wmax]; s.upI = c % g.NX; s.upJ = Math.floor(c / g.NX); }
    s.zeta0 = Math.max(s.zeta0, d[o + D.zeta0]); s.zeta1 = Math.max(s.zeta1, d[o + D.zeta1]);
    s.coldPool = Math.min(s.coldPool, d[o + D.thp0]); s.dbzMax = Math.max(s.dbzMax, d[o + D.comp]);
    s.rainMax = Math.max(s.rainMax, d[o + D.rain]);
  }
  return s;
}

export interface TornadoEvent {
  /** model times, s (end null while on the ground) */
  start: number; end: number | null;
  /** estimated peak ground-relative wind, m/s, so far */
  peak: number;
  /** current estimate, m/s */
  now: number;
  /** storm-relative position (m from the domain's south-west corner) and model time, along the path */
  track: [number, number, number][];
}

/**
 * Tornado tracker. A 1-2 km grid can't resolve a tornado, but it does resolve the parent near-ground circulation.
 * A "tornado" is declared when strong near-ground rotation sits under a low-level updraft (the stretching that
 * concentrates it) for at least a minute, and ends when that rotation weakens. Intensity is an estimate scaled from
 * the resolved rotation, not a simulated wind.
 */
export class TornadoTracker {
  events: TornadoEvent[] = [];
  private since: number | null = null;
  constructor(private g: GridSpec) {}

  /** grid-adjusted vorticity: coarser grids smooth rotation out, so scale toward the 1 km equivalent */
  private eff(z: number): number { return z * Math.min(2.5, this.g.dx / 1000); }

  update(t: number, d: Float32Array): TornadoEvent | null {
    const g = this.g;
    let best = 0, bi = 0, bj = 0;
    for (let j = 2; j < g.NY - 2; j++) for (let i = 2; i < g.NX - 2; i++) {
      const z0 = d[(j * g.NX + i) * ND + D.zeta0];
      if (z0 <= best) continue;
      // an updraft of at least 3 m/s at 1 km within one cell
      let up = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) up = Math.max(up, d[((j + dj) * g.NX + i + di) * ND + D.w1]);
      if (up >= 3) { best = z0; bi = i; bj = j; }
    }
    const z = this.eff(best), cur = this.events.length ? this.events[this.events.length - 1] : null, active = cur && cur.end === null ? cur : null;
    const V = Math.min(105, 20 + 2500 * Math.max(0, z - 0.008));
    const pos: [number, number, number] = [bi * g.dx, bj * g.dy, t];
    if (active) {
      if (z < 0.008) { active.end = t; this.since = null; return null; }
      active.now = V; active.peak = Math.max(active.peak, V); active.track.push(pos);
      return active;
    }
    // must persist for a minute of model time
    if (z >= 0.012) { if (this.since === null) this.since = t; } else this.since = null;
    if (this.since !== null && t - this.since >= 60) {
      const ev: TornadoEvent = { start: this.since, end: null, peak: V, now: V, track: [pos] };
      this.events.push(ev); this.since = null;
      return ev;
    }
    return null;
  }
}
