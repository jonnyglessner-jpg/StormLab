/**
 * WebGPU implementation of the cloud model. Same algorithm and step order as SimCPU:
 *   advect (A -> B) -> microphysics and sedimentation (B) -> buoyancy (B.w) -> diffusion + sponges (B -> A)
 *   -> divergence -> red-black line relaxation -> pressure-gradient correction (A)
 * A always holds the current state between steps.
 */
import { type BaseState } from './base';
import { ADV1, ADV2, BUOY, CLOCK, DEP, DIAGW, DIAGZ, DIFFRELAX, DIV, GRAD, LAPH, LINE, MICRO, NUDGE, PACK, SED } from './gpu-kernels';
import { nC, nU, nV, nW, type GridSpec } from './grid';
import { type SimFields } from './model-cpu';
import { DEFAULT_PARAMS, MAX_TOWERS, type Nudge, type SimParams } from './params';

type FieldName = 'u' | 'v' | 'w' | 'th' | 'qv' | 'qc' | 'qr' | 'qi' | 'qs' | 'qh';
const FIELDS: FieldName[] = ['th', 'qv', 'qc', 'qr', 'qi', 'qs', 'qh', 'u', 'v', 'w'];
const BS = 65;
/** values per column in the diagnostics buffer (see DIAGW and DIAGZ in gpu-kernels.ts) */
export const ND = 12;

export class SimGPU {
  readonly device: GPUDevice;
  readonly g: GridSpec;
  readonly p: SimParams;
  readonly b: BaseState;
  t = 0;
  steps = 0;
  A: Record<FieldName, GPUBuffer>;
  B: Record<FieldName, GPUBuffer>;
  phi: GPUBuffer; div: GPUBuffer; tmp: GPUBuffer;
  /** departure points of the layout being advected, 6 floats per point */
  dep: GPUBuffer;
  /** accumulated rain [0, plane) and hail [plane, 2 plane), mm */
  acc: GPUBuffer;
  /** base state, a uniform buffer of 8 x 65 floats */
  base: GPUBuffer;
  private uP: GPUBuffer;
  private uN: GPUBuffer;
  /** model time on the GPU, advanced by the CLOCK kernel each step */
  private clk: GPUBuffer;
  nudgeCfg: Nudge | null = null;
  private passes: { pipe: GPUComputePipeline; bind: GPUBindGroup; wg: [number, number, number] }[] = [];
  /** cloud/rain density for the renderer (rgba8unorm, NX x NY x NZ) */
  densTex: GPUTexture | null = null;
  diag: GPUBuffer | null = null;
  private packPass: { pipe: GPUComputePipeline; bind: GPUBindGroup } | null = null;
  private diagPasses: { pipe: GPUComputePipeline; bind: GPUBindGroup }[] = [];
  private diagStage: GPUBuffer | null = null;
  private diagBusy = false;

  static async create(device: GPUDevice, g: GridSpec, base: BaseState, params: Partial<SimParams> = {}): Promise<SimGPU> {
    if (g.NZ > 64) throw new Error('NZ must be at most 64');
    const s = new SimGPU(device, g, base, params);
    await s.build();
    return s;
  }

