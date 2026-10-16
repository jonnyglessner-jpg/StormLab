/**
 * CPU reference implementation of the cloud model. The WebGPU kernels mirror this code step for step; tests run
 * both and compare. Physics:
 *   - anelastic equations on a C grid, storm-following frame
 *   - semi-Lagrangian advection with MacCormack correction and a min/max limiter
 *   - buoyancy from potential temperature, water vapour and condensate loading
 *   - six-class bulk microphysics with ice and hail (micro.ts): Kessler warm rain, LFO-type ice, snow and hail,
 *     mixed-phase saturation adjustment, and sedimentation of rain, snow and hail
 *   - constant eddy diffusion, lateral sponge, Rayleigh damping aloft
 *   - pressure projection enforcing div(rho0 u) = 0, solved by red-black vertical-line relaxation
 */
import { type BaseState } from './base';
import { layouts, nC, nU, nV, nW, type GridSpec, type Layout } from './grid';
import { MP } from './micro';
import { C, DEFAULT_PARAMS, type Bubble, type Nudge, type SimParams } from './params';

export interface SimFields {
  u: Float32Array; v: Float32Array; w: Float32Array;
  th: Float32Array; qv: Float32Array; qc: Float32Array; qr: Float32Array;
  /** cloud ice, snow and hail mixing ratios, kg/kg */
  qi: Float32Array; qs: Float32Array; qh: Float32Array;
  /** pressure variable p'/rho0 (m^2/s^2) */
  phi: Float32Array;
  /** accumulated surface rain (including melted snow), mm */
  rain: Float32Array;
  /** accumulated surface hail, mm of water */
  hail: Float32Array;
}

export const qsatT = (T: number, p: number): number => {
  const es = 610.78 * Math.exp(17.27 * (T - 273.16) / (T - 35.86));
  return C.eps * es / Math.max(p - es, 1);
};

export class SimCPU {
  readonly g: GridSpec;
  readonly b: BaseState;
  readonly p: SimParams;
  f: SimFields;
  t = 0;
  nudgeCfg: Nudge | null = null;
  private L: ReturnType<typeof layouts>;
  private tmpA: Float32Array; private tmpB: Float32Array;
  private div: Float32Array;

  constructor(g: GridSpec, base: BaseState, params: Partial<SimParams> = {}) {
    this.g = g; this.b = base; this.p = { ...DEFAULT_PARAMS, ...params };
    this.L = layouts(g);
    const N = nC(g);
    this.f = {
      u: new Float32Array(nU(g)), v: new Float32Array(nV(g)), w: new Float32Array(nW(g)),
      th: new Float32Array(N), qv: new Float32Array(N), qc: new Float32Array(N), qr: new Float32Array(N),
      qi: new Float32Array(N), qs: new Float32Array(N), qh: new Float32Array(N),
      phi: new Float32Array(N), rain: new Float32Array(g.NX * g.NY), hail: new Float32Array(g.NX * g.NY)
    };
    const big = Math.max(nU(g), nV(g), nW(g));
    this.tmpA = new Float32Array(big); this.tmpB = new Float32Array(big);
    this.div = new Float32Array(N);
    this.reset();
  }

  /** Fill every field with the base state. */
  reset(): void {
    const { g, b, f } = this;
    for (let k = 0; k < g.NZ; k++) for (let j = 0; j < g.NY; j++) {
      for (let i = 0; i <= g.NX; i++) f.u[(k * g.NY + j) * (g.NX + 1) + i] = b.u0[k];
      for (let i = 0; i < g.NX; i++) {
        const c = (k * g.NY + j) * g.NX + i;
        f.th[c] = b.th0[k]; f.qv[c] = b.qv0[k]; f.qc[c] = 0; f.qr[c] = 0; f.qi[c] = 0; f.qs[c] = 0; f.qh[c] = 0; f.phi[c] = 0;
      }
    }
    for (let k = 0; k < g.NZ; k++) for (let j = 0; j <= g.NY; j++) for (let i = 0; i < g.NX; i++) f.v[(k * (g.NY + 1) + j) * g.NX + i] = b.v0[k];
    f.w.fill(0); f.rain.fill(0); f.hail.fill(0);
    this.t = 0;
  }

