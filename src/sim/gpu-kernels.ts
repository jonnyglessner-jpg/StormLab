/**
 * WGSL compute kernels for the cloud model. Each mirrors the matching method of SimCPU (model-cpu.ts).
 * Shared uniform P:
 *   n = (NX, NY, NZ, -)        d = (dx, dy, dz, dt)          k = (kdiff, k1, qcCrit, k2)
 *   s = (spongeCells, spongeTau, dampZ, dampTau)            m = (omega, rhoSurface, hyper, -)
 * Per-dispatch uniform Lay (field layout):
 *   n = (nx, ny, nz, baseField+1 or 0)   o = (ox, oy, oz, isW)
 * Base-state buffer: base[f * 65 + k] with f = 0 th0, 1 qv0, 2 pi0, 3 rho0, 4 p0, 5 u0, 6 v0, 7 rhoW (k <= NZ).
 */

const HEAD = /* wgsl */`
struct Params { n: vec4u, d: vec4f, k: vec4f, s: vec4f, m: vec4f };
struct Lay { n: vec4u, o: vec4f };
const BS: u32 = 65u;
fn cIndex(i: u32, j: u32, k: u32) -> u32 { return (k * P.n.y + j) * P.n.x + i; }
`;

/** Trilinear sampler and min/max bounds for one buffer with a given layout expression. */
function sampler(name: string, buf: string, dims: string, off: string): string {
  return /* wgsl */`
fn ${name}_idx(x: f32, y: f32, z: f32) -> vec4f {
  let dm = ${dims}; let ofs = ${off};
  let fx = clamp(x / P.d.x - ofs.x, 0.0, f32(dm.x) - 1.0001);
  let fy = clamp(y / P.d.y - ofs.y, 0.0, f32(dm.y) - 1.0001);
  let fz = clamp(z / P.d.z - ofs.z, 0.0, f32(dm.z) - 1.0001);
  return vec4f(fx, fy, fz, 0.0);
}
fn ${name}(x: f32, y: f32, z: f32) -> f32 {
  let dm = ${dims}; let f = ${name}_idx(x, y, z);
  let i = u32(floor(f.x)); let j = u32(floor(f.y)); let k = u32(floor(f.z));
  let tx = f.x - f32(i); let ty = f.y - f32(j); let tz = f.z - f32(k);
  let sy = dm.x; let sz = dm.x * dm.y; let o = k * sz + j * sy + i;
  let c00 = mix(${buf}[o], ${buf}[o + 1u], tx);           let c10 = mix(${buf}[o + sy], ${buf}[o + sy + 1u], tx);
  let c01 = mix(${buf}[o + sz], ${buf}[o + sz + 1u], tx); let c11 = mix(${buf}[o + sz + sy], ${buf}[o + sz + sy + 1u], tx);
  return mix(mix(c00, c10, ty), mix(c01, c11, ty), tz);
}
fn ${name}_bounds(x: f32, y: f32, z: f32) -> vec2f {
  let dm = ${dims}; let f = ${name}_idx(x, y, z);
  let i = u32(floor(f.x)); let j = u32(floor(f.y)); let k = u32(floor(f.z));
  let sy = dm.x; let sz = dm.x * dm.y; let o = k * sz + j * sy + i;
  var mn = ${buf}[o]; var mx = ${buf}[o];
  for (var q = 1u; q < 8u; q++) {
    let v = ${buf}[o + select(0u, 1u, (q & 1u) != 0u) + select(0u, sy, (q & 2u) != 0u) + select(0u, sz, (q & 4u) != 0u)];
    mn = min(mn, v); mx = max(mx, v);
  }
  return vec2f(mn, mx);
}`;
}

