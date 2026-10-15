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

/** Updraft nudging (Naylor & Gilmore 2012): w is pulled toward wmax inside an ellipsoid until tEnd. */
export interface Nudge {
  x: number; y: number; z: number;
  rh: number; rz: number;
  /** target updraft, m/s */
  wmax: number;
  /** relaxation time, s */
  tau: number;
  /** nudging stops at this model time, s */
  tEnd: number;
}
