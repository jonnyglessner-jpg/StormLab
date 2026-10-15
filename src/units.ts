import { KT } from './physics/constants';
import { type EnvInput } from './physics/environment';
import { type EnvSliders } from './presets';

/** Slider values (knots) to the physics input (m/s). */
export const toEnv = (s: EnvSliders): EnvInput => ({
  T0F: s.T0F, TdF: Math.min(s.TdF, s.T0F), lapse: s.lapse, cap: s.cap,
  llj: s.llj * KT, shear: s.shear * KT, upper: s.upper * KT
});