const VEL = /* wgsl */`
${sampler('sU', 'U', 'vec3u(P.n.x + 1u, P.n.y, P.n.z)', 'vec3f(0.0, 0.5, 0.5)')}
${sampler('sV', 'V', 'vec3u(P.n.x, P.n.y + 1u, P.n.z)', 'vec3f(0.5, 0.0, 0.5)')}
${sampler('sW', 'W', 'vec3u(P.n.x, P.n.y, P.n.z + 1u)', 'vec3f(0.5, 0.5, 0.0)')}
fn vel(p: vec3f) -> vec3f { return vec3f(sU(p.x, p.y, p.z), sV(p.x, p.y, p.z), sW(p.x, p.y, p.z)); }
fn depart(p: vec3f, s: f32) -> vec3f {
  let v1 = vel(p);
  let pm = p - 0.5 * s * v1;
  let v2 = vel(pm);
  var d = p - s * v2;
  d.z = clamp(d.z, 0.0, f32(P.n.z) * P.d.z);
  return d;
}`;

const LAYPOS = /* wgsl */`
fn layPos(id: vec3u) -> vec3f { return vec3f((f32(id.x) + L.o.x) * P.d.x, (f32(id.y) + L.o.y) * P.d.y, (f32(id.z) + L.o.z) * P.d.z); }
fn layIdx(id: vec3u) -> u32 { return (id.z * L.n.y + id.y) * L.n.x + id.x; }
fn inLay(id: vec3u) -> bool { return id.x < L.n.x && id.y < L.n.y && id.z < L.n.z; }`;

/** MacCormack pass 1: forward semi-Lagrangian sample into TMP. */
export const ADV1 = /* wgsl */`${HEAD}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> L: Lay;
@group(0) @binding(2) var<storage, read> U: array<f32>;
@group(0) @binding(3) var<storage, read> V: array<f32>;
@group(0) @binding(4) var<storage, read> W: array<f32>;
@group(0) @binding(5) var<storage, read> SRC: array<f32>;
@group(0) @binding(6) var<storage, read_write> TMP: array<f32>;
${VEL}
${sampler('sSrc', 'SRC', 'L.n.xyz', 'L.o.xyz')}
${LAYPOS}
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (!inLay(id)) { return; }
  let d = depart(layPos(id), P.d.w);
  TMP[layIdx(id)] = sSrc(d.x, d.y, d.z);
}`;

/** MacCormack pass 2: backward sample of TMP, correction, min/max limiter; result into DST. */
export const ADV2 = /* wgsl */`${HEAD}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> L: Lay;
@group(0) @binding(2) var<storage, read> U: array<f32>;
@group(0) @binding(3) var<storage, read> V: array<f32>;
@group(0) @binding(4) var<storage, read> W: array<f32>;
@group(0) @binding(5) var<storage, read> SRC: array<f32>;
@group(0) @binding(6) var<storage, read> TMP: array<f32>;
@group(0) @binding(7) var<storage, read_write> DST: array<f32>;
${VEL}
${sampler('sSrc', 'SRC', 'L.n.xyz', 'L.o.xyz')}
${sampler('sTmp', 'TMP', 'L.n.xyz', 'L.o.xyz')}
${LAYPOS}
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (!inLay(id)) { return; }
  let p = layPos(id); let c = layIdx(id);
  let db = depart(p, -P.d.w);
  let back = sTmp(db.x, db.y, db.z);
  var v = TMP[c] + 0.5 * (SRC[c] - back);
  let df = depart(p, P.d.w);
  let b = sSrc_bounds(df.x, df.y, df.z);
  DST[c] = clamp(v, b.x, b.y);
}`;

