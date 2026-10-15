/** Markup for the storm view. */
import { PRESETS } from '../../presets';
import { SIM_BAR_HTML, SIM_CARD_HTML } from './sim-panel';

export interface SliderDef { k: 'T0F' | 'TdF' | 'lapse' | 'cap' | 'llj' | 'shear' | 'upper'; label: string; min: number; max: number; step: number; fmt: (v: number) => string }

export const SLIDERS: SliderDef[] = [
  { k: 'T0F', label: 'Surface temperature', min: 60, max: 100, step: 1, fmt: v => `${v} °F` },
  { k: 'TdF', label: 'Surface dewpoint', min: 45, max: 80, step: 1, fmt: v => `${v} °F` },
  { k: 'lapse', label: 'Mid-level lapse rate', min: 5.5, max: 9.5, step: 0.1, fmt: v => `${v.toFixed(1)} °C/km` },
  { k: 'cap', label: 'Cap (inversion) strength', min: 0, max: 5, step: 0.25, fmt: v => `+${v.toFixed(2)} °C` },
  { k: 'llj', label: 'Low-level jet (1 km wind)', min: 0, max: 70, step: 1, fmt: v => `${v} kt` },
  { k: 'shear', label: 'Deep-layer shear (0–6 km)', min: 0, max: 90, step: 1, fmt: v => `${v} kt` },
  { k: 'upper', label: 'Upper-level wind (10 km)', min: 10, max: 130, step: 1, fmt: v => `${v} kt` }
];

const sliderRows = (list: SliderDef[]) => list.map(s =>
  `<div class="sl"><label for="e_${s.k}">${s.label}</label><output id="o_${s.k}"></output><input type="range" id="e_${s.k}" min="${s.min}" max="${s.max}" step="${s.step}"></div>`).join('');
const presetButtons = Object.entries(PRESETS).map(([k, p]) => `<button data-pre="${k}">${p.name}</button>`).join('');

