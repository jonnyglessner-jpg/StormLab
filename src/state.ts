/** State shared between the views for the length of a visit. */
import { type TornadoParams } from './physics/storm';
import { type EnvSliders } from './presets';

export interface TornadoLink {
  params: TornadoParams;
  /** 'typical' or a dice 'roll' */
  label: 'typical' | 'roll';
  env: EnvSliders;
  stp: number;
  ptor: number;
}

export interface StormViewState { view: '3d' | 'radar'; prod: 'dbz' | 'vel'; labels: boolean }

export const app: {
  link: TornadoLink | null;
  env: EnvSliders | null;
  stormView: StormViewState;
} = {
  link: null,
  env: null,
  stormView: { view: '3d', prod: 'dbz', labels: true }
};
