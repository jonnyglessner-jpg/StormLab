/**
 * A city-builder style camera (after Cities: Skylines II): the camera orbits a pivot point, and every control moves
 * a goal state that the camera eases toward, so motion is smooth and has a little momentum.
 *
 *   WASD / arrows   glide across the ground, relative to the view (Shift: faster)
 *   Q / E           rotate around the pivot          R / F   tilt
 *   wheel           zoom toward the point under the cursor
 *   right-drag      grab the ground and drag the view
 *   left / middle-drag   rotate and tilt
 *
 * Pan speed scales with the zoom distance, so it feels the same up close and from far out. The camera never goes
 * below the ground. Lengths are km, angles degrees; `yaw` is the camera's azimuth around the pivot as in Camera.az
 * (0 = east of the pivot, -90 = south of it); `pitch` is its elevation angle seen from the pivot (negative = below
 * the pivot, looking up at the storm).
 */
import { clamp } from '../../physics/constants';
import { type Camera } from '../../render/chaser';

export interface RigState { px: number; py: number; yaw: number; pitch: number; dist: number }

export const PITCH_MIN = -40, PITCH_MAX = 85, DIST_MIN = 1.5, DIST_MAX = 120;
/** lowest the camera may go, km */
export const CAM_MIN_H = 0.03;
/** vertical field of view (matches cameraBasis: tan of half-angle 32 deg) */
const TAN_HALF = Math.tan(32 * Math.PI / 180);

/** The pivot sits higher when zoomed out, so a far view frames the whole storm and a close one the tornado. */
export const pivotHeight = (dist: number) => clamp(0.12 * dist, 0.5, 3.5);

/** Pitch limited so the camera stays above the ground. */
export function clampPitch(pitch: number, dist: number): number {
  const pz = pivotHeight(dist);
  const minSin = (CAM_MIN_H - pz) / dist;
  const minPitch = minSin <= -1 ? -90 : Math.asin(minSin) * 180 / Math.PI;
  return clamp(pitch, Math.max(PITCH_MIN, minPitch), PITCH_MAX);
}

export function toCamera(s: RigState): Camera {
  const pz = pivotHeight(s.dist), pr = s.pitch * Math.PI / 180;
  return { az: s.yaw, dist: s.dist * Math.cos(pr), h: Math.max(CAM_MIN_H, pz + s.dist * Math.sin(pr)), tz: pz, tx: s.px, ty: s.py };
}

export function fromCamera(c: Camera): RigState {
  const dz = c.h - c.tz, dist = Math.hypot(c.dist, dz);
  return { px: c.tx ?? 0, py: c.ty ?? 0, yaw: c.az, pitch: Math.atan2(dz, c.dist) * 180 / Math.PI, dist };
}

/** Horizontal forward (camera toward pivot) and right vectors for a yaw. */
export function groundAxes(yaw: number) {
  const a = yaw * Math.PI / 180;
  return { fx: -Math.cos(a), fy: -Math.sin(a), rx: -Math.sin(a), ry: Math.cos(a) };
}

export class CameraRig {
  goal: RigState;
  cur: RigState;
  private keys = new Set<string>();
  /** true while anything is moving, so the renderer can drop to a lower resolution */
  moving = false;

  constructor(init: Camera) { this.goal = fromCamera(init); this.cur = { ...this.goal }; }

  camera(): Camera { return toCamera(this.cur); }

  /** Shift the pivot (both goal and current) without easing, e.g. to follow the storm. */
  translate(dx: number, dy: number) { this.goal.px += dx; this.goal.py += dy; this.cur.px += dx; this.cur.py += dy; }
  /** Fly the pivot to a point. */
  lookAt(x: number, y: number) { this.goal.px = x; this.goal.py = y; }
  /** Jump straight to a point (no easing). */
  jumpTo(x: number, y: number) { this.lookAt(x, y); this.cur.px = x; this.cur.py = y; }

  keyDown(code: string) { this.keys.add(code); }
  keyUp(code: string) { this.keys.delete(code); }
  clearKeys() { this.keys.clear(); }
  static readonly KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  /** Pan by a screen-space drag (pixels), so the ground under the cursor follows it. */
  dragPan(dxPx: number, dyPx: number, viewH: number) {
    const g = this.goal, k = (2 * TAN_HALF * g.dist / Math.max(viewH, 1)) * 1.1;
    const { fx, fy, rx, ry } = groundAxes(g.yaw);
    // dragging down moves the view forward less steeply when looking along the ground
    const fk = k / Math.max(Math.sin(Math.max(Math.abs(g.pitch), 12) * Math.PI / 180), 0.2) * 0.35;
    g.px += -rx * dxPx * k + fx * dyPx * fk;
    g.py += -ry * dxPx * k + fy * dyPx * fk;
  }

