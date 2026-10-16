/**
 * WGSL for the designed storm.
 *   BUILD  paints the storm's features into a 3-D volume: r = cloud, g = precipitation, b = near-ground features
 *          (for shadows only), a = how billowy the cloud is
 *   LIGHT  sun transmittance and skylight for every cell of a half-resolution grid
 *   RENDER ray-marches the volume over the ground, adds sub-grid billows, and draws the tornado analytically at
 *          tens-of-metres detail
 * Parameters come from design.ts (struct SP, NSLOT vec4s). Lengths are km, in the storm's frame.
 */

const SP = /* wgsl */`
struct SP {
  f: vec4f,      // xy forward (storm motion) unit, zw left unit
  base: vec4f,   // x cloud base, y storm top (EL), z clock s
  tower: vec4f,  // x top height, y radius, z amount, w striation
  tilt: vec4f,   // xy updraft tilt km/km, z overshooting top
  anvil: vec4f,  // xy direction, z length, w amount
  anvil2: vec4f, // x bottom, y top, z mammatus, w backshear km
  wall: vec4f,   // xy centre, z radius, w amount
  wall2: vec4f,  // x lowering, y spin rad/s, z tail cloud, w scud
  tail: vec4f,   // xy inflow tail direction, z length, w amount
  ffd: vec4f,    // xy forward-flank core, z size scale, w amount
  hail: vec4f,   // xy hail core, z radius, w amount
  rfd: vec4f,    // x clear slot, y slot radius, z rear-flank rain, w HP wrap
  flank: vec4f,  // xy flanking-line direction, z amount, w tower count
  tor: vec4f,    // xy tornado at the ground, z amount, w type (0 slender .. 1 wedge)
  tor2: vec4f,   // x radius at ground, y radius at cloud base, z condensation reach (0..1), w rope-out
  tor3: vec4f,   // xy tornado top (under the wall cloud), z debris
  up: vec4f,     // xy updraft centre at cloud base
  grid: vec4f    // x cells across, y levels, z half-width km, w top km
};
`;

const NOISE = /* wgsl */`
fn n3(p: vec3f) -> f32 { return textureSampleLevel(noiseT, sampRep, p, 0.0).r; }
// three octaves, about 11, 4.3 and 1.7 km
fn fbm(p: vec3f) -> f32 { return 0.5 * n3(p * 0.09) + 0.3 * n3(p * 0.23 + vec3f(0.31, 0.17, 0.53)) + 0.2 * n3(p * 0.6 + vec3f(0.7, 0.2, 0.4)); }
// cauliflower: rounded lobes (inverted ridged noise) at about 2.5 and 1 km
fn billow(p: vec3f) -> f32 { let a = 1.0 - abs(2.0 * n3(p * 0.4) - 1.0); let b = 1.0 - abs(2.0 * n3(p * 1.0 + vec3f(0.2, 0.6, 0.3)) - 1.0); return 0.65 * a + 0.35 * b; }
`;