/** Kessler microphysics at cell centres (in place). */
export const MICRO = /* wgsl */`${HEAD}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> BASE: array<f32>;
@group(0) @binding(2) var<storage, read_write> TH: array<f32>;
@group(0) @binding(3) var<storage, read_write> QV: array<f32>;
@group(0) @binding(4) var<storage, read_write> QC: array<f32>;
@group(0) @binding(5) var<storage, read_write> QR: array<f32>;
const LV: f32 = 2.5e6; const CPD: f32 = 1004.0; const RV: f32 = 461.5;
fn qsat(T: f32, p: f32) -> f32 { let es = 610.78 * exp(17.27 * (T - 273.16) / (T - 35.86)); return 0.622 * es / max(p - es, 1.0); }
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.n.x || id.y >= P.n.y || id.z >= P.n.z) { return; }
  let c = cIndex(id.x, id.y, id.z); let k = id.z; let dt = P.d.w;
  let pi = BASE[2u * BS + k]; let pr = BASE[4u * BS + k]; let rho = BASE[3u * BS + k];
  var th = TH[c]; var qv = QV[c]; var qc = max(QC[c], 0.0); var qr = max(QR[c], 0.0);
  let ar = P.k.y * max(qc - P.k.z, 0.0);
  var cr = 0.0; if (qr > 0.0) { cr = P.k.w * qc * pow(qr, 0.875); }
  let dqr = min(qc, dt * (ar + cr));
  qc -= dqr; qr += dqr;
  for (var it = 0; it < 2; it++) {
    let T = th * pi; let qs = qsat(T, pr);
    var dq = (qv - qs) / (1.0 + LV * LV * qs / (CPD * RV * T * T));
    if (dq < 0.0) { dq = max(dq, -qc); }
    qv -= dq; qc += dq; th += LV / (CPD * pi) * dq;
  }
  if (qr > 0.0) {
    let T = th * pi; let qs = qsat(T, pr);
    if (qv < qs) {
      let r = 0.001 * rho; let rq = r * qr;
      let er = (1.6 + 124.9 * pow(rq, 0.2046)) * pow(rq, 0.525) / (2.55e8 / (pr * qs) + 5.4e5) * ((qs - qv) / (r * qs));
      let ern = min(min(dt * er, qr), qs - qv);
      qr -= ern; qv += ern; th -= LV / (CPD * pi) * ern;
    }
  }
  TH[c] = th; QV[c] = qv; QC[c] = qc; QR[c] = qr;
}`;

/** Rain sedimentation, step 1: downward mass flux rho qr Vt. */
export const SEDFLUX = /* wgsl */`${HEAD}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> BASE: array<f32>;
@group(0) @binding(2) var<storage, read> QR: array<f32>;
@group(0) @binding(3) var<storage, read_write> FLUX: array<f32>;
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.n.x || id.y >= P.n.y || id.z >= P.n.z) { return; }
  let c = cIndex(id.x, id.y, id.z); let rho = BASE[3u * BS + id.z]; let qr = QR[c];
  var vt = 0.0;
  if (qr > 1e-9) { vt = 36.34 * pow(0.001 * rho * qr, 0.1364) * sqrt(P.m.y / rho); }
  FLUX[c] = rho * qr * vt;
}`;

/** Rain sedimentation, step 2: flux divergence, and rain reaching the ground. */
export const SEDAPPLY = /* wgsl */`${HEAD}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> BASE: array<f32>;
@group(0) @binding(2) var<storage, read_write> QR: array<f32>;
@group(0) @binding(3) var<storage, read> FLUX: array<f32>;
@group(0) @binding(4) var<storage, read_write> RAIN: array<f32>;
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.n.x || id.y >= P.n.y || id.z >= P.n.z) { return; }
  let plane = P.n.x * P.n.y; let c = cIndex(id.x, id.y, id.z); let c2 = id.y * P.n.x + id.x;
  var above = 0.0; if (id.z < P.n.z - 1u) { above = FLUX[c + plane]; }
  QR[c] = max(0.0, QR[c] + P.d.w * (above - FLUX[c]) / (BASE[3u * BS + id.z] * P.d.z));
  if (id.z == 0u) { RAIN[c2] = RAIN[c2] + FLUX[c] * P.d.w; }
}`;

