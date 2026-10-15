/** Physical constants and small numeric helpers shared by the physics modules. SI units throughout. */

export const RD = 287.04;      // gas constant for dry air, J/(kg K)
export const CP = 1005.7;      // specific heat of dry air at constant pressure, J/(kg K)
export const G = 9.81;         // gravity, m/s^2
export const EPS = 0.622;      // Rd/Rv
export const LV = 2.501e6;     // latent heat of vaporization, J/kg
export const P00 = 1e5;        // reference pressure, Pa

/** Vertical grid of the environment profiles: 0-16 km every 100 m. */
export const DZ = 100;
export const NZ = 161;

export const MPH = 0.44704;    // m/s per mph
export const KT = 0.514444;    // m/s per knot
export const FT = 0.3048;      // m per foot

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, t: number): number => {
  const q = clamp((t - a) / (b - a), 0, 1);
  return q * q * (3 - 2 * q);
};

export type Vec2 = [number, number];
