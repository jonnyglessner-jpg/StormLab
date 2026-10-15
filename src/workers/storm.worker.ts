/** Runs the storm computation off the main thread so the sliders stay responsive. */
import { compute, type ComputeOptions, type ComputeResult } from '../physics/compute';
import { type EnvInput } from '../physics/environment';

export interface WorkerRequest { id: number; env: EnvInput; opt: ComputeOptions }
export interface WorkerResponse { id: number; result: ComputeResult }

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerResponse, transfer: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, env, opt } = e.data;
  const result = compute(env, opt);
  const transfer: Transferable[] = [result.dbz.buffer, result.anv.buffer, result.vr.buffer];
  if (result.vol) {
    transfer.push(result.vol.beta.buffer);
    if (result.vol.lit) transfer.push(result.vol.lit.buffer);
  }
  scope.postMessage({ id, result }, transfer);
};