/** Buoyancy on interior w levels (in place). */
export const BUOY = /* wgsl */`${HEAD}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> BASE: array<f32>;
@group(0) @binding(2) var<storage, read_write> W: array<f32>;
@group(0) @binding(3) var<storage, read> TH: array<f32>;
@group(0) @binding(4) var<storage, read> QV: array<f32>;
@group(0) @binding(5) var<storage, read> QC: array<f32>;
@group(0) @binding(6) var<storage, read> QR: array<f32>;
fn B(c: u32, k: u32) -> f32 {
  let th0 = BASE[k]; let qv0 = BASE[BS + k];
  return 9.81 * ((TH[c] - th0) / th0 + 0.608 * (QV[c] - qv0) - QC[c] - QR[c]);
}
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let k = id.z + 1u;
  if (id.x >= P.n.x || id.y >= P.n.y || k >= P.n.z) { return; }
  let plane = P.n.x * P.n.y; let c2 = id.y * P.n.x + id.x;
  W[k * plane + c2] = W[k * plane + c2] + P.d.w * 0.5 * (B((k - 1u) * plane + c2, k - 1u) + B(k * plane + c2, k));
}`;

/** Horizontal 5-point Laplacian (grid units, zero-gradient edges) of SRC into LAP, for the 4th-order filter. */
export const LAPH = /* wgsl */`${HEAD}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> L: Lay;
@group(0) @binding(2) var<storage, read> SRC: array<f32>;
@group(0) @binding(3) var<storage, read_write> LAP: array<f32>;
${LAYPOS}
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  _ = P.n;   // keep binding 0 in the automatic layout, like every other kernel
  if (!inLay(id)) { return; }
  let c = layIdx(id); let sy = L.n.x; let v = SRC[c];
  var xm = v; if (id.x > 0u) { xm = SRC[c - 1u]; }
  var xp = v; if (id.x < L.n.x - 1u) { xp = SRC[c + 1u]; }
  var ym = v; if (id.y > 0u) { ym = SRC[c - sy]; }
  var yp = v; if (id.y < L.n.y - 1u) { yp = SRC[c + sy]; }
  LAP[c] = xm + xp + ym + yp - 4.0 * v;
}`;

/** 4th-order horizontal filter and vertical diffusion of perturbations, then sponge and Rayleigh damping; SRC -> DST. */
export const DIFFRELAX = /* wgsl */`${HEAD}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> L: Lay;
@group(0) @binding(2) var<storage, read> BASE: array<f32>;
@group(0) @binding(3) var<storage, read> SRC: array<f32>;
@group(0) @binding(4) var<storage, read_write> DST: array<f32>;
@group(0) @binding(5) var<storage, read> LAP: array<f32>;
${LAYPOS}
fn bk(k: u32) -> f32 {
  if (L.n.w == 0u) { return 0.0; }
  return BASE[(L.n.w - 1u) * BS + min(k, P.n.z - 1u)];
}
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (!inLay(id)) { return; }
  let c = layIdx(id); let sy = L.n.x; let sz = L.n.x * L.n.y; let v = SRC[c];
  let K = P.k.x * P.d.w; let az = K / (P.d.z * P.d.z); let nu = P.m.z / 64.0;
  let l = LAP[c];
  var xm = l; if (id.x > 0u) { xm = LAP[c - 1u]; }
  var xp = l; if (id.x < L.n.x - 1u) { xp = LAP[c + 1u]; }
  var ym = l; if (id.y > 0u) { ym = LAP[c - sy]; }
  var yp = l; if (id.y < L.n.y - 1u) { yp = LAP[c + sy]; }
  let p0 = v - bk(id.z);
  var zm = p0; if (id.z > 0u) { zm = SRC[c - sz] - bk(id.z - 1u); }
  var zp = p0; if (id.z < L.n.z - 1u) { zp = SRC[c + sz] - bk(id.z + 1u); }
  var out = v - nu * (xm + xp + ym + yp - 4.0 * l) + az * (zm + zp - 2.0 * p0);
  // relaxation
  let z = (f32(id.z) + L.o.z) * P.d.z; let ztop = f32(P.n.z) * P.d.z;
  var rz = 0.0;
  if (z > P.s.z) { let q = sin(1.5707963 * (z - P.s.z) / (ztop - P.s.z)); rz = q * q / P.s.w; }
  let xi = f32(id.x) + L.o.x; let yj = f32(id.y) + L.o.y;
  let d = min(min(xi, f32(P.n.x) - xi), min(yj, f32(P.n.y) - yj));
  var rs = 0.0; if (d < P.s.x) { let q = 1.0 - d / P.s.x; rs = q * q / P.s.y; }
  let r = min(1.0, (rs + rz) * P.d.w);
  out += (bk(id.z) - out) * r;
  if (L.o.w > 0.5 && (id.z == 0u || id.z == P.n.z)) { out = 0.0; }
  DST[c] = out;
}`;

