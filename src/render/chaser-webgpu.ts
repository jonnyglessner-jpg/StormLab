/**
 * WebGPU chaser view.
 * 1. A compute pass lights the cloud volume on the GPU: optical depth toward the sun and skylight from above,
 *    marched through the density texture for every voxel.
 * 2. A render pass ray-marches the volume from the camera, with tiling noise for sub-grid billows.
 */
import { BMAX, type VolumeData } from '../physics/volume';
import { cameraBasis, SUN_DIR, type Camera, type ChaserRenderer } from './chaser';
import { getGPU } from './gpu-device';
import { cloudNoise } from './noise';

const LIGHT_WGSL = /* wgsl */`
struct LU { sun: vec4f, dims: vec4f, p: vec4f };   // dims: light-grid NX, NZ, L km, ZT km; p: bmax, step km
@group(0) @binding(0) var dens: texture_3d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var outL: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> U: LU;

fn uvw(p: vec3f) -> vec3f { return vec3f((p.x + U.dims.z) / (2.0 * U.dims.z), (p.y + U.dims.z) / (2.0 * U.dims.z), p.z / U.dims.w); }
fn beta(p: vec3f) -> f32 { let d = textureSampleLevel(dens, samp, uvw(p), 0.0).r; return d * d * U.p.x; }

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let nv = u32(U.dims.x); let nz = u32(U.dims.y);
  if (id.x >= nv || id.y >= nv || id.z >= nz) { return; }
  let dx = 2.0 * U.dims.z / U.dims.x; let dz = U.dims.w / U.dims.y;
  let pos = vec3f(-U.dims.z + (f32(id.x) + 0.5) * dx, -U.dims.z + (f32(id.y) + 0.5) * dx, (f32(id.z) + 0.5) * dz);
  // optical depth toward the sun
  let st = U.p.y;
  var tau = 0.0; var q = pos + U.sun.xyz * 0.5 * st;
  for (var i = 0; i < 48; i++) {
    if (q.z > U.dims.w || abs(q.x) > U.dims.z || abs(q.y) > U.dims.z) { break; }
    tau += beta(q) * st; q += U.sun.xyz * st;
  }
  // skylight: optical depth straight up
  var up = 0.0; var r = pos + vec3f(0.0, 0.0, 0.5 * dz);
  for (var i = 0; i < 32; i++) { if (r.z > U.dims.w) { break; } up += beta(r) * dz; r.z += dz; }
  // two exponentials stand in for multiple scattering, which lets light deeper into thick cloud
  let sun = 0.75 * exp(-0.35 * tau) + 0.25 * exp(-0.08 * tau);
  textureStore(outL, id, vec4f(sun, exp(-0.12 * up), 0.0, 1.0));
}`;

