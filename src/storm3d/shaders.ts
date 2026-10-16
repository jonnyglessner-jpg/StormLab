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
  base: vec4f,   // x cloud base, y storm top (EL), z clock s, w storm time min
  tower: vec4f,  // x top height, y radius, z amount, w striation
  tilt: vec4f,   // xy updraft tilt km/km, z overshooting top, w mesocyclone spin rad/s (counter-clockwise)
  anvil: vec4f,  // xy direction, z length, w growth (0..1)
  anvil2: vec4f, // x bottom, y top, z mammatus, w backshear km
  wall: vec4f,   // xy centre, z radius, w amount
  wall2: vec4f,  // x lowering, y spin rad/s, z tail cloud, w scud
  tail: vec4f,   // xy inflow tail direction, z length, w amount
  ffd: vec4f,    // xy forward-flank core, z size scale, w amount
  hail: vec4f,   // xy hail core, z radius, w amount
  rfd: vec4f,    // x clear slot, y slot radius, z rear-flank rain, w HP wrap
  flank: vec4f,  // xy flanking-line direction, z growth, w tower count (up to 8)
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
// rotate a horizontal vector counter-clockwise (x east, y north) by angle a
fn rot2(v: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(c * v.x - s * v.y, s * v.x + c * v.y); }
fn billow(p: vec3f) -> f32 { let a = 1.0 - abs(2.0 * n3(p * 0.55) - 1.0); let b = 1.0 - abs(2.0 * n3(p * 1.4 + vec3f(0.2, 0.6, 0.3)) - 1.0); return 0.7 * a + 0.3 * b; }
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
      // the wall cloud turns counter-clockwise: sample its texture in a frame turned back by the angle turned so far
      let dr = rot2(dw, -S.wall2.y * clock);
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
fn hash1(x: f32) -> f32 { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }

// Material, stored in the alpha channel: water cloud 0.3 + 0.7 * turbulence (0 smooth .. 1 cauliflower);
// ice cloud (the anvil) 0.3 * (1 - ice), so 0 is pure ice
fn water(turb: f32) -> f32 { return 0.3 + 0.7 * clamp(turb, 0.0, 1.0); }
fn icy(ice: f32) -> f32 { return 0.3 * (1.0 - clamp(ice, 0.0, 1.0)); }

