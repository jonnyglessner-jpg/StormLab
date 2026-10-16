import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { baseFromEnvironment, baseFromProfile, weismanKlempProfile } from '../src/sim/base';
import { D, diagCPU, HailSwath, ND, summarize, TornadoTracker } from '../src/sim/diag';
import { type GridSpec } from '../src/sim/grid';
import { MP } from '../src/sim/micro';
import { singleNudge } from '../src/sim/params';
import { SimCPU } from '../src/sim/model-cpu';
import { environment } from '../src/physics/environment';
import { PRESETS } from '../src/presets';
import { toEnv } from '../src/units';

const small: GridSpec = { NX: 32, NY: 32, NZ: 20, dx: 2000, dy: 2000, dz: 750 };
const maxAbs = (a: Float32Array) => { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); return m; };

describe('cloud model', () => {
  test('a calm, stable atmosphere stays at rest', () => {
    // humidity falling off with height, unsaturated everywhere (a constant 2 g/kg would condense aloft)
    const prof = { theta: (z: number) => 300 + 0.004 * z, qv: (z: number) => 0.004 * Math.exp(-z / 2000), u: () => 0, v: () => 0, psfc: 1e5 };
    const s = new SimCPU(small, baseFromProfile(small, prof, 0, 0), { dt: 10 });
    for (let n = 0; n < 15; n++) s.step();
    assert.ok(maxAbs(s.f.w) < 1e-4, `w ${maxAbs(s.f.w)}`);
  });

  test('a uniform wind is carried without change', () => {
    const prof = { theta: (z: number) => 300 + 0.004 * z, qv: (z: number) => 0.004 * Math.exp(-z / 2000), u: () => 12, v: () => -5, psfc: 1e5 };
    const s = new SimCPU(small, baseFromProfile(small, prof, 0, 0), { dt: 10 });
    for (let n = 0; n < 10; n++) s.step();
    let du = 0; for (const v of s.f.u) du = Math.max(du, Math.abs(v - 12));
    assert.ok(du < 1e-3 && maxAbs(s.f.w) < 1e-3, `du ${du}`);
  });

  test('the pressure solver keeps the flow mass-conserving', () => {
    const s = new SimCPU(small, baseFromProfile(small, weismanKlempProfile(0.014, 25), 12, 0), { dt: 10 });
    s.addBubble({ x: 30000, y: 32000, z: 1400, rh: 8000, rz: 1400, dth: 3 });
    for (let n = 0; n < 20; n++) s.step();
    assert.ok(maxAbs(s.f.w) > 1, 'bubble should be rising');
    assert.ok(s.maxDivergence() < 2e-5, `divergence ${s.maxDivergence()}`);
  });

  test('a dry warm bubble rises', () => {
    const prof = { theta: () => 300, qv: () => 0, u: () => 0, v: () => 0, psfc: 1e5 };
    const s = new SimCPU(small, baseFromProfile(small, prof, 0, 0), { dt: 10 });
    s.addBubble({ x: 32000, y: 32000, z: 2000, rh: 6000, rz: 1500, dth: 2 });
    for (let n = 0; n < 30; n++) s.step();
    // warmest air has moved up from its starting height
    const plane = small.NX * small.NY; let best = 0, kBest = 0;
    for (let k = 0; k < small.NZ; k++) for (let c = 0; c < plane; c++) { const v = s.f.th[k * plane + c] - 300; if (v > best) { best = v; kBest = k; } }
    // it starts centred at 2 km (nearest level 1875 m) and must have moved up
    assert.ok((kBest + 0.5) * small.dz > 2400, `warm core at ${(kBest + 0.5) * small.dz} m`);
    assert.ok(maxAbs(s.f.w) > 1, `w ${maxAbs(s.f.w)}`);
  });

  test('moist convection in the Weisman-Klemp sounding makes a storm with rain, an ice anvil and hail', () => {
    const s = new SimCPU(small, baseFromProfile(small, weismanKlempProfile(0.0145, 30), 14.21, -1.6), { dt: 10 });
    s.nudgeCfg = singleNudge(28000, 32000, 1500, 10000, 1500, 10, 10, 900);
    for (let n = 0; n < 150; n++) s.step();
    const sm = summarize(s.t, small, diagCPU(small, s.b, s.f));
    assert.ok(sm.wmax > 20, `wmax ${sm.wmax}`);
    assert.ok(sm.dbzMax > 45, `dBZ ${sm.dbzMax}`);
    assert.ok(sm.coldPool < -0.5, `cold pool ${sm.coldPool}`);
    // ice in the anvil (above 9 km) and hail somewhere in the storm
    const plane = small.NX * small.NY, k9 = Math.ceil(9000 / small.dz);
    let qiTop = 0, qh = 0, hailGround = 0;
    for (let c = k9 * plane; c < small.NZ * plane; c++) qiTop = Math.max(qiTop, s.f.qi[c]);
    for (const v of s.f.qh) qh = Math.max(qh, v);
    for (const v of s.f.hail) hailGround = Math.max(hailGround, v);
    assert.ok(qiTop > 3e-4, `anvil ice ${qiTop}`);
    assert.ok(qh > 1e-3, `hail ${qh}`);
    assert.ok(hailGround > 0, 'hail should reach the ground');
  });

  test('microphysics conserves water and energy', () => {
    const cases: [number[], number, number, number][] = [
      [[300, 0.016, 0.003, 0.002, 0, 0, 0], 0.97, 90000, 1.05],                  // warm cloud with rain
      [[351, 0.0025, 0.002, 0.003, 0.0005, 0.001, 0.002], 0.75, 36500, 0.48],   // mixed phase at -10 C
      [[372, 0.0001, 0, 0, 0.0008, 0.0005, 0], 0.6, 17000, 0.26],              // anvil at -50 C
      [[316, 0.005, 0, 0.001, 0, 0.0005, 0.004], 0.88, 64000, 0.8]             // hail melting at +5 C
    ];
    for (const [s0, pi, p, rho] of cases) {
      const s = new Float64Array(s0);
      const water = (x: Float64Array) => x[1] + x[2] + x[3] + x[4] + x[5] + x[6];
      // liquid-water static energy (no height change): cp T + Lv qv - Lf (ice)
      const energy = (x: Float64Array) => 1004 * x[0] * pi + 2.5e6 * x[1] - 3.34e5 * (x[4] + x[5] + x[6]);
      const w0 = water(s), e0 = energy(s);
      for (let n = 0; n < 20; n++) MP.micro(s, pi, p, rho, 1.15, 6, 1e-3, 1e-3, 2.2);
      assert.ok(Math.abs(water(s) - w0) < 1e-12, `water ${water(s) - w0}`);
      assert.ok(Math.abs(energy(s) - e0) / 1004 < 0.02, `energy ${(energy(s) - e0) / 1004} K`);
      for (const v of s.slice(2)) assert.ok(v >= 0);
    }
  });

  test('fall speeds, reflectivity and hail size are realistic', () => {
    const v = new Float64Array(3);
    MP.vterm(0.002, 0.001, 0.005, 1.0, 1.15, v);
    assert.ok(v[0] > 5 && v[0] < 10, `rain ${v[0]}`);
    assert.ok(v[1] > 0.5 && v[1] < 2.5, `snow ${v[1]}`);
    assert.ok(v[2] > 10 && v[2] < 25, `hail ${v[2]}`);
    const zr = MP.dbz(0.003, 0, 0, 1.0, 290);
    assert.ok(zr > 48 && zr < 55, `rain dBZ ${zr}`);         // ~51 dBZ for 3 g/kg
    const zh = MP.dbz(0, 0, 0.005, 1.0, 280);
    assert.ok(zh > 62 && zh < 76, `hail dBZ ${zh}`);
    const d1 = MP.hail(0.001, 1.0), d5 = MP.hail(0.005, 1.0);
    assert.ok(d1 > 15 && d1 < d5 && d5 < 60, `hail size ${d1} ${d5} mm`);
  });

  test('a capped environment stays quiet without forcing', () => {
    const g: GridSpec = { NX: 24, NY: 24, NZ: 20, dx: 2000, dy: 2000, dz: 750 };
    const s = new SimCPU(g, baseFromEnvironment(g, environment(toEnv(PRESETS.capped))), { dt: 10 });
    for (let n = 0; n < 20; n++) s.step();
    assert.ok(maxAbs(s.f.qc) < 1e-6 && maxAbs(s.f.qi) < 1e-6, `qc ${maxAbs(s.f.qc)} qi ${maxAbs(s.f.qi)}`);
  });
});

