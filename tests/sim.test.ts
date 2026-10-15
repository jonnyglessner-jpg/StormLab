import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { baseFromEnvironment, baseFromProfile, weismanKlempProfile } from '../src/sim/base';
import { D, diagCPU, ND, summarize, TornadoTracker } from '../src/sim/diag';
import { type GridSpec } from '../src/sim/grid';
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

  test('moist convection in the Weisman-Klemp sounding makes a storm with rain', () => {
    const s = new SimCPU(small, baseFromProfile(small, weismanKlempProfile(0.0145, 30), 14.21, -1.6), { dt: 10 });
    s.nudgeCfg = { x: 28000, y: 32000, z: 1500, rh: 10000, rz: 1500, wmax: 10, tau: 10, tEnd: 900 };
    for (let n = 0; n < 120; n++) s.step();
    const sm = summarize(s.t, small, diagCPU(small, s.b, s.f));
    assert.ok(sm.wmax > 20, `wmax ${sm.wmax}`);
    assert.ok(sm.dbzMax > 45, `dBZ ${sm.dbzMax}`);
    assert.ok(sm.coldPool < -0.5, `cold pool ${sm.coldPool}`);
  });

  test('a capped environment stays quiet without forcing', () => {
    const g: GridSpec = { NX: 24, NY: 24, NZ: 20, dx: 2000, dy: 2000, dz: 750 };
    const s = new SimCPU(g, baseFromEnvironment(g, environment(toEnv(PRESETS.capped))), { dt: 10 });
    for (let n = 0; n < 20; n++) s.step();
    assert.ok(maxAbs(s.f.qc) < 1e-6);
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
