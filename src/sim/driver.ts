/**
 * Runs the cloud model for the UI: WebGPU when available (1 km grid), otherwise the CPU reference in a worker
 * (2 km grid). Paces the model against the wall clock, keeps the renderer's volume current, and publishes
 * diagnostics.
 */
import { type VolumeData } from '../physics/volume';
import { type Environment } from '../physics/environment';
import { type ChaserRenderer } from '../render/chaser';
import { getGPU } from '../render/gpu-device';
import { baseFromEnvironment, type BaseState } from './base';
import { COARSE_GRID, DEFAULT_GRID, FINE_GRID, mixFor, stepFor, type GridSpec } from './grid';
import { SimCPU } from './model-cpu';
import { SimGPU } from './model-gpu';
import { defaultNudge, START_NOISE } from './start';
import type { SimWorkerIn, SimWorkerOut } from './sim.worker';

export const RUN_LENGTH = 7200;   // s of model time

/** One diagnostics frame. cu, cv: the storm-following frame's motion over the ground, m/s. */
export interface DiagFrame { t: number; g: GridSpec; diag: Float32Array; cu: number; cv: number }

export interface SimDriver {
  readonly kind: 'gpu' | 'cpu';
  readonly g: GridSpec;
  readonly base: BaseState;
  /** model time, s */
  readonly t: number;
  running: boolean;
  /** model seconds per wall-clock second; Infinity runs as fast as the hardware allows */
  speed: number;
  /** advance by the wall-clock interval since the last call */
  tick(wallDt: number): void;
  onDiag: ((f: DiagFrame) => void) | null;
  /** cloud volume updated since the renderer last drew */
  volumeDirty: boolean;
  /** point the renderer at this simulation's volume again */
  attach(): void;
  destroy(): void;
}

/** Start a simulation: on the GPU when there is one (fine = the 500 m grid), otherwise on the CPU's coarse grid. */
export async function createDriver(E: Environment, renderer: ChaserRenderer | null, fine = false): Promise<SimDriver> {
  if (renderer?.kind === 'webgpu' && renderer.device && renderer.attachTexture) {
    const gpu = await getGPU();
    if (gpu) return GpuDriver.create(E, renderer, fine ? FINE_GRID : DEFAULT_GRID);
  }
  return new CpuDriver(E, renderer);
}

class GpuDriver implements SimDriver {
  readonly kind = 'gpu' as const;
  running = false;
  speed = 180;
  onDiag: ((f: DiagFrame) => void) | null = null;
  volumeDirty = false;
  private carry = 0;
  private inFlight = false;
  private lastDiag = -1e9;
  private maxBatch = 2;

  private constructor(readonly sim: SimGPU, readonly g: GridSpec, readonly base: BaseState, private renderer: ChaserRenderer) {}

  static async create(E: Environment, renderer: ChaserRenderer, g: GridSpec): Promise<GpuDriver> {
    const base = baseFromEnvironment(g, E), dt = stepFor(g), kh = mixFor(g);
    const sim = await SimGPU.create(renderer.device!, g, base, { dt, kh });
    const init = new SimCPU(g, base, { dt, kh });             // initial state is built on the CPU and uploaded
    init.addNoise(START_NOISE.amp, START_NOISE.zTop, START_NOISE.seed);
    sim.upload(init.f);
    sim.nudgeCfg = defaultNudge(g, dt);
    sim.pack();
    const d = new GpuDriver(sim, g, base, renderer);
    d.attach();
    d.volumeDirty = true;
    void d.publish();
    return d;
  }
  get t() { return this.sim.t; }

  tick(wallDt: number): void {
    if (!this.running || this.inFlight || this.sim.t >= RUN_LENGTH) return;
    const dt = this.sim.p.dt;
    this.carry += isFinite(this.speed) ? this.speed * wallDt / dt : this.maxBatch;
    let n = Math.min(Math.floor(this.carry), this.maxBatch, Math.ceil((RUN_LENGTH - this.sim.t) / dt));
    if (n < 1) return;
    this.carry -= n;
    if (this.carry > this.maxBatch) this.carry = this.maxBatch;    // don't build up a backlog
    this.inFlight = true;
    const t0 = performance.now();
    this.sim.step(n);
    this.sim.pack();
    this.renderer.relight!();
    this.volumeDirty = true;
    this.sim.device.queue.onSubmittedWorkDone().then(() => {
      this.inFlight = false;
      // keep a batch under about 25 ms of GPU time
      const ms = performance.now() - t0, per = ms / n;
      this.maxBatch = Math.max(1, Math.min(40, Math.floor(25 / Math.max(per, 0.2))));
      if (this.sim.t - this.lastDiag >= 30) void this.publish();
    });
  }

  attach(): void {
    const g = this.g;
    this.renderer.attachTexture!(this.sim.densTex!, g.NX, g.NZ, g.NX * g.dx / 2000, g.NZ * g.dz / 1000);
  }

  private async publish(): Promise<void> {
    const d = await this.sim.readDiag();
    if (!d) return;
    this.lastDiag = this.sim.t;
    this.onDiag?.({ t: this.sim.t, g: this.g, diag: d, cu: this.base.cu, cv: this.base.cv });
  }

  destroy(): void { this.running = false; this.sim.destroy(); }
}

/** CPU fallback: the reference model in a worker on the coarse grid; volumes are lit on the CPU for WebGL. */
class CpuDriver implements SimDriver {
  readonly kind = 'cpu' as const;
  readonly g = COARSE_GRID;
  readonly base: BaseState;
  running = false;
  speed = 180;
  onDiag: ((f: DiagFrame) => void) | null = null;
  volumeDirty = false;
  private worker: Worker;
  private tNow = 0;
  private budget = 0;
  private waiting = false;
  private lastVol: VolumeData | null = null;

  constructor(E: Environment, private renderer: ChaserRenderer | null) {
    this.base = baseFromEnvironment(this.g, E);
    this.worker = new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<SimWorkerOut>) => {
      const m = e.data;
      this.waiting = false;
      this.tNow = m.t;
      if (m.vol) { this.lastVol = m.vol; if (this.renderer) { this.renderer.setVolume(m.vol); this.volumeDirty = true; } }
      this.onDiag?.({ t: m.t, g: this.g, diag: m.diag, cu: this.base.cu, cv: this.base.cv });
    };
    const msg: SimWorkerIn = { type: 'init', env: E.o, nudge: defaultNudge(this.g, 10) };
    this.worker.postMessage(msg);
  }
  get t() { return this.tNow; }

  tick(wallDt: number): void {
    if (!this.running || this.tNow >= RUN_LENGTH) return;
    this.budget += isFinite(this.speed) ? this.speed * wallDt : 120;
    if (this.waiting || this.budget < 30) return;
    // ask for up to two minutes of model time at once; the worker answers when done
    const seconds = Math.min(this.budget, 120);
    this.budget = Math.max(0, this.budget - seconds);
    this.waiting = true;
    const msg: SimWorkerIn = { type: 'run', seconds, volume: true };
    this.worker.postMessage(msg);
  }

  attach(): void { if (this.lastVol && this.renderer) this.renderer.setVolume(this.lastVol); }

  destroy(): void { this.running = false; this.worker.terminate(); }
}
