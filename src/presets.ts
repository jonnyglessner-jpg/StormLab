/**
 * Ready-made scenarios. Each one fixes the sounding and winds (winds in knots) and says what it shows.
 * The app has no sliders: these are the environments people explore.
 */
export interface EnvSliders {
  T0F: number; TdF: number; lapse: number; cap: number;
  /** depth of the moist layer above cloud base, ft */
  moistFt: number;
  /** knots */
  llj: number; shear: number; upper: number;
}

export interface Preset extends EnvSliders {
  name: string;
  /** one line under the name */
  blurb: string;
  /** what to look for, a sentence or two */
  watch: string;
}

export const PRESETS: Record<string, Preset> = {
  plains: {
    name: 'Plains tornado outbreak', T0F: 84, TdF: 68, moistFt: 4000, lapse: 7.8, cap: 1.0, llj: 44, shear: 55, upper: 80,
    blurb: 'Deep Gulf moisture, a strong low-level jet and south-west flow aloft.',
    watch: 'A classic supercell: a rock-hard updraft, a hook on radar and a tornado-producing wall cloud. Storms move north-east at 30–35 mph.'
  },
  hail: {
    name: 'Big hail day', T0F: 92, TdF: 66, moistFt: 2000, lapse: 8.8, cap: 1.0, llj: 22, shear: 55, upper: 70,
    blurb: 'Steep mid-level lapse rates and big instability, but weak low-level winds.',
    watch: 'Huge updrafts and large hail with a high, dry cloud base. Plenty of rotation aloft, little near the ground, so tornadoes are unlikely.'
  },
  dixie: {
    name: 'Dixie Alley HP', T0F: 75, TdF: 68, moistFt: 4000, lapse: 6.0, cap: 0, llj: 50, shear: 60, upper: 58,
    blurb: 'Low clouds, modest instability and very strong wind shear.',
    watch: 'A heavy-precipitation supercell. Rain wraps around the mesocyclone, so tornadoes are hidden in rain and hard to see coming.'
  },
  ohio: {
    name: 'Ohio Valley spring', T0F: 82, TdF: 66, moistFt: 3000, lapse: 6.8, cap: 0.5, llj: 34, shear: 50, upper: 75,
    blurb: 'Moderate instability with strong shear ahead of a spring system.',
    watch: 'Supercells that rotate well but run on less fuel than out west. Watch whether the low-level rotation is enough for a tornado.'
  },
  lp: {
    name: 'High Plains LP', T0F: 90, TdF: 57, moistFt: 0, lapse: 8.5, cap: 0.5, llj: 22, shear: 48, upper: 95,
    blurb: 'Dry air, a high cloud base and fierce winds aloft.',
    watch: 'A low-precipitation supercell: a sculpted, corkscrew updraft with little rain, the kind photographers chase. Large hail, few tornadoes.'
  },
  capped: {
    name: 'Cap holds (bust)', T0F: 90, TdF: 68, moistFt: 0, lapse: 8.0, cap: 4.0, llj: 36, shear: 50, upper: 80,
    blurb: 'Every ingredient for big storms, under a strong inversion.',
    watch: 'Huge CAPE and shear, and nothing happens. The warm layer aloft stops surface air from rising: the classic bust day.'
  },
  pulse: {
    name: 'Summer pulse storm', T0F: 90, TdF: 72, moistFt: 1500, lapse: 6.0, cap: 0, llj: 8, shear: 10, upper: 24,
    blurb: 'Hot, humid and almost no wind.',
    watch: 'Without shear the storm rains into its own updraft: it towers up, dumps heavy rain and small hail, and collapses within the hour.'
  }
};

/** Just the environment numbers of a preset. */
export function envOf(p: Preset): EnvSliders {
  const { T0F, TdF, lapse, cap, moistFt, llj, shear, upper } = p;
  return { T0F, TdF, lapse, cap, moistFt, llj, shear, upper };
}
