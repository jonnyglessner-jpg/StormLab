import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraRig, CAM_MIN_H, fromCamera, toCamera } from '../src/views/storm/camera-rig';

const near = (a: number, b: number, eps: number, what: string) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);
const settle = (r: CameraRig, s = 3) => { for (let i = 0; i < s * 60; i++) r.update(1 / 60); };

describe('camera rig', () => {
  test('round-trips its state through a camera', () => {
    const s = { px: 3, py: -2, yaw: -70, pitch: 6, dist: 24 };
    const b = fromCamera(toCamera(s));
    near(b.dist, s.dist, 1e-6, 'dist'); near(b.pitch, s.pitch, 1e-6, 'pitch'); near(b.yaw, s.yaw, 1e-9, 'yaw');
  });

  test('W moves the pivot forward along the view, D to its right, and speed scales with distance', () => {
    const r = new CameraRig({ az: -90, dist: 10, h: 2, tz: 1.2, tx: 0, ty: 0 });   // camera south of the pivot, looking north
    r.keyDown('KeyW'); r.update(1); r.keyUp('KeyW');
    assert.ok(r.goal.py > 5 && Math.abs(r.goal.px) < 1e-6, `forward is north: ${r.goal.px}, ${r.goal.py}`);
    const r2 = new CameraRig({ az: -90, dist: 40, h: 5, tz: 3.5, tx: 0, ty: 0 });
    r2.keyDown('KeyD'); r2.update(1);
    assert.ok(r2.goal.px > 20, `right is east, and faster when further out: ${r2.goal.px}`);
  });

  test('Q/E rotate, R/F tilt, and the camera never goes below the ground', () => {
    const r = new CameraRig({ az: 0, dist: 10, h: 2, tz: 1.2, tx: 0, ty: 0 });
    r.keyDown('KeyQ'); r.update(1); r.keyUp('KeyQ');
    assert.ok(r.goal.yaw > 50, 'Q rotates');
    r.keyDown('KeyF'); for (let i = 0; i < 300; i++) r.update(1 / 30);
    settle(r);
    assert.ok(r.camera().h >= CAM_MIN_H - 1e-9, `above ground: ${r.camera().h}`);
  });

  test('zooming toward the cursor keeps that point under it', () => {
    const r = new CameraRig({ az: -90, dist: 20, h: 8, tz: 2.4, tx: 0, ty: 0 });
    const before = r.cursorPoint(0.5, -0.2, 1.6)!;
    r.zoom(-300, 0.5, -0.2, 1.6);
    const after = r.cursorPoint(0.5, -0.2, 1.6)!;
    assert.ok(r.goal.dist < 20, 'zoomed in');
    near(after[0], before[0], 0.6, 'x under cursor'); near(after[1], before[1], 0.6, 'y under cursor');
  });

  test('eases toward the goal and comes to rest', () => {
    const r = new CameraRig({ az: -90, dist: 20, h: 3, tz: 2.4, tx: 0, ty: 0 });
    r.lookAt(10, 5); r.update(1 / 60);
    assert.ok(r.cur.px > 0 && r.cur.px < 10, 'moves part way in one frame'); assert.ok(r.moving);
    settle(r);
    near(r.cur.px, 10, 1e-3, 'arrives'); assert.ok(!r.moving, 'at rest');
  });
});
