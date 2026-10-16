/**
 * WebGPU renderer for the designed storm. Each update paints the storm into a 3-D volume (BUILD) and lights it
 * (LIGHT); each frame ray-marches it (RENDER) from the chaser's camera.
 */
import { cameraBasis, type Camera } from '../render/chaser';

/** Early-evening sun, the Plains' peak tornado hours (about 6-7 pm in late spring): low in the west, 15 degrees
 * up. It lights the storm's flank golden and leaves its base and underside in deep shade. */
const SUN_AZ = 272 * Math.PI / 180, SUN_ELEV = 15 * Math.PI / 180;
export const STORM_SUN: [number, number, number] = [Math.sin(SUN_AZ) * Math.cos(SUN_ELEV), Math.cos(SUN_AZ) * Math.cos(SUN_ELEV), Math.sin(SUN_ELEV)];
import { getGPU } from '../render/gpu-device';
import { cloudNoise } from '../render/noise';
import { NSLOT } from './design';
import { BUILD, LIGHT, RENDER } from './shaders';

/** volume half-width and top, km */
export const VOL_L = 50, VOL_TOP = 18;
/** peak extinction for cloud and for precipitation, 1/km */
const CMAX = 26, PMAX = 2.6;

export interface Quality { nv: number; nz: number }
export const QUALITY_HIGH: Quality = { nv: 288, nz: 144 };
export const QUALITY_LOW: Quality = { nv: 176, nz: 72 };

async function moduleOf(device: GPUDevice, code: string, label: string): Promise<GPUShaderModule> {
  const m = device.createShaderModule({ code, label });
  const info = await m.getCompilationInfo();
  const errs = info.messages.filter(x => x.type === 'error');
  if (errs.length) throw new Error(`${label}: ${errs.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('; ')}`);
  return m;
}

export class StormRenderer {
  readonly kind = 'webgpu' as const;
  private dens!: GPUTexture; private light!: GPUTexture;
  private buildBind!: GPUBindGroup; private lightBind!: GPUBindGroup; private renderBind!: GPUBindGroup;
  private frame = 0;
  private q: Quality;

  private constructor(
    readonly device: GPUDevice, readonly canvas: HTMLCanvasElement, private ctx: GPUCanvasContext, private format: GPUTextureFormat,
    private buildPipe: GPUComputePipeline, private lightPipe: GPUComputePipeline, private renderPipe: GPURenderPipeline,
    private sp: GPUBuffer, private spB: GPUBuffer, private lu: GPUBuffer, private ru: GPUBuffer, private noise: GPUTexture,
    private samp: GPUSampler, private sampRep: GPUSampler, q: Quality
  ) { this.q = q; this.allocate(); }

