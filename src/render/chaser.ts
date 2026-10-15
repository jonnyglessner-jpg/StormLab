/** Chaser view: ray-marched cloud volume. WebGPU when available, WebGL2 otherwise. */
import { type VolumeData } from '../physics/compute';
import { createWebGLRenderer } from './chaser-webgl';
import { createWebGPURenderer } from './chaser-webgpu';

export interface Camera {
  /** azimuth of the camera around the storm, degrees (0 = east of it, -90 = south) */
  az: number;
  /** distance from the target, km */
  dist: number;
  /** camera height, km */
  h: number;
  /** height of the point it looks at, km */
  tz: number;
}

export interface ChaserRenderer {
  readonly kind: 'webgpu' | 'webgl2';
  /** the canvas it draws into (may be a fresh copy if a WebGPU attempt claimed the original) */
  readonly canvas: HTMLCanvasElement;
  /** whether the volume must arrive with CPU lighting packed in */
  readonly needsCpuLighting: boolean;
  setVolume(v: VolumeData): void;
  /** draw a frame; `scale` is the internal resolution relative to CSS pixels (lower while the camera moves) */
  render(cam: Camera, scale?: number): void;
  /** render one frame offscreen and return its pixels (RGBA), for saving an image or for tests */
  capture(cam: Camera, width: number, height: number): Promise<ImageData | null>;
  destroy(): void;
}

export const SUN_EL = 22 * Math.PI / 180;
/** unit vector toward the sun: low in the west */
export const SUN_DIR: [number, number, number] = [-Math.cos(SUN_EL), 0, Math.sin(SUN_EL)];
export const TARGET: [number, number] = [4, 2];

/** Camera basis for a look-at toward the storm. */
export function cameraBasis(cam: Camera) {
  const az = cam.az * Math.PI / 180;
  const cp = [TARGET[0] + cam.dist * Math.cos(az), TARGET[1] + cam.dist * Math.sin(az), cam.h];
  let f = [TARGET[0] - cp[0], TARGET[1] - cp[1], cam.tz - cp[2]];
  const fl = Math.hypot(f[0], f[1], f[2]); f = f.map(v => v / fl);
  let r = [f[1], -f[0], 0];
  const rl = Math.hypot(r[0], r[1]) || 1; r = r.map(v => v / rl);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { cp, f, r, u, th: Math.tan(32 * Math.PI / 180) };
}

/**
 * Try WebGPU first (add ?renderer=webgl to the URL to force the fallback). A canvas keeps the first context type
 * it hands out, so if WebGPU fails after claiming the canvas, the WebGL2 renderer gets a fresh copy of it.
 */
export async function createChaserRenderer(canvas: HTMLCanvasElement): Promise<ChaserRenderer | null> {
  const forced = new URLSearchParams(location.search).get('renderer');
  if (forced !== 'webgl' && 'gpu' in navigator) {
    try {
      const r = await createWebGPURenderer(canvas);
      if (r) return r;
    } catch (e) {
      console.warn('WebGPU renderer unavailable, falling back to WebGL2', e);
      const fresh = canvas.cloneNode(true) as HTMLCanvasElement;
      canvas.replaceWith(fresh);
      canvas = fresh;
    }
  }
  return createWebGLRenderer(canvas);
}
