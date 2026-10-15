/** One full storm computation, run in the worker: radar fields, velocity, feature geometry and the cloud volume. */
import { type Vec2 } from './constants';
import { environment, type EnvInput } from './environment';
import { storm } from './storm';
import { blur, toDbz, trajectories, type Grid3 } from './trajectories';
import { layerMean } from './winds';
import { cloudVolume, lightVolumeCPU } from './volume';

export interface ComputeOptions {
  nRel: number;
  /** build the cloud volume */
  volume: boolean;
  /** also light it on the CPU (only the WebGL fallback needs this) */
  cpuLighting: boolean;
}

export interface StormGeometry {
  Ru: number; mesoX: number; mesoY: number; rfdX: number; rfdY: number; RmLow: number;
  /** position (m) and dBZ of the forward-flank core */
  core: [number, number, number] | null;
  /** radar site, m (storm-relative) */
  radar: Vec2;
  R: number; N: number; dx: number;
}

export interface VolumeData extends Grid3 {
  /** extinction, 1/km */
  beta: Float32Array;
  /** packed RGBA8 with CPU lighting, when requested */
  lit: Uint8Array | null;
}

export interface ComputeResult {
  dbz: Float32Array;
  anv: Float32Array;
  /** radial velocity (m/s, positive away from the radar) of the storm-relative wind at about 700 m */
  vr: Float32Array;
  vol: VolumeData | null;
  geo: StormGeometry;
}

export const RADAR_GRID = { R: 50000, N: 200 };
export const VOLUME_GRID: Grid3 = { NV: 128, NZv: 48, Rv: 60000, ZT: 16000, dxv: 120000 / 128, dzv: 16000 / 48 };

export function compute(o: EnvInput, opt: ComputeOptions): ComputeResult {
  const E = environment(o), St = storm(E);
  const { R, N } = RADAR_GRID;
  const T = trajectories(St, { R, N, nRel: opt.nRel, volume: opt.volume ? VOLUME_GRID : undefined });
  const dbz = toDbz(blur(T.low, N, 1.5), T.nRel);
  const anv = blur(T.anvil, N, 2);
  const F = T.F, ov = [0, 0, 0];
  const radar: Vec2 = [70000 * Math.SQRT1_2, -70000 * Math.SQRT1_2];   // 70 km south-east
  const vr = new Float32Array(N * N);
  if (St.forms) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -R + (i + 0.5) * T.dx, y = -R + (j + 0.5) * T.dx;
    F.vel(x, y, 700, ov);
    const dx = x - radar[0], dy = y - radar[1], d = Math.hypot(dx, dy);
    vr[j * N + i] = (ov[0] * dx + ov[1] * dy) / d;
  }
  let vol: VolumeData | null = null;
  if (opt.volume) {
    const beta = cloudVolume(St, T);
    vol = { ...VOLUME_GRID, beta, lit: opt.cpuLighting ? lightVolumeCPU(beta, VOLUME_GRID) : null };
  }
  let core: [number, number, number] | null = null;
  if (St.forms) {
    const up = layerMean(E.w, 6000, 10000), fa = Math.atan2(up[1] - E.bk.rm[1], up[0] - E.bk.rm[0]) + 0.5;
    let bz = -99;
    for (let j = 0; j < N; j += 2) for (let i = 0; i < N; i += 2) {
      const x = -R + (i + 0.5) * T.dx, y = -R + (j + 0.5) * T.dx, d = Math.hypot(x, y);
      if (d < 0.8 * F.Ru || d > 25000 || Math.cos(Math.atan2(y, x) - fa) < 0.3) continue;
      if (dbz[j * N + i] > bz) { bz = dbz[j * N + i]; core = [x, y, bz]; }
    }
  }
  const geo: StormGeometry = { core, Ru: F.Ru, mesoX: F.mesoX, mesoY: F.mesoY, rfdX: F.rfdX, rfdY: F.rfdY, RmLow: F.RmLow, radar, R, N, dx: T.dx };
  return { dbz, anv, vr, vol, geo };
}
