/** Tunable model parameters, shared by the CPU reference and the GPU kernels so both run the same physics. */
export interface SimParams {
  /** time step, s */
  dt: number;
  /** eddy diffusivity for momentum and scalars (vertical), m^2/s */
  kdiff: number;
  /** 4th-order horizontal filter strength: fraction of a 2-gridpoint wave removed per step */
  hyper: number;
  /** Kessler autoconversion rate (1/s) and threshold (kg/kg) */
  k1: number; qcCrit: number;
  /** accretion coefficient (1/s) */
  k2: number;
  /** lateral sponge width (cells) and its strongest relaxation time (s) */
  spongeCells: number; spongeTau: number;
  /** Rayleigh damping above this height (m), with this time scale at the model top (s) */
  dampZ: number; dampTau: number;
  /** pressure solver: line-relaxation sweeps per step and over-relaxation factor */
  pIters: number; omega: number;
}

export const DEFAULT_PARAMS: SimParams = {
  dt: 6, kdiff: 40, hyper: 0.08, k1: 1e-3, qcCrit: 1e-3, k2: 2.2,
  spongeCells: 6, spongeTau: 300, dampZ: 12000, dampTau: 300,
  pIters: 24, omega: 1.5
};

/** Physical constants used by the model (Kessler / WRF conventions). */
export const C = {
  g: 9.81, cp: 1004, Rd: 287, Rv: 461.5, Lv: 2.5e6, eps: 0.622
};

export interface Bubble {
  /** centre, m from the domain's south-west corner */
  x: number; y: number; z: number;
  /** horizontal and vertical radius, m */
  rh: number; rz: number;
  /** potential temperature excess, K */
  dth: number;
  /** carry boundary-layer moisture (a thermal rising from the surface layer) instead of the local humidity */
  moist?: boolean;
}

/** One forced thermal: w is pulled toward wmax inside an ellipsoid between model times t0 and t1. */
export interface Tower {
  /** centre, m from the domain's south-west corner */
  x: number; y: number; z: number;
  /** horizontal and vertical radius, m */
  rh: number; rz: number;
  /** target updraft, m/s */
  wmax: number;
  /** active from t0 until t1, s of model time */
  t0: number; t1: number;
}
/** Most towers a run can use (fixed by the GPU uniform layout). */
export const MAX_TOWERS = 8;

/**
 * Updraft nudging (Naylor & Gilmore 2012, as in CM1): each tower's w is relaxed toward its target with time scale
 * tau while it is active.
 */
export interface Nudge { towers: Tower[]; tau: number }

/** A single forced updraft from t = 0 to tEnd, the classic CM1 setup. */
export const singleNudge = (x: number, y: number, z: number, rh: number, rz: number, wmax: number, tau: number, tEnd: number): Nudge =>
  ({ towers: [{ x, y, z, rh, rz, wmax, t0: 0, t1: tEnd }], tau });
