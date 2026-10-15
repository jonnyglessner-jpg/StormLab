/** CPU fallback: runs the reference cloud model off the main thread and returns diagnostics and lit volumes. */
import { type VolumeData } from '../physics/compute';
import { environment, type EnvInput } from '../physics/environment';
import { lightVolumeCPU } from '../physics/volume';
import { baseFromEnvironment } from './base';
import { diagCPU } from './diag';
import { COARSE_GRID } from './grid';
import { SimCPU } from './model-cpu';
import { type Nudge } from './params';

export type SimWorkerIn =
  | { type: 'init'; env: EnvInput; nudge: Nudge }
  | { type: 'run'; seconds: number; volume: boolean };
export interface SimWorkerOut { t: number; diag: Float32Array; vol: VolumeData | null }

interface Scope { onmessage: ((e: MessageEvent<SimWorkerIn>) => void) | null; postMessage(m: SimWorkerOut, t: Transferable[]): void }
const scope = self as unknown as Scope;
let sim: SimCPU | null = null;
const BMAX = 24;

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    const g = COARSE_GRID;
    sim = new SimCPU(g, baseFromEnvironment(g, environment(m.env)), { dt: 10 });
    sim.nudgeCfg = { ...m.nudge, tau: 10 };
    return;
  }
  if (!sim) return;
  const steps = Math.max(1, Math.round(m.seconds / sim.p.dt));
  for (let n = 0; n < steps; n++) sim.step();
  const g = sim.g, diag = diagCPU(g, sim.b, sim.f);
  let vol: VolumeData | null = null;
  if (m.volume) {
    // same extinction mapping as the PACK kernel
    const N = g.NX * g.NY * g.NZ, beta = new Float32Array(N);
    for (let c = 0; c < N; c++) beta[c] = Math.min(BMAX, 22000 * Math.max(sim.f.qc[c], 0)) + 350 * Math.max(sim.f.qr[c], 0);
    const grid = { NV: g.NX, NZv: g.NZ, Rv: g.NX * g.dx / 2, ZT: g.NZ * g.dz, dxv: g.dx, dzv: g.dz };
    vol = { ...grid, beta, lit: lightVolumeCPU(beta, grid) };
  }
  const transfer: Transferable[] = [diag.buffer];
  if (vol) { transfer.push(vol.beta.buffer); if (vol.lit) transfer.push(vol.lit.buffer); }
  scope.postMessage({ t: sim.t, diag, vol }, transfer);
};
