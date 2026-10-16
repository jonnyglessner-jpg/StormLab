/**
 * The designed storm: a supercell built from the conceptual model forecasters use (Lemon & Doswell 1979 and later
 * work), not solved from equations. The setup's environment decides how strong, how rotating, how wet and which
 * way the storm goes; a timed lifecycle decides when each feature appears.
 *
 * Coordinates are km in the storm's frame (it moves with the storm): x east, y north, z up. The updraft sits at
 * `up`, offset upstream of the volume's centre so the anvil has room downstream.
 */
import { clamp } from '../physics/constants';
import { type Environment } from '../physics/environment';
import { tornadoParams, type StormDiag } from '../physics/storm';
import { at } from '../physics/winds';

/** Number of vec4 slots in the parameter block (must match the WGSL struct SP in shaders.ts). */
export const NSLOT = 20;

/** One moment of the storm, as numbers the GPU builder and renderer read. */
export interface StormFrame {
  /** packed parameters for the GPU (NSLOT x vec4) */
  params: Float32Array;
  /** what's happening now, for captions */
  stage: string;
  caption: string;
  /** tornado on the ground (0..1) */
  tornado: number;
}

/** Fixed properties of a storm for one setup. */
export interface StormPlan {
  kind: 'supercell' | 'pulse' | 'capped' | 'none';
  /** cloud base and storm top (equilibrium level), km */
  zb: number; el: number;
  /** storm motion, m/s, and its unit vector; left normal */
  motion: [number, number]; fwd: [number, number]; lft: [number, number];
  /** anvil direction (storm-relative wind aloft) */
  adir: [number, number];
  /** updraft tilt, km per km of height */
  tilt: [number, number];
  /** updraft radius, km */
  R: number;
  striation: number;
  /** precipitation scales */
  ffd: number; hail: number; rfd: number; wrap: number; slot: number; tail: number;
  anvilLen: number;
  /** wall cloud radius and lowering, km; rotation rate, rad/s */
  Rw: number; lower: number; spin: number;
  /** mesocyclone's visible spin, rad/s (counter-clockwise) */
  mesoSpin: number;
  /** tornado: whether the storm makes one, its type (0 slender .. 1 wedge), ground radius km */
  tornadic: boolean; torType: number; torR: number;
  /** anticyclonic circulation at the southern curl of the RFD surge: anti-mesocyclone strength (0..1), and whether
   * this storm (rarely) puts down an anticyclonic tornado there */
  antiMeso: number; antiTornado: boolean;
  /** total length of the lifecycle, min */
  duration: number;
}