  /** Warm bubble (cosine-squared), keeping the relative humidity of the environment. */
  addBubble(bb: Bubble): void {
    const { g, b, f } = this;
    for (let k = 0; k < g.NZ; k++) for (let j = 0; j < g.NY; j++) for (let i = 0; i < g.NX; i++) {
      const x = (i + 0.5) * g.dx, y = (j + 0.5) * g.dy, z = (k + 0.5) * g.dz;
      const r = Math.hypot((x - bb.x) / bb.rh, (y - bb.y) / bb.rh, (z - bb.z) / bb.rz);
      if (r >= 1) continue;
      const c = (k * g.NY + j) * g.NX + i, d = bb.dth * Math.cos(Math.PI / 2 * r) ** 2;
      const T0 = b.th0[k] * b.pi0[k], rh = b.qv0[k] / qsatT(T0, b.p0[k]);
      f.th[c] = b.th0[k] + d;
      const qs = qsatT((b.th0[k] + d) * b.pi0[k], b.p0[k]);
      f.qv[c] = bb.moist ? Math.max(b.qv0[k], b.qv0[k] + (Math.min(b.qv0[0], qs) - b.qv0[k]) * Math.cos(Math.PI / 2 * r) ** 2) : rh * qs;
    }
  }

  /* ---------- sampling helpers ---------- */
  private sample(a: Float32Array, L: Layout, x: number, y: number, z: number): number {
    const g = this.g;
    let fx = x / g.dx - L.ox, fy = y / g.dy - L.oy, fz = z / g.dz - L.oz;
    fx = Math.min(Math.max(fx, 0), L.nx - 1.0001); fy = Math.min(Math.max(fy, 0), L.ny - 1.0001); fz = Math.min(Math.max(fz, 0), L.nz - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), tx = fx - i, ty = fy - j, tz = fz - k;
    const sx = 1, sy = L.nx, sz = L.nx * L.ny, o = k * sz + j * sy + i;
    const c00 = a[o] + (a[o + sx] - a[o]) * tx, c10 = a[o + sy] + (a[o + sy + sx] - a[o + sy]) * tx;
    const c01 = a[o + sz] + (a[o + sz + sx] - a[o + sz]) * tx, c11 = a[o + sz + sy] + (a[o + sz + sy + sx] - a[o + sz + sy]) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
    return c0 + (c1 - c0) * tz;
  }
  /** min and max of the 8 grid values around a point (for the MacCormack limiter) */
  private bounds(a: Float32Array, L: Layout, x: number, y: number, z: number, out: number[]): void {
    const g = this.g;
    let fx = x / g.dx - L.ox, fy = y / g.dy - L.oy, fz = z / g.dz - L.oz;
    fx = Math.min(Math.max(fx, 0), L.nx - 1.0001); fy = Math.min(Math.max(fy, 0), L.ny - 1.0001); fz = Math.min(Math.max(fz, 0), L.nz - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), sy = L.nx, sz = L.nx * L.ny, o = k * sz + j * sy + i;
    const v0 = a[o], v1 = a[o + 1], v2 = a[o + sy], v3 = a[o + sy + 1], v4 = a[o + sz], v5 = a[o + sz + 1], v6 = a[o + sz + sy], v7 = a[o + sz + sy + 1];
    out[0] = Math.min(v0, v1, v2, v3, v4, v5, v6, v7); out[1] = Math.max(v0, v1, v2, v3, v4, v5, v6, v7);
  }
  private vel(x: number, y: number, z: number, o: number[]): void {
    const { L, f } = this;
    o[0] = this.sample(f.u, L.u, x, y, z); o[1] = this.sample(f.v, L.v, x, y, z); o[2] = this.sample(f.w, L.w, x, y, z);
  }
  /** departure point of a parcel arriving at (x,y,z) after time s (negative s traces forward), RK2 */
  private vtmp = [0, 0, 0];
  private depart(x: number, y: number, z: number, s: number, o: number[]): void {
    const v = this.vtmp;
    this.vel(x, y, z, v);
    const xm = x - 0.5 * s * v[0], ym = y - 0.5 * s * v[1], zm = z - 0.5 * s * v[2];
    this.vel(xm, ym, zm, v);
    o[0] = x - s * v[0]; o[1] = y - s * v[1]; o[2] = Math.min(Math.max(z - s * v[2], 0), this.g.NZ * this.g.dz);
  }