const NEAR = /* wgsl */`
// Near-ground features, drawn at full detail in the render pass (fine = 1) and coarsely into the volume for
// shadows (fine = 0): the wall cloud, its tail cloud and scud, and the inflow tail. Returns density 0..1.
fn nearField(p: vec3f, fine: f32) -> f32 {
  let zb = S.base.x; let clock = S.base.z;
  var v = 0.0;
  if (S.wall.w > 0.0) {
    let wc = S.wall.xy; let Rw = S.wall.z; let lw = S.wall2.x;
    let dw = p.xy - wc; let rw = length(dw);
    if (rw < Rw + 5.5 && p.z < zb + 0.4 && p.z > zb - lw - 0.4) {
      // the wall cloud turns: sample its texture in a frame rotating faster near the centre
      let rot = S.wall2.y * clock / (0.5 + 0.5 * rw);
      let cs = cos(rot); let sn = sin(rot);
      let dr = vec2f(cs * dw.x - sn * dw.y, sn * dw.x + cs * dw.y);
      let n = 0.5 * n3(vec3f(dr * 0.5, p.z * 1.0)) + 0.5 * mix(0.5, n3(vec3f(dr * 1.9, p.z * 2.2) + vec3f(0.3, 0.7, 0.2)), fine);
      // ragged fringe hanging from the bottom: fine noise around the circumference, stretched vertically
      let ang = atan2(dr.y, dr.x);
      let fringe = mix(0.5, n3(vec3f(ang * 1.3, rw * 0.8, p.z * 0.6) + vec3f(0.1, 0.9, 0.5)), fine);
      // a lowered block with a flat, ragged bottom and steep sides, stepping up to the main base at its edge
      let bot = zb - lw * (1.0 - 0.45 * pow(min(rw / Rw, 1.2), 6.0)) + (n - 0.5) * 0.14 - (fringe - 0.5) * 0.3;
      let w = smoothstep(Rw + 0.15, Rw - 0.2, rw + (n - 0.5) * 1.0) * smoothstep(bot - 0.03, bot + 0.05, p.z) * smoothstep(zb + 0.3, zb + 0.05, p.z);
      v = max(v, S.wall.w * w);
      // tail cloud: a ragged band from the wall cloud toward the rain on the forward flank
      let td = normalize(S.ffd.xy - wc); let s = dot(dw, td); let qq = dot(dw, vec2f(-td.y, td.x));
      let nt = n3(vec3f(s * 0.3, qq * 1.0, p.z * 1.5) + vec3f(0.2, 0.6, 0.1));
      let wt = mix(1.0, 0.35, clamp((s - Rw) / 4.5, 0.0, 1.0));
      let zt = zb - lw * 0.6 + 0.15 * clamp((s - Rw) / 4.5, 0.0, 1.0);
      let tl = smoothstep(Rw * 0.4, Rw * 0.8, s) * (1.0 - smoothstep(Rw + 3.0, Rw + 4.8, s + (nt - 0.5) * 1.5))
        * smoothstep(wt, wt * 0.4, abs(qq) + (nt - 0.5) * 0.6) * smoothstep(zt - 0.05, zt + 0.06, p.z) * smoothstep(zb + 0.05, zb - 0.12, p.z);
      v = max(v, S.wall2.z * tl * 0.9);
      // scud: ragged fragments below the base, being drawn into the wall cloud
      // only on the inflow side (ahead of and to the right of the wall cloud), sparse
      let phiS = atan2(dot(dw, S.f.zw), dot(dw, S.f.xy));
      let side = smoothstep(-0.2, 0.4, cos(phiS + 0.8));
      let sn2 = n3(vec3f(dr * 1.2, p.z * 3.5) + vec3f(0.4, 0.3, 0.8));
      let sc = side * smoothstep(0.74, 0.8, sn2) * smoothstep(Rw + 2.6, Rw + 0.6, rw) * smoothstep(zb - lw * 0.8 - 0.08, zb - lw * 0.8 + 0.05, p.z) * smoothstep(zb - 0.08, zb - 0.25, p.z);
      v = max(v, S.wall2.w * sc * 0.85);
    }
  }
  if (S.tail.w > 0.0) {
    // inflow tail (beaver tail): a smooth, laminar band streaming in along the forward flank's edge
    let t0 = S.up.xy + S.f.xy * 2.5 + S.f.zw * 0.5;
    let td = S.tail.xy; let s = dot(p.xy - t0, td);
    // the tail curves: it bends toward the forward flank as it nears the storm
    let qq = dot(p.xy - t0, vec2f(-td.y, td.x)) - 0.035 * (S.tail.z - s) * (S.tail.z - s) * 0.12 + 0.6 * sin(s * 0.35);
    if (s > -2.0 && s < S.tail.z + 2.0 && abs(qq) < 5.0 && abs(p.z - zb) < 1.2) {
      let fr = clamp(s / S.tail.z, 0.0, 1.0);
      let n = 0.55 * n3(vec3f(s * 0.05, qq * 0.45, p.z * 0.6)) + 0.45 * mix(0.5, n3(vec3f(s * 0.25, qq * 1.6, p.z * 2.5) + vec3f(0.6, 0.2, 0.4)), fine);
      let wt = mix(2.6, 0.5, fr); let zc = zb + 0.1 + 0.45 * (1.0 - fr); let th = mix(0.5, 0.18, fr);
      let inT = smoothstep(-0.6, 0.6, s) * (1.0 - smoothstep(S.tail.z * 0.8, S.tail.z, s + (n - 0.5) * 4.0))
        * smoothstep(wt, wt * 0.45, abs(qq) + (n - 0.5) * 0.9) * smoothstep(th, th * 0.4, abs(p.z - zc) + (n - 0.5) * 0.12);
      v = max(v, S.tail.w * inT * 0.85);
    }
  }
  return v;
}
`;

