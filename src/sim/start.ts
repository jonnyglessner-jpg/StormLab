/** Initial conditions for a run: where and how the storm is started. */
import { type GridSpec } from './grid';
import { type Nudge } from './params';

/**
 * How a run starts: a main forced updraft about 12 km across ringed by smaller cumulus towers (about 7 km) along a short SW-NE line
 * at 45% of the domain width, switched on at staggered times over the first ten minutes, as along a weak
 * boundary. They rise, merge and organise into the storm. Each is nudged as in CM1 (Naylor & Gilmore 2012); a
 * small random temperature noise in the boundary layer breaks the symmetry.
 */
export function defaultNudge(g: GridSpec, tau: number): Nudge {
  const x0 = g.NX * g.dx * 0.45, y0 = g.NY * g.dy * 0.5, minR = 2.5 * g.dx;
  const d = [Math.SQRT1_2, Math.SQRT1_2], n = [-Math.SQRT1_2, Math.SQRT1_2];
  // along-line km, across-line km, radius km, start s, end s, target w m/s. The first is the main updraft, lifting
  // boundary-layer air through the cap; the others are smaller cumulus towers around it.
  const plan: [number, number, number, number, number, number][] = [
    [0, 0, 6, 0, 1080, 12], [-7, 1.5, 3.5, 60, 720, 10], [7, -1.5, 3.5, 120, 720, 10], [-3, -6, 3.5, 180, 720, 10],
    [-13, -1, 3.5, 240, 660, 10], [12, 3, 3.5, 300, 660, 10], [3.5, 6, 3.5, 360, 660, 10]
  ];
  return {
    tau,
    towers: plan.map(([a, c, r, t0, t1, wmax]) => ({
      x: x0 + 1000 * (a * d[0] + c * n[0]), y: y0 + 1000 * (a * d[1] + c * n[1]),
      z: 1500, rh: Math.max(1000 * r, minR), rz: 1500, wmax, t0, t1
    }))
  };
}
/** Boundary-layer temperature noise for the start, K. */
export const START_NOISE = { amp: 0.1, zTop: 1500, seed: 7 };
