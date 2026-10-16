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
  grid: vec4f,   // x cells across, y levels, z half-width km, w top km
  rfdb: vec4f,   // rear-flank downdraft surge: xy centre, z radius km, w clear slot / horseshoe amount
  anti: vec4f,   // southern curl of the surge: xy position, z anti-mesocyclone, w anticyclonic tornado
  slab: vec4f    // build pass: x first z level of this slab (the build is spread over several frames)
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
// The low-level mesocyclone: once the rear-flank downdraft surges, the rotating updraft's lower few km broaden over the
// horseshoe, so its rim rises from the horseshoe's lip into the updraft. Centre and extra radius at height zr above base
fn mesoCentre(zr: f32) -> vec2f {
  let lo = exp(-max(zr, 0.0) / 2.5);
  return S.up.xy + S.tilt.xy * max(zr, 0.0) + (S.rfdb.xy - S.up.xy) * 0.55 * S.rfdb.w * lo;
}
fn mesoExtra(zr: f32) -> f32 { return S.rfdb.z * 0.55 * S.rfdb.w * exp(-max(zr, 0.0) / 2.5); }
// angle round the updraft measured from the inflow vault (the side facing the inflow tail), -pi..pi
fn vaultAngle(d: vec2f) -> f32 { let v = S.tail.xy; return atan2(v.x * d.y - v.y * d.x, dot(v, d)); }
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
      // a broad bowl: deepest in the middle, its underside curving up to the base at the rim
      let bowl = 1.0 - pow(min(rw / Rw, 1.0), 2.4);
      let bot = zb - lw * (0.15 + 0.85 * bowl) + (n - 0.5) * 0.12 - (fringe - 0.5) * 0.18;
      var w = smoothstep(Rw + 0.15, Rw - 0.2, rw + (n - 0.5) * 1.0) * smoothstep(bot - 0.03, bot + 0.05, p.z) * smoothstep(zb + 0.3, zb + 0.05, p.z);
      // the rear-flank downdraft eats the wall cloud's southern and western side away: what's left curls round
      // the clear slot, with the tornado at its tip
      if (S.rfdb.w > 0.0) {
        let hb = smoothstep(S.rfdb.z * 0.85, S.rfdb.z * 0.55, length(p.xy - S.rfdb.xy) + (n - 0.5) * 0.7) * smoothstep(Rw * 0.55, Rw * 1.0, rw);
        w *= 1.0 - 0.8 * S.rfdb.w * hb;
      }
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
  if (S.rfdb.w > 0.0) {
    // the horseshoe: the edge of the base curling round the clear slot, closed on the east and open to the rear, its
    // northern arm running into the wall cloud and its southern arm ending in the anticyclonic curl. Thick and deep:
    // a steep, ragged face toward the slot, rising more gently outward into the base
    let db = p.xy - S.rfdb.xy; let rb = length(db); let Rs = S.rfdb.z;
    if (abs(rb - Rs) < 2.2 && p.z < zb + 1.3 && p.z > zb - 1.0) {
      let th = atan2(dot(db, S.f.zw), dot(db, S.f.xy));     // the arc runs from -170 deg (south arm) through the east to +60 (north arm)
      let am = smoothstep(-0.55, -0.33, cos(th + 0.96));
      let dl = rot2(db, -0.06 * clock);
      let nl = 0.6 * n3(vec3f(dl * 0.6, p.z * 1.2) + vec3f(0.2, 0.4, 0.9)) + 0.4 * mix(0.5, n3(vec3f(dl * 2.2, p.z * 2.6) + vec3f(0.8, 0.1, 0.3)), fine);
      let north = smoothstep(0.3, 1.0, cos(th - 0.9)); let south = smoothstep(0.5, 1.0, cos(th + 2.97));
      let D = (0.3 + 0.15 * south + 0.25 * north + 0.4 * S.wall2.x * north) * (0.75 + 0.5 * nl);
      // radial profile: x < 0 toward the slot (steep face), x > 0 outward (rising into the base)
      // a wedge of rising cloud: its underside slants up on both sides, gently toward the slot and more gently
      // outward into the base, not a vertical cliff
      let x = rb - Rs + (nl - 0.5) * 0.7;
      let prof = clamp(1.0 - max(-x, 0.0) / 1.1 - max(x, 0.0) / 0.9, 0.0, 1.0);
      let bot = zb - D * prof * prof * (3.0 - 2.0 * prof) - (nl - 0.5) * 0.2;
      // soft, ragged underside: density fades over a few hundred metres, with wisps hanging below
      let wisp = mix(0.5, n3(vec3f(dl * 3.0, p.z * 6.0) + vec3f(0.4, 0.9, 0.2)), fine);
      let lip = am * step(0.01, prof) * smoothstep(bot - 0.12 - wisp * 0.12, bot + 0.22, p.z) * smoothstep(zb + 1.2, zb + 0.6, p.z);   // its top inside the meso's base
      // the lip is the rolled underside of the mesocyclone's rim: none of it sticks out beyond the cloud above
      let mR0 = S.tower.y * 1.05 + mesoExtra(0.0);
      let cover = smoothstep(mR0 + 0.2, mR0 - 1.2, length(p.xy - mesoCentre(0.0)));
      v = max(v, S.rfdb.w * lip * cover);
    }
  }
  if (S.anti.z > 0.0) {
    // anti-mesocyclone: a small lowering at the southern curl, turning clockwise
    let da = p.xy - S.anti.xy; let ra = length(da);
    let Ra = 0.45 + 0.4 * S.anti.z;
    if (ra < Ra + 1.0 && p.z < zb + 0.3 && p.z > zb - 0.7) {
      let dra = rot2(da, 0.16 * clock);
      let na = 0.55 * n3(vec3f(dra * 0.9, p.z * 1.5) + vec3f(0.6, 0.2, 0.7)) + 0.45 * mix(0.5, n3(vec3f(dra * 2.8, p.z * 3.0) + vec3f(0.1, 0.5, 0.2)), fine);
      let la = (0.1 + 0.25 * S.anti.z) * (1.0 - 0.5 * pow(min(ra / Ra, 1.2), 4.0));
      let bot = zb - la - (na - 0.5) * 0.12;
      let lw2 = smoothstep(Ra + 0.1, Ra - 0.25, ra + (na - 0.5) * 0.6) * smoothstep(bot - 0.03, bot + 0.05, p.z) * smoothstep(zb + 0.2, zb, p.z);
      v = max(v, S.anti.z * lw2 * 0.9);
    }
  }
  if (S.tail.w > 0.0) {
    // inflow tail (beaver tail): a smooth, laminar band streaming in along the forward flank's edge
    let t0 = S.up.xy + S.f.xy * 2.5 + S.f.zw * 0.5;
    let td = S.tail.xy; let s = dot(p.xy - t0, td);
    // the tail curves: it bends toward the forward flank as it nears the storm
    let qq = dot(p.xy - t0, vec2f(-td.y, td.x)) - 0.035 * (S.tail.z - s) * (S.tail.z - s) * 0.12 + 0.6 * sin(s * 0.35);
    if (s > -2.0 && s < S.tail.z + 2.0 && abs(qq) < 5.0 && p.z > zb - 1.0 && p.z < zb + 3.0) {
      let fr = clamp(s / S.tail.z, 0.0, 1.0);
      let n = 0.55 * n3(vec3f(s * 0.05, qq * 0.45, p.z * 0.6)) + 0.45 * mix(0.5, n3(vec3f(s * 0.25, qq * 1.6, p.z * 2.5) + vec3f(0.6, 0.2, 0.4)), fine);
      // a deep band near the storm (a kilometre or more), rising as it is drawn up into the updraft's vault,
      // thinning and lowering to a ragged ribbon far out
      let near = (1.0 - fr) * (1.0 - fr);
      let wt = mix(2.6, 0.35, pow(fr, 0.7)); let zc = zb + 0.2 + 1.1 * near; let th = mix(0.15, 1.0, near);
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
  if (r > R * 2.2 || p.z > zt + R * 1.2 || p.z < zb - 0.3) { return 0.0; }
  // lumps scaled to the tower, so small and large towers have the same cauliflower character
  let ps = p / max(R, 0.4) + vec3f(seed * 3.7, seed * 1.9, seed * 5.3);
  let n = 0.62 * n3(ps * 0.3) + 0.38 * n3(ps * 0.7 + vec3f(0.3, 0.6, 0.1)) - 0.5;
  let hz = clamp((p.z - zb) / max(zt - zb, 0.3), 0.0, 1.0);
  // a tower that narrows upward into a lumpy, turreted head
  let edge = R * (0.95 - 0.35 * hz * hz) + n * R * 0.8;
  let top = zt - 1.1 * R * pow(min(r / max(R, 0.1), 1.4), 2.0) + n * R * 1.0;
  // a soft, ragged base, a little higher toward the tower's edge (air rising into it), not a flat cut
  let zbt = zb + 0.15 * clamp(r / max(R, 0.1), 0.0, 1.2) + n * 0.3;
  return ss(0.45, -0.45, r - edge) * ss(zbt - 0.15, zbt + 0.3, p.z) * ss(top + 0.25, top - 0.45, p.z);
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let nv = u32(S.grid.x); let nz = u32(S.grid.y);
  let id = vec3u(gid.x, gid.y, gid.z + u32(S.slab.x));
  if (id.x >= nv || id.y >= nv || id.z >= nz) { return; }
  let L = S.grid.z; let ZT = S.grid.w;
  let p = vec3f(-L + (f32(id.x) + 0.5) * 2.0 * L / S.grid.x, -L + (f32(id.y) + 0.5) * 2.0 * L / S.grid.x, (f32(id.z) + 0.5) * ZT / S.grid.y);
  let fw = S.f.xy; let lf = S.f.zw; let zb = S.base.x; let el = S.base.y; let tmin = S.base.w;
  // nothing above the storm's top: skip the work
  if (p.z > el + 2.5) { textureStore(outD, id, vec4f(0.0, 0.0, 0.0, water(1.0))); return; }
  var cloud = 0.0; var rain = 0.0;
  // material blended by each feature's share of the cloud here, so it changes smoothly where features meet
  var mw = 1e-4; var ms = 1e-4 * water(1.0);
  let R = S.tower.y; let zt = S.tower.x;
  let zr = p.z - zb;

  // ---- main updraft. Low down, the rotating updraft (mesocyclone): a broad, smooth barrel with a flared skirt
  // at cloud base (its striations are cut in the render pass, where they turn). Higher up, the convective tower,
  // widening like a bell into the anvil, with a domed top and an overshooting top above it.
  let c = mesoCentre(zr);
  let d = p.xy - c; let r = length(d);
  if (S.tower.z > 0.0 && r < R * 3.5 + 6.0) {
    let H = max(zt - zb, 0.5);
    let hz = clamp(zr / H, 0.0, 1.0);
    let lam = clamp(1.7 * S.tower.w, 0.0, 1.0) * (1.0 - ss(4.0, 7.5, zr));   // how laminar (striated) the updraft is here
    let young = 1.0 - clamp(S.anvil.w, 0.0, 1.0);
    // the base of a mature supercell is broad: the rotating updraft spreads out into a wide, sloping skirt of
    // striated cloud just above cloud base (the 'mothership'), widest at the bottom
    // a young tower narrows into a turreted head; a mature one widens again toward the anvil
    let flare = (0.55 * S.tower.w + 0.12 * (1.0 - young)) * exp(-max(zr, 0.0) / 1.0);
    // near the top a mature tower flares out like a trumpet into the anvil, rather than meeting it at a corner
    let trumpet = 1.4 * pow(ss(el - 5.0, el - 0.6, p.z), 2.0) * clamp(S.anvil.w, 0.0, 1.0);
    let rad0 = R * mix(1.0, 0.8, young) * (1.0 + flare - 0.22 * S.tower.w * ss(0.05, 0.35, hz) + mix(0.25 * ss(0.4, 0.8, hz) + trumpet, -0.3 * hz * hz, young));
    let rad = rad0 + mesoExtra(zr);
    let n = fbm(p) - 0.5;
    let lump = mix(0.5, 1.7, ss(1.0, 5.0, zr)) * (1.0 - 0.75 * lam);
    let edge = rad + n * 2.2 * lump;
    // domed top: rounder while the tower is young, flatter once it spreads into the anvil
    let dome = mix(0.9 * rad, 2.2, clamp(S.anvil.w, 0.0, 1.0));
    let ztc = zb + (zt - zb) * mix(1.0, 0.88, young);
    let top = ztc - dome * pow(min(r / max(rad, 0.1), 1.5), 2.0) + n * mix(1.1, 2.4, young);
    // where the side slopes gently (the skirt) the edge moves a long way per grid level: widen the ramp to match, or
    // the surface shows terraces at every level
    let ew = 0.55 + 0.05 * R * (0.9 * S.tower.w + 0.12) * exp(-max(zr, 0.0));
    // the underside: rising air condensing unevenly, so not a knife-edge plane. Ragged, soft, and sloping up away
    // from the updraft core toward the rim of the skirt
    let nb = n3(p * 0.45 + vec3f(0.3, 0.8, 0.5)) - 0.5;
    // the vault: on the inflow side (to the right of and ahead of the motion) warm, moist air streams in under a
    // raised, arched base, separating the updraft from the downdrafts behind it
    let inDir = normalize(fw * 0.45 - lf * 0.9);
    let ca = dot(d, inDir) / max(r, 0.01);
    let vault = 1.3 * S.tower.w * ss(0.15, 0.85, ca) * ss(R * 0.15, R * 0.9, r);
    let zbase = zb + 0.35 * clamp((r - R * 0.8) / max(R, 0.5), 0.0, 1.5) + vault + nb * 0.3;
    var tw = ss(ew, -ew, r - edge) * ss(zbase - 0.2, zbase + 0.35, p.z) * ss(top + 0.3, top - 0.6, p.z);
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
    if (length(vec2f(u / Lb, v / Wb)) < 1.7 && p.z < el - 1.0) {
    let n = fbm(p * 1.15 + vec3f(5.1, 2.3, 0.7)) - 0.5;
    let fr = clamp(u / Lb * 0.5 + 0.5, 0.0, 1.0);
    let bot = zb + 0.1 + 2.6 * fr * fr;
    let topb = el - 3.0 + 1.0 * (1.0 - fr);
    // rounded, not a cliff: the far end draws in toward the top and the bottom
    let hb = clamp((p.z - zb) / max(topb - zb, 1.0), 0.0, 1.0);
    let e = length(vec2f(u / (Lb * (0.75 + 0.35 * sin(3.1416 * hb))), v / Wb)) + n * 0.6;
    let bv = 0.8 * ss(1.0, 0.7, e) * ss(-R * 0.3, R * 0.6, dot(p.xy - S.up.xy, ax)) * ss(bot - 0.1, bot + 0.5, p.z + n * 0.9) * ss(topb + 0.6, topb - 0.6, p.z + n * 0.8);
    mw += bv * bv; ms += bv * bv * water(0.55);
    cloud = max(cloud, bv);
    }
  }

  // ---- the rear-flank downdraft surge eats a notch up the back of the low updraft: the clear slot. Its outline in
  // the base is the horseshoe (the flanking line and the rest of the storm are added after, so they keep their bases)
  if (S.rfdb.z > 0.0 && length(p.xy - S.rfdb.xy) < S.rfdb.z * 1.6 + 2.0 && p.z < zb + 9.0) {
    let db = p.xy - S.rfdb.xy; let rb = length(db); let Rs = S.rfdb.z;
    let th = atan2(dot(db, lf), dot(db, fw));
    let nsl = n3(vec3f(p.x * 0.35, p.y * 0.35, p.z * 0.25) + vec3f(0.7, 0.7, 0.1)) - 0.5;
    // the slot: inside the horseshoe, and out through its open, rear side to clear air behind the storm, so from the
    // front you see daylight through it under the base
    let od = cos(2.18) * fw + sin(2.18) * lf;               // the opening faces the rear, west for a NE mover (+125 deg)
    let u = dot(db, od); let vv = abs(dot(db, vec2f(-od.y, od.x)));
    let chan = ss(-0.5, 0.5, u) * ss(Rs * (0.85 + 0.08 * u), Rs * (0.55 + 0.08 * u), vv + nsl * Rs * 0.3);
    let hole = max(ss(Rs * 0.85, Rs * 0.55, rb + nsl * Rs * 0.3), chan);
    // the base over the wall cloud stays: the wall cloud hangs from it on the inner side of the northern arm
    let keep = ss(S.wall.z * 1.35, S.wall.z * 0.95, length(p.xy - S.wall.xy) + nsl * 0.5);
    // a deep notch, up through most of the storm's lower half, deepest toward the open rear side: looking up through
    // it you see light, not the underside of the updraft
    let hgt = zb + (2.5 + 5.5 * S.rfdb.w) * (0.6 + 0.4 * ss(0.3, -0.8, cos(th)));
    let slot = clamp(S.rfdb.w * hole * (1.0 - keep) * ss(hgt + 1.0, hgt - 0.9, p.z + nsl * 1.8), 0.0, 1.0);
    cloud *= 1.0 - slot;
  }

  // ---- inflow: warm, moist air streaming in from the east-south-east is drawn up into the updraft. Near the storm
  // the inflow tail thickens and climbs, rising as a smooth, banded ramp into the side of the mesocyclone: the
  // updraft's vaulted inflow side, kept apart from the rain on the forward flank
  if (S.tail.w > 0.0) {
    let t0 = S.up.xy + S.f.xy * 2.5 + S.f.zw * 0.5;
    let td = S.tail.xy; let tn = vec2f(-td.y, td.x);
    let sT = dot(p.xy - t0, td) + R * 0.6;                       // 0 at the updraft's edge, increasing outward
    let qT = dot(p.xy - t0, tn) - 0.035 * (S.tail.z - sT) * (S.tail.z - sT) * 0.12;
    if (sT > -1.0 && sT < 9.0 && abs(qT) < 6.0 && p.z < zb + 5.0) {
      let rise = exp(-max(sT, 0.0) / 3.5);
      let nI = fbm(p * 1.3 + vec3f(1.7, 0.4, 2.2)) - 0.5;
      let topI = zb + 0.7 + 3.4 * rise + nI * 0.4;
      let botI = zb + 0.12 + 0.25 * (1.0 - rise) + nI * 0.15;
      let wI = (1.0 + 2.2 * rise) * (0.8 + 0.4 * nI);
      // laminar bands along the inflow
      let band = 0.85 + 0.15 * sin(6.2832 * (p.z - zb) / 0.45 + sT * 0.4);
      let iv = S.tail.w * 0.9 * ss(wI + 0.4, wI - 0.6, abs(qT)) * ss(botI - 0.1, botI + 0.2, p.z) * ss(topI + 0.3, topI - 0.5, p.z)
        * ss(-1.0, 0.5, sT) * (1.0 - ss(6.0, 9.0, sT)) * band;
      mw += iv * iv; ms += iv * iv * water(0.15);
      cloud = max(cloud, iv);
    }
  }

  // ---- anvil: ice spreading out under the tropopause. Seen from above (satellite), an oval canopy drawn out along
  // the wind aloft: its upwind end a sharp, rounded edge just upwind of the updraft (pushed there by the backshear),
  // bubbly with overshooting tops near the updraft, its widest part well downwind, tapering again far downstream.
  // Its top is flat and smooth with faint ripples; in cross-section it is a lens, thinning to feathered edges; thick
  // near the storm, it thins downstream into streaky cirrus that fades out rather than ending at a wall. Mammatus
  // hang beneath it downwind of the storm.
  if (S.anvil.w > 0.0 && p.z > el - 9.0) {
    let a0 = S.up.xy + S.tilt.xy * (el - zb);
    let ad = S.anvil.xy; let an = vec2f(-ad.y, ad.x);
    let s = dot(p.xy - a0, ad); let q = dot(p.xy - a0, an);
    let grow = S.anvil.w; let Lz = max(S.anvil.z, 2.0);
    let fr = clamp(s / Lz, 0.0, 1.0);
    // plan: an ellipse from just upwind of the updraft to the far end, about 2.5 times as long as it is wide
    let back = S.anvil2.w * grow;
    let nb = max(back + R * 0.5, 0.5);
    let A = 0.5 * (Lz + nb); let sc = 0.5 * (Lz - nb);
    let B = R * (1.2 + 0.6 * grow) + A * 0.34 * grow;
    // a slightly egg-shaped oval: fuller toward the storm's end
    let su = (s - sc) / A;
    let Bq = B * (1.0 - 0.18 * su);
    let e = length(vec2f(su, q / max(Bq, 0.5)));
    // the updraft spreads out in all directions under the tropopause: a round canopy round it, merged with the oval
    let outD = min((e - 1.0) * min(Bq, A), length(p.xy - a0) - R * 2.6 * (0.6 + 0.4 * grow));
    if (outD < 3.5) {   // outside this the outline can't reach even with its noise
    let n = fbm(p * 0.5 + vec3f(3.1, 1.7, 0.0)) - 0.5;
    let streak = 0.6 * n3(vec3f(s * 0.022, q * 0.2, p.z * 0.25) + vec3f(0.2, 0.5, 0.8)) + 0.4 * n3(vec3f(s * 0.05, q * 0.45, p.z * 0.4) + vec3f(0.7, 0.1, 0.5)) - 0.5;
    let inPlan = ss(1.4, -2.0, outD + n * 1.0 + streak * (0.5 + 1.0 * fr));
    // cross-section: a lens, thinning to feathered edges (but a sharp, steep edge upwind)
    let qe = clamp(e, 0.0, 1.0);
    let lens = mix(sqrt(max(1.0 - qe * qe, 0.0)), pow(max(1.0 - qe * qe, 0.0), 0.2), ss(-0.3, -0.8, su));
    // vertical: flat top, a little higher over the updraft; thick near the storm, thin far out
    // over the updraft and its upwind side the top bulges up into a dome of turrets; downstream it is flat
    let headD = length(vec2f(max(-s, 0.0) / max(nb, 0.5), q / max(B, 0.5)));
    let bulge = (1.2 + 0.8 * n) * exp(-max(s, 0.0) / max(R * 2.0, 1.0)) * (1.0 - ss(0.6, 1.0, headD)) * grow;
    let topz = S.anvil2.y + 0.35 * exp(-max(s, 0.0) / 8.0) - 0.3 * fr + n * 0.06 + bulge;
    // the backsheared part stays thick, with a sharp edge, its underside sloping down toward the updraft
    let upw = ss(0.0, -nb, s);
    let thick = mix(2.7, 0.3, pow(fr, 0.55)) * mix(1.0, 0.45, upw) * (0.55 + 0.45 * grow) * (0.2 + 0.8 * lens);
    // round the updraft the underside curves down into the tower, so tower and anvil are one smooth surface
    let dA = length(p.xy - a0);
    let skirtA = 2.2 * exp(-dA / max(R * 0.9, 1.0)) * (1.0 - ss(R * 1.2, R * 2.2, dA)) * grow;
    let botz = topz - thick - skirtA + n * 0.5 * thick + streak * 0.2 * fr;
    // a soft top over several grid levels, so the gently sloping top doesn't show a contour line where it crosses one
    let vert = ss(botz - 0.2, botz + 0.35, p.z) * ss(topz + 0.25, topz - 0.55, p.z + streak * 0.25);
    // downstream it thins into cirrus and fades out
    let dens = mix(1.0, 0.3, ss(0.05, 0.9, fr)) * (1.0 - ss(0.7, 1.05, fr + streak * 0.2)) * mix(0.6, 1.0, lens);
    let av = inPlan * vert * dens;
    // lumpy knuckles round the head near the updraft; smooth, streaky ice further out
    // the head of the storm, the upwind end and the first stretch downwind, is cauliflower like the tower beneath
    // it; the texture smooths out into streaky ice further downstream
    // cauliflower in the core of the head, over and just round the updraft, blending out into ice towards the rim
    let knuckle = (1.0 - ss(R * 1.0, R * 1.0 + 0.18 * Lz, s)) * (1.0 - ss(0.35, 0.85, qe));
    mw += av * av; ms += av * av * mix(icy(0.35 + 0.65 * ss(0.02, 0.3, fr)), water(0.9), knuckle);
    cloud = max(cloud, av);
    // mammatus: rounded pouches hanging from the underside, in a band downwind of the storm. Each is a lobe on a
    // jittered grid (about 1.6 km apart), so they read as round bulges rather than a blotchy texture
    if (S.anvil2.z > 0.0 && fr > 0.03 && fr < 0.6 && false) {   // mammatus off for now: at this grid they read as holes
      let cs = 3.4;   // large enough for the volume grid to resolve them as round, not blocky
      let g = p.xy / cs; let gi = floor(g);
      var dep = 0.0;
      for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
          let c = gi + vec2f(f32(ox), f32(oy));
          let h1 = hash1(c.x * 17.3 + c.y * 91.7); let h2 = hash1(c.x * 43.1 + c.y * 7.9); let h3 = hash1(c.x * 5.7 + c.y * 61.3);
          let ctr = (c + vec2f(0.2 + 0.6 * h1, 0.2 + 0.6 * h2)) * cs;
          let rr = cs * (0.34 + 0.2 * h3);
          let d = length(p.xy - ctr) / rr;
          dep = max(dep, rr * 0.35 * (1.0 - d * d) * step(0.3, h3) * step(d, 1.0));
        }
      }
      let band = ss(0.03, 0.1, fr) * (1.0 - ss(0.4, 0.6, fr)) * lens;
      let depth = 0.45 * S.anvil2.z * band * dep;
      let mv = 0.85 * inPlan * ss(botz - depth - 0.15, botz - depth + 0.2, p.z) * (1.0 - ss(botz + 0.05, botz + 0.3, p.z)) * ss(0.02, 0.12, depth);
      mw += mv * mv; ms += mv * mv * icy(0.95);   // shaded like the anvil's underside, not as separate dark blobs
      cloud = max(cloud, mv);
    }
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
      let Hk = (zt - zb) * (0.5 - 0.06 * fk) * (0.55 + 0.8 * h3) * grow * life;
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
    let rel = p.xy - S.up.xy; let al = dot(rel, fd);
    let off = dot(rel, rn) - 0.03 * al * al;
    if (reach > 0.0 && abs(off) < 2.5 && al > 0.0 && al < reach + 1.0 && p.z < zb + 1.6) {
      let nb = n3(p * 0.7 + vec3f(0.9, 0.3, 0.1)) - 0.5;
      let sh = ss(1.1, 0.5, abs(off) + nb * 0.8) * ss(R * 0.5, R + 0.5, al) * ss(reach - 0.5, reach - 2.5, al)
        * ss(zb - 0.1 + nb * 0.3, zb + 0.3 + nb * 0.3, p.z) * ss(zb + 0.8 + nb * 0.4, zb + 0.35, p.z) * 0.7;
      mw += sh * sh; ms += sh * sh * water(0.6);
      cloud = max(cloud, sh);
    }
  }

  // ---- towers on the rear-flank gust front: the surge lifts the air at its edge into cumulus that build up the side
  // of the storm and merge with the updraft, so the horseshoe lip is the base of rising cloud
  if (S.rfdb.w > 0.0 && S.rfdb.z > 0.0) {
    let rc = S.rfdb.xy; let Rs = S.rfdb.z;
    for (var k = 0u; k < 5u; k++) {
      let fk = f32(k);
      // along the arc from the south arm (-170 deg) through the east to the north arm (+60 deg)
      let th = radians(-165.0 + fk * 52.0);
      let dir = cos(th) * fw + sin(th) * lf;
      let h1 = hash1(fk * 3.3 + 7.1); let h2 = hash1(fk * 5.9 + 1.7);
      let ctr = rc + dir * Rs * (1.0 + 0.15 * h1);
      // taller toward the updraft, leaning in toward it
      let toUp = S.up.xy - ctr; let dU = length(toUp);
      let Hk = (zt - zb) * (0.28 + 0.3 * h2) * (0.6 + 0.4 * ss(R * 3.0, R * 1.0, dU)) * S.rfdb.w;
      let lean = toUp / max(dU, 0.1) * 0.12 * max(zr, 0.0);
      let fv = congestus(p, ctr + lean, (1.1 + 0.6 * h1) * (0.6 + 0.4 * S.rfdb.w), zb + 0.05, zb + Hk, 20.0 + fk * 2.3);
      mw += fv * fv; ms += fv * fv * water(1.0);
      cloud = max(cloud, fv);
    }
  }

  // ---- wall cloud, tail cloud, scud and inflow tail: drawn in the render pass; the volume keeps a coarse copy
  // (blue channel) only for their shadows
  let wc = S.wall.xy; let Rw = S.wall.z; let dw = p.xy - wc; let rw = length(dw);
  let near = nearField(p, 0.0);

  // ---- precipitation: streaky curtains under the forward flank, a hail core next to the updraft. Shafts come out
  // of the cloud base and reach the ground as they grow.
  let below = ss(zb + 1.2, zb - 0.3, p.z);
  var curt = 0.0;
  if (below > 0.0) {
    curt = (0.35 + 0.65 * ss(0.3, 0.7, n3(vec3f(p.x * 0.11 + p.z * 0.01, p.y * 0.11, p.z * 0.02))))
      * (0.55 + 0.6 * n3(vec3f(p.x * 0.45, p.y * 0.45, p.z * 0.04) + vec3f(0.3, 0.5, 0.1)));
  }
  if (S.ffd.w > 0.0 && below > 0.0) {
    let reachF = zb * (1.0 - clamp(S.ffd.w * 1.6, 0.0, 1.0));
    let fq = p.xy - S.ffd.xy; let fa = dot(fq, fw) / (6.0 * S.ffd.z); let fb = dot(fq, lf) / (4.0 * S.ffd.z);
    rain = max(rain, S.ffd.w * exp(-(fa * fa + fb * fb)) * curt * below * ss(reachF - 0.2, reachF + 0.3, p.z));
  }
  if (S.hail.w > 0.0 && below > 0.0) {
    let reachH = zb * (1.0 - clamp(S.hail.w * 1.6, 0.0, 1.0));
    let hq = length(p.xy - S.hail.xy) / S.hail.z; let hh = exp(-hq * hq) * curt * below * ss(reachH - 0.2, reachH + 0.3, p.z);
    rain = max(rain, S.hail.w * hh * 0.9);
  }

  // ---- rear-flank downdraft rain: curtains wrapping round the north and west of the surge (the hook), and round
  // all of it in an HP storm
  if (S.rfdb.z > 0.0 && below > 0.0) {
    let db = p.xy - S.rfdb.xy; let rb = length(db); let Rs = S.rfdb.z;
    let th = atan2(dot(db, lf), dot(db, fw));
    let nsl = n3(vec3f(p.x * 0.35, p.y * 0.35, p.z * 0.25) + vec3f(0.7, 0.7, 0.1)) - 0.5;
    let hook = max(ss(-0.25, 0.55, cos(th - 1.9)), S.rfd.w);
    let ring = ss(Rs * 0.45, Rs * 0.8, rb + nsl * 0.8) * ss(Rs * 1.15, Rs * 0.92, rb + nsl * 0.6);
    rain = max(rain, S.rfd.z * ring * hook * curt * below * 0.6);
  }

  textureStore(outD, id, vec4f(sqrt(clamp(cloud, 0.0, 1.0)), sqrt(clamp(rain, 0.0, 1.0)), sqrt(clamp(near, 0.0, 1.0)), ms / mw));
}`;


/**
 * Lighting on a half-resolution grid, computed once per volume update (not per pixel per frame):
 *   r  sun transmittance, including a near sunward blocker for water cloud
 *   g  skylight (transmittance straight up)
 *   b  how open the sky is just overhead: dark under bases and shelves (water cloud)
 *   a  ice shade: anvil undersides in the shade of the ice above them, lit tops and rims (ice)
 */
export const LIGHT = /* wgsl */`
struct LU { sun: vec4f, dims: vec4f, p: vec4f };   // dims: light-grid N, NZ, L km, ZT km; p: cloud max, rain max, step km, cloud base km
@group(0) @binding(0) var dens: texture_3d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var outL: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> U: LU;
fn uvw(p: vec3f) -> vec3f { return vec3f((p.x + U.dims.z) / (2.0 * U.dims.z), (p.y + U.dims.z) / (2.0 * U.dims.z), p.z / U.dims.w); }
fn dr(p: vec3f) -> f32 { return textureSampleLevel(dens, samp, uvw(p), 0.0).r; }
fn beta(p: vec3f) -> f32 { let d = textureSampleLevel(dens, samp, uvw(p), 0.0); return (d.r * d.r + d.b * d.b) * U.p.x + d.g * d.g * U.p.y; }
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let nv = u32(U.dims.x); let nz = u32(U.dims.y);
  if (id.x >= nv || id.y >= nv || id.z >= nz) { return; }
  let dx = 2.0 * U.dims.z / U.dims.x; let dz = U.dims.w / U.dims.y;
  let pos = vec3f(-U.dims.z + (f32(id.x) + 0.5) * dx, -U.dims.z + (f32(id.y) + 0.5) * dx, (f32(id.z) + 0.5) * dz);
  let here = textureSampleLevel(dens, samp, uvw(pos), 0.0);
  let ice = 1.0 - clamp(here.a / 0.3, 0.0, 1.0);
  let zb = U.p.w;
  // sun: march toward the sun in steps of st
  let st = U.p.z;
  var tau = 0.0; var q = pos + U.sun.xyz * 0.5 * st;
  for (var i = 0; i < 40; i++) {
    if (q.z > U.dims.w || abs(q.x) > U.dims.z || abs(q.y) > U.dims.z) { break; }
    tau += beta(q) * st; q += U.sun.xyz * st;
  }
  var sun = 0.72 * exp(-0.38 * tau) + 0.28 * exp(-0.07 * tau);
  // water cloud: a blocker a little way sunward shades this cell (crevices between billows, the lee of a base's edge)
  if (ice < 0.2) { sun *= 1.0 - 0.5 * clamp((dr(pos + U.sun.xyz * 0.9) - 0.3) * 2.0, 0.0, 1.0); }
  // sky: march straight up in steps of 2 dz
  var up = 0.0; var r = pos + vec3f(0.0, 0.0, dz);
  for (var i = 0; i < 24; i++) { if (r.z > U.dims.w) { break; } up += beta(r) * 2.0 * dz; r.z += 2.0 * dz; }
  // overhead: cloud just above this cell hides the sky (undersides of bases and shelves), not high in the storm
  let vUp = dr(pos + vec3f(0.0, 0.0, 0.5));
  let skyOcc = 1.0 - 0.75 * (1.0 - smoothstep(zb + 2.0, zb + 4.0, pos.z)) * clamp((vUp - 0.3) * 2.2, 0.0, 1.0);
  // ice: the anvil's underside is in the shade of the ice above it; its top and rim stay bright. Probe up and toward
  // the sun, and compare ice above with ice below (sampled over a couple of km, so mammatus share the shade)
  var iceShade = 1.0;
  if (ice > 0.05) {
    let above = clamp((dr(pos + vec3f(0.0, 0.0, 0.6)) - 0.1) * 3.0, 0.0, 1.0) * 0.55 + clamp((dr(pos + vec3f(0.0, 0.0, 1.5)) - 0.1) * 3.0, 0.0, 1.0) * 0.45;
    let sunward = clamp((dr(pos + U.sun.xyz * 1.2) - 0.1) * 3.0, 0.0, 1.0) * 0.55 + clamp((dr(pos + U.sun.xyz * 3.0) - 0.1) * 3.0, 0.0, 1.0) * 0.45;
    var ua = 0.0; var dn = 0.0;
    for (var k = 0; k < 4; k++) {
      let o = vec3f(cos(f32(k) * 1.571), sin(f32(k) * 1.571), 0.0) * 1.2;
      ua += dr(pos + o + vec3f(0.0, 0.0, 1.0)); dn += dr(pos + o - vec3f(0.0, 0.0, 1.0));
    }
    let under = smoothstep(0.0, 0.4, (ua - 1.5 * dn) * 0.25);
    iceShade = (1.0 - 0.8 * sunward) * (1.0 - 0.8 * under) * (1.0 - 0.3 * above);
  }
  textureStore(outL, id, vec4f(sun, exp(-0.1 * up), skyOcc, iceShade));
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
  // the finest octaves only up close (lod < 1): far away they would only add sparkle, and they cost samples
  var f1 = 0.5; var f2 = 0.5;
  if (lod < 0.98) { f1 = mix(n3(q * 1.9 + vec3f(0.11, 0.71, 0.29)), 0.5, lod); f2 = mix(n3(q * 3.5 + vec3f(0.5, 0.3, 0.9)), 0.5, lod); }
  if (turb < 0.98) { soft = 0.55 * n3(q * 0.21) + 0.3 * n3(q * 0.6 + vec3f(0.31, 0.17, 0.53)) + 0.15 * f1; }
  if (turb > 0.02) { lobes = 0.88 * billow(q) + 0.12 * f2; }
  return mix(soft, lobes, turb);
}
// striations: grooves stacked up the side of the rotating updraft, rings with a slow wave in them; ang and w are
// taken in the rotating frame, so the wave (and with it the grooves) visibly turns
// av: angle from the inflow vault in the still frame; the bands sweep down toward it from both sides, so the
// striations all point in to where the inflow enters
fn grooves(zr: f32, ang: f32, w: f32, av: f32) -> f32 {
  let ph = zr / 0.8 + 0.2 * sin(ang * 2.0 + w * 4.0) + 1.1 * w + 0.35 * ang / 6.2832 + 1.7 * (1.0 - abs(av) / 3.1416);
  let g = fract(ph);
  return pow(g, 1.4) * smoothstep(1.0, 0.72, g);   // eased back to the next lip, so no hard step to alias
}