/** Divergence of rho0 u, divided by dt (right-hand side of the pressure equation). */
export const DIV = /* wgsl */`${HEAD}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> BASE: array<f32>;
@group(0) @binding(2) var<storage, read> U: array<f32>;
@group(0) @binding(3) var<storage, read> V: array<f32>;
@group(0) @binding(4) var<storage, read> W: array<f32>;
@group(0) @binding(5) var<storage, read_write> D: array<f32>;
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.n.x || id.y >= P.n.y || id.z >= P.n.z) { return; }
  let NX = P.n.x; let NY = P.n.y; let i = id.x; let j = id.y; let k = id.z; let plane = NX * NY;
  let r = BASE[3u * BS + k];
  let du = U[(k * NY + j) * (NX + 1u) + i + 1u] - U[(k * NY + j) * (NX + 1u) + i];
  let dv = V[(k * (NY + 1u) + j + 1u) * NX + i] - V[(k * (NY + 1u) + j) * NX + i];
  let dw = BASE[7u * BS + k + 1u] * W[(k + 1u) * plane + j * NX + i] - BASE[7u * BS + k] * W[k * plane + j * NX + i];
  D[cIndex(i, j, k)] = (r * (du / P.d.x + dv / P.d.y) + dw / P.d.z) / P.d.w;
}`;

/** One colour of red-black vertical-line relaxation; each column solved with Thomas' algorithm. */
export const LINE = /* wgsl */`${HEAD}
struct Color { c: vec4u };
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> COL: Color;
@group(0) @binding(2) var<storage, read> BASE: array<f32>;
@group(0) @binding(3) var<storage, read> D: array<f32>;
@group(0) @binding(4) var<storage, read_write> PHI: array<f32>;
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let NX = P.n.x; let NY = P.n.y; let NZ = P.n.z; let i = id.x; let j = id.y;
  if (i >= NX || j >= NY || ((i + j) & 1u) != COL.c.x) { return; }
  let idx2 = 1.0 / (P.d.x * P.d.x); let idy2 = 1.0 / (P.d.y * P.d.y); let idz2 = 1.0 / (P.d.z * P.d.z);
  var bb: array<f32, 64>; var cc: array<f32, 64>; var rr: array<f32, 64>;
  let plane = NX * NY;
  for (var k = 0u; k < NZ; k++) {
    let c = k * plane + j * NX + i; let r = BASE[3u * BS + k];
    var nb = 0.0; if (i > 0u) { nb += PHI[c - 1u]; } if (i < NX - 1u) { nb += PHI[c + 1u]; }
    var nby = 0.0; if (j > 0u) { nby += PHI[c - NX]; } if (j < NY - 1u) { nby += PHI[c + NX]; }
    var a = 0.0; if (k > 0u) { a = BASE[7u * BS + k] * idz2; }
    var cu = 0.0; if (k < NZ - 1u) { cu = BASE[7u * BS + k + 1u] * idz2; }
    var b = -(a + cu) - 2.0 * r * (idx2 + idy2);
    var rhs = D[c] - r * idx2 * nb - r * idy2 * nby;
    if (k > 0u) { let m = a / bb[k - 1u]; b -= m * cc[k - 1u]; rhs -= m * rr[k - 1u]; }
    bb[k] = b; cc[k] = cu; rr[k] = rhs;
  }
  var s = rr[NZ - 1u] / bb[NZ - 1u];
  var c = (NZ - 1u) * plane + j * NX + i;
  PHI[c] = PHI[c] + P.m.x * (s - PHI[c]);
  for (var kk = 1u; kk < NZ; kk++) {
    let k = NZ - 1u - kk;
    s = (rr[k] - cc[k] * s) / bb[k];
    c = k * plane + j * NX + i;
    PHI[c] = PHI[c] + P.m.x * (s - PHI[c]);
  }
}`;