  static async create(canvas: HTMLCanvasElement, q: Quality = QUALITY_HIGH): Promise<StormRenderer | null> {
    const gpu = await getGPU();
    if (!gpu) return null;
    const device = gpu.device;
    const [bm, lm, rm] = await Promise.all([moduleOf(device, BUILD, 'storm-build'), moduleOf(device, LIGHT, 'storm-light'), moduleOf(device, RENDER, 'storm-render')]);
    const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!ctx) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });
    const buildPipe = device.createComputePipeline({ layout: 'auto', compute: { module: bm, entryPoint: 'main' } });
    const lightPipe = device.createComputePipeline({ layout: 'auto', compute: { module: lm, entryPoint: 'main' } });
    const renderPipe = device.createRenderPipeline({
      layout: 'auto', vertex: { module: rm, entryPoint: 'vs' }, fragment: { module: rm, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' }
    });
    const U = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    const sp = device.createBuffer({ size: NSLOT * 16, usage: U }), spB = device.createBuffer({ size: NSLOT * 16, usage: U }), lu = device.createBuffer({ size: 48, usage: U }), ru = device.createBuffer({ size: 112, usage: U });
    const NN = 48;
    const noise = device.createTexture({ size: [NN, NN, NN], dimension: '3d', format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: noise }, cloudNoise(NN) as Uint8Array<ArrayBuffer>, { bytesPerRow: NN, rowsPerImage: NN }, [NN, NN, NN]);
    const clampS = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    const rep = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });
    return new StormRenderer(device, canvas, ctx, format, buildPipe, lightPipe, renderPipe, sp, spB, lu, ru, noise, clampS, rep, q);
  }

  get quality(): Quality { return this.q; }
  setQuality(q: Quality): void { if (q.nv === this.q.nv && q.nz === this.q.nz) return; this.q = q; this.dens.destroy(); this.light.destroy(); this.allocate(); }

  private allocate(): void {
    const d = this.device, { nv, nz } = this.q;
    this.dens = d.createTexture({ size: [nv, nv, nz], dimension: '3d', format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    const ln = Math.max(8, Math.floor(nv / 3)), lz = Math.max(4, Math.floor(nz / 3));
    this.light = d.createTexture({ size: [ln, ln, lz], dimension: '3d', format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    const B = (b: GPUBuffer): GPUBindingResource => ({ buffer: b });
    this.buildBind = d.createBindGroup({ layout: this.buildPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: B(this.spB) }, { binding: 1, resource: this.noise.createView() }, { binding: 2, resource: this.sampRep }, { binding: 3, resource: this.dens.createView() }] });
    this.lightBind = d.createBindGroup({ layout: this.lightPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: this.dens.createView() }, { binding: 1, resource: this.samp }, { binding: 2, resource: this.light.createView() }, { binding: 3, resource: B(this.lu) }] });
    this.renderBind = d.createBindGroup({ layout: this.renderPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: this.dens.createView() }, { binding: 1, resource: this.light.createView() }, { binding: 2, resource: this.noise.createView() },
      { binding: 3, resource: this.samp }, { binding: 4, resource: this.sampRep }, { binding: 5, resource: B(this.ru) }, { binding: 6, resource: B(this.sp) }] });
  }

  /** number of frames a volume rebuild is spread over */
  static SLABS = 4;
  private slab = -1; private slabZ = 0;

  private writeUniforms(params: Float32Array): void {
    const p = new Float32Array(NSLOT * 4); p.set(params.subarray(0, Math.min(params.length, NSLOT * 4)));
    p.set([this.q.nv, this.q.nz, VOL_L, VOL_TOP], 17 * 4);
    p.set([0, 0, 0, 0], 20 * 4);
    this.device.queue.writeBuffer(this.spB, 0, p);
    const ln = this.lightN(), lz = this.lightZ();
    this.device.queue.writeBuffer(this.lu, 0, new Float32Array([STORM_SUN[0], STORM_SUN[1], STORM_SUN[2], 0, ln, lz, VOL_L, VOL_TOP, CMAX, PMAX, 0.8, params[4]]));
  }
  private lightN(): number { return Math.max(8, Math.floor(this.q.nv / 3)); }
  private lightZ(): number { return Math.max(4, Math.floor(this.q.nz / 3)); }
  private encodeBuild(enc: GPUCommandEncoder, z0: number, nzSlab: number): void {
    this.device.queue.writeBuffer(this.spB, 20 * 16, new Float32Array([z0, 0, 0, 0]));
    const pass = enc.beginComputePass();
    pass.setPipeline(this.buildPipe); pass.setBindGroup(0, this.buildBind);
    pass.dispatchWorkgroups(Math.ceil(this.q.nv / 4), Math.ceil(this.q.nv / 4), Math.ceil(nzSlab / 4));
    pass.end();
  }
  private encodeLight(enc: GPUCommandEncoder): void {
    const pass = enc.beginComputePass();
    pass.setPipeline(this.lightPipe); pass.setBindGroup(0, this.lightBind);
    pass.dispatchWorkgroups(Math.ceil(this.lightN() / 4), Math.ceil(this.lightN() / 4), Math.ceil(this.lightZ() / 4));
    pass.end();
  }

  /** Paint and light the storm for one moment (params from stormAt), all at once. */
  update(params: Float32Array): void {
    this.slab = -1;
    this.writeUniforms(params);
    this.setClock(params, params[4 + 2]);
    const enc = this.device.createCommandEncoder();
    this.encodeBuild(enc, 0, this.q.nz);
    this.encodeLight(enc);
    this.device.queue.submit([enc.finish()]);
  }
  /** As update(), waiting for each pass and returning its time in ms (tests and profiling). */
  async updateTimed(params: Float32Array): Promise<{ build: number; light: number }> {
    this.slab = -1;
    this.writeUniforms(params);
    this.setClock(params, params[4 + 2]);
    const q = this.device.queue;
    let enc = this.device.createCommandEncoder(); this.encodeBuild(enc, 0, this.q.nz); q.submit([enc.finish()]);
    const t0 = performance.now(); await q.onSubmittedWorkDone(); const t1 = performance.now();
    enc = this.device.createCommandEncoder(); this.encodeLight(enc); q.submit([enc.finish()]);
    await q.onSubmittedWorkDone();
    return { build: t1 - t0, light: performance.now() - t1 };
  }

  /**
   * Start a rebuild spread over SLABS frames: call step() once per frame. The storm changes over minutes, so a
   * volume whose slabs are a few frames apart in age is indistinguishable, and the work per frame is small.
   */
  beginUpdate(params: Float32Array): void {
    this.writeUniforms(params);
    this.setClock(params, params[4 + 2]);
    this.slab = 0; this.slabZ = Math.ceil(this.q.nz / StormRenderer.SLABS / 4) * 4;
  }
  /** Do this frame's share of a rebuild in progress; returns true when the rebuild (and relight) finished. */
  step(): boolean {
    if (this.slab < 0) return false;
    const enc = this.device.createCommandEncoder();
    const z0 = this.slab * this.slabZ;
    this.encodeBuild(enc, z0, Math.min(this.slabZ, this.q.nz - z0));
    this.slab++;
    const done = this.slab * this.slabZ >= this.q.nz;
    if (done) { this.encodeLight(enc); this.slab = -1; }
    this.device.queue.submit([enc.finish()]);
    return done;
  }
  get rebuilding(): boolean { return this.slab >= 0; }

  /** Only the clock changes (spin inside the wall cloud and tornado): cheaper than a full update. */
  setClock(params: Float32Array, clock: number): void {
    const p = new Float32Array(NSLOT * 4); p.set(params.subarray(0, Math.min(params.length, NSLOT * 4)));
    p[4 + 2] = clock; p.set([this.q.nv, this.q.nz, VOL_L, VOL_TOP], 17 * 4);
    this.device.queue.writeBuffer(this.sp, 0, p);
  }

  private writeCamera(cam: Camera, W: number, H: number): void {
    const b = cameraBasis(cam);
    this.device.queue.writeBuffer(this.ru, 0, new Float32Array([
      ...b.cp, cam.gx ?? 0, ...b.f, cam.gy ?? 0, ...b.r, 0, ...b.u, 0, ...STORM_SUN, 0,
      W, H, b.th, CMAX, PMAX, 1.7, (this.frame++ % 64) * 1.37, 0
    ]));
  }
  private encode(view: GPUTextureView): GPUCommandEncoder {
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(this.renderPipe); pass.setBindGroup(0, this.renderBind); pass.draw(3); pass.end();
    return enc;
  }

  /** Draw a frame; `scale` is the internal resolution relative to CSS pixels, `mul` a further factor on the default. */
  render(cam: Camera, scale?: number, mul = 1): void {
    // cap the pixel count (about 1.6 megapixels) so full screen on a big display stays smooth
    const cw = Math.max(1, this.canvas.clientWidth), ch = Math.max(1, this.canvas.clientHeight);
    const s = (scale ?? Math.min(window.devicePixelRatio || 1, 1.25, Math.sqrt(1.6e6 / (cw * ch)))) * mul;
    const W = Math.max(1, Math.round(this.canvas.clientWidth * s)), H = Math.max(1, Math.round(this.canvas.clientHeight * s));
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this.writeCamera(cam, W, H);
    this.device.queue.submit([this.encode(this.ctx.getCurrentTexture().createView()).finish()]);
  }

  /** Render offscreen and return the pixels (saving an image, tests). */
  async capture(cam: Camera, W: number, H: number): Promise<ImageData> {
    const d = this.device;
    const tex = d.createTexture({ size: [W, H], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const bpr = Math.ceil(W * 4 / 256) * 256;
    const buf = d.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.writeCamera(cam, W, H);
    const enc = this.encode(tex.createView());
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [W, H]);
    d.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange()), out = new ImageData(W, H), bgra = this.format === 'bgra8unorm';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = y * bpr + x * 4, o = (y * W + x) * 4;
      out.data[o] = src[s + (bgra ? 2 : 0)]; out.data[o + 1] = src[s + 1]; out.data[o + 2] = src[s + (bgra ? 0 : 2)]; out.data[o + 3] = 255;
    }
    buf.unmap(); buf.destroy(); tex.destroy();
    return out;
  }

  destroy(): void { this.dens.destroy(); this.light.destroy(); this.noise.destroy(); for (const b of [this.sp, this.spB, this.lu, this.ru]) b.destroy(); this.ctx.unconfigure(); }
}
