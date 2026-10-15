/**
 * Cloud-model grid. Arakawa C (MAC) staggering:
 *   scalars (theta, qv, qc, qr, pressure) at cell centres      NX x NY x NZ
 *   u at x-faces                                               (NX+1) x NY x NZ
 *   v at y-faces                                               NX x (NY+1) x NZ
 *   w at z-faces                                               NX x NY x (NZ+1)
 * Index order: x fastest, then y, then z.
 */
export interface GridSpec {
  NX: number; NY: number; NZ: number;
  /** grid spacing, m */
  dx: number; dy: number; dz: number;
}

export const DEFAULT_GRID: GridSpec = { NX: 96, NY: 96, NZ: 40, dx: 1000, dy: 1000, dz: 400 };
/** Coarser grid for the CPU fallback and quick tests. */
export const COARSE_GRID: GridSpec = { NX: 48, NY: 48, NZ: 32, dx: 2000, dy: 2000, dz: 500 };

export const nC = (g: GridSpec) => g.NX * g.NY * g.NZ;
export const nU = (g: GridSpec) => (g.NX + 1) * g.NY * g.NZ;
export const nV = (g: GridSpec) => g.NX * (g.NY + 1) * g.NZ;
export const nW = (g: GridSpec) => g.NX * g.NY * (g.NZ + 1);

/** Field layouts: dimensions and the offset of sample points from the cell corner, in cells. */
export interface Layout { nx: number; ny: number; nz: number; ox: number; oy: number; oz: number }
export const layouts = (g: GridSpec) => ({
  c: { nx: g.NX, ny: g.NY, nz: g.NZ, ox: 0.5, oy: 0.5, oz: 0.5 } as Layout,
  u: { nx: g.NX + 1, ny: g.NY, nz: g.NZ, ox: 0, oy: 0.5, oz: 0.5 } as Layout,
  v: { nx: g.NX, ny: g.NY + 1, nz: g.NZ, ox: 0.5, oy: 0, oz: 0.5 } as Layout,
  w: { nx: g.NX, ny: g.NY, nz: g.NZ + 1, ox: 0.5, oy: 0.5, oz: 0 } as Layout
});