  /* ---------- advection ---------- */
  /**
   * Departure points for every point of a layout, forward (s = dt) and backward (s = -dt), using the velocity at
   * the start of the step. All seven scalars share the cell-centre layout, so they share one set.
   */
  private depBuf = new Map<Layout, { f: Float64Array; b: Float64Array }>();
  private departures(L: Layout): { f: Float64Array; b: Float64Array } {
    const g = this.g, dt = this.p.dt, n = L.nx * L.ny * L.nz, d = [0, 0, 0];
    let buf = this.depBuf.get(L);
    if (!buf) { buf = { f: new Float64Array(3 * n), b: new Float64Array(3 * n) }; this.depBuf.set(L, buf); }
    const F = buf.f, B = buf.b;
    for (let k = 0; k < L.nz; k++) for (let j = 0; j < L.ny; j++) for (let i = 0; i < L.nx; i++) {
      const c = (k * L.ny + j) * L.nx + i, x = (i + L.ox) * g.dx, y = (j + L.oy) * g.dy, z = (k + L.oz) * g.dz;
      this.depart(x, y, z, dt, d); F[3 * c] = d[0]; F[3 * c + 1] = d[1]; F[3 * c + 2] = d[2];
      this.depart(x, y, z, -dt, d); B[3 * c] = d[0]; B[3 * c + 1] = d[1]; B[3 * c + 2] = d[2];
    }
    return buf;
  }
  /** MacCormack semi-Lagrangian advection of one field (in place), with precomputed departure points. */
  private advect(a: Float32Array, L: Layout, dep: { f: Float64Array; b: Float64Array }): void {
    const fwd = this.tmpA, out = this.tmpB, n = L.nx * L.ny * L.nz, F = dep.f, B = dep.b, bnd = [0, 0];
    for (let c = 0; c < n; c++) fwd[c] = this.sample(a, L, F[3 * c], F[3 * c + 1], F[3 * c + 2]);
    for (let c = 0; c < n; c++) {
      const back = this.sample(fwd, L, B[3 * c], B[3 * c + 1], B[3 * c + 2]);
      const v = fwd[c] + 0.5 * (a[c] - back);
      this.bounds(a, L, F[3 * c], F[3 * c + 1], F[3 * c + 2], bnd);
      out[c] = Math.min(Math.max(v, bnd[0]), bnd[1]);
    }
    a.set(out.subarray(0, n));
  }

  /* ---------- microphysics ---------- */
  private ms = new Float64Array(7);
  private vt = new Float64Array(3);
  private microphysics(): void {
    const { g, b, f, p } = this, dt = p.dt, plane = g.NX * g.NY, rhoS = b.rho0[0], s = this.ms;
    for (let k = 0; k < g.NZ; k++) {
      const pi = b.pi0[k], pr = b.p0[k], rho = b.rho0[k];
      for (let c = k * plane; c < (k + 1) * plane; c++) {
        s[0] = f.th[c]; s[1] = f.qv[c]; s[2] = f.qc[c]; s[3] = f.qr[c]; s[4] = f.qi[c]; s[5] = f.qs[c]; s[6] = f.qh[c];
        MP.micro(s, pi, pr, rho, rhoS, dt, p.k1, p.qcCrit, p.k2);
        f.th[c] = s[0]; f.qv[c] = s[1]; f.qc[c] = s[2]; f.qr[c] = s[3]; f.qi[c] = s[4]; f.qs[c] = s[5]; f.qh[c] = s[6];
      }
    }
    this.sediment();
  }