const RENDER_WGSL = /* wgsl */`
struct RU { cp: vec4f, cf: vec4f, cr: vec4f, cu: vec4f, sd: vec4f, a: vec4f, b: vec4f };
// a: res.x, res.y, tan(half fov), L km ; b: ZT km, bmax, exposure, frame
@group(0) @binding(0) var dens: texture_3d<f32>;
@group(0) @binding(1) var light: texture_3d<f32>;
@group(0) @binding(2) var noise: texture_3d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var sampRep: sampler;
@group(0) @binding(5) var<uniform> U: RU;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
fn uvw(p: vec3f) -> vec3f { let L = U.a.w; return vec3f((p.x + L) / (2.0 * L), (p.y + L) / (2.0 * L), p.z / U.b.x); }
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }
// farm fields on a one-mile grid of section roads, faded with distance so they don't shimmer
fn groundColor(p: vec2f, dist: f32) -> vec3f {
  let sec = 1.609;
  let cell = floor(p / sec);
  let h1 = hash(cell + vec2f(0.37, 0.11)); let h2 = hash(cell * 1.7 + vec2f(5.3, 2.9));
  var field = mix(vec3f(0.22, 0.29, 0.14), vec3f(0.34, 0.32, 0.19), step(0.62, h1));
  field = mix(field, vec3f(0.17, 0.24, 0.11), step(0.85, h2));
  let f = fract(p / sec) * sec;
  let edge = min(min(f.x, sec - f.x), min(f.y, sec - f.y));
  let w = max(0.012, dist * 0.0011);
  let road = 1.0 - smoothstep(w, 2.0 * w, edge);
  let detail = exp(-dist / 30.0);
  var gc = mix(vec3f(0.24, 0.3, 0.16), field, detail);
  return mix(gc, vec3f(0.44, 0.42, 0.37), road * detail);
}

@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let res = U.a.xy;
  var uv = vec2f(fc.x / res.x, 1.0 - fc.y / res.y) * 2.0 - 1.0; uv.x *= res.x / res.y;
  let rd = normalize(U.cf.xyz + uv.x * U.a.z * U.cr.xyz + uv.y * U.a.z * U.cu.xyz);
  let cp = U.cp.xyz; let L = U.a.w; let ZT = U.b.x;
  let inv = 1.0 / rd; let b0 = vec3f(-L, -L, 0.0); let b1 = vec3f(L, L, ZT);
  let t0 = (b0 - cp) * inv; let t1 = (b1 - cp) * inv; let tmn = min(t0, t1); let tmx = max(t0, t1);
  let ta = max(max(tmn.x, tmn.y), max(tmn.z, 0.0)); let tb = min(min(tmx.x, tmx.y), tmx.z);
  let cosg = dot(rd, U.sd.xyz);
  let sunc = vec3f(1.0, 0.93, 0.8); let skyc = vec3f(0.48, 0.58, 0.72);
  var col = vec3f(0.0); var T = 1.0;
  if (tb > ta) {
    let dt0 = 0.18;
    var t = ta + dt0 * hash(fc.xy + U.b.w);
    let ph = 0.5 + 1.1 * pow(max(cosg, 0.0), 8.0);
    for (var i = 0; i < 480; i++) {
      if (t > tb || T < 0.01) { break; }
      let q = cp + rd * t;
      let tc = uvw(q);
      let s = textureSampleLevel(dens, samp, tc, 0.0).r;
      // empty air: stride ahead (the density grid is about 0.9 km, so 0.7 km strides can't skip a cloud)
      var dt = dt0 * (1.0 + t / 70.0);
      if (s <= 0.004) { dt = max(dt, 0.7); }
      if (s > 0.004) {
        // sub-grid billows from tiling noise at about 2.5 km and 0.8 km
        let nn = 0.62 * textureSampleLevel(noise, sampRep, q * 0.085, 0.0).r + 0.38 * textureSampleLevel(noise, sampRep, q * 0.27 + vec3f(0.31, 0.17, 0.53), 0.0).r;
        let d = clamp(s * (0.45 + 1.1 * nn) - 0.03, 0.0, 1.0);
        let be = d * d * U.b.y;
        if (be > 0.002) {
          let lt = textureSampleLevel(light, samp, tc, 0.0);
          let a = 1.0 - exp(-be * dt);
          let base = smoothstep(0.0, 1.2, q.z);
          let Lc = sunc * (lt.r * ph * 1.9) + skyc * (0.2 + 0.65 * lt.g) * (0.75 + 0.25 * base);
          col += T * a * Lc; T *= 1.0 - a;
        }
      }
      t += dt;
    }
  }
  var bg: vec3f;
  if (rd.z < 0.0) {
    let tg = -cp.z / rd.z; let g = cp + rd * tg;
    var sh = 1.0;
    if (abs(g.x) < L && abs(g.y) < L) { sh = textureSampleLevel(light, samp, vec3f((g.x + L) / (2.0 * L), (g.y + L) / (2.0 * L), 0.01), 0.0).r; }
    let hz = 1.0 - exp(-tg / 70.0);
    // ground position: the volume's frame plus how far it has moved over the ground
    let gp = g.xy + vec2f(U.cp.w, U.cf.w);
    bg = groundColor(gp, tg) * (0.3 + 0.7 * sh) * (1.0 - hz) + vec3f(0.62, 0.66, 0.7) * hz * 0.85;
  } else {
    let el = clamp(rd.z, 0.0, 1.0);
    bg = vec3f(0.78, 0.82, 0.86) * pow(1.0 - el, 3.0) + vec3f(0.34, 0.5, 0.76) * (1.0 - pow(1.0 - el, 3.0)) + 0.35 * pow(max(cosg, 0.0), 24.0) * vec3f(1.0, 0.9, 0.7);
  }
  var c = col + T * bg;
  c = 1.0 - exp(-U.b.z * c);
  return vec4f(pow(c, vec3f(1.0 / 1.1)), 1.0);
}`;