/** Subtract the pressure gradient from u, v and w. One kernel per component, selected by COMP. */
export const GRAD = /* wgsl */`${HEAD}
struct Comp { c: vec4u };
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> COMP: Comp;
@group(0) @binding(2) var<storage, read> PHI: array<f32>;
@group(0) @binding(3) var<storage, read_write> F: array<f32>;
fn phiAt(i: i32, j: i32, k: i32) -> f32 {
  if (i < 0 || j < 0 || i >= i32(P.n.x) || j >= i32(P.n.y)) { return 0.0; }
  return PHI[cIndex(u32(i), u32(j), u32(k))];
}
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let NX = P.n.x; let NY = P.n.y; let NZ = P.n.z;
  let i = i32(id.x); let j = i32(id.y); let k = i32(id.z);
  if (COMP.c.x == 0u) {
    if (id.x > NX || id.y >= NY || id.z >= NZ) { return; }
    let c = (id.z * NY + id.y) * (NX + 1u) + id.x;
    F[c] = F[c] - P.d.w * (phiAt(i, j, k) - phiAt(i - 1, j, k)) / P.d.x;
  } else if (COMP.c.x == 1u) {
    if (id.x >= NX || id.y > NY || id.z >= NZ) { return; }
    let c = (id.z * (NY + 1u) + id.y) * NX + id.x;
    F[c] = F[c] - P.d.w * (phiAt(i, j, k) - phiAt(i, j - 1, k)) / P.d.y;
  } else {
    if (id.x >= NX || id.y >= NY || id.z == 0u || id.z >= NZ) { return; }
    let c = (id.z * NY + id.y) * NX + id.x;
    F[c] = F[c] - P.d.w * (phiAt(i, j, k) - phiAt(i, j, k - 1)) / P.d.z;
  }
}`;

/** Updraft nudging on interior w levels. N: centre (x,y,z,on), (rh, rz, wmax, dt/tau). */
export const NUDGE = /* wgsl */`${HEAD}
struct Nud { a: vec4f, b: vec4f };
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> N: Nud;
@group(0) @binding(2) var<storage, read_write> W: array<f32>;
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let k = id.z + 1u;
  if (N.a.w < 0.5 || id.x >= P.n.x || id.y >= P.n.y || k >= P.n.z) { return; }
  let x = (f32(id.x) + 0.5) * P.d.x; let y = (f32(id.y) + 0.5) * P.d.y; let z = f32(k) * P.d.z;
  let r = length(vec3f((x - N.a.x) / N.b.x, (y - N.a.y) / N.b.x, (z - N.a.z) / N.b.y));
  if (r >= 1.0) { return; }
  let q = cos(1.5707963 * r); let sh = q * q;
  let c = (k * P.n.y + id.y) * P.n.x + id.x;
  W[c] = W[c] + N.b.w * sh * (N.b.z * sh - W[c]);
}`;

/**
 * Pack cloud and rain into the renderer's density texture: extinction (1/km) from cloud water and rain,
 * sqrt-encoded against BMAX like the instant model's volume.
 */