export const BUILD = /* wgsl */`${SP}
@group(0) @binding(0) var<uniform> S: SP;
@group(0) @binding(1) var noiseT: texture_3d<f32>;
@group(0) @binding(2) var sampRep: sampler;
@group(0) @binding(3) var outD: texture_storage_3d<rgba8unorm, write>;
${NOISE}
${NEAR}
fn ss(a: f32, b: f32, x: f32) -> f32 { return smoothstep(a, b, x); }

// a cumulus tower: centre c, radius R, base zb, top zt, billow amplitude
fn tower(p: vec3f, c: vec2f, R: f32, zb: f32, zt: f32, bil: f32) -> f32 {
  let r = length(p.xy - c);
  let n = fbm(p) - 0.5;
  let hz = clamp((p.z - zb) / max(zt - zb, 0.5), 0.0, 1.0);
  let edge = R * (0.85 + 0.3 * hz * hz) + n * bil;
  let top = zt - 1.6 * pow(min(r / max(R, 0.1), 1.6), 2.0) + n * 1.2;
  return ss(0.6, -0.6, r - edge) * ss(zb - 0.1, zb + 0.3, p.z) * ss(top + 0.4, top - 0.6, p.z);
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let nv = u32(S.grid.x); let nz = u32(S.grid.y);
  if (id.x >= nv || id.y >= nv || id.z >= nz) { return; }
  let L = S.grid.z; let ZT = S.grid.w;
  let p = vec3f(-L + (f32(id.x) + 0.5) * 2.0 * L / S.grid.x, -L + (f32(id.y) + 0.5) * 2.0 * L / S.grid.x, (f32(id.z) + 0.5) * ZT / S.grid.y);
  let fw = S.f.xy; let lf = S.f.zw; let zb = S.base.x; let el = S.base.y; let clock = S.base.z;
  var cloud = 0.0; var rain = 0.0; var turb = 0.0;
  // turb: how billowy the cloud is here (0 laminar .. 1 cauliflower), weighted by each feature's share

  // ---- main updraft: a tilted tower with a flat, striated rain-free base
  let c = S.up.xy + S.tilt.xy * max(p.z - zb, 0.0);
  let d = p.xy - c; let r = length(d);
  let R = S.tower.y; let zt = S.tower.x;
  if (S.tower.z > 0.0) {
    let hz = clamp((p.z - zb) / max(zt - zb, 0.5), 0.0, 1.0);
    let low = 1.0 - ss(zb + 1.5, zb + 5.5, p.z);
    let ang = atan2(d.y, d.x);
    // striations: stacked, gently corkscrewing bands around the lower updraft
    let band = sin(6.2832 * (p.z - zb) / 0.75 + ang - clock * 0.03);
    let n = fbm(p) - 0.5;
    let edge = R * (0.85 + 0.35 * hz * hz) + S.tower.w * 0.22 * band * low + n * 2.4 * mix(1.0, 0.3, S.tower.w * low);
    let top = zt - 1.8 * pow(min(r / max(R, 0.1), 1.6), 2.0) + n * 1.2;
    var tw = ss(0.6, -0.6, r - edge) * ss(zb - 0.1, zb + 0.25, p.z) * ss(top + 0.4, top - 0.6, p.z);
    // overshooting top: a dome above the anvil over the updraft
    let od = length(vec3f(d / max(R * 0.7, 0.5), (p.z - el) / 1.6));
    tw = max(tw, S.tilt.z * ss(1.0, 0.6, od + n * 0.3) * ss(el - 1.5, el - 0.5, p.z));
    let tv = S.tower.z * tw;
    turb = select(turb, mix(0.25, 1.0, ss(zb + 1.0, zb + 4.0, p.z) * (1.0 - 0.6 * S.tower.w * low)), tv > cloud);
    cloud = max(cloud, tv);
  }

  // ---- anvil: spreading downwind from the updraft top, thinning with distance, mammatus underneath
  if (S.anvil.w > 0.0) {
    let a0 = S.up.xy + S.tilt.xy * (el - zb);
    let ad = S.anvil.xy; let an = vec2f(-ad.y, ad.x);
    let s = dot(p.xy - a0, ad); let q = dot(p.xy - a0, an);
    let n = fbm(p * 0.8 + vec3f(3.1, 1.7, 0.0)) - 0.5;
    let wA = R * 1.25 + max(s, 0.0) * 0.42;
    let bot = S.anvil2.x + 0.012 * max(s, 0.0); let tp = S.anvil2.y - 0.014 * max(s, 0.0);
    let inA = ss(wA + 1.5, wA - 1.5, abs(q) + n * 4.0) * ss(-S.anvil2.w - 1.0, -S.anvil2.w + 1.0, s) * (1.0 - ss(S.anvil.z * 0.7, S.anvil.z, s + n * 6.0));
    let vert = ss(bot - 0.3, bot + 0.4, p.z + n * 0.8) * ss(tp + 0.3, tp - 0.5, p.z + n * 0.5);
    let thin = mix(1.0, 0.3, clamp(s / max(S.anvil.z, 1.0), 0.0, 1.0));
    let av = S.anvil.w * inA * vert * thin;
    turb = select(turb, mix(0.55, 0.3, clamp(s / max(S.anvil.z, 1.0), 0.0, 1.0)), av > cloud);
    cloud = max(cloud, av);
    if (S.anvil2.z > 0.0) {
      let pouch = ss(0.58, 0.72, n3(vec3f(p.x * 0.45, p.y * 0.45, p.z * 0.9) + vec3f(0.5, 0.1, 0.3)));
      let under = ss(bot - 1.1, bot - 0.4, p.z) * (1.0 - ss(bot - 0.05, bot + 0.2, p.z));
      cloud = max(cloud, S.anvil2.z * S.anvil.w * pouch * under * inA * ss(6.0, 18.0, s) * 0.85);
    }
  }

  // ---- flanking line: cumulus towers stepping down to the rear of the updraft
  for (var i = 0u; i < 4u; i++) {
    if (f32(i) >= S.flank.w || S.flank.z <= 0.0) { break; }
    let fi = f32(i);
    let ctr = S.up.xy + S.flank.xy * (R + 2.5 + 3.4 * fi);
    let top = zb + (zt - zb) * (0.5 - 0.1 * fi);
    let fv = S.flank.z * tower(p, ctr, 1.9 - 0.3 * fi, zb, top, 1.6);
    turb = select(turb, 1.0, fv > cloud);
    cloud = max(cloud, fv);
  }

  // ---- wall cloud, tail cloud, scud and inflow tail: drawn in the render pass; the volume keeps a coarse copy
  // (blue channel) only for their shadows
  let wc = S.wall.xy; let Rw = S.wall.z; let dw = p.xy - wc; let rw = length(dw);
  let near = nearField(p, 0.0);

  // ---- precipitation: streaky curtains under the forward flank, a hail core next to the updraft
  // rain curtains: vertical streaks with gaps, leaning slightly with the low-level wind
  let curt = (0.35 + 0.65 * ss(0.3, 0.7, n3(vec3f(p.x * 0.11 + p.z * 0.01, p.y * 0.11, p.z * 0.02))))
    * (0.55 + 0.6 * n3(vec3f(p.x * 0.45, p.y * 0.45, p.z * 0.04) + vec3f(0.3, 0.5, 0.1)));
  let below = ss(zb + 1.2, zb - 0.3, p.z);
  if (S.ffd.w > 0.0) {
    let fq = p.xy - S.ffd.xy; let fa = dot(fq, fw) / (6.0 * S.ffd.z); let fb = dot(fq, lf) / (4.0 * S.ffd.z);
    rain = max(rain, S.ffd.w * exp(-(fa * fa + fb * fb)) * curt * below);
  }
  if (S.hail.w > 0.0) {
    let hq = length(p.xy - S.hail.xy) / S.hail.z; let hh = exp(-hq * hq) * curt * below;
    rain = max(rain, S.hail.w * hh * 0.9);
  }

  // ---- rear-flank downdraft: rain curtain to the rear and a clear slot carved around the wall cloud
  if (S.rfd.z > 0.0 || S.rfd.x > 0.0) {
    let phi = atan2(dot(dw, lf), dot(dw, fw));           // 0 ahead, +pi/2 left, -pi/2 right, +-pi behind
    let sec = max(ss(-0.1, 0.5, cos(phi - 2.8)), S.rfd.w);   // centred behind and a little to the left (west of the meso); HP storms wrap it round
    let ns = n3(vec3f(p.x * 0.4, p.y * 0.4, p.z * 0.3) + vec3f(0.7, 0.7, 0.1)) - 0.5;
    let slotR = S.rfd.y;
    let ring = ss(Rw * 0.8, Rw * 1.1, rw + ns * 0.5) * ss(slotR + 0.6, slotR - 0.4, rw + ns * 0.9);
    let slot = clamp(S.rfd.x * ring * ss(-0.1, 0.45, cos(phi + 2.356)) * ss(zb + 2.8, zb + 1.2, p.z), 0.0, 1.0);
    cloud *= 1.0 - slot; rain *= 1.0 - slot;
    let cur = ss(slotR - 0.3, slotR + 0.9, rw) * ss(slotR + 5.5, slotR + 2.0, rw) * sec;
    rain = max(rain, S.rfd.z * cur * curt * below * 0.45);
  }

  textureStore(outD, id, vec4f(sqrt(clamp(cloud, 0.0, 1.0)), sqrt(clamp(rain, 0.0, 1.0)), sqrt(clamp(near, 0.0, 1.0)), turb));
}`;

