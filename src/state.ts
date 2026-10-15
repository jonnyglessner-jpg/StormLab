/** State shared between the views for the length of a visit. */
import { type TornadoParams } from './physics/storm';
import { type EnvSliders } from './presets';

export interface TornadoLink {
  params: TornadoParams;
  /** 'typical', a dice 'roll', or a tornado from the full simulation */
  label: 'typical' | 'roll' | 'sim';
  env: EnvSliders;
  stp: number;
  ptor: number;
}

export interface StormViewState { view: '3d' | 'radar'; prod: 'dbz' | 'vel' | 'hail'; labels: boolean; mode: 'instant' | 'sim' }

export const app: {
  link: TornadoLink | null;
  env: EnvSliders | null;
  stormView: StormViewState;
} = {
  link: null,
  env: null,
  stormView: { view: '3d', prod: 'dbz', labels: true, mode: 'instant' }
};