  dragRotate(dxPx: number, dyPx: number) {
    this.goal.yaw -= dxPx * 0.25;
    this.goal.pitch = clampPitch(this.goal.pitch + dyPx * 0.18, this.goal.dist);
  }

  /**
   * Zoom by a wheel step toward the point under the cursor. `ndcX`/`ndcY` are the cursor in -1..1 (y up), `aspect`
   * is width / height.
   */
  zoom(deltaY: number, ndcX = 0, ndcY = 0, aspect = 1.6) {
    const g = this.goal, old = g.dist;
    const nd = clamp(old * Math.exp(deltaY * 0.0012), DIST_MIN, DIST_MAX);
    if (nd === old) return;
    // the point under the cursor on the horizontal plane through the pivot: shift the pivot toward it by the
    // fraction the distance shrinks, so it stays under the cursor
    const hit = this.cursorPoint(ndcX, ndcY, aspect);
    if (hit) {
      const f = 1 - nd / old;
      g.px += (hit[0] - g.px) * f; g.py += (hit[1] - g.py) * f;
    }
    g.dist = nd;
    g.pitch = clampPitch(g.pitch, nd);
  }

  /** Where a ray through the cursor meets the horizontal plane through the pivot (the goal state's view). */
  cursorPoint(ndcX: number, ndcY: number, aspect: number): [number, number] | null {
    const c = toCamera(this.goal), a = c.az * Math.PI / 180;
    const cp = [c.tx! + c.dist * Math.cos(a), c.ty! + c.dist * Math.sin(a), c.h];
    let f = [c.tx! - cp[0], c.ty! - cp[1], c.tz - cp[2]];
    const fl = Math.hypot(f[0], f[1], f[2]); f = f.map(v => v / fl);
    let r = [f[1], -f[0], 0]; const rl = Math.hypot(r[0], r[1]) || 1; r = r.map(v => v / rl);
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const d = [0, 1, 2].map(i => f[i] + ndcX * aspect * TAN_HALF * r[i] + ndcY * TAN_HALF * u[i]);
    if (Math.abs(d[2]) < 1e-4) return null;
    const tt = (c.tz - cp[2]) / d[2];
    if (tt <= 0 || tt > c.dist * 6 + 60) return null;
    return [cp[0] + d[0] * tt, cp[1] + d[1] * tt];
  }

  /** Advance: apply held keys to the goal, then ease the camera toward it. dt in seconds. */
  update(dt: number, fast = false) {
    const g = this.goal, k = this.keys, sp = fast ? 2.5 : 1;
    const ax = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ay = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (ax || ay) {
      const { fx, fy, rx, ry } = groundAxes(g.yaw), v = 0.9 * g.dist * sp * dt;
      g.px += (rx * ax + fx * ay) * v; g.py += (ry * ax + fy * ay) * v;
    }
    const rot = (k.has('KeyQ') ? 1 : 0) - (k.has('KeyE') ? 1 : 0);
    if (rot) g.yaw += rot * 75 * sp * dt;
    const tilt = (k.has('KeyR') ? 1 : 0) - (k.has('KeyF') ? 1 : 0);
    if (tilt) g.pitch = clampPitch(g.pitch + tilt * 40 * sp * dt, g.dist);

    // ease toward the goal (frame-rate independent), zoom in log space
    const c = this.cur, e = 1 - Math.exp(-dt * 9);
    const before = { ...c };
    c.px += (g.px - c.px) * e; c.py += (g.py - c.py) * e;
    c.yaw += (g.yaw - c.yaw) * e;
    c.pitch += (g.pitch - c.pitch) * e;
    c.dist = Math.exp(Math.log(c.dist) + (Math.log(g.dist) - Math.log(c.dist)) * e);
    c.pitch = clampPitch(c.pitch, c.dist);
    const moved = Math.hypot(c.px - before.px, c.py - before.py) / c.dist + Math.abs(c.yaw - before.yaw) / 90
      + Math.abs(c.pitch - before.pitch) / 90 + Math.abs(Math.log(c.dist / before.dist));
    this.moving = moved > 2e-4 || k.size > 0;
  }
}