  /**
   * Sedimentation of rain, snow and hail, column by column: upwind flux form, with as many sub-steps as the
   * column's fastest fall speed needs to keep the Courant number under 0.8. Melted snow counts as rain at the ground.
   */
  private sediment(): void {
    const { g, b, f, p } = this, plane = g.NX * g.NY, rhoS = b.rho0[0], vt = this.vt, dz = g.dz;
    for (let c2 = 0; c2 < plane; c2++) {
      let vmax = 0;
      for (let k = 0; k < g.NZ; k++) {
        const c = k * plane + c2;
        MP.vterm(f.qr[c], f.qs[c], f.qh[c], b.rho0[k], rhoS, vt);
        vmax = Math.max(vmax, vt[0], vt[1], vt[2]);
      }
      const ns = Math.max(1, Math.ceil(vmax * p.dt / (0.8 * dz))), h = p.dt / ns;
      for (let n = 0; n < ns; n++) {
        let fr = 0, fs = 0, fh = 0;
        for (let k = g.NZ - 1; k >= 0; k--) {
          const c = k * plane + c2, rho = b.rho0[k], qr = f.qr[c], qs = f.qs[c], qh = f.qh[c];
          MP.vterm(qr, qs, qh, rho, rhoS, vt);
          const kr = rho * qr * vt[0], ks = rho * qs * vt[1], kh = rho * qh * vt[2], m = h / (rho * dz);
          f.qr[c] = Math.max(0, qr + m * (fr - kr)); f.qs[c] = Math.max(0, qs + m * (fs - ks)); f.qh[c] = Math.max(0, qh + m * (fh - kh));
          fr = kr; fs = ks; fh = kh;
        }
        f.rain[c2] += (fr + fs) * h; f.hail[c2] += fh * h;     // kg/m^2 = mm
      }
    }
  }

  /* ---------- forcing: buoyancy, diffusion, sponges ---------- */
  private forcing(): void {
    const { g, b, f, p } = this, dt = p.dt, plane = g.NX * g.NY;
    // buoyancy on interior w levels
    for (let k = 1; k < g.NZ; k++) for (let c2 = 0; c2 < plane; c2++) {
      const lo = (k - 1) * plane + c2, hi = k * plane + c2;
      const B = (cc: number, kk: number) => C.g * ((f.th[cc] - b.th0[kk]) / b.th0[kk] + 0.608 * (f.qv[cc] - b.qv0[kk]) - f.qc[cc] - f.qr[cc] - f.qi[cc] - f.qs[cc] - f.qh[cc]);
      f.w[k * plane + c2] += dt * 0.5 * (B(lo, k - 1) + B(hi, k));
    }
    // diffusion of perturbations from the base state (explicit, conservative enough at these K)
    this.diffuse(f.u, this.L.u, b.u0);
    this.diffuse(f.v, this.L.v, b.v0);
    this.diffuse(f.w, this.L.w, null);
    this.diffuse(f.th, this.L.c, b.th0);
    this.diffuse(f.qv, this.L.c, b.qv0);
    this.diffuse(f.qc, this.L.c, null);
    this.diffuse(f.qr, this.L.c, null);
    this.diffuse(f.qi, this.L.c, null);
    this.diffuse(f.qs, this.L.c, null);
    this.diffuse(f.qh, this.L.c, null);
    // lateral sponge and Rayleigh damping aloft, relaxing toward the base state
    this.relax(f.u, this.L.u, b.u0); this.relax(f.v, this.L.v, b.v0); this.relax(f.w, this.L.w, null);
    this.relax(f.th, this.L.c, b.th0); this.relax(f.qv, this.L.c, b.qv0); this.relax(f.qc, this.L.c, null); this.relax(f.qr, this.L.c, null);
    this.relax(f.qi, this.L.c, null); this.relax(f.qs, this.L.c, null); this.relax(f.qh, this.L.c, null);
    // w = 0 at the ground and the lid
    for (let c2 = 0; c2 < plane; c2++) { f.w[c2] = 0; f.w[g.NZ * plane + c2] = 0; }
  }
  /**
   * Vertical eddy diffusion of the perturbation from the base state, plus a 4th-order horizontal filter
   * (-nu/64 * L(L(a)), L the 5-point Laplacian in grid units), which removes 2-gridpoint noise and leaves the
   * storm-scale flow nearly untouched.
   */
  private diffuse(a: Float32Array, L: Layout, base: Float32Array | null): void {
    const g = this.g, K = this.p.kdiff * this.p.dt, out = this.tmpA, lap = this.tmpB, n = L.nx * L.ny * L.nz;
    const az = K / (g.dz * g.dz), sy = L.nx, sz = L.nx * L.ny, nu = this.p.hyper / 64;
    const bk = (k: number) => base ? base[Math.min(k, base.length - 1)] : 0;
    for (let k = 0; k < L.nz; k++) for (let j = 0; j < L.ny; j++) for (let i = 0; i < L.nx; i++) {
      const c = (k * L.ny + j) * L.nx + i, v = a[c];
      const xm = i > 0 ? a[c - 1] : v, xp = i < L.nx - 1 ? a[c + 1] : v, ym = j > 0 ? a[c - sy] : v, yp = j < L.ny - 1 ? a[c + sy] : v;
      lap[c] = xm + xp + ym + yp - 4 * v;
    }
    for (let k = 0; k < L.nz; k++) for (let j = 0; j < L.ny; j++) for (let i = 0; i < L.nx; i++) {
      const c = (k * L.ny + j) * L.nx + i, v = a[c], l = lap[c];
      const xm = i > 0 ? lap[c - 1] : l, xp = i < L.nx - 1 ? lap[c + 1] : l, ym = j > 0 ? lap[c - sy] : l, yp = j < L.ny - 1 ? lap[c + sy] : l;
      const p0 = v - bk(k), zm = k > 0 ? a[c - sz] - bk(k - 1) : p0, zp = k < L.nz - 1 ? a[c + sz] - bk(k + 1) : p0;
      out[c] = v - nu * (xm + xp + ym + yp - 4 * l) + az * (zm + zp - 2 * p0);
    }
    a.set(out.subarray(0, n));
  }
  private relax(a: Float32Array, L: Layout, base: Float32Array | null): void {
    const g = this.g, p = this.p, dt = p.dt, ns = p.spongeCells, ztop = g.NZ * g.dz;
    for (let k = 0; k < L.nz; k++) {
      const z = (k + L.oz) * g.dz;
      const rz = z > p.dampZ ? Math.sin(Math.PI / 2 * (z - p.dampZ) / (ztop - p.dampZ)) ** 2 / p.dampTau : 0;
      const target = base ? base[Math.min(k, base.length - 1)] : 0;
      for (let j = 0; j < L.ny; j++) {
        const yj = j + L.oy, dy = Math.min(yj, g.NY - yj);          // distance to the nearest edge, in cells
        for (let i = 0; i < L.nx; i++) {
          const xi = i + L.ox, dx = Math.min(xi, g.NX - xi), d = Math.min(dx, dy);
          const rs = d < ns ? (1 - d / ns) ** 2 / p.spongeTau : 0, r = Math.min(1, (rs + rz) * dt);
          if (r > 0) { const c = (k * L.ny + j) * L.nx + i; a[c] += (target - a[c]) * r; }
        }
      }
    }
  }