/** Lighting on a half-resolution grid: r = sun transmittance, g = skylight. */
export const LIGHT = /* wgsl */`
struct LU { sun: vec4f, dims: vec4f, p: vec4f };   // dims: light-grid N, NZ, L km, ZT km; p: cloud max, rain max, step km
@group(0) @binding(0) var dens: texture_3d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var outL: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> U: LU;
fn uvw(p: vec3f) -> vec3f { return vec3f((p.x + U.dims.z) / (2.0 * U.dims.z), (p.y + U.dims.z) / (2.0 * U.dims.z), p.z / U.dims.w); }
fn beta(p: vec3f) -> f32 { let d = textureSampleLevel(dens, samp, uvw(p), 0.0); return (d.r * d.r + d.b * d.b) * U.p.x + d.g * d.g * U.p.y; }
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let nv = u32(U.dims.x); let nz = u32(U.dims.y);
  if (id.x >= nv || id.y >= nv || id.z >= nz) { return; }
  let dx = 2.0 * U.dims.z / U.dims.x; let dz = U.dims.w / U.dims.y;
  let pos = vec3f(-U.dims.z + (f32(id.x) + 0.5) * dx, -U.dims.z + (f32(id.y) + 0.5) * dx, (f32(id.z) + 0.5) * dz);
  let st = U.p.z;
  var tau = 0.0; var q = pos + U.sun.xyz * 0.5 * st;
  for (var i = 0; i < 64; i++) {
    if (q.z > U.dims.w || abs(q.x) > U.dims.z || abs(q.y) > U.dims.z) { break; }
    tau += beta(q) * st; q += U.sun.xyz * st;
  }
  var up = 0.0; var r = pos + vec3f(0.0, 0.0, 0.5 * dz);
  for (var i = 0; i < 48; i++) { if (r.z > U.dims.w) { break; } up += beta(r) * dz; r.z += dz; }
  let sun = 0.72 * exp(-0.38 * tau) + 0.28 * exp(-0.07 * tau);
  textureStore(outL, id, vec4f(sun, exp(-0.1 * up), 0.0, 1.0));
}`;