export const PACK = /* wgsl */`${HEAD}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> QC: array<f32>;
@group(0) @binding(2) var<storage, read> QR: array<f32>;
@group(0) @binding(3) var OUT: texture_storage_3d<rgba8unorm, write>;
const BMAX: f32 = 24.0;
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.n.x || id.y >= P.n.y || id.z >= P.n.z) { return; }
  let c = cIndex(id.x, id.y, id.z);
  let beta = min(BMAX, 22000.0 * max(QC[c], 0.0)) + 350.0 * max(QR[c], 0.0);
  textureStore(OUT, id, vec4f(sqrt(clamp(beta / BMAX, 0.0, 1.0)), 0.0, 0.0, 1.0));
}`;

/**
 * Per-column diagnostics, ND = 10 values per column:
 *   0 reflectivity at about 600 m (dBZ)   1 u, 2 v at about 600 m (storm-relative, m/s)   3 column max w
 *   4 vertical vorticity near the ground (lowest level)   5 vertical vorticity at about 1 km
 *   6 w at about 1 km   7 theta perturbation at the lowest level (K)   8 rain accumulation (mm)   9 composite dBZ
 * Vorticity is evaluated at the cell's south-west corner from the face velocities.
 */
export const DIAG = /* wgsl */`${HEAD}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> BASE: array<f32>;
@group(0) @binding(2) var<storage, read> U: array<f32>;
@group(0) @binding(3) var<storage, read> V: array<f32>;
@group(0) @binding(4) var<storage, read> W: array<f32>;
@group(0) @binding(5) var<storage, read> TH: array<f32>;
@group(0) @binding(6) var<storage, read> QR: array<f32>;
@group(0) @binding(7) var<storage, read_write> OUT: array<f32>;
@group(0) @binding(8) var<storage, read> RAIN: array<f32>;
fn uAt(i: u32, j: u32, k: u32) -> f32 { return U[(k * P.n.y + j) * (P.n.x + 1u) + i]; }
fn vAt(i: u32, j: u32, k: u32) -> f32 { return V[(k * (P.n.y + 1u) + j) * P.n.x + i]; }
fn zeta(i: u32, j: u32, k: u32) -> f32 {
  if (i == 0u || j == 0u) { return 0.0; }
  return (vAt(i, j, k) - vAt(i - 1u, j, k)) / P.d.x - (uAt(i, j, k) - uAt(i, j - 1u, k)) / P.d.y;
}
fn dbz(c: u32, k: u32) -> f32 {
  let rq = BASE[3u * BS + k] * max(QR[c], 0.0) * 1000.0;
  if (rq < 1e-3) { return -99.0; }
  return 43.1 + 17.5 * log(rq) / log(10.0);
}
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x; let j = id.y;
  if (i >= P.n.x || j >= P.n.y) { return; }
  let plane = P.n.x * P.n.y; let c2 = j * P.n.x + i; let o = c2 * 10u;
  let kl = min(u32(600.0 / P.d.z), P.n.z - 1u);
  let k1 = min(u32(1000.0 / P.d.z), P.n.z - 1u);
  var wmax = 0.0; var comp = -99.0;
  for (var k = 0u; k < P.n.z; k++) { wmax = max(wmax, W[k * plane + c2]); comp = max(comp, dbz(k * plane + c2, k)); }
  OUT[o] = dbz(kl * plane + c2, kl);
  OUT[o + 1u] = 0.5 * (uAt(i, j, kl) + uAt(i + 1u, j, kl));
  OUT[o + 2u] = 0.5 * (vAt(i, j, kl) + vAt(i, j + 1u, kl));
  OUT[o + 3u] = wmax;
  OUT[o + 4u] = zeta(i, j, 0u);
  OUT[o + 5u] = zeta(i, j, k1);
  OUT[o + 6u] = W[k1 * plane + c2];
  OUT[o + 7u] = TH[c2] - BASE[0u];
  OUT[o + 8u] = RAIN[c2];
  OUT[o + 9u] = comp;
}`;