async function checkedModule(device: GPUDevice, code: string, label: string): Promise<GPUShaderModule> {
  const m = device.createShaderModule({ code, label });
  const info = await m.getCompilationInfo();
  const errs = info.messages.filter(x => x.type === 'error');
  if (errs.length) throw new Error(`${label}: ${errs.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('; ')}`);
  return m;
}

export async function createWebGPURenderer(canvas: HTMLCanvasElement): Promise<ChaserRenderer | null> {
  const gpu = await getGPU();
  if (!gpu) return null;
  const device = gpu.device;
  const lightMod = await checkedModule(device, LIGHT_WGSL, 'lighting');
  const renderMod = await checkedModule(device, RENDER_WGSL, 'render');
  const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const samp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  const sampRep = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });
  const NN = 48;
  const noiseTex = device.createTexture({ size: [NN, NN, NN], dimension: '3d', format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: noiseTex }, cloudNoise(NN) as Uint8Array<ArrayBuffer>, { bytesPerRow: NN, rowsPerImage: NN }, [NN, NN, NN]);

  const lightPipe = device.createComputePipeline({ layout: 'auto', compute: { module: lightMod, entryPoint: 'main' } });
  const renderPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: renderMod, entryPoint: 'vs' },
    fragment: { module: renderMod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' }
  });
  const lightUBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const renderUBuf = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  // the volume being drawn: either our own texture (instant model) or one owned by the simulation
  let ownTex: GPUTexture | null = null, lightTex: GPUTexture | null = null;
  let bind: GPUBindGroup | null = null, lbind: GPUBindGroup | null = null;
  let geom: { NV: number; NZ: number; L: number; ZT: number } | null = null, frame = 0;

  /** Point the renderer at a density texture (r channel, sqrt-encoded extinction) covering +/-L km and 0..ZT km. */
  function bindDensity(tex: GPUTexture, NV: number, NZ: number, L: number, ZT: number): void {
    if (!lightTex || !geom || geom.NV !== NV || geom.NZ !== NZ) {
      lightTex?.destroy();
      // lighting varies smoothly, so it lives on a half-resolution grid (8x fewer voxels to march from)
      lightTex = device.createTexture({ size: [Math.max(1, NV >> 1), Math.max(1, NV >> 1), Math.max(1, NZ >> 1)], dimension: '3d', format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
    }
    geom = { NV, NZ, L, ZT };
    bind = device.createBindGroup({
      layout: renderPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: tex.createView() }, { binding: 1, resource: lightTex.createView() },
        { binding: 2, resource: noiseTex.createView() }, { binding: 3, resource: samp }, { binding: 4, resource: sampRep },
        { binding: 5, resource: { buffer: renderUBuf } }
      ]
    });
    lbind = device.createBindGroup({
      layout: lightPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: tex.createView() }, { binding: 1, resource: samp },
        { binding: 2, resource: lightTex.createView() }, { binding: 3, resource: { buffer: lightUBuf } }
      ]
    });
    device.queue.writeBuffer(lightUBuf, 0, new Float32Array([SUN_DIR[0], SUN_DIR[1], SUN_DIR[2], 0, Math.max(1, NV >> 1), Math.max(1, NZ >> 1), L, ZT, BMAX, 0.8, 0, 0]));
  }

  /** Recompute sun and sky lighting from the current density texture. */
  function relight(): void {
    if (!lbind || !geom) return;
    const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
    pass.setPipeline(lightPipe); pass.setBindGroup(0, lbind);
    pass.dispatchWorkgroups(Math.ceil((geom.NV >> 1) / 4), Math.ceil((geom.NV >> 1) / 4), Math.ceil(Math.max(1, geom.NZ >> 1) / 4));
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  function setVolume(v: VolumeData): void {
    const { NV, NZv } = v;
    if (!ownTex || ownTex.width !== NV || ownTex.depthOrArrayLayers !== NZv) {
      ownTex?.destroy();
      ownTex = device.createTexture({ size: [NV, NV, NZv], dimension: '3d', format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    }
    // density, sqrt-encoded so thin cloud keeps precision in 8 bits
    const n = NV * NV * NZv, d8 = new Uint8Array(n);
    for (let k = 0; k < n; k++) d8[k] = Math.round(255 * Math.sqrt(Math.min(1, Math.max(0, v.beta[k] / BMAX))));
    device.queue.writeTexture({ texture: ownTex }, d8, { bytesPerRow: NV, rowsPerImage: NV }, [NV, NV, NZv]);
    bindDensity(ownTex, NV, NZv, v.Rv / 1000, v.ZT / 1000);
    relight();
  }

  function writeUniforms(cam: Camera, W: number, H: number): void {
    const b = cameraBasis(cam);
    device.queue.writeBuffer(renderUBuf, 0, new Float32Array([
      ...b.cp, cam.gx ?? 0, ...b.f, cam.gy ?? 0, ...b.r, 0, ...b.u, 0, ...SUN_DIR, 0,
      W, H, b.th, geom!.L,
      geom!.ZT, BMAX, 1.7, (frame++ % 64) * 1.37
    ]));
  }
  function encodeDraw(view: GPUTextureView): GPUCommandEncoder {
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(renderPipe); pass.setBindGroup(0, bind!); pass.draw(3); pass.end();
    return enc;
  }
  function render(cam: Camera, scaleIn?: number): void {
    if (!geom || !bind) return;
    const scale = scaleIn ?? Math.min(window.devicePixelRatio || 1, 1.25), W = Math.max(1, Math.round(canvas.clientWidth * scale)), H = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    writeUniforms(cam, W, H);
    device.queue.submit([encodeDraw(ctx!.getCurrentTexture().createView()).finish()]);
  }
  async function capture(cam: Camera, W: number, H: number): Promise<ImageData | null> {
    if (!geom || !bind) return null;
    const tex = device.createTexture({ size: [W, H], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const bpr = Math.ceil(W * 4 / 256) * 256;
    const buf = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    writeUniforms(cam, W, H);
    const enc = encodeDraw(tex.createView());
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [W, H]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange()), out = new ImageData(W, H), bgra = format === 'bgra8unorm';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = y * bpr + x * 4, d = (y * W + x) * 4;
      out.data[d] = src[s + (bgra ? 2 : 0)]; out.data[d + 1] = src[s + 1]; out.data[d + 2] = src[s + (bgra ? 0 : 2)]; out.data[d + 3] = 255;
    }
    buf.unmap(); buf.destroy(); tex.destroy();
    return out;
  }

  return {
    kind: 'webgpu', canvas, needsCpuLighting: false, setVolume, render, capture,
    device,
    attachTexture(tex: GPUTexture, NV: number, NZ: number, Lkm: number, ZTkm: number) { bindDensity(tex, NV, NZ, Lkm, ZTkm); relight(); },
    relight,
    destroy() { ownTex?.destroy(); lightTex?.destroy(); noiseTex.destroy(); ctx.unconfigure(); }
  };
}