/** Render pass. RU: camera basis, sun, frame data. */
export const RENDER = /* wgsl */`${SP}
struct RU { cp: vec4f, cf: vec4f, cr: vec4f, cu: vec4f, sd: vec4f, a: vec4f, b: vec4f };
// cp.w, cf.w: ground offset (km the storm has travelled); a: res.x, res.y, tan(half fov), cloud max; b: rain max, exposure, frame, -
@group(0) @binding(0) var dens: texture_3d<f32>;
@group(0) @binding(1) var light: texture_3d<f32>;
@group(0) @binding(2) var noiseT: texture_3d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var sampRep: sampler;
@group(0) @binding(5) var<uniform> U: RU;
@group(0) @binding(6) var<uniform> S: SP;
${NOISE}
${NEAR}

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
fn uvw(p: vec3f) -> vec3f { let L = S.grid.z; return vec3f((p.x + L) / (2.0 * L), (p.y + L) / (2.0 * L), p.z / S.grid.w); }
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }

// farm fields on a one-mile grid of section roads, faded with distance so they don't shimmer
fn groundColor(p: vec2f, dist: f32) -> vec3f {
  let sec = 1.609;
  let cell = floor(p / sec);
  let h1 = hash(cell + vec2f(0.37, 0.11)); let h2 = hash(cell * 1.7 + vec2f(5.3, 2.9));
  var field = mix(vec3f(0.22, 0.29, 0.14), vec3f(0.34, 0.32, 0.19), step(0.62, h1));
  field = mix(field, vec3f(0.17, 0.24, 0.11), step(0.85, h2));
  let f = fract(p / sec) * sec;
  let edge = min(min(f.x, sec - f.x), min(f.y, sec - f.y));
  let w = max(0.012, dist * 0.0011);
  let road = 1.0 - smoothstep(w, 2.0 * w, edge);
  let detail = exp(-dist / 30.0);
  let gc = mix(vec3f(0.24, 0.3, 0.16), field, detail);
  return mix(gc, vec3f(0.44, 0.42, 0.37), road * detail);
}

// the tornado, drawn analytically: condensation funnel (x) and debris (y), extinction 1/km
fn tornado(q: vec3f) -> vec2f {
  let zb = S.base.x;
  if (S.tor.z <= 0.0 || q.z > zb + 0.1) { return vec2f(0.0); }
  // the funnel flares to its top radius where it meets the lowered wall cloud, not at the main cloud base
  let ztop = max(zb - 0.5 * S.wall2.x, 0.3);
  let h = clamp(q.z / ztop, 0.0, 1.0);
  let clock = S.base.z;
  // axis from the ground position up to the wall cloud, with a slow sway that grows as it ropes out
  let sway = (0.06 + 0.4 * S.tor2.w) * vec2f(sin(h * 6.0 + clock * 0.35), cos(h * 4.5 + clock * 0.28)) * sin(3.1416 * h);
  let ax = mix(S.tor.xy, S.tor3.xy, pow(h, 0.8)) + sway;
  let dv = q.xy - ax; let d = length(dv);
  let rad = mix(S.tor2.x, S.tor2.y, pow(h, mix(3.0, 0.7, S.tor.w)));
  let ang = atan2(dv.y, dv.x);
  // rotating, ragged texture on the funnel's skin
  let sp = n3(vec3f(ang * 0.32 - clock * 0.9 + q.z * 1.4, d * 3.0, q.z * 0.9));
  let condBottom = zb * (1.0 - S.tor2.z);
  let funnel = S.tor.z * smoothstep(rad * 1.08, rad * 0.75, d + (sp - 0.5) * rad * 0.5) * smoothstep(condBottom - 0.04, condBottom + 0.08, q.z) * smoothstep(ztop + 0.35, ztop + 0.05 - 0.3 * S.tor2.w, q.z) * 45.0;
  // debris cloud at the ground, wider than the funnel
  let dr = S.tor2.x * 2.6 + 0.06; let dh = 0.1 + 0.25 * S.tor.w * (1.0 - S.tor2.w);
  let dn = n3(vec3f(ang * 0.5 - clock * 1.2, d * 4.0, q.z * 3.0) + vec3f(0.3, 0.1, 0.7));
  let debris = S.tor3.z * smoothstep(dr, dr * 0.35, d + (dn - 0.5) * dr * 0.7) * smoothstep(dh, dh * 0.25, q.z) * 14.0;
  return vec2f(funnel, debris);
}

@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let res = U.a.xy;
  var uv = vec2f(fc.x / res.x, 1.0 - fc.y / res.y) * 2.0 - 1.0; uv.x *= res.x / res.y;
  let rd = normalize(U.cf.xyz + uv.x * U.a.z * U.cr.xyz + uv.y * U.a.z * U.cu.xyz);
  let cp = U.cp.xyz; let L = S.grid.z; let ZT = S.grid.w;
  let inv = 1.0 / rd; let b0 = vec3f(-L, -L, 0.0); let b1 = vec3f(L, L, ZT);
  let t0 = (b0 - cp) * inv; let t1 = (b1 - cp) * inv; let tmn = min(t0, t1); let tmx = max(t0, t1);
  let ta = max(max(tmn.x, tmn.y), max(tmn.z, 0.0)); var tb = min(min(tmx.x, tmx.y), tmx.z);
  if (rd.z < 0.0) { tb = min(tb, -cp.z / rd.z); }
  let cosg = dot(rd, U.sd.xyz);
  let sunc = vec3f(1.0, 0.92, 0.78); let skyc = vec3f(0.46, 0.56, 0.7);
  let hazec = vec3f(0.66, 0.7, 0.75);
  // tornado bounding cylinder
  let torR = max(S.tor2.y, S.tor2.x * 2.6 + 0.06) + 0.5;
  let torC = 0.5 * (S.tor.xy + S.tor3.xy);
  var col = vec3f(0.0); var T = 1.0;
  if (tb > ta) {
    let dt0 = 0.1;
    var t = ta + dt0 * hash(fc.xy + U.b.z);
    let ph = 0.45 + 1.2 * pow(max(cosg, 0.0), 8.0);
    for (var i = 0; i < 700; i++) {
      if (t > tb || T < 0.01) { break; }
      let q = cp + rd * t;
      let nearTor = S.tor.z > 0.0 && q.z < S.base.x + 0.2 && length(q.xy - torC) < torR + length(S.tor.xy - S.tor3.xy) * 0.5;
      var dt = dt0 * (1.0 + t / 50.0);
      let tc = uvw(q);
      let s = textureSampleLevel(dens, samp, tc, 0.0);
      // near-ground features: fine steps where the coarse copy says they are
      let nearOn = s.b > 0.05 && q.z < S.base.x + 0.5;
      if (nearTor) { dt = 0.02 + t * 0.0006; }
      else if (nearOn) { dt = min(dt, 0.035 + t * 0.003); }
      else if (s.r <= 0.004 && s.g <= 0.004 && s.b <= 0.004) { dt = max(dt, 0.45); }
      var be = 0.0; var Lc = vec3f(0.0);
      let lt = textureSampleLevel(light, samp, tc, 0.0);
      let haze = 1.0 - exp(-t / 110.0);
      if (s.r > 0.004) {
        // sub-grid billows: finer near the camera
        // the volume holds a smooth field; a threshold with fine noise makes crisp, billowed cloud edges
        let soft = 0.55 * n3(q * 0.21) + 0.3 * n3(q * 0.6 + vec3f(0.31, 0.17, 0.53)) + 0.15 * n3(q * 1.9 + vec3f(0.11, 0.71, 0.29));
        let lobes = 0.7 * billow(q) + 0.3 * n3(q * 4.0 + vec3f(0.5, 0.3, 0.9));
        let nn = mix(soft, lobes, s.a);
        let v = s.r + (nn - 0.5) * mix(0.12, 0.8, s.a);
        let dd = smoothstep(0.27, 0.36, v) * (0.4 + 0.6 * smoothstep(0.36, 0.75, v));
        let bc = dd * U.a.w;
        let baseShade = smoothstep(S.base.x - 0.4, S.base.x + 1.5, q.z);
        // sun, sky, and light bounced up from the ground onto the base
        let bounce = vec3f(0.3, 0.33, 0.27) * (1.0 - baseShade) * 0.55;
        let c = sunc * (lt.r * ph * 1.9) + skyc * (0.24 + 0.6 * lt.g) * (0.75 + 0.25 * baseShade) + bounce;
        be += bc; Lc += c * bc;
      }
      if (nearOn) {
        let nv = nearField(q, 1.0);
        let bn = smoothstep(0.22, 0.38, nv) * U.a.w * 0.8;
        if (bn > 0.0) {
          let c = sunc * (lt.r * ph * 1.4) + skyc * (0.2 + 0.55 * lt.g) + vec3f(0.3, 0.33, 0.27) * 0.45;
          be += bn; Lc += c * vec3f(0.72, 0.76, 0.82) * bn;
        }
      }
      if (s.g > 0.004) {
        let br = s.g * s.g * U.b.x;
        let hq = length(q.xy - S.hail.xy) / max(S.hail.z, 0.5);
        let hw = S.hail.w * exp(-hq * hq);
        let pc = mix(vec3f(0.55, 0.6, 0.66), vec3f(0.8, 0.88, 0.86), clamp(hw, 0.0, 1.0)) * (sunc * lt.r * 0.9 + skyc * (0.35 + 0.5 * lt.g));
        be += br; Lc += pc * br;
      }
      if (nearTor) {
        let tv = tornado(q);
        if (tv.x + tv.y > 0.0) {
          let tl = sunc * lt.r * 0.7 + skyc * (0.22 + 0.5 * lt.g);
          be += tv.x + tv.y; Lc += tl * vec3f(0.72, 0.74, 0.76) * tv.x + tl * vec3f(0.42, 0.34, 0.26) * tv.y;
        }
      }
      if (be > 0.0005) {
        let a = 1.0 - exp(-be * dt);
        let c = mix(Lc / be, hazec, haze * 0.9);
        col += T * a * c; T *= 1.0 - a;
      }
      t += dt;
    }
  }
  var bg: vec3f;
  if (rd.z < 0.0) {
    let tg = -cp.z / rd.z; let g = cp + rd * tg;
    var sh = 1.0;
    if (abs(g.x) < L && abs(g.y) < L) { sh = textureSampleLevel(light, samp, vec3f((g.x + L) / (2.0 * L), (g.y + L) / (2.0 * L), 0.01), 0.0).r; }
    let hz = 1.0 - exp(-tg / 70.0);
    let gp = g.xy + vec2f(U.cp.w, U.cf.w);
    bg = groundColor(gp, tg) * (0.45 + 0.55 * sh) * (1.0 - hz) + hazec * hz * 0.85;
  } else {
    let el = clamp(rd.z, 0.0, 1.0);
    bg = vec3f(0.8, 0.83, 0.86) * pow(1.0 - el, 3.0) + vec3f(0.33, 0.49, 0.75) * (1.0 - pow(1.0 - el, 3.0)) + 0.4 * pow(max(cosg, 0.0), 24.0) * vec3f(1.0, 0.9, 0.7);
  }
  var cc = col + T * bg;
  cc = 1.0 - exp(-U.b.y * cc);
  return vec4f(pow(cc, vec3f(1.0 / 1.1)), 1.0);
}`;
