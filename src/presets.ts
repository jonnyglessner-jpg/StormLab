/** Ready-made environments. Winds are in knots here (the units the sliders use). */
export interface EnvSliders {
  T0F: number; TdF: number; lapse: number; cap: number;
  /** knots */
  llj: number; shear: number; upper: number;
}

export const PRESETS: Record<string, EnvSliders & { name: string }> = {
  plains: { name: 'Plains outbreak', T0F: 84, TdF: 68, lapse: 7.8, cap: 1.0, llj: 44, shear: 55, upper: 80 },
  ohio: { name: 'Ohio Valley', T0F: 82, TdF: 66, lapse: 6.8, cap: 0.5, llj: 34, shear: 50, upper: 75 },
  dixie: { name: 'Dixie HP', T0F: 75, TdF: 68, lapse: 6.0, cap: 0, llj: 50, shear: 60, upper: 58 },
  lp: { name: 'High Plains LP', T0F: 90, TdF: 57, lapse: 8.5, cap: 0.5, llj: 22, shear: 48, upper: 95 },
  capped: { name: 'Capped', T0F: 90, TdF: 68, lapse: 8.0, cap: 4.0, llj: 36, shear: 50, upper: 80 },
  pulse: { name: 'Summer pulse', T0F: 90, TdF: 72, lapse: 6.0, cap: 0, llj: 8, shear: 10, upper: 24 }
};