describe('tornado tracker', () => {
  const g: GridSpec = { NX: 20, NY: 20, NZ: 10, dx: 1000, dy: 1000, dz: 400 };
  const frame = (zeta0: number, w1: number) => {
    const d = new Float32Array(g.NX * g.NY * ND);
    const c = (10 * g.NX + 10) * ND; d[c + D.zeta0] = zeta0; d[c + D.w1] = w1; d[c + D.zeta1] = zeta0;
    return d;
  };
  test('needs strong near-ground rotation under an updraft for a minute', () => {
    const tr = new TornadoTracker(g);
    assert.equal(tr.update(0, frame(0.02, 1)), null);        // no updraft above: no tornado
    assert.equal(tr.update(30, frame(0.02, 6)), null);       // starts the clock
    assert.equal(tr.update(60, frame(0.02, 6)), null);
    const ev = tr.update(90, frame(0.02, 6));
    if (!ev) throw new Error('tornado expected after a minute');
    assert.ok(ev.end === null);
    assert.ok(ev.now > 35 && ev.now < 60, `V ${ev.now}`);
    assert.equal(tr.update(120, frame(0.004, 6)), null);     // rotation fades: tornado ends
    assert.equal(tr.events.length, 1);
    assert.equal(tr.events[0].end, 120);
  });
});

describe('hail swath', () => {
  test('places storm-relative hail on the ground using the storm motion', () => {
    const g: GridSpec = { NX: 10, NY: 10, NZ: 4, dx: 1000, dy: 1000, dz: 500 };
    const sw = new HailSwath(g, 10, 0, 1000);           // storm moving east at 10 m/s
    const d = new Float32Array(g.NX * g.NY * ND);
    d[(5 * g.NX + 5) * ND + D.hailD] = 30;
    sw.add(0, d); sw.add(500, d);
    // the same storm-relative column lands 5 km further east after 500 s
    const at = (x: number, y: number) => sw.d[Math.floor((y - sw.y0) / 1000) * sw.nx + Math.floor((x - sw.x0) / 1000)];
    assert.equal(at(5500, 5500), 30);
    assert.equal(at(10500, 5500), 30);
    assert.equal(at(8500, 5500), 0);
    assert.equal(sw.max, 30);
  });
});
