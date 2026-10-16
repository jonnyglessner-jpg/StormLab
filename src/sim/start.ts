/** Initial conditions for a run: where and how the storm is started. */
import { type GridSpec } from './grid';
import { type Nudge } from './params';

/**
 * How a run starts: one broad updraft forced for the first 15 minutes at 45% of the domain width, as in CM1's
 * iinit = 12 (Naylor & Gilmore 2012). It lifts boundary-layer air through the cap; the storm then organises on its
 * own. (A field of smaller towers was tried: they competed with each other and the storm never organised into one
 * mesocyclone.) A small random temperature noise in the boundary layer breaks the symmetry.
 */
export function defaultNudge(g: GridSpec, tau: number, rh = 10000): Nudge {
  return {
    tau,
    towers: [{ x: g.NX * g.dx * 0.45, y: g.NY * g.dy * 0.5, z: 1500, rh, rz: 1500, wmax: 10, t0: 0, t1: 900 }]
  };
}
/** Boundary-layer temperature noise for the start, K. */
export const START_NOISE = { amp: 0.1, zTop: 1500, seed: 7 };