  /* ---------- pressure projection ---------- */
  private project(): void {
    const { g, b, f, p } = this, dt = p.dt, NX = g.NX, NY = g.NY, NZ = g.NZ, plane = NX * NY;
    const idx2 = 1 / (g.dx * g.dx), idy2 = 1 / (g.dy * g.dy), idz2 = 1 / (g.dz * g.dz);
    // right-hand side: div(rho0 u*) / dt
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const c = k * plane + j * NX + i, r = b.rho0[k];
      const du = f.u[(k * NY + j) * (NX + 1) + i + 1] - f.u[(k * NY + j) * (NX + 1) + i];
      const dv = f.v[(k * (NY + 1) + j + 1) * NX + i] - f.v[(k * (NY + 1) + j) * NX + i];
      const dw = b.rhoW[k + 1] * f.w[(k + 1) * plane + j * NX + i] - b.rhoW[k] * f.w[k * plane + j * NX + i];
      this.div[c] = (r * (du / g.dx + dv / g.dy) + dw / g.dz) / dt;
    }
    // red-black vertical-line relaxation (each column solved exactly with Thomas' algorithm)
    const aa = new Float64Array(NZ), bb = new Float64Array(NZ), cc = new Float64Array(NZ), rr = new Float64Array(NZ), sol = new Float64Array(NZ);
    const phi = f.phi;
    for (let it = 0; it < p.pIters; it++) for (let color = 0; color < 2; color++) {
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        if (((i + j) & 1) !== color) continue;
        for (let k = 0; k < NZ; k++) {
          const c = k * plane + j * NX + i, r = b.rho0[k];
          const nb = (i > 0 ? phi[c - 1] : 0) + (i < NX - 1 ? phi[c + 1] : 0);
          const nbY = (j > 0 ? phi[c - NX] : 0) + (j < NY - 1 ? phi[c + NX] : 0);
          aa[k] = k > 0 ? b.rhoW[k] * idz2 : 0;
          cc[k] = k < NZ - 1 ? b.rhoW[k + 1] * idz2 : 0;
          bb[k] = -(aa[k] + cc[k]) - 2 * r * (idx2 + idy2);
          rr[k] = this.div[c] - r * idx2 * nb - r * idy2 * nbY;
        }
        // Thomas algorithm
        for (let k = 1; k < NZ; k++) { const m = aa[k] / bb[k - 1]; bb[k] -= m * cc[k - 1]; rr[k] -= m * rr[k - 1]; }
        sol[NZ - 1] = rr[NZ - 1] / bb[NZ - 1];
        for (let k = NZ - 2; k >= 0; k--) sol[k] = (rr[k] - cc[k] * sol[k + 1]) / bb[k];
        for (let k = 0; k < NZ; k++) { const c = k * plane + j * NX + i; phi[c] += p.omega * (sol[k] - phi[c]); }
      }
    }
    // subtract the pressure gradient
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i <= NX; i++) {
      const pl = i > 0 ? phi[k * plane + j * NX + i - 1] : 0, pr = i < NX ? phi[k * plane + j * NX + i] : 0;
      f.u[(k * NY + j) * (NX + 1) + i] -= dt * (pr - pl) / g.dx;
    }
    for (let k = 0; k < NZ; k++) for (let j = 0; j <= NY; j++) for (let i = 0; i < NX; i++) {
      const ps = j > 0 ? phi[k * plane + (j - 1) * NX + i] : 0, pn = j < NY ? phi[k * plane + j * NX + i] : 0;
      f.v[(k * (NY + 1) + j) * NX + i] -= dt * (pn - ps) / g.dy;
    }
    for (let k = 1; k < NZ; k++) for (let c2 = 0; c2 < plane; c2++) {
      f.w[k * plane + c2] -= dt * (phi[k * plane + c2] - phi[(k - 1) * plane + c2]) / g.dz;
    }
  }

  /** Residual divergence max |div(rho0 u)| / rho0 (1/s), for tests. */
  maxDivergence(): number {
    const { g, b, f } = this, NX = g.NX, NY = g.NY, plane = NX * NY;
    let m = 0;
    for (let k = 0; k < g.NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const du = f.u[(k * NY + j) * (NX + 1) + i + 1] - f.u[(k * NY + j) * (NX + 1) + i];
      const dv = f.v[(k * (NY + 1) + j + 1) * NX + i] - f.v[(k * (NY + 1) + j) * NX + i];
      const dw = b.rhoW[k + 1] * f.w[(k + 1) * plane + j * NX + i] - b.rhoW[k] * f.w[k * plane + j * NX + i];
      m = Math.max(m, Math.abs((b.rho0[k] * (du / g.dx + dv / g.dy) + dw / g.dz) / b.rho0[k]));
    }
    return m;
  }

  /** Updraft nudging on w levels while t < tEnd. */
  private nudge(): void {
    const n = this.nudgeCfg, g = this.g, f = this.f;
    if (!n || this.t >= n.tEnd) return;
    const a = Math.min(1, this.p.dt / n.tau), plane = g.NX * g.NY;
    for (let k = 1; k < g.NZ; k++) for (let j = 0; j < g.NY; j++) for (let i = 0; i < g.NX; i++) {
      const x = (i + 0.5) * g.dx, y = (j + 0.5) * g.dy, z = k * g.dz;
      const r = Math.hypot((x - n.x) / n.rh, (y - n.y) / n.rh, (z - n.z) / n.rz);
      if (r >= 1) continue;
      const sh = Math.cos(Math.PI / 2 * r) ** 2, c = k * plane + j * g.NX + i;
      f.w[c] += a * sh * (n.wmax * sh - f.w[c]);
    }
  }

  /** Advance one time step. */
  step(): void {
    const { f, L } = this;
    // advect with the velocity at the start of the step: departure points first, then every field
    const dc = this.departures(L.c), du = this.departures(L.u), dv = this.departures(L.v), dw = this.departures(L.w);
    for (const a of [f.th, f.qv, f.qc, f.qr, f.qi, f.qs, f.qh]) this.advect(a, L.c, dc);
    this.advect(f.u, L.u, du); this.advect(f.v, L.v, dv); this.advect(f.w, L.w, dw);
    this.microphysics();
    this.forcing();
    this.nudge();
    this.project();
    this.t += this.p.dt;
  }
}