const unit = (u: number, v: number): [number, number] => { const m = Math.hypot(u, v) || 1; return [u / m, v / m]; };
const ramp = (t: number, a: number, b: number) => { const x = clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

export function planStorm(E: Environment, S: StormDiag): StormPlan {
  const zb = clamp(E.pc.lcl / 1000, 0.5, 2.6), el = clamp((E.pc.el ?? 12000) / 1000, 8, 15.5);
  const rm = E.bk.rm, motion: [number, number] = [rm[0], rm[1]];
  const fwd = unit(rm[0], rm[1]), lft: [number, number] = [-fwd[1], fwd[0]];
  const adir = unit(at(E.w.u, 10000) - rm[0], at(E.w.v, 10000) - rm[1]);
  const sh = unit(at(E.w.u, 6000) - E.w.u[0], at(E.w.v, 6000) - E.w.v[0]);
  const tiltAmt = 0.1 * clamp(E.shear6 / 25, 0, 1.4);
  const kind: StormPlan['kind'] = !S.forms ? (S.capped ? 'capped' : 'none') : S.mode === 'pulse' || S.mode === 'multicell' ? 'pulse' : 'supercell';
  const lp = S.precip === 'lp', hp = S.precip === 'hp';
  const R = clamp(2.2 + 1.3 * clamp((S.w - 20) / 30, 0, 1), 2.0, 3.5) * (lp ? 0.85 : 1);
  const tp = S.ptor > 0 ? tornadoParams(S, S.vMed) : null;
  const rcKm = tp ? tp.rc * 0.9144 / 1000 : 0.1;
  const meso = clamp(S.vLow / 20, 0.3, 1.2);
  return {
    kind, zb, el, motion, fwd, lft, adir, tilt: [sh[0] * tiltAmt, sh[1] * tiltAmt], R,
    striation: (lp ? 1 : hp ? 0.3 : 0.65) * clamp(S.vMid / 18, 0.4, 1.2),
    ffd: lp ? 0.35 : hp ? 1.5 : 1, hail: lp ? 0.6 : hp ? 1.1 : 1, rfd: lp ? 0.25 : hp ? 1.4 : 0.9,
    wrap: hp ? 0.75 : 0, slot: hp ? 0.45 : lp ? 0.8 : 1, tail: lp ? 0.6 : hp ? 0.85 : 1,
    anvilLen: clamp(28 + 1.1 * E.srAnvil, 20, 62),
    Rw: clamp(1.1 + 0.9 * meso, 1.0, 2.2) * (hp ? 1.2 : 1), lower: clamp(0.25 + 0.3 * meso, 0.2, 0.6) * clamp(1.6 - zb / 2, 0.6, 1.3),
    spin: 0.04 + 0.08 * meso, mesoSpin: 0.025 + 0.03 * meso,
    tornadic: kind === 'supercell' && S.ptor >= 0.3,
    torType: rcKm < 0.07 ? 0.15 : rcKm < 0.18 ? 0.5 : 0.9, torR: clamp(rcKm, 0.03, 0.45),
    antiMeso: kind === 'supercell' && S.ptor >= 0.3 ? clamp(E.srh1 / 300, 0.4, 1) : 0,
    antiTornado: kind === 'supercell' && E.stp >= 4,
    duration: kind === 'supercell' ? 110 : 70
  };
}

/** Wall-cloud / tornado cycle: the first wall cloud forms at 30 min, then every 38 min. */
const CYCLE0 = 30, CYCLE = 38;

/** Everything at storm time t (min). `clock` is wall-clock seconds, for motion inside features (spin, sway). */
export function stormAt(P: StormPlan, t: number, clock: number): StormFrame {
  const a = new Float32Array(NSLOT * 4);
  const set = (slot: number, x: number, y: number, z: number, w: number) => a.set([x, y, z, w], slot * 4);
  const [fx, fy] = P.fwd, [lx, ly] = P.lft;
  const at2 = (f: number, l: number, o: [number, number] = up): [number, number] => [o[0] + f * fx + l * lx, o[1] + f * fy + l * ly];
  // updraft 15 km upstream of the volume's centre along the anvil, so the anvil fits downstream
  const up: [number, number] = [-P.adir[0] * 15, -P.adir[1] * 15];
  let stage = '', caption = '', torOn = 0;

  // ---- defaults: nothing
  let towerTop = P.zb + 0.5, towerR = 1, towerAmt = 0, strat = 0, overshoot = 0;
  let anvilAmt = 0, anvilLen = 4, back = 1, mamm = 0;
  let wallAmt = 0, lower = 0, tailCloud = 0, scud = 0, wc = at2(-1.0, -0.8);
  let tailAmt = 0, ffdAmt = 0, hailAmt = 0, slot = 0, slotR = P.Rw + 1, rfdAmt = 0;
  let flankAmt = 0, flankN = 0, mesoSpin = 0;
  let torAmt = 0, torGround = 0.1, torTop = 0.3, cond = 0, rope = 0, debris = 0;
  let torBot: [number, number] = wc, torTopP: [number, number] = wc;
  // rear-flank downdraft surge: a bulge of outflow (centre rcB, radius Rs) whose gust front curls round from its
  // northern end (under the wall cloud, where the tornado forms) to its southern end (anticyclonic side)
  let rcB: [number, number] = wc, Rs = 0, horse = 0, curlS: [number, number] = wc, antiAmt = 0, antiTor = 0;

  if (P.kind === 'supercell') {
    towerTop = P.zb + 1 + (P.el + 0.4 - P.zb - 1) * ramp(t, 0, 14);
    towerR = P.R * (0.8 + 0.2 * ramp(t, 4, 20) + 0.25 * ramp(t, 20, 40));   // broadening as the mesocyclone matures
    towerAmt = 1;
    overshoot = ramp(t, 14, 20) * (0.7 + 0.3 * Math.sin(t * 0.9));
    anvilAmt = ramp(t, 10, 20); anvilLen = 5 + P.anvilLen * ramp(t, 10, 55); back = 1.5 + 3 * ramp(t, 20, 40);
    mamm = 0.8 * ramp(t, 32, 48);
    strat = P.striation * ramp(t, 20, 32);
    ffdAmt = P.ffd * ramp(t, 14, 24); hailAmt = P.hail * ramp(t, 18, 28);
    tailAmt = P.tail * ramp(t, 24, 34);
    flankAmt = ramp(t, 18, 30); flankN = 6;
    mesoSpin = P.mesoSpin * ramp(t, 16, 30);
    if (t >= CYCLE0) {
      const k = Math.floor((t - CYCLE0) / CYCLE), tau = (t - CYCLE0) - k * CYCLE;
      // the wall cloud forms under the rear-right of the updraft base, then occludes rearward and fades
      const occ = ramp(tau, 24, 34);
      wc = at2(-1.0 - 2.2 * occ, -0.8 + 1.4 * occ);
      wallAmt = ramp(tau, 0, 6) * (1 - ramp(tau, 29, 35));
      lower = P.lower * (0.4 + 0.6 * ramp(tau, 4, 14));
      tailCloud = wallAmt * ramp(tau, 5, 12); scud = wallAmt * 0.8;
      slot = P.slot * ramp(tau, 10, 16) * (1 - ramp(tau, 30, 36));
      slotR = P.Rw + 0.8 + 2.2 * ramp(tau, 12, 30);
      rfdAmt = P.rfd * ramp(tau, 8, 16);
      // the surge: its northern curl sits under the rear-right of the wall cloud; it bulges out to the south and east
      const curlN: [number, number] = [wc[0] + (-0.35 * fx - 0.35 * lx) * P.Rw, wc[1] + (-0.35 * fy - 0.35 * ly) * P.Rw];
      Rs = P.Rw * (0.6 + 1.5 * ramp(tau, 9, 26));
      // angles in the storm's frame (0 = downstream, +90 = left of motion): the surge centre lies south-south-west of
      // the tornado, its gust front bulging east between the northern curl (+40) and the southern curl (-140)
      const thN = 40 * Math.PI / 180, thS = -140 * Math.PI / 180;
      rcB = [curlN[0] - Rs * (Math.cos(thN) * fx + Math.sin(thN) * lx), curlN[1] - Rs * (Math.cos(thN) * fy + Math.sin(thN) * ly)];
      curlS = [rcB[0] + Rs * (Math.cos(thS) * fx + Math.sin(thS) * lx), rcB[1] + Rs * (Math.cos(thS) * fy + Math.sin(thS) * ly)];
      horse = slot * ramp(tau, 9, 15);
      antiAmt = P.antiMeso * ramp(tau, 12, 17) * (1 - ramp(tau, 25, 30));
      if (P.antiTornado && k === 1) antiTor = ramp(tau, 17, 18.5) * (1 - ramp(tau, 21, 23));
      if (P.tornadic && k < 2) {
        const form = ramp(tau, 14, 16.5), die = ramp(tau, 26, 28.5);
        torAmt = form * (1 - die);
        rope = ramp(tau, 21.5, 26);
        cond = ramp(tau, 13.5, 16) * (P.zb < 1.4 ? 1 : 0.75) * (1 - 0.45 * ramp(tau, 25, 27.5));
        debris = ramp(tau, 15, 16.5) * (1 - ramp(tau, 25, 28));
        const shrink = 1 - 0.75 * rope;
        torGround = P.torR * shrink * (0.6 + 0.4 * form);
        torTop = (P.torR * (P.torType > 0.7 ? 1.4 : 2.6) + 0.12) * (1 - 0.6 * rope);
        // tornado under the rear-right part of the wall cloud; it's left behind as the storm occludes (rope out)
        torTopP = curlN;   // the northern curl of the RFD surge
        const drift = 0.45 * rope;
        torBot = [torTopP[0] + (-fx * 0.8 - lx * 0.6) * drift, torTopP[1] + (-fy * 0.8 - ly * 0.6) * drift];
        torOn = torAmt;
      }
      if (antiTor > 0.15) { stage = 'Anticyclonic tornado'; caption = 'Rare: a second tornado at the southern curl of the rear-flank downdraft surge, turning clockwise, while the main tornado turns counter-clockwise at the northern curl.'; }
      else if (torAmt > 0.15) { stage = rope > 0.4 ? 'Tornado roping out' : 'Tornado on the ground'; caption = rope > 0.4 ? 'The rear-flank downdraft has wrapped around the circulation and cut off its warm inflow. The tornado thins into a rope and is left behind as the storm occludes.' : 'The tornado forms at the northern curl of the rear-flank downdraft surge, where the surge meets the warm inflow under the wall cloud.' + (antiAmt > 0.3 ? ' At the surge\'s southern curl the air turns the other way: an anti-mesocyclone.' : ''); }
      else if (tau < 10) { stage = k ? 'New wall cloud' : 'Wall cloud forming'; caption = 'Rain-cooled, moist air from the forward flank is pulled into the updraft and condenses lower than the main cloud base: a rotating wall cloud under the rear of the updraft.'; }
      else if (tau < 16) { stage = 'Rear-flank downdraft'; caption = 'Dry air from behind the storm descends, reaches the ground and surges out around the south side of the wall cloud, carving a horseshoe-shaped clear slot into the base.'; }
      else if (tau < 29) { stage = P.tornadic ? 'Mature mesocyclone' : 'Mature supercell'; caption = 'The rear-flank downdraft surges around the wall cloud and the horseshoe-shaped clear slot widens.' + (antiAmt > 0.3 ? ' Cyclonic rotation curls up at its northern end and anticyclonic rotation at its southern end.' : '') + (P.tornadic ? '' : ' Strong low-level rotation, but no tornado this cycle.'); }
      else { stage = 'Occlusion'; caption = 'The gust front wraps around the old circulation, which weakens and drifts to the rear. A new updraft base and wall cloud take over to the east.'; }
    } else if (t < 12) { stage = 'Towering cumulus'; caption = 'A boundary-layer thermal breaks the cap and rises as a hard, cauliflower tower.'; }
    else if (t < 22) { stage = 'Cumulonimbus'; caption = 'The tower reaches the tropopause and spreads out as an anvil downwind. Rain and hail start to fall on the forward flank.'; }
    else { stage = 'Supercell organising'; caption = 'Wind shear tilts the inflow\'s spin into the updraft: the updraft rotates (a mesocyclone), the base flattens and striates, and an inflow tail streams in from the east.'; }
  } else if (P.kind === 'pulse') {
    const life = 1 - ramp(t, 34, 52), sink = ramp(t, 34, 50);
    towerTop = P.zb + 1 + (P.el - P.zb - 1) * ramp(t, 0, 13) * (1 - 0.6 * sink); towerR = P.R * 0.8 * (0.5 + 0.5 * ramp(t, 3, 15)) * (1 - 0.35 * sink); towerAmt = 0.25 + 0.75 * life;
    overshoot = 0.5 * ramp(t, 13, 18) * life;
    anvilAmt = ramp(t, 11, 20) * (1 - 0.6 * ramp(t, 50, 70)); anvilLen = 4 + 10 * ramp(t, 11, 40); back = 3;
    ffdAmt = 1.4 * ramp(t, 16, 22) * (1 - ramp(t, 40, 55)); hailAmt = 0.4 * ramp(t, 18, 24) * (1 - ramp(t, 32, 40));
    stage = t < 13 ? 'Towering cumulus' : t < 22 ? 'Mature storm' : t < 34 ? 'Heavy rain' : t < 50 ? 'Collapsing' : 'Dissipating anvil';
    caption = t < 13 ? 'A tower rises in hot, humid air with almost no wind.' : t < 34 ? 'Without shear, the rain falls straight back down through the updraft: a short burst of torrential rain and small hail.' : 'The rain-cooled downdraft chokes off the updraft. The tower collapses and only the anvil is left.';
  } else if (P.kind === 'capped') {
    const pulse = Math.abs(Math.sin(t / 7));
    towerTop = P.zb + 0.8 + 1.4 * pulse; towerR = 1.6; towerAmt = 0.9;
    stage = 'Capped'; caption = 'Cumulus try to grow but the warm layer aloft stops them: they bubble up and fall back all afternoon.';
  } else { stage = 'Clear'; caption = 'Not enough instability for storms.'; }

  // ---- pack (order must match struct SP in shaders.ts)
  const sx = P.zb, flank = (() => { const [u, v] = [-fx - 0.3 * lx, -fy - 0.3 * ly], m = Math.hypot(u, v); return [u / m, v / m]; })();
  const tdir = (() => { const [u, v] = [fx - 0.7 * lx, fy - 0.7 * ly], m = Math.hypot(u, v); return [u / m, v / m]; })();
  const ffdC = P.kind === 'pulse' ? up : at2(P.ffd < 0.5 ? 9 : 6, P.ffd < 0.5 ? 6 : 4.5);
  const hailC = P.kind === 'pulse' ? up : at2(2.8, 2.2);
  set(0, fx, fy, lx, ly);
  set(1, sx, P.el, clock, t);
  set(2, towerTop, towerR, towerAmt, strat);
  set(3, P.tilt[0], P.tilt[1], overshoot, mesoSpin);
  set(4, P.adir[0], P.adir[1], anvilLen, anvilAmt);
  set(5, P.el - 2.4, P.el + 0.25, mamm, back);
  set(6, wc[0], wc[1], P.Rw, wallAmt);
  set(7, lower, P.spin, tailCloud, scud);
  set(8, tdir[0], tdir[1], 11, tailAmt);
  set(9, ffdC[0], ffdC[1], P.kind === 'pulse' ? 0.6 : P.ffd > 1.2 ? 1.35 : 1, ffdAmt);
  set(10, hailC[0], hailC[1], 2.0, hailAmt);
  set(11, slot, slotR, rfdAmt, P.wrap);
  set(12, flank[0], flank[1], flankAmt, flankN);
  set(13, torBot[0], torBot[1], torAmt, P.torType);
  set(14, torGround, torTop, cond, rope);
  set(15, torTopP[0], torTopP[1], debris, 0);
  set(16, up[0], up[1], 0, 0);
  // slot 17 (grid) is filled by the renderer
  set(18, rcB[0], rcB[1], Rs, horse);
  set(19, curlS[0], curlS[1], antiAmt, antiTor);
  return { params: a, stage, caption, tornado: torOn };
}