// a cumulus congestus tower: centre c, radius R, base zb, top zt. Near-vertical sides, a rounded top
fn congestus(p: vec3f, c: vec2f, R: f32, zb: f32, zt: f32, seed: f32) -> f32 {
  let r = length(p.xy - c);
  // lumps scaled to the tower, so small and large towers have the same cauliflower character
  let ps = p / max(R, 0.4) + vec3f(seed * 3.7, seed * 1.9, seed * 5.3);
  let n = 0.62 * n3(ps * 0.3) + 0.38 * n3(ps * 0.7 + vec3f(0.3, 0.6, 0.1)) - 0.5;
  let hz = clamp((p.z - zb) / max(zt - zb, 0.3), 0.0, 1.0);
  // a tower that narrows upward into a lumpy, turreted head
  let edge = R * (0.95 - 0.35 * hz * hz) + n * R * 0.8;
  let top = zt - 1.1 * R * pow(min(r / max(R, 0.1), 1.4), 2.0) + n * R * 1.0;
  return ss(0.45, -0.45, r - edge) * ss(zb - 0.05, zb + 0.12, p.z) * ss(top + 0.25, top - 0.45, p.z);
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let nv = u32(S.grid.x); let nz = u32(S.grid.y);
  if (id.x >= nv || id.y >= nv || id.z >= nz) { return; }
  let L = S.grid.z; let ZT = S.grid.w;
  let p = vec3f(-L + (f32(id.x) + 0.5) * 2.0 * L / S.grid.x, -L + (f32(id.y) + 0.5) * 2.0 * L / S.grid.x, (f32(id.z) + 0.5) * ZT / S.grid.y);
  let fw = S.f.xy; let lf = S.f.zw; let zb = S.base.x; let el = S.base.y; let tmin = S.base.w;
  var cloud = 0.0; var rain = 0.0;
  // material blended by each feature's share of the cloud here, so it changes smoothly where features meet
  var mw = 1e-4; var ms = 1e-4 * water(1.0);
  let R = S.tower.y; let zt = S.tower.x;
  let zr = p.z - zb;

  // ---- main updraft. Low down, the rotating updraft (mesocyclone): a broad, smooth barrel with a flared skirt
  // at cloud base (its striations are cut in the render pass, where they turn). Higher up, the convective tower,
  // widening like a bell into the anvil, with a domed top and an overshooting top above it.
  let c = S.up.xy + S.tilt.xy * max(zr, 0.0);
  let d = p.xy - c; let r = length(d);
  if (S.tower.z > 0.0) {
    let H = max(zt - zb, 0.5);
    let hz = clamp(zr / H, 0.0, 1.0);
    let lam = S.tower.w * (1.0 - ss(2.0, 4.5, zr));                 // how laminar (striated) the updraft is here
    let flare = 0.2 * exp(-max(zr, 0.0) / 0.5) * S.tower.w;
    // a waist above the striated base, then the tower widening again toward the anvil
    let young = 1.0 - clamp(S.anvil.w, 0.0, 1.0);
    // a young tower narrows into a turreted head; a mature one widens again toward the anvil
    let rad = R * mix(1.0, 0.8, young) * (1.0 + flare - 0.22 * S.tower.w * ss(0.05, 0.35, hz) + mix(0.3 * ss(0.45, 0.95, hz), -0.3 * hz * hz, young));
    let n = fbm(p) - 0.5;
    let lump = mix(0.5, 1.5, ss(1.0, 5.0, zr)) * (1.0 - 0.75 * lam);
    let edge = rad + n * 2.2 * lump;
    // domed top: rounder while the tower is young, flatter once it spreads into the anvil
    let dome = mix(0.9 * rad, 2.2, clamp(S.anvil.w, 0.0, 1.0));
    let ztc = zb + (zt - zb) * mix(1.0, 0.88, young);
    let top = ztc - dome * pow(min(r / max(rad, 0.1), 1.5), 2.0) + n * mix(1.1, 2.4, young);
    var tw = ss(0.55, -0.55, r - edge) * ss(zb - 0.05, zb + 0.15, p.z) * ss(top + 0.3, top - 0.6, p.z);
    // overshooting top: a dome pushing up through the anvil, rising as the updraft matures
    let oh = 1.8 * S.tilt.z;
    let od = length(vec3f(d / max(R * 0.75, 0.5), (p.z - el) / max(oh, 0.2)));
    tw = max(tw, ss(1.0, 0.65, od + n * 0.3) * ss(el - 1.5, el - 0.4, p.z) * step(0.01, S.tilt.z));
    var tv = S.tower.z * tw;
    // a young tower is a cluster of turrets, each a towering cumulus of its own, merging into one
    if (young > 0.02) {
      for (var j = 0u; j < 3u; j++) {
        let fj = f32(j);
        let a = 2.1 * fj + 0.7; let o = vec2f(cos(a), sin(a)) * R * (0.62 + 0.1 * fj);
        let hj = (zt - zb) * (1.02 - 0.2 * fj);
        tv = max(tv, S.tower.z * young * congestus(p, c + o * (1.0 + 0.08 * max(zr, 0.0)), R * (0.48 - 0.05 * fj), zb, zb + hj, 11.0 + fj * 3.0));
      }
    }
    mw += tv * tv; ms += tv * tv * water(mix(1.0, 0.12, lam));
    cloud = max(cloud, tv);
  }

  // ---- storm body: the deep cloud downstream of the updraft, over the forward-flank rain and hail, from cloud base
  // up into the anvil. Its underside rises downstream, so you see under it into the rain shafts.
  if (S.ffd.w > 0.0 && S.tower.z > 0.0) {
    let ax = normalize(S.ffd.xy - S.up.xy + vec2f(1e-4, 0.0)); let an = vec2f(-ax.y, ax.x);
    let g = sqrt(clamp(S.ffd.w, 0.0, 1.6));
    let Lb = (3.0 + 4.5 * S.ffd.z) * g + R * 0.5; let Wb = (2.5 + 2.0 * S.ffd.z) * (0.5 + 0.5 * g) + R * 0.4;
    let o = S.up.xy + ax * (Lb * 0.75);
    let u = dot(p.xy - o, ax); let v = dot(p.xy - o, an);
    let n = fbm(p * 1.15 + vec3f(5.1, 2.3, 0.7)) - 0.5;
    let fr = clamp(u / Lb * 0.5 + 0.5, 0.0, 1.0);
    let bot = zb + 0.1 + 2.6 * fr * fr;
    let topb = el - 3.0 + 1.0 * (1.0 - fr);
    // rounded, not a cliff: the far end draws in toward the top and the bottom
    let hb = clamp((p.z - zb) / max(topb - zb, 1.0), 0.0, 1.0);
    let e = length(vec2f(u / (Lb * (0.75 + 0.35 * sin(3.1416 * hb))), v / Wb)) + n * 0.6;
    let bv = 0.8 * ss(1.0, 0.7, e) * ss(bot - 0.1, bot + 0.5, p.z + n * 0.9) * ss(topb + 0.6, topb - 0.6, p.z + n * 0.8);
    mw += bv * bv; ms += bv * bv * water(0.55);
    cloud = max(cloud, bv);
  }

  // ---- anvil: a wedge spreading downwind from the top of the updraft. Thick and lumpy where it leaves the tower,
  // thinning downstream into translucent, streaky ice; a rounded edge pushed upwind (backshear); mammatus beneath.
  if (S.anvil.w > 0.0) {
    let a0 = S.up.xy + S.tilt.xy * (el - zb);
    let ad = S.anvil.xy; let an = vec2f(-ad.y, ad.x);
    let s = dot(p.xy - a0, ad); let q = dot(p.xy - a0, an);
    let n = fbm(p * 0.8 + vec3f(3.1, 1.7, 0.0)) - 0.5;
    let streak = 0.6 * n3(vec3f(s * 0.03, q * 0.3, p.z * 0.4) + vec3f(0.2, 0.5, 0.8)) + 0.4 * n3(vec3f(s * 0.08, q * 0.12, p.z * 0.3) + vec3f(0.7, 0.1, 0.5)) - 0.5;
    let Lz = max(S.anvil.z, 2.0); let grow = S.anvil.w;
    let fr = clamp(s / Lz, 0.0, 1.0);
    let back = S.anvil2.w * grow;
    // half-width: spreads downstream; upwind it closes in a rounded nose
    let W0 = R * (1.1 + 0.5 * grow);
    let W = W0 + max(s, 0.0) * 0.4 * (0.5 + 0.5 * grow);
    let nb = max(back + R * 0.4, 0.5);
    // distance outside the anvil's outline: straight flanks downstream, an elliptical nose upwind
    let outD = select(abs(q) - W, (length(vec2f(s / nb, q / W0)) - 1.0) * W0, s < 0.0);
    let topz = S.anvil2.y - 0.4 * fr + 0.3 * exp(-max(s, 0.0) / 6.0) + n * 0.08;
    let thick = mix(2.3, 0.45, pow(fr, 0.4)) * (0.6 + 0.4 * grow);
    let botz = topz - thick + n * 0.7 + streak * 0.4 * fr;
    let inW = ss(1.0, -1.4, outD + n * 1.6 + streak * 1.2 * fr);
    let inL = 1.0 - ss(0.72, 1.0, s / Lz + n * 0.12 + streak * 0.1);
    let vert = ss(botz - 0.2, botz + 0.5, p.z) * ss(topz + 0.15, topz - 0.35, p.z);
    let dens = mix(1.0, 0.5, ss(0.15, 0.9, fr));
    let av = inW * inL * vert * dens;
    mw += av * av; ms += av * av * icy(0.5 + 0.5 * ss(0.05, 0.4, fr));
    cloud = max(cloud, av);
    // mammatus: rounded pouches hanging from the underside, nearer the storm
    if (S.anvil2.z > 0.0) {
      let pouch = ss(0.56, 0.74, n3(vec3f(p.x * 0.5, p.y * 0.5, p.z * 0.25) + vec3f(0.5, 0.1, 0.3)));
      let depth = 0.7 * S.anvil2.z * pouch;
      let under = ss(botz - depth - 0.05, botz - depth + 0.2, p.z) * (1.0 - ss(botz + 0.1, botz + 0.4, p.z));
      let mv = 0.8 * under * inW * ss(0.05, 0.15, fr) * (1.0 - ss(0.45, 0.65, fr)) * step(0.05, depth);
      mw += mv * mv; ms += mv * mv * water(0.35);
      cloud = max(cloud, mv);
    }
  }

  // ---- flanking line: an irregular line of towering cumulus along the rear-flank gust front, curving away to the
  // rear and right, tops stepping down from the main updraft. Nearer towers are older and taller and lean into the
  // updraft; each rises and sags slowly as new towers grow and merge.
  if (S.flank.z > 0.0) {
    let fd = S.flank.xy; let rn = vec2f(fd.y, -fd.x);
    var reach = 0.0;
    for (var k = 0u; k < 8u; k++) {
      if (f32(k) >= S.flank.w) { break; }
      let fk = f32(k);
      let h1 = hash1(fk * 7.31 + 1.3); let h2 = hash1(fk * 3.97 + 0.4); let h3 = hash1(fk * 5.13 + 2.2);
      let dist = R * 0.8 + 1.6 + fk * 2.7 + (h1 - 0.5) * 1.4;
      let ctr = S.up.xy + fd * dist + rn * (0.03 * dist * dist + (h2 - 0.5) * 1.3);
      let grow = clamp(S.flank.z * 1.7 - fk * 0.1, 0.0, 1.0);
      let life = 0.86 + 0.14 * sin(tmin * 0.3 + fk * 1.9);
      let Hk = (zt - zb) * (0.72 - 0.085 * fk) * (0.55 + 0.8 * h3) * grow * life;
      if (Hk < 0.25) { continue; }
      reach = max(reach, dist);
      let rk = (2.3 - 0.17 * fk) * (0.75 + 0.45 * h1) * (0.65 + 0.35 * grow);
      let lean = -fd * 0.16 * max(zr, 0.0);
      var fv = congestus(p, ctr + lean, rk, zb, zb + Hk, fk + 0.37);
      // a second, smaller turret on the same base
      let off = vec2f(h2 - 0.5, h3 - 0.5) * rk * 1.5;
      fv = max(fv, congestus(p, ctr + off + lean * 0.8, rk * 0.65, zb, zb + Hk * (0.5 + 0.45 * h1), fk + 4.1));
      let off2 = vec2f(h1 - 0.5, 0.5 - h2) * rk * 1.6;
      fv = max(fv, congestus(p, ctr + off2 + lean * 0.9, rk * 0.5, zb, zb + Hk * (0.35 + 0.5 * h2), fk + 8.3));
      mw += fv * fv; ms += fv * fv * water(1.0);
      cloud = max(cloud, fv);
    }
    // the line's shared base, a low ragged shelf joining the towers to the updraft
    if (reach > 0.0) {
      let rel = p.xy - S.up.xy; let al = dot(rel, fd);
      let off = dot(rel, rn) - 0.03 * al * al;
      let nb = n3(p * 0.7 + vec3f(0.9, 0.3, 0.1)) - 0.5;
      let sh = ss(1.1, 0.5, abs(off) + nb * 0.8) * ss(R * 0.5, R + 0.5, al) * ss(reach - 0.5, reach - 2.5, al)
        * ss(zb - 0.05, zb + 0.1, p.z) * ss(zb + 0.6 + nb * 0.4, zb + 0.2, p.z) * 0.7;
      mw += sh * sh; ms += sh * sh * water(0.6);
      cloud = max(cloud, sh);
    }
  }

  // ---- wall cloud, tail cloud, scud and inflow tail: drawn in the render pass; the volume keeps a coarse copy
  // (blue channel) only for their shadows
  let wc = S.wall.xy; let Rw = S.wall.z; let dw = p.xy - wc; let rw = length(dw);
  let near = nearField(p, 0.0);

  // ---- precipitation: streaky curtains under the forward flank, a hail core next to the updraft. Shafts come out
  // of the cloud base and reach the ground as they grow.
  let curt = (0.35 + 0.65 * ss(0.3, 0.7, n3(vec3f(p.x * 0.11 + p.z * 0.01, p.y * 0.11, p.z * 0.02))))
    * (0.55 + 0.6 * n3(vec3f(p.x * 0.45, p.y * 0.45, p.z * 0.04) + vec3f(0.3, 0.5, 0.1)));
  let below = ss(zb + 1.2, zb - 0.3, p.z);
  if (S.ffd.w > 0.0) {
    let reachF = zb * (1.0 - clamp(S.ffd.w * 1.6, 0.0, 1.0));
    let fq = p.xy - S.ffd.xy; let fa = dot(fq, fw) / (6.0 * S.ffd.z); let fb = dot(fq, lf) / (4.0 * S.ffd.z);
    rain = max(rain, S.ffd.w * exp(-(fa * fa + fb * fb)) * curt * below * ss(reachF - 0.2, reachF + 0.3, p.z));
  }
  if (S.hail.w > 0.0) {
    let reachH = zb * (1.0 - clamp(S.hail.w * 1.6, 0.0, 1.0));
    let hq = length(p.xy - S.hail.xy) / S.hail.z; let hh = exp(-hq * hq) * curt * below * ss(reachH - 0.2, reachH + 0.3, p.z);
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

  textureStore(outD, id, vec4f(sqrt(clamp(cloud, 0.0, 1.0)), sqrt(clamp(rain, 0.0, 1.0)), sqrt(clamp(near, 0.0, 1.0)), ms / mw));
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

// the tornado, drawn analytically. x: condensation funnel as a cloud field (0..1, same scale as nearField, so the
// funnel is drawn as part of the wall cloud: same threshold, same light, merging into it); y: debris, extinction 1/km
fn tornado(q: vec3f) -> vec2f {
  let zb = S.base.x;
  if (S.tor.z <= 0.0 || q.z > zb + 0.15) { return vec2f(0.0); }
  // the funnel reaches its top radius where it meets the lowered wall cloud, then keeps going up into the base
  let ztop = max(zb - 0.6 * S.wall2.x, 0.3);
  let h = clamp(q.z / ztop, 0.0, 1.0);
  let clock = S.base.z;
  // axis from the ground position up to the wall cloud, with a slow sway that grows as it ropes out
  let sway = (0.05 + 0.12 * S.tor2.w) * vec2f(sin(h * 6.0 + clock * 0.35), cos(h * 4.5 + clock * 0.28)) * sin(3.1416 * h);
  let ax = mix(S.tor.xy, S.tor3.xy, smoothstep(0.08, 0.8, h)) + sway;   // near-vertical where it leaves the ground and where it enters the cloud
  let dv = q.xy - ax; let d = length(dv);
  var rad = mix(S.tor2.x, S.tor2.y, pow(h, mix(3.0, 0.7, S.tor.w)));
  // collar: the funnel widens smoothly into a cone-shaped lowering under the wall cloud, so the two are one cloud
  let collar = smoothstep(ztop - 0.45 * ztop, ztop + 0.1, q.z);
  rad += collar * collar * (0.25 * S.wall.z + 0.3 * S.tor2.y) * (1.0 - 0.4 * S.tor2.w);
  // texture in a frame turning with the vortex: vertical striations and a ragged skin, scaled to the funnel
  let pr = rot2(dv, -clock * 0.9) / max(rad, 0.04);   // turning counter-clockwise
  let n1 = n3(vec3f(pr * 0.9, q.z * 1.1 - clock * 0.15));
  let n2 = n3(vec3f(pr * 2.6, q.z * 5.0) + vec3f(0.31, 0.77, 0.13));
  let rough = (n1 - 0.5) * 0.45 + (n2 - 0.5) * 0.3;
  // condensation reaches down to condBottom; below it the funnel thins into a translucent sheath
  let condBottom = zb * (1.0 - S.tor2.z);
  let down = smoothstep(condBottom - 0.06, condBottom + 0.12, q.z);
  let core = smoothstep(1.25, 0.45, d / rad + rough);
  let funnel = min(S.tor.z * 2.5, 1.0) * core * mix(0.55, 1.0, down) * mix(0.75, 1.0, smoothstep(0.0, 0.35, h));
  // debris and dust: a whirl at the ground, wider than the funnel, rising as a sheath around its lower part
  let dr = S.tor2.x * 2.4 + 0.06; let dh = 0.08 + 0.22 * S.tor.w * (1.0 - S.tor2.w);
  let dn = n3(vec3f(pr * 0.7 * rad / dr, q.z * 2.5) + vec3f(0.3, 0.1, 0.7));
  let whirl = smoothstep(dr, dr * 0.3, d + (dn - 0.5) * dr * 0.8) * smoothstep(dh, dh * 0.15, q.z);
  let sheath = smoothstep(rad * 1.9, rad * 1.0, d + (dn - 0.5) * rad * 0.6) * smoothstep(0.35 * zb, 0.0, q.z) * 0.35;
  let debris = S.tor3.z * (whirl + sheath) * 7.0;
  return vec2f(funnel, debris);
}

// sub-grid detail for water cloud: smooth (turb 0) to cauliflower (turb 1)
// lod 0 near .. 1 far: the finest octave fades out with distance so far clouds don't sparkle
fn detail(q: vec3f, turb: f32, lod: f32) -> f32 {
  var soft = 0.5; var lobes = 0.5;
  if (turb < 0.98) { soft = 0.55 * n3(q * 0.21) + 0.3 * n3(q * 0.6 + vec3f(0.31, 0.17, 0.53)) + 0.15 * mix(n3(q * 1.9 + vec3f(0.11, 0.71, 0.29)), 0.5, lod); }
  if (turb > 0.02) { lobes = 0.88 * billow(q) + 0.12 * mix(n3(q * 3.5 + vec3f(0.5, 0.3, 0.9)), 0.5, lod); }
  return mix(soft, lobes, turb);
}
// striations: grooves stacked up the side of the rotating updraft, rings with a slow wave in them; ang and w are
// taken in the rotating frame, so the wave (and with it the grooves) visibly turns
fn grooves(zr: f32, ang: f32, w: f32) -> f32 {
  let ph = zr / 0.8 + 0.2 * sin(ang * 2.0 + w * 4.0) + 1.1 * w + ang / 6.2832;
  let g = fract(ph);
  return pow(g, 1.4) * smoothstep(1.0, 0.9, g);
}

fn smax(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.0) / k; return max(a, b) + h * h * k * 0.25; }

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
  let torR = max(S.tor2.y * 1.3 + 0.25 * S.wall.z, S.tor2.x * 2.4 + 0.06) * 1.2 + 0.4;
  let torC = 0.5 * (S.tor.xy + S.tor3.xy);
  var col = vec3f(0.0); var T = 1.0;
  if (tb > ta) {
    let dt0 = 0.1;
    var t = ta + dt0 * hash(fc.xy + U.b.z);
    let ph = 0.45 + 1.2 * pow(max(cosg, 0.0), 8.0);
    var surf = false;
    for (var i = 0; i < 700; i++) {
      if (t > tb || T < 0.01) { break; }
      let q = cp + rd * t;
      let nearTor = S.tor.z > 0.0 && q.z < S.base.x + 0.2 && length(q.xy - torC) < torR + length(S.tor.xy - S.tor3.xy) * 0.5;
      var dt = dt0 * (1.0 + t / 50.0);
      let tc = uvw(q);
      let s = textureSampleLevel(dens, samp, tc, 0.0);
      // near-ground features: fine steps where the coarse copy says they are
      let nearOn = s.b > 0.05 && q.z < S.base.x + 0.5;
      if (surf) { dt = min(dt, 0.025 + t * 0.0015); }
      if (nearTor) { dt = 0.02 + t * 0.0006; }
      else if (nearOn) { dt = min(dt, 0.035 + t * 0.003); }
      else if (s.r <= 0.004 && s.g <= 0.004 && s.b <= 0.004) { dt = max(dt, 0.45); }
      var be = 0.0; var Lc = vec3f(0.0);
      let lt = textureSampleLevel(light, samp, tc, 0.0);
      let haze = 1.0 - exp(-t / 110.0);
      if (s.r > 0.004) {
        // material from the alpha channel: water cloud 0.3..1 (turbulence), ice 0..0.3
        let ice = 1.0 - clamp(s.a / 0.3, 0.0, 1.0);
        let turb = clamp((s.a - 0.3) / 0.7, 0.0, 1.0);
        // the updraft turns counter-clockwise: near it, detail is sampled in a frame rotating with the mesocyclone,
        // blended into the still frame around it so there is no seam
        let zr = q.z - S.base.x;
        let uc = S.up.xy + S.tilt.xy * max(zr, 0.0);
        let ud = q.xy - uc; let ur = length(ud);
        let mR = max(S.tower.y, 0.5);
        let m = select(0.0, (1.0 - smoothstep(1.25 * mR, 2.0 * mR, ur)) * (1.0 - smoothstep(6.0, 9.0, zr)) * smoothstep(-0.6, -0.1, zr), S.tilt.w > 0.0);
        var nn = 0.5; var stri = 0.0;
        let lod = smoothstep(3.0, 18.0, t);
        if (ice < 0.99) {
          if (m < 0.99) { nn = detail(q, turb, lod); }
          if (m > 0.01) {
            let udr = rot2(ud, -S.tilt.w * S.base.z);
            let qr = vec3f(uc + udr, q.z);
            nn = mix(nn, detail(qr, turb, lod), m);
            let lam = S.tower.w * (1.0 - smoothstep(2.0, 4.5, zr)) * smoothstep(-0.2, 0.15, zr);
            // only on the updraft's own surface, not on flanking towers that come within reach
            let own = 1.0 - smoothstep(1.0 * mR, 1.35 * mR, ur);
            if (lam * own > 0.01) { stri = m * own * lam * grooves(zr, atan2(udr.y, udr.x), n3(qr * 0.18 + vec3f(0.4, 0.8, 0.2))); }
          }
        }
        if (ice > 0.01) {
          // ice: fibrous streaks drawn out along the wind aloft
          let ad = S.anvil.xy; let an = vec2f(-ad.y, ad.x);
          let fib = 0.45 * n3(vec3f(dot(q.xy, ad) * 0.08, dot(q.xy, an) * 0.4, q.z * 0.7)) + 0.55 * n3(q * 0.5 + vec3f(0.2, 0.9, 0.4));
          nn = mix(nn, fib, ice);
        }
        let v = s.r + (nn - 0.5) * mix(mix(0.2, 0.5, turb), 0.5, ice) - 0.25 * stri;
        let ddW = smoothstep(0.26, 0.4, v) * (0.4 + 0.6 * smoothstep(0.4, 0.75, v));
        let ddI = smoothstep(0.18, 0.8, v) * 0.6;
        let dd = mix(ddW, ddI, ice);
        surf = T > 0.25 && v > 0.15;
        if (dd > 0.0) {
          let bc = dd * U.a.w;
          // self-shadowing of the billows, which the coarse light grid can't resolve: look a little way sunward
          var selfSh = 1.0;
          if (turb > 0.25 && ice < 0.5) {
            let qs = q + U.sd.xyz * 0.32;
            let vs = textureSampleLevel(dens, samp, uvw(qs), 0.0).r + (detail(qs, turb, 1.0) - 0.5) * 0.7 * turb;
            selfSh = 1.0 - 0.7 * turb * clamp((vs - 0.3) * 2.2, 0.0, 1.0);
          }
          let baseShade = smoothstep(S.base.x - 0.4, S.base.x + 1.5, q.z);
          // sun, sky, and light bounced up from the ground onto the base
          let bounce = vec3f(0.3, 0.33, 0.27) * (1.0 - baseShade) * 0.55;
          var c = sunc * (lt.r * ph * 1.9 * selfSh) + skyc * (0.24 + 0.6 * lt.g) * (0.75 + 0.25 * baseShade) * (0.8 + 0.2 * selfSh) + bounce;
          c *= 1.0 - 0.38 * stri;
          be += bc; Lc += c * bc;
        }
      }
      if (s.r <= 0.004) { surf = false; }
      var tv = vec2f(0.0);
      if (nearTor) { tv = tornado(q); }
      if (nearOn || tv.x > 0.0) {
        // the wall cloud and the funnel are one cloud: smooth union, then the same threshold and light
        let nw = select(0.0, nearField(q, 1.0), nearOn);
        let nv = smax(nw, tv.x, 0.15);
        let bn = smoothstep(0.22, 0.38, nv) * U.a.w * 0.8;
        if (bn > 0.0) {
          // the funnel's own share is a little darker and cooler, as condensation in the vortex usually looks
          let fs = clamp((tv.x - nw) * 3.0 + 0.5, 0.0, 1.0) * step(0.001, tv.x);
          let c = sunc * (lt.r * ph * 1.4) + skyc * (0.2 + 0.55 * lt.g) + vec3f(0.3, 0.33, 0.27) * 0.45;
          be += bn; Lc += c * mix(vec3f(0.72, 0.76, 0.82), vec3f(0.6, 0.64, 0.7), fs) * bn;
        }
      }
      if (s.g > 0.004) {
        let br = s.g * s.g * U.b.x;
        let hq = length(q.xy - S.hail.xy) / max(S.hail.z, 0.5);
        let hw = S.hail.w * exp(-hq * hq);
        let pc = mix(vec3f(0.55, 0.6, 0.66), vec3f(0.8, 0.88, 0.86), clamp(hw, 0.0, 1.0)) * (sunc * lt.r * 0.9 + skyc * (0.35 + 0.5 * lt.g));
        be += br; Lc += pc * br;
      }
      if (tv.y > 0.0) {
        // dust and debris: lit like the ground beneath, fading into the haze
        let tl = sunc * lt.r * 0.8 + skyc * (0.3 + 0.5 * lt.g) + vec3f(0.3, 0.33, 0.27) * 0.3;
        be += tv.y; Lc += tl * vec3f(0.5, 0.44, 0.37) * tv.y;
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