// the rare anticyclonic tornado at the southern curl of the surge: slender, turning clockwise
fn antiTornado(q: vec3f) -> vec2f {
  let zb = S.base.x;
  if (S.anti.w <= 0.0 || q.z > zb + 0.1) { return vec2f(0.0); }
  let clock = S.base.z;
  let ztop = max(zb - 0.1 - 0.25 * S.anti.z, 0.3);
  let h = clamp(q.z / ztop, 0.0, 1.0);
  let sway = 0.07 * vec2f(sin(h * 5.0 + clock * 0.4), cos(h * 4.0 + clock * 0.3)) * sin(3.1416 * h);
  let dv = q.xy - (S.anti.xy - S.f.xy * 0.25 * (1.0 - h) + sway); let d = length(dv);
  var rad = mix(0.03, 0.07, pow(h, 1.5)) * (0.6 + 0.4 * min(S.anti.w * 2.0, 1.0));
  let collar = smoothstep(ztop * 0.6, ztop + 0.08, q.z);
  rad += collar * collar * 0.25;
  let pr = rot2(dv, clock * 1.1) / max(rad, 0.03);   // turning clockwise
  let rough = (n3(vec3f(pr * 0.9, q.z * 1.3)) - 0.5) * 0.45 + (n3(vec3f(pr * 2.6, q.z * 5.0) + vec3f(0.5, 0.2, 0.9)) - 0.5) * 0.3;
  let funnel = min(S.anti.w * 2.5, 1.0) * smoothstep(1.25, 0.45, d / rad + rough) * smoothstep(zb * 0.25, zb * 0.45, q.z);
  let dn = n3(vec3f(pr * 0.25, q.z * 2.5) + vec3f(0.3, 0.1, 0.7));
  let debris = S.anti.w * smoothstep(0.12, 0.04, d + (dn - 0.5) * 0.08) * smoothstep(0.1, 0.02, q.z) * 6.0;
  return vec2f(funnel, debris);
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
  // low evening sun: warm and a little dimmer; the sky and haze a touch warmer near the horizon
  let sunc = vec3f(1.0, 0.82, 0.6) * 0.95; let skyc = vec3f(0.42, 0.52, 0.68);
  let hazec = vec3f(0.68, 0.68, 0.7);
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
      let nearAnti = S.anti.w > 0.0 && q.z < S.base.x + 0.2 && length(q.xy - S.anti.xy) < 0.75;
      var dt = dt0 * (1.0 + t / 50.0);
      let tc = uvw(q);
      let s = textureSampleLevel(dens, samp, tc, 0.0);
      // near-ground features: fine steps where the coarse copy says they are
      let nearOn = s.b > 0.05 && q.z < S.base.x + 1.2;
      if (surf) { dt = min(dt, 0.025 + t * 0.0015); }
      if (nearTor || nearAnti) { dt = 0.02 + t * 0.0006; }
      else if (nearOn) { dt = min(dt, 0.035 + t * 0.003); }
      else if (s.r <= 0.004 && s.g <= 0.004 && s.b <= 0.004) { dt = max(dt, 0.45 * (1.0 + t / 40.0)); }   // empty air: stride
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
        let uc = mesoCentre(zr);
        let ud = q.xy - uc; let ur = length(ud);
        let mR = max(S.tower.y, 0.5);
        let radAt = mR * (1.0 + (0.55 * S.tower.w + 0.12) * exp(-max(zr, 0.0) / 1.0)) + mesoExtra(zr);
        let m = select(0.0, (1.0 - smoothstep(1.25 * radAt, 2.0 * radAt, ur)) * (1.0 - smoothstep(6.0, 9.0, zr)) * smoothstep(-0.6, -0.1, zr), S.tilt.w > 0.0);
        var nn = 0.5; var stri = 0.0;
        let lod = smoothstep(3.0, 18.0, t);
        if (ice < 0.99) {
          // one detail lookup at a position blended between the still and the rotating frame: continuous, so no seam
          var qr = q; var udr = ud;
          if (m > 0.01) { udr = rot2(ud, -S.tilt.w * S.base.z); qr = vec3f(mix(q.xy, uc + udr, m), q.z); }
          nn = detail(qr, turb, lod);
          if (m > 0.01) {
            let lam = clamp(1.7 * S.tower.w, 0.0, 1.0) * (1.0 - smoothstep(4.0, 7.5, zr)) * smoothstep(0.15, 0.7, zr);   // on the sides, not the ragged base
            // only on the updraft's own surface, not on flanking towers that come within reach
            let own = 1.0 - smoothstep(0.75 * radAt, 1.05 * radAt, ur);   // not on the thin rim of the skirt, where grooves would cut teeth
            if (lam * own > 0.01) { stri = m * own * lam * grooves(zr, atan2(udr.y, udr.x), n3(qr * 0.18 + vec3f(0.4, 0.8, 0.2)), vaultAngle(ud)); }
          }
        }
        // water cloud: the field plus billowed detail, cut at a crisp threshold
        let v = s.r + (nn - 0.5) * mix(0.2, 0.5, turb) - 0.25 * stri;
        let lowSoft = 1.0 - smoothstep(S.base.x + 0.2, S.base.x + 0.8, q.z);   // undersides: soft and ragged
        let ddW = mix(smoothstep(0.26, 0.4, v), smoothstep(0.18, 0.55, v), lowSoft) * (0.4 + 0.6 * smoothstep(0.4, 0.75, v));
        // ice (the anvil): thin layers, not lumps. Sheets stacked a few hundred metres apart, gently warped, drawn
        // out into long streaks along the wind aloft. The texture scales the density (no threshold), so the ice is
        // translucent and its edges fade into wisps
        var ddI = 0.0;
        if (ice > 0.01) {
          let ad = S.anvil.xy; let an = vec2f(-ad.y, ad.x);
          let ua = dot(q.xy, ad); let va = dot(q.xy, an);
          let warp = n3(vec3f(ua * 0.012, va * 0.05, 0.37));
          let layers = 0.5 + 0.5 * cos(6.2832 * (q.z / 0.42 + 2.2 * warp));
          let streak = n3(vec3f(ua * 0.01, va * 0.22, q.z * 0.5) + vec3f(0.6, 0.2, 0.9));
          var fine = 0.5;
          if (lod < 0.98) { fine = mix(n3(vec3f(ua * 0.04, va * 0.8, q.z * 1.6) + vec3f(0.1, 0.5, 0.3)), 0.5, lod); }
          let iceTex = 0.3 + 0.7 * clamp(0.45 * layers + 0.35 * streak + 0.2 * fine + 0.1, 0.0, 1.0);
          let vI = s.r * iceTex;
          ddI = smoothstep(0.04, 0.8, vI) * 0.55;
        }
        // blend by the material, which changes gradually from the tower's cauliflower into the anvil's ice
        let dd = mix(ddW, ddI, smoothstep(0.0, 1.0, ice));
        surf = T > 0.25 && v > 0.15;
        if (dd > 0.0) {
          let bc = dd * U.a.w;
          // self-shadowing of the billows, which the coarse light grid can't resolve: look a little way sunward
          // self-shadowing of billows at a finer scale than the light grid: one probe a little way sunward with
          // the billow detail added (the coarser blocker term is in the light grid's sun channel)
          var selfSh = 1.0;
          if (turb > 0.25 && ice < 0.2) {
            let q1 = q + U.sd.xyz * 0.3;
            let v1 = textureSampleLevel(dens, samp, uvw(q1), 0.0).r + (billow(q1) - 0.5) * 0.7 * turb;
            selfSh = 1.0 - 0.75 * turb * clamp((v1 - 0.3) * 2.2, 0.0, 1.0);
          }
          // undersides of bases and shelves get little sky (light grid b); the anvil's underside sits in the shade of
          // the ice above it (light grid a)
          let skyOcc = mix(lt.b, 1.0, ice);
          let baseShade = smoothstep(S.base.x - 0.4, S.base.x + 1.5, q.z);
          // sun, sky, and light bounced up from the ground onto the base
          let bounce = vec3f(0.27, 0.29, 0.3) * (1.0 - baseShade) * 0.55;
          let iceSun = mix(1.0, lt.a, ice); let iceSky = mix(1.0, 0.3 + 0.7 * lt.a, ice);
          var c = sunc * (lt.r * ph * 1.9 * selfSh * iceSun) + skyc * (0.24 + 0.6 * lt.g) * (0.75 + 0.25 * baseShade) * (0.8 + 0.2 * selfSh) * skyOcc * iceSky + bounce;
          c *= 1.0 - 0.38 * stri;
          be += bc; Lc += c * bc;
        }
      }
      if (s.r <= 0.004) { surf = false; }
      var tv = vec2f(0.0);
      if (nearTor) { tv = tornado(q); }
      if (nearAnti) { let ta = antiTornado(q); tv = vec2f(max(tv.x, ta.x), tv.y + ta.y); }
      if (nearOn || tv.x > 0.0) {
        // the wall cloud and the funnel are one cloud: smooth union, then the same threshold and light
        let nw = select(0.0, nearField(q, 1.0), nearOn);
        let nv = smax(nw, tv.x, 0.15);
        // the funnel's own share: a softer, more translucent edge than the wall cloud, a little darker and cooler
        let fs = clamp((tv.x - nw) * 3.0 + 0.5, 0.0, 1.0) * step(0.001, tv.x);
        let lowN = 1.0 - smoothstep(S.base.x - 0.1, S.base.x + 0.3, q.z);
        let bn = mix(mix(smoothstep(0.22, 0.38, nv), smoothstep(0.14, 0.55, nv), 0.6 * lowN), smoothstep(0.12, 0.6, nv) * 0.75, fs) * U.a.w * 0.8;
        if (bn > 0.0) {
          // lowered cloud is lit mostly from the side and below: darker the further it hangs under the base
          let under0 = 0.6 + 0.4 * smoothstep(S.base.x - 0.5, S.base.x + 0.1, q.z);
          // under the storm's base the low cloud is in deep shade: dense cloud just above it hides sun and sky
          let under = under0 * (0.2 + 0.8 * lt.b);
          let c = (sunc * (lt.r * ph * 1.4) + skyc * (0.2 + 0.55 * lt.g)) * under + vec3f(0.27, 0.29, 0.3) * 0.45;
          be += bn; Lc += c * mix(vec3f(0.72, 0.76, 0.82), vec3f(0.6, 0.64, 0.7), fs) * bn;
        }
      }
      if (s.g > 0.004) {
        let br = s.g * s.g * U.b.x;
        let hq = length(q.xy - S.hail.xy) / max(S.hail.z, 0.5);
        let hw = S.hail.w * exp(-hq * hq);
        let fwd = 1.0 + 2.2 * pow(max(cosg, 0.0), 4.0);     // rain scatters forward: curtains glow against the light
        let pc = mix(vec3f(0.55, 0.6, 0.66), vec3f(0.8, 0.88, 0.86), clamp(hw, 0.0, 1.0)) * (sunc * lt.r * 0.9 * fwd + skyc * (0.35 + 0.5 * lt.g));
        be += br; Lc += pc * br;
      }
      if (tv.y > 0.0) {
        // dust and debris: lit like the ground beneath, fading into the haze
        let tl = sunc * lt.r * 0.8 + skyc * (0.3 + 0.5 * lt.g) + vec3f(0.27, 0.29, 0.3) * 0.3;
        be += tv.y; Lc += tl * vec3f(0.5, 0.44, 0.37) * tv.y;
      }
      // light shafts: haze under the storm (where the sky is hidden overhead) lit where sunlight gets through, i.e. the
      // clear slot, and dark in the storm's shadow
      if (q.z < S.base.x + 0.3 && lt.g < 0.9) {
        let ks = 0.05 * (1.0 - lt.g);
        let sc = sunc * lt.r * (0.25 + 2.4 * pow(max(cosg, 0.0), 6.0)) * 0.9;
        let ah = 1.0 - exp(-ks * dt);
        col += T * ah * sc; T *= 1.0 - ah;
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
    // low sun: dimmer, warmer fields where it reaches them
    bg = groundColor(gp, tg) * (0.4 + 0.42 * sh * vec3f(1.05, 0.95, 0.82)) * (1.0 - hz) + hazec * hz * 0.85;
  } else {
    let el = clamp(rd.z, 0.0, 1.0);
    // horizon glow, warmer toward the sun
    let hz = mix(vec3f(0.78, 0.8, 0.84), vec3f(0.95, 0.82, 0.66), pow(max(cosg, 0.0), 3.0) * 0.8);
    bg = hz * pow(1.0 - el, 3.0) + vec3f(0.33, 0.47, 0.72) * (1.0 - pow(1.0 - el, 3.0)) + 0.5 * pow(max(cosg, 0.0), 24.0) * vec3f(1.0, 0.85, 0.6);
  }
  var cc = col + T * bg;
  cc = 1.0 - exp(-U.b.y * cc);
  return vec4f(pow(cc, vec3f(1.0 / 1.1)), 1.0);
}`;
