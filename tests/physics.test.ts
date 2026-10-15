import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { compute } from '../src/physics/compute';
import { environment } from '../src/physics/environment';
import { mulberry } from '../src/physics/random';
import { efDist, storm, tornadoFrom } from '../src/physics/storm';
import { esat, qsat } from '../src/physics/thermo';
import { srh, type Winds } from '../src/physics/winds';
import { NZ } from '../src/physics/constants';
import { PRESETS } from '../src/presets';
import { toEnv } from '../src/units';

const within = (v: number, lo: number, hi: number, what: string) => assert.ok(v >= lo && v <= hi, `${what} = ${v.toFixed(2)}, expected ${lo}..${hi}`);
const env = (k: string) => environment(toEnv(PRESETS[k]));

describe('thermodynamics', () => {
  test('saturation vapour pressure matches Bolton at 0 C and 30 C', () => {
    within(esat(273.15), 611.1, 611.3, 'esat(0 C)');
    within(esat(303.15), 4230, 4260, 'esat(30 C)');   // tables: 4246 Pa
  });
  test('saturation mixing ratio at 1000 hPa, 20 C is about 14.7 g/kg', () => {
    within(qsat(1e5, 293.15) * 1000, 14.4, 15.0, 'qsat');
  });
  test('Plains outbreak instability is in the observed range', () => {
    const E = env('plains');
    within(E.pc.cape, 2500, 3600, 'MLCAPE');
    within(E.pc.cin, -120, 0, 'MLCIN');
    within(E.pc.lcl, 900, 1400, 'LCL');
    within(E.lapse36, 7.5, 8.1, '3-6 km lapse rate');
  });
  test('LCL follows the 125 m per degree dewpoint-depression rule', () => {
    const E = environment({ ...toEnv(PRESETS.plains), T0F: 90, TdF: 60 });
    within(E.pc.lcl, 1700, 2300, 'LCL for a 16.7 C spread');
  });
  test('a strong cap holds storms back', () => {
    const E = env('capped');
    assert.ok(E.pc.cin < -200, `CIN ${E.pc.cin}`);
    assert.equal(storm(E).forms, false);
  });
  test('CAPE rises with dewpoint and with lapse rate', () => {
    const base = toEnv(PRESETS.ohio);
    const c = (o: Partial<typeof base>) => environment({ ...base, ...o }).pc.cape;
    assert.ok(c({ TdF: 70 }) > c({ TdF: 62 }));
    assert.ok(c({ lapse: 8.5 }) > c({ lapse: 6.0 }));
  });
});

describe('winds', () => {
  test('0-6 km shear matches the slider', () => {
    const E = env('plains');
    within(E.shear6, 0.98 * 55 * 0.514444, 1.02 * 55 * 0.514444, '0-6 km shear');
  });
  test('right-mover deviates to the right of the mean wind', () => {
    const E = env('plains'), { rm, mw } = E.bk;
    const sh = [Math.cos(250 * Math.PI / 180), 0];
    assert.ok(rm[0] !== mw[0] || rm[1] !== mw[1]);
    // the cross product of (shear vector) x (rm - mw) is negative for a deviation to the right
    const d = [rm[0] - mw[0], rm[1] - mw[1]], lo = [E.w.u[0], E.w.v[0]], hi = [E.w.u[60], E.w.v[60]];
    const s = [hi[0] - lo[0], hi[1] - lo[1]];
    assert.ok(s[0] * d[1] - s[1] * d[0] < 0, `deviation not to the right (${sh})`);
    within(Math.hypot(d[0], d[1]), 7.4, 7.6, 'Bunkers deviation');
  });
  test('helicity is zero for a straight hodograph with storm motion on it', () => {
    const u = new Float64Array(NZ), v = new Float64Array(NZ);
    for (let k = 0; k < NZ; k++) u[k] = Math.min(k, 60) * 0.5;
    const w: Winds = { u, v };
    within(srh(w, [10, 0], 3000), -1, 1, 'SRH');
  });
  test('a stronger low-level jet means more 0-1 km helicity', () => {
    const base = toEnv(PRESETS.ohio);
    assert.ok(environment({ ...base, llj: 25 }).srh1 > environment({ ...base, llj: 12 }).srh1);
  });
});

