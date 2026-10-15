/** Browser check: run the CPU reference and the WebGPU model from the same state and compare. */
import { baseFromProfile, weismanKlempProfile } from '../../src/sim/base';
import { type GridSpec } from '../../src/sim/grid';
import { SimCPU } from '../../src/sim/model-cpu';
import { SimGPU } from '../../src/sim/model-gpu';

const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; console.log(s); };

async function main() {
  const q = new URLSearchParams(location.search);
  const steps = +(q.get('steps') ?? 40);
  const g: GridSpec = { NX: 32, NY: 32, NZ: 20, dx: 2000, dy: 2000, dz: 750 };
  const base = baseFromProfile(g, weismanKlempProfile(0.0145, 30), 14.21, -1.6);
  const params = { dt: 10, pIters: 12 };
  const cpu = new SimCPU(g, base, params);
  cpu.addBubble({ x: 28000, y: 32000, z: 1400, rh: 10000, rz: 1400, dth: 3 });
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice();
  device.addEventListener('uncapturederror', e => log('GPU error: ' + (e as GPUUncapturedErrorEvent).error.message));
  const gpu = await SimGPU.create(device, g, base, params);
  gpu.upload(cpu.f);
  // updraft nudging on for the first 20 steps, so the NUDGE kernel is covered too
  const nudge = { x: 30000, y: 32000, z: 1500, rh: 8000, rz: 1500, wmax: 10, tau: 10, tEnd: 200 };
  cpu.nudgeCfg = { ...nudge }; gpu.nudgeCfg = { ...nudge };
  const t0 = performance.now();
  for (let n = 0; n < steps; n++) gpu.step(1);
  const G = await gpu.download();
  const tg = performance.now() - t0;
  const t1 = performance.now();
  for (let n = 0; n < steps; n++) cpu.step();
  const tc = performance.now() - t1;
  const cmp = (name: keyof typeof G, a: Float32Array, b: Float32Array) => {
    let md = 0, mx = 0;
    for (let i = 0; i < a.length; i++) { md = Math.max(md, Math.abs(a[i] - b[i])); mx = Math.max(mx, Math.abs(b[i])); }
    log(`${name}: max|cpu| ${mx.toPrecision(4)}  max|gpu-cpu| ${md.toPrecision(3)}  rel ${(md / (mx || 1)).toPrecision(3)}`);
    return md / (mx || 1);
  };
  const base0 = new Float32Array(cpu.f.th.length);
  const plane = g.NX * g.NY;
  for (let c = 0; c < base0.length; c++) base0[c] = base.th0[Math.floor(c / plane)];
  const thp = (a: Float32Array) => a.map((v, i) => v - base0[i]);
  const rel = [cmp('w', G.w, cpu.f.w), cmp('u', G.u, cpu.f.u), cmp('th', thp(G.th), thp(cpu.f.th)), cmp('qv', G.qv, cpu.f.qv), cmp('qc', G.qc, cpu.f.qc), cmp('qr', G.qr, cpu.f.qr), cmp('phi', G.phi, cpu.f.phi)];
  log(`steps ${steps}: GPU ${tg.toFixed(0)} ms, CPU ${tc.toFixed(0)} ms`);
  document.title = 'DONE ' + Math.max(...rel).toPrecision(3);
}
main().catch(e => { log('ERROR ' + (e as Error).message); document.title = 'ERROR'; });