export const STORM_HTML = `
<div class="wrap">
  <header>
    <div class="eyebrow">Instant storm model · parcel theory, Bunkers motion, precipitation trajectories</div>
    <h1>Supercell Lab</h1>
    <p class="lede">Build the environment and watch the storm it supports. The sliders set the sounding and the winds. From those, the model works out the updraft, the rotation and where the rain and hail fall, then sends any tornado the storm produces to the Tornado Lab.</p>
  </header>
  <section class="bench">
    <div class="stagecol">
      <div class="row" style="gap:10px">
        <div class="seg" role="group" aria-label="Model" id="svMode" style="margin-left:0">
          <button data-mode="instant" aria-pressed="true">Instant model</button><button data-mode="sim">Full simulation</button>
        </div>
        <span class="gpu-note" id="svModeCap">Instant: the storm this environment supports, worked out in a second.</span>
      </div>
      <div class="stage">
        <canvas id="svGL" aria-label="Three-dimensional view of the storm" style="display:block;width:100%;aspect-ratio:16/10;min-height:260px;cursor:grab;touch-action:none"></canvas>
        <canvas id="svRadar" aria-label="Radar view of the storm" hidden style="display:block;width:100%;aspect-ratio:16/10;min-height:260px;background:#11171a"></canvas>
        <span class="tag tl" id="svTagL">—</span>
        <span class="tag tr" id="svTagR">—</span>
        <div id="svBanner" hidden style="position:absolute;left:10px;right:10px;bottom:10px;font-size:13px;color:#f3efe4;background:rgba(18,24,26,.78);padding:8px 10px;border-radius:6px"></div>
      </div>
      <div class="row" style="gap:10px">
        <div class="seg" role="group" aria-label="View" style="margin-left:0">
          <button data-v="3d" aria-pressed="true">Chaser view</button><button data-v="radar">Radar</button>
        </div>
        <div class="seg" role="group" aria-label="Radar product" id="svProd" style="margin-left:0">
          <button data-p="dbz" aria-pressed="true">Reflectivity</button><button data-p="vel">Storm-relative velocity</button><button data-p="hail" hidden>Hail swath</button>
        </div>
        <label id="svLabWrap"><input type="checkbox" id="svLab" checked> Labels</label>
        <button id="svSave" type="button">Save image</button>
        <span class="gpu-note" id="svGpu"></span>
      </div>${SIM_BAR_HTML}
      <dl class="read" aria-live="polite">
        <div class="wide"><dt>Storm type</dt><dd><span id="rType">—</span><small id="rTypeSub">—</small></dd></div>
        <div class="wide"><dt>Updraft</dt><dd><span id="rW">—</span><small id="rWSub">—</small></dd></div>
        <div><dt>Mid-level rotation</dt><dd id="rMid">—</dd></div>
        <div><dt>Low-level rotation</dt><dd id="rLow">—</dd></div>
        <div><dt>Largest hail</dt><dd id="rHail">—</dd></div>
        <div><dt>Storm motion</dt><dd id="rMove">—</dd></div>
      </dl>
      <div class="card" id="torCard">
        <div class="cardhead"><h2>Tornado outlook</h2></div>
        <div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 16px;align-items:center">
          <div id="tPct" style="font-family:var(--f-display);font-weight:600;font-size:46px;line-height:1">—</div>
          <div><div id="tHead" style="font-weight:600">—</div><p class="cap" id="tWhy">—</p></div>
        </div>
        <canvas id="tEF" style="display:block;width:100%;height:118px" aria-label="Chance of each EF rating if a tornado forms"></canvas>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button id="tTyp">Typical tornado from this storm</button>
          <button id="tRoll">Roll the dice</button>
        </div>
        <p class="cap" id="tRes" aria-live="polite"></p>
      </div>${SIM_CARD_HTML}
    </div>
    <aside class="rack" aria-label="Environment">
      <div style="display:grid;gap:8px">
        <h2>Setups</h2>
        <div class="presets" role="group" aria-label="Setups">${presetButtons}</div>
      </div>
      <h2>Temperature and moisture</h2>
      <div class="sliders">${sliderRows(SLIDERS.slice(0, 4))}</div>
      <h2>Wind</h2>
      <div class="sliders">${sliderRows(SLIDERS.slice(4))}</div>
      <dl class="read" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div><dt>CAPE</dt><dd id="eCAPE">—</dd></div>
        <div><dt>CIN</dt><dd id="eCIN">—</dd></div>
        <div><dt>Cloud base (LCL)</dt><dd id="eLCL">—</dd></div>
        <div><dt>0–1 km SRH</dt><dd id="eS1">—</dd></div>
        <div><dt>Supercell composite</dt><dd id="eSCP">—</dd></div>
        <div><dt>Sig. tornado param.</dt><dd id="eSTP">—</dd></div>
      </dl>
    </aside>
  </section>
  <section class="lower">
    <div class="card">
      <div class="cardhead"><h2>Sounding</h2>
        <div class="legend"><span><i class="ln" style="color:#e0533d"></i>Temperature</span><span><i class="ln" style="color:#2f9e5a"></i>Dewpoint</span><span><i class="ln d" style="color:var(--ink)"></i>Rising parcel</span></div>
      </div>
      <canvas id="skewT" style="display:block;width:100%;aspect-ratio:1/1;max-height:520px" aria-label="Skew-T sounding with the rising parcel"></canvas>
      <p class="cap">Skew-T, temperature against pressure. Red shading is CAPE, where the rising parcel is warmer than its surroundings. Blue is CIN, the energy needed to push it up to its level of free convection.</p>
    </div>
    <div class="card">
      <div class="cardhead"><h2>Hodograph</h2>
        <div class="legend"><span><i class="ln" style="color:#e655d6"></i>0–1 km</span><span><i class="ln" style="color:#ef4040"></i>1–3 km</span><span><i class="ln" style="color:#ffb347"></i>3–6 km</span><span><i class="ln" style="color:#8a9a96"></i>6–12 km</span></div>
      </div>
      <canvas id="hodo" style="display:block;width:100%;aspect-ratio:1/1;max-height:520px" aria-label="Hodograph with Bunkers storm motions"></canvas>
      <dl class="read" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div><dt>0–6 km shear</dt><dd id="hS6">—</dd></div>
        <div><dt>0–3 km SRH</dt><dd id="hS3">—</dd></div>
        <div><dt>Storm-relative wind, 9–11 km</dt><dd id="hSRA">—</dd></div>
      </dl>
      <p class="cap">Wind at each height, plotted as a vector from the origin. The shaded area between the low-level curve and the right-mover’s motion is the storm-relative helicity: how much the inflow spins along the direction it moves, ready to be tilted into a mesocyclone.</p>
    </div>
  </section>
  <section class="card notes">
    <div style="display:grid;gap:10px">
      <h2>What the model does</h2>
      <ol>
        <li><b>Sounding.</b> A well-mixed afternoon boundary layer up to the cumulus base, a capping inversion on top of it, then your mid-level lapse rate between 3 and 6 km. A 1 km mixed-layer parcel is lifted dry to its LCL and then pseudoadiabatically, with virtual temperature, to get CAPE, CIN and the equilibrium level.</li>
        <li><b>Winds.</b> A south-easterly surface wind veering through a southerly low-level jet to westerlies aloft, scaled so the 0–6 km shear matches your slider. Storm motion uses the Bunkers right-mover method, and helicity is computed relative to it.</li>
        <li><b>Storm.</b> Updraft speed is half the parcel-theory value √(2·CAPE), the usual result once entrainment and water loading are counted, plus up to 35% from the rotation-driven pressure lift in helical environments. Storm mode follows the 0–6 km shear thresholds used in forecasting (about 20 and 40 kt). Mesocyclone strength scales with √SRH. Precipitation type follows storm-relative anvil-level wind: under about 35 kt is HP, about 35–55 kt classic, above that LP.</li>
        <li><b>Radar and cloud.</b> Thousands of rain, snow and hail particles are released from the updraft and carried by an analytic storm flow, made up of the environmental winds, flow around the updraft, a rotating mesocyclone, a rear-flank downdraft and outflow. They fall at their own speeds, melt below the freezing level and evaporate in dry air. Where they spend time is what the radar shows and what the cloud view renders. Below about 2.5 km, rear-flank precipitation is carried around the low-level mesocyclone, which draws the hook.</li>
        <li><b>Tornado.</b> The chance of a tornado and its likely strength come from the Significant Tornado Parameter, scaled to match how often supercells in such environments produce tornadoes and how the share of EF2+ tornadoes rises with STP in SPC climatology. A tornado from the storm takes its cloud base, forward speed and precipitation type directly from the environment.</li>
      </ol>
    </div>
    <div style="display:grid;gap:10px">
      <h2>Limits</h2>
      <ul>
        <li>The instant model is diagnostic, not a cloud model. Its storm is steady: it doesn’t grow, cycle or interact with other storms, and its flow fields are shaped to match observed supercell structure rather than solved. Full simulation mode is the cloud model.</li>
        <li>No fronts, drylines, terrain or daytime heating changes. Storms form whenever CIN is weaker than about −200 J/kg, as if something lifted the air.</li>
        <li>Tornado odds are climatological. The same environment produces tornadoes on some days and not on others, which is why there’s a dice button.</li>
        <li>Radar reflectivity is calibrated to typical values. The pattern comes from the trajectories, but the exact dBZ numbers are approximate.</li>
      </ul>
      <p class="refs">Thompson et al. (2003, 2012) for SCP and STP; Smith et al. (2015) for tornado intensity versus STP; Bunkers et al. (2000); Rasmussen &amp; Straka (1998) for precipitation type; Lemon &amp; Doswell (1979) for the rear-flank downdraft and hook; Weisman &amp; Klemp (1982) for shear and storm type.</p>
    </div>
  </section>
</div>`;
