import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { environment } from '../src/physics/environment';
import { storm } from '../src/physics/storm';
import { PRESETS } from '../src/presets';
import { planStorm, stormAt, NSLOT } from '../src/storm3d/design';
import { toEnv } from '../src/units';

const plan = (k: string) => { const E = environment(toEnv(PRESETS[k])); return planStorm(E, storm(E)); };

describe('designed storm', () => {
  test('each setup gets the storm it is meant to show', () => {
    assert.equal(plan('plains').kind, 'supercell');
    assert.ok(plan('plains').tornadic, 'plains outbreak storm should be tornadic');
    assert.equal(plan('hail').kind, 'supercell');
    assert.equal(plan('lp').kind, 'supercell');
    assert.equal(plan('capped').kind, 'capped');
    assert.ok(plan('pulse').kind !== 'supercell', 'pulse storm should not be a supercell');
  });

  test('storms move north-east in south-west flow', () => {
    for (const k of ['plains', 'dixie', 'ohio', 'hail']) {
      const [u, v] = plan(k).motion;
      assert.ok(u > 0 && v > 0, `${k}: motion (${u.toFixed(1)}, ${v.toFixed(1)}) should head north-east`);
    }
  });

  test('every moment is finite, and the tornado comes and goes', () => {
    for (const k of Object.keys(PRESETS)) {
      const P = plan(k);
      let sawTor = false;
      for (let t = 0; t <= P.duration; t += 0.5) {
        const f = stormAt(P, t, 12.3);
        assert.equal(f.params.length, NSLOT * 4);
        assert.ok(f.params.every(Number.isFinite), `${k} at ${t} min has a non-finite parameter`);
        assert.ok(f.stage.length > 0 && f.caption.length > 0);
        if (f.tornado > 0.5) sawTor = true;
      }
      if (k === 'plains') assert.ok(sawTor, 'plains storm should produce a tornado');
      if (k === 'capped' || k === 'pulse') assert.ok(!sawTor, `${k} should not produce a tornado`);
      assert.equal(stormAt(P, 0, 0).tornado, 0, `${k} starts without a tornado`);
    }
  });

  test('the RFD horseshoe: wall cloud and tornado inside it, the rare anticyclonic tornado at the southern tip', () => {
    const P = plan('plains');
    assert.ok(P.antiTornado, 'the plains outbreak storm is the one that can put down an anticyclonic tornado');
    for (const k of ['dixie', 'ohio', 'hail', 'lp']) assert.ok(!plan(k).antiTornado, `${k} should not`);
    let sawAnti = false;
    for (let t = 30; t <= P.duration; t += 0.5) {
      const a = stormAt(P, t, 0).params, at = (i: number): [number, number] => [a[i * 4], a[i * 4 + 1]];
      const [rx, ry] = at(18), Rs = a[18 * 4 + 2];
      if (Rs <= 0 || a[18 * 4 + 3] <= 0) continue;
      const [wx, wy] = at(6);
      assert.ok(Math.hypot(wx - rx, wy - ry) < Rs, `wall cloud inside the horseshoe at ${t}`);
      assert.ok(wy > ry, `wall cloud on the northern side of the slot at ${t}`);
      if (a[13 * 4 + 2] > 0.5) { const [tx, ty] = at(15); assert.ok(Math.hypot(tx - rx, ty - ry) < Rs, `tornado inside the horseshoe at ${t}`); }
      if (a[19 * 4 + 3] > 0.5) {
        sawAnti = true;
        const [sx, sy] = at(19), ty = at(15)[1];
        assert.ok(Math.abs(Math.hypot(sx - rx, sy - ry) - Rs) < 0.05, `anticyclonic tornado on the horseshoe at ${t}`);
        assert.ok(sy < ty, 'anticyclonic tornado south of the main one');
      }
    }
    assert.ok(sawAnti, 'plains storm shows its anticyclonic tornado once');
  });
});