  private constructor(device: GPUDevice, g: GridSpec, base: BaseState, params: Partial<SimParams>) {
    this.device = device; this.g = g; this.b = base; this.p = { ...DEFAULT_PARAMS, ...params };
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const buf = (n: number, label: string) => device.createBuffer({ size: Math.max(16, n * 4), usage: S, label });
    const sizes: Record<FieldName, number> = { u: nU(g), v: nV(g), w: nW(g), th: nC(g), qv: nC(g), qc: nC(g), qr: nC(g), qi: nC(g), qs: nC(g), qh: nC(g) };
    const mk = (tag: string) => Object.fromEntries(FIELDS.map(f => [f, buf(sizes[f], `${tag}.${f}`)])) as Record<FieldName, GPUBuffer>;
    this.A = mk('A'); this.B = mk('B');
    this.phi = buf(nC(g), 'phi'); this.div = buf(nC(g), 'div');
    this.tmp = buf(Math.max(nU(g), nV(g), nW(g)), 'tmp'); this.dep = buf(6 * Math.max(nU(g), nV(g), nW(g)), 'dep'); this.acc = buf(2 * g.NX * g.NY, 'acc');
    this.base = device.createBuffer({ size: 8 * BS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'base' });
    const bd = new Float32Array(8 * BS);
    const put = (f: number, a: Float32Array) => { for (let k = 0; k < a.length; k++) bd[f * BS + k] = a[k]; };
    put(0, base.th0); put(1, base.qv0); put(2, base.pi0); put(3, base.rho0); put(4, base.p0); put(5, base.u0); put(6, base.v0); put(7, base.rhoW);
    device.queue.writeBuffer(this.base, 0, bd);
    this.uP = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.uN = device.createBuffer({ size: 16 + 32 * MAX_TOWERS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.clk = buf(4, 'clock');
    this.writeParams();
  }

  writeParams(): void {
    const { g, p } = this, ab = new ArrayBuffer(80), u = new Uint32Array(ab), f = new Float32Array(ab);
    u[0] = g.NX; u[1] = g.NY; u[2] = g.NZ;
    f.set([g.dx, g.dy, g.dz, p.dt], 4);
    f.set([p.kdiff, p.k1, p.qcCrit, p.k2], 8);
    f.set([p.spongeCells, p.spongeTau, p.dampZ, p.dampTau], 12);
    f.set([p.omega, this.b.rho0[0], p.hyper, 0], 16);
    this.device.queue.writeBuffer(this.uP, 0, ab);
  }

  private uniform(words: number[], floats: number[]): GPUBuffer {
    const ab = new ArrayBuffer(32), u = new Uint32Array(ab), f = new Float32Array(ab);
    words.forEach((v, i) => u[i] = v); floats.forEach((v, i) => f[4 + i] = v);
    const b = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(b, 0, ab);
    return b;
  }

  private async build(): Promise<void> {
    const d = this.device, g = this.g;
    const mod = async (code: string, label: string) => {
      const m = d.createShaderModule({ code, label });
      const info = await m.getCompilationInfo();
      const errs = info.messages.filter(x => x.type === 'error');
      if (errs.length) throw new Error(`${label}: ${errs.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('; ')}`);
      return d.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: 'main' }, label });
    };
    const [pDep, pAdv1, pAdv2, pMicro, pSed, pBuoy, pDiff, pDiv, pLine, pGrad, pNudge, pLap, pClock] = await Promise.all([
      mod(DEP, 'dep'), mod(ADV1, 'adv1'), mod(ADV2, 'adv2'), mod(MICRO, 'micro'), mod(SED, 'sed'),
      mod(BUOY, 'buoy'), mod(DIFFRELAX, 'diffrelax'), mod(DIV, 'div'), mod(LINE, 'line'), mod(GRAD, 'grad'), mod(NUDGE, 'nudge'), mod(LAPH, 'laph'), mod(CLOCK, 'clock')
    ]);
    const lay = (f: FieldName, baseIdx: number) => {
      const n = f === 'u' ? [g.NX + 1, g.NY, g.NZ] : f === 'v' ? [g.NX, g.NY + 1, g.NZ] : f === 'w' ? [g.NX, g.NY, g.NZ + 1] : [g.NX, g.NY, g.NZ];
      const o = f === 'u' ? [0, 0.5, 0.5] : f === 'v' ? [0.5, 0, 0.5] : f === 'w' ? [0.5, 0.5, 0] : [0.5, 0.5, 0.5];
      return { buf: this.uniform([...n, baseIdx], [...o, f === 'w' ? 1 : 0]), n: n as [number, number, number] };
    };
    const baseOf: Record<FieldName, number> = { th: 1, qv: 2, qc: 0, qr: 0, qi: 0, qs: 0, qh: 0, u: 6, v: 7, w: 0 };
    const wg = (n: [number, number, number], z = 4): [number, number, number] => [Math.ceil(n[0] / 8), Math.ceil(n[1] / 8), Math.ceil(n[2] / z)];
    const bg = (pipe: GPUComputePipeline, res: GPUBindingResource[]) =>
      d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: res.map((r, i) => ({ binding: i, resource: r })) });
    const B = (b: GPUBuffer): GPUBindingResource => ({ buffer: b });
    const P = B(this.uP), cells: [number, number, number] = [g.NX, g.NY, g.NZ];
    const add = (pipe: GPUComputePipeline, res: GPUBindingResource[], w: [number, number, number]) => this.passes.push({ pipe, bind: bg(pipe, res), wg: w });

    // 1. advection A -> B: departure points once per layout, then every field on that layout
    let lastLayout = '';
    for (const f of FIELDS) {
      const L = lay(f, 0), key = f === 'u' || f === 'v' || f === 'w' ? f : 'c';
      if (key !== lastLayout) { add(pDep, [P, B(L.buf), B(this.A.u), B(this.A.v), B(this.A.w), B(this.dep)], wg(L.n)); lastLayout = key; }
      add(pAdv1, [P, B(L.buf), B(this.A[f]), B(this.dep), B(this.tmp)], wg(L.n));
      add(pAdv2, [P, B(L.buf), B(this.A[f]), B(this.tmp), B(this.dep), B(this.B[f])], wg(L.n));
    }
    // 2. microphysics and sedimentation on B
    const Bq = (...f: FieldName[]) => f.map(k => B(this.B[k]));
    add(pMicro, [P, B(this.base), ...Bq('th', 'qv', 'qc', 'qr', 'qi', 'qs', 'qh')], wg(cells));
    add(pSed, [P, B(this.base), ...Bq('qr', 'qs', 'qh'), B(this.acc)], [Math.ceil(g.NX / 8), Math.ceil(g.NY / 8), 1]);
    // 3. buoyancy on B.w
    add(pBuoy, [P, B(this.base), ...Bq('w', 'th', 'qv', 'qc', 'qr', 'qi', 'qs', 'qh')], wg([g.NX, g.NY, g.NZ - 1]));
    // 4. diffusion + sponges B -> A
    for (const f of FIELDS) {
      const L = lay(f, baseOf[f]);
      add(pLap, [P, B(L.buf), B(this.B[f]), B(this.tmp)], wg(L.n));
      add(pDiff, [P, B(L.buf), B(this.base), B(this.B[f]), B(this.A[f]), B(this.tmp)], wg(L.n));
    }
    // 5. updraft nudging (switched on and off through its uniform), then projection
    add(pNudge, [P, B(this.uN), B(this.A.w), B(this.clk)], wg([g.NX, g.NY, g.NZ - 1]));
    add(pDiv, [P, B(this.base), B(this.A.u), B(this.A.v), B(this.A.w), B(this.div)], wg(cells));
    const col = [this.uniform([0], []), this.uniform([1], [])];
    const line = [0, 1].map(c => bg(pLine, [P, B(col[c]), B(this.base), B(this.div), B(this.phi)]));
    for (let it = 0; it < this.p.pIters; it++) for (const c of [0, 1]) this.passes.push({ pipe: pLine, bind: line[c], wg: [Math.ceil(g.NX / 8), Math.ceil(g.NY / 8), 1] });
    const comps: [FieldName, [number, number, number]][] = [['u', [g.NX + 1, g.NY, g.NZ]], ['v', [g.NX, g.NY + 1, g.NZ]], ['w', [g.NX, g.NY, g.NZ + 1]]];
    comps.forEach(([f, n], ci) => add(pGrad, [P, B(this.uniform([ci], [])), B(this.phi), B(this.A[f])], wg(n)));
    // 6. advance the model clock
    add(pClock, [P, B(this.clk)], [1, 1, 1]);

    // outputs: density texture for the renderer and per-column diagnostics
    const [pPack, pDiagW, pDiagZ] = await Promise.all([mod(PACK, 'pack'), mod(DIAGW, 'diagw'), mod(DIAGZ, 'diagz')]);
    this.densTex = d.createTexture({ size: [g.NX, g.NY, g.NZ], dimension: '3d', format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    const A = this.A;
    this.packPass = { pipe: pPack, bind: bg(pPack, [P, B(A.qc), B(A.qr), B(A.qi), B(A.qs), B(A.qh), this.densTex.createView()]) };
    this.diag = d.createBuffer({ size: g.NX * g.NY * ND * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.diagStage = d.createBuffer({ size: g.NX * g.NY * ND * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.diagPasses = [
      { pipe: pDiagW, bind: bg(pDiagW, [P, B(this.base), B(A.u), B(A.v), B(A.w), B(A.th), B(this.diag), B(this.acc)]) },
      { pipe: pDiagZ, bind: bg(pDiagZ, [P, B(this.base), B(A.th), B(A.qr), B(A.qs), B(A.qh), B(this.diag)]) }
    ];
  }

  /** Write cloud and rain into densTex. */
  pack(): void {
    if (this.dead || !this.packPass) return;
    const g = this.g, enc = this.device.createCommandEncoder(), pass = enc.beginComputePass();
    pass.setPipeline(this.packPass.pipe); pass.setBindGroup(0, this.packPass.bind);
    pass.dispatchWorkgroups(Math.ceil(g.NX / 8), Math.ceil(g.NY / 8), Math.ceil(g.NZ / 4)); pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /** Compute and read back the per-column diagnostics. Returns null if a read is already in flight. */
  async readDiag(): Promise<Float32Array | null> {
    if (this.dead || !this.diagPasses.length || !this.diag || !this.diagStage || this.diagBusy) return null;
    this.diagBusy = true;
    const g = this.g, enc = this.device.createCommandEncoder(), pass = enc.beginComputePass();
    for (const q of this.diagPasses) { pass.setPipeline(q.pipe); pass.setBindGroup(0, q.bind); pass.dispatchWorkgroups(Math.ceil(g.NX / 8), Math.ceil(g.NY / 8), 1); }
    pass.end();
    enc.copyBufferToBuffer(this.diag, 0, this.diagStage, 0, this.diag.size);
    this.device.queue.submit([enc.finish()]);
    try {
      await this.diagStage.mapAsync(GPUMapMode.READ);
      if (this.dead) return null;
      const out = new Float32Array(this.diagStage.getMappedRange().slice(0));
      this.diagStage.unmap();
      return out;
    } catch { return null; } finally { this.diagBusy = false; }
  }

  /** Encode n time steps into one command buffer and submit. Nudging is evaluated at the start of the batch. */
  step(n = 1): void {
    if (this.dead) return;
    this.writeNudge();
    const enc = this.device.createCommandEncoder();
    for (let s = 0; s < n; s++) {
      const pass = enc.beginComputePass();
      for (const q of this.passes) { pass.setPipeline(q.pipe); pass.setBindGroup(0, q.bind); pass.dispatchWorkgroups(...q.wg); }
      pass.end();
    }
    this.device.queue.submit([enc.finish()]);
    this.t += n * this.p.dt; this.steps += n;
  }

  /** Upload the towers (they switch on and off by the GPU's own clock, so batches of steps stay exact). */
  private nudgeSent: Nudge | null | undefined = undefined;
  private writeNudge(): void {
    const nd = this.nudgeCfg;
    if (nd === this.nudgeSent) return;
    this.nudgeSent = nd;
    const a = new Float32Array(4 + 8 * MAX_TOWERS), tw = nd ? nd.towers.slice(0, MAX_TOWERS) : [];
    a[0] = tw.length; a[1] = nd ? Math.min(1, this.p.dt / nd.tau) : 0;
    tw.forEach((t, i) => a.set([t.x, t.y, t.z, t.wmax, t.rh, t.rz, t.t0, t.t1], 4 + 8 * i));
    this.device.queue.writeBuffer(this.uN, 0, a);
  }

  /** Copy a full CPU state into the GPU (initial conditions). */
  upload(f: SimFields): void {
    const q = this.device.queue;
    for (const k of FIELDS) q.writeBuffer(this.A[k], 0, f[k] as Float32Array<ArrayBuffer>);
    q.writeBuffer(this.phi, 0, f.phi as Float32Array<ArrayBuffer>);
    q.writeBuffer(this.clk, 0, new Float32Array([this.t]));
    q.writeBuffer(this.acc, 0, f.rain as Float32Array<ArrayBuffer>);
    q.writeBuffer(this.acc, f.rain.byteLength, f.hail as Float32Array<ArrayBuffer>);
  }

  /** Read buffers back (tests and diagnostics). */
  async read(bufs: GPUBuffer[]): Promise<Float32Array[]> {
    const d = this.device, enc = d.createCommandEncoder();
    const stage = bufs.map(b => { const s = d.createBuffer({ size: b.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); enc.copyBufferToBuffer(b, 0, s, 0, b.size); return s; });
    d.queue.submit([enc.finish()]);
    const out: Float32Array[] = [];
    for (const s of stage) { await s.mapAsync(GPUMapMode.READ); out.push(new Float32Array(s.getMappedRange().slice(0))); s.unmap(); s.destroy(); }
    return out;
  }

  async download(): Promise<SimFields> {
    const A = this.A, plane = this.g.NX * this.g.NY;
    const [u, v, w, th, qv, qc, qr, qi, qs, qh, phi, acc] = await this.read([A.u, A.v, A.w, A.th, A.qv, A.qc, A.qr, A.qi, A.qs, A.qh, this.phi, this.acc]);
    return { u, v, w, th, qv, qc, qr, qi, qs, qh, phi, rain: acc.slice(0, plane), hail: acc.slice(plane, 2 * plane) };
  }

  /** true once destroy() has been called: no more steps, packs or readbacks */
  dead = false;
  /** Free the GPU memory once the work already queued has finished (a readback may still be in flight). */
  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    const free = () => this.free();
    this.device.queue.onSubmittedWorkDone().then(() => setTimeout(free, 0), free);
  }
  private free(): void {
    for (const r of [this.A, this.B]) for (const k of FIELDS) r[k].destroy();
    for (const b of [this.phi, this.div, this.tmp, this.dep, this.clk, this.acc, this.base, this.uP, this.uN]) b.destroy();
    this.densTex?.destroy(); this.diag?.destroy(); this.diagStage?.destroy();
  }
}