describe('storm diagnosis', () => {
  test('setups give the expected storm types', () => {
    assert.equal(storm(env('pulse')).mode, 'pulse');
    assert.equal(storm(env('plains')).mode, 'supercell');
    assert.equal(storm(env('dixie')).precip, 'hp');
    assert.equal(storm(env('lp')).precip, 'lp');
    assert.equal(storm(env('plains')).precip, 'classic');
  });
  test('STP drives the tornado odds', () => {
    const p = storm(env('plains')), o = storm(env('ohio')), l = storm(env('lp'));
    assert.ok(p.E.stp > o.E.stp && p.ptor > o.ptor);
    assert.equal(l.ptor, 0);   // LCL too high: STP 0
  });
  test('EF distribution sums to 1 and EF2+ share follows STP climatology', () => {
    const lo = efDist((72 + 16 * Math.log(1.5)) * 0.44704, 0.3), hi = efDist((72 + 16 * Math.log(11)) * 0.44704, 0.3);
    within(lo.reduce((a, b) => a + b, 0), 0.999, 1.001, 'sum');
    within(lo.slice(2).reduce((a, b) => a + b, 0), 0.05, 0.2, 'EF2+ at STP 0.5');
    within(hi.slice(2).reduce((a, b) => a + b, 0), 0.4, 0.6, 'EF2+ at STP 10');
  });
  test('the typical tornado has the median peak wind and the storm’s cloud base', () => {
    const S = storm(env('plains')), t = tornadoFrom(S, mulberry(1), true);
    assert.ok(t);
    within(t!.peakMph, S.vMed / 0.44704 - 1, S.vMed / 0.44704 + 1, 'peak');
    within(t!.zc * 0.3048, S.E.pc.lcl - 30, S.E.pc.lcl + 30, 'cloud base');
  });
  test('rolling many times reproduces the tornado chance', () => {
    const S = storm(env('ohio')), r = mulberry(7);
    let n = 0; const N = 4000;
    for (let i = 0; i < N; i++) if (tornadoFrom(S, r, false)) n++;
    within(n / N, S.ptor - 0.03, S.ptor + 0.03, 'tornado frequency');
  });
});

describe('radar and cloud fields', () => {
  test('a classic supercell has a strong core, a hook and a weak-echo inflow notch', () => {
    const r = compute(toEnv(PRESETS.plains), { nRel: 2000, volume: false, cpuLighting: false });
    const { N, R, dx } = r.geo, at = (x: number, y: number) => r.dbz[Math.floor((y + R) / dx) * N + Math.floor((x + R) / dx)];
    let mx = -99; for (const v of r.dbz) mx = Math.max(mx, v);
    within(mx, 50, 70, 'max reflectivity');
    assert.ok(at(r.geo.mesoX, r.geo.mesoY) > at(0, 0) + 10, 'hook should be stronger than the updraft notch');
    assert.ok(r.geo.core && r.geo.core[2] > 40, 'forward-flank core');
  });
  test('the cloud volume has a tower and stays clear far upstream', () => {
    const r = compute(toEnv(PRESETS.ohio), { nRel: 1200, volume: true, cpuLighting: true });
    const v = r.vol!, k = Math.floor(6000 / v.dzv), c = v.NV / 2;
    assert.ok(v.beta[(k * v.NV + c) * v.NV + c] > 5, 'updraft tower at 6 km');
    assert.ok(v.beta[(k * v.NV + c) * v.NV + 2] < 0.5, 'clear air 55 km west');
    assert.equal(v.lit!.length, v.NV * v.NV * v.NZv * 4);
  });
  test('no storm, no echo', () => {
    const r = compute(toEnv(PRESETS.capped), { nRel: 500, volume: false, cpuLighting: false });
    let mx = -99; for (const v of r.dbz) mx = Math.max(mx, v);
    assert.equal(mx, -99);
  });
});
