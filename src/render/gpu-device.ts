/**
 * One WebGPU device for the whole app, shared by the simulation and the renderer so the simulation's fields can
 * be drawn without copying them through the CPU.
 */
let pending: Promise<{ adapter: GPUAdapter; device: GPUDevice } | null> | null = null;
// Keep the adapter reachable: in some Chrome builds a garbage-collected adapter takes its GPU instance with it
// and the device is lost ("A valid external Instance reference no longer exists").
let keepAdapter: GPUAdapter | null = null;

export function getGPU(): Promise<{ adapter: GPUAdapter; device: GPUDevice } | null> {
  if (pending) return pending;
  pending = (async () => {
    if (!('gpu' in navigator)) return null;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    keepAdapter = adapter;
    const device = await adapter.requestDevice();
    device.lost.then(info => {
      if (info.reason !== 'destroyed') console.error('WebGPU device lost:', info.message);
      pending = null; keepAdapter = null;
    });
    device.addEventListener('uncapturederror', e => console.error('WebGPU:', (e as GPUUncapturedErrorEvent).error.message));
    return { adapter, device };
  })();
  return pending;
}

export const gpuAdapterInUse = (): GPUAdapter | null => keepAdapter;
