/** Markup for the storm view. */
import { PRESETS } from '../../presets';
import { SIM_BAR_HTML, SIM_CARD_HTML } from './sim-panel';

const presetCards = Object.entries(PRESETS).map(([k, p]) =>
  `<button class="pcard" data-pre="${k}" aria-pressed="false"><b>${p.name}</b><span>${p.blurb}</span></button>`).join('');

export const STORM_HTML = `
<div class="wrap">
  <header>
    <div class="eyebrow">3-D cloud model · ice and hail microphysics · runs on your GPU</div>
    <h1>Supercell Lab</h1>
    <p class="lede">Pick a severe-weather setup and grow the storm. A cloud model solves the equations of motion for that atmosphere: an updraft breaks through the cap, and the storm organises into a rotating supercell that drops hail and may put down a tornado. Any tornado it makes opens in the Tornado Lab.</p>
  </header>
  <section class="bench">
    <div class="stagecol">
      <div class="stage">
        <canvas id="svGL" aria-label="Three-dimensional view of the storm" style="display:block;width:100%;aspect-ratio:16/10;min-height:260px;cursor:grab;touch-action:none"></canvas>
        <canvas id="svRadar" aria-label="Radar view of the storm" hidden style="display:block;width:100%;aspect-ratio:16/10;min-height:260px;background:#11171a"></canvas>
        <span class="tag tl" id="svTagL">—</span>
        <span class="tag tr" id="svTagR">—</span>
        <div id="svStart" class="startover"><button type="button" id="svStartBtn">Grow the storm</button><p>Runs for up to two hours of storm time.</p></div>
      </div>
      <div class="row" style="gap:10px">
        <div class="seg" role="group" aria-label="View" style="margin-left:0">
          <button data-v="3d" aria-pressed="true">Chaser view</button><button data-v="radar">Radar</button>
        </div>
        <div class="seg" role="group" aria-label="Radar product" id="svProd" style="margin-left:0">
          <button data-p="dbz" aria-pressed="true">Reflectivity</button><button data-p="vel">Storm-relative velocity</button><button data-p="hail">Hail swath</button>
        </div>
        <button id="svSave" type="button">Save image</button>
        <span class="gpu-note" id="svGpu"></span>
      </div>${SIM_BAR_HTML}
      ${SIM_CARD_HTML}
    </div>
    <aside class="rack" aria-label="Setups">
      <h2>Setups</h2>
      <div class="pcards" role="group" aria-label="Setups">${presetCards}</div>
      <div class="pwatch"><h3 id="pName">—</h3><p id="pWatch">—</p></div>
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
        <li><b>Atmosphere.</b> Each setup is a sounding and a hodograph: a well-mixed afternoon boundary layer up to cloud base, a humid layer above it on days with deep moisture, a capping inversion, the setup's mid-level lapse rate, and south-west flow veering with height. CAPE, CIN and helicity are worked out from them the way forecasters do.</li>
        <li><b>Cloud model.</b> The anelastic equations of motion, with turbulent mixing, on a 3-D grid of 1 km boxes (500 m optional) 400 m deep, about 90 km across, moving with the storm. It is the same kind of model research groups use (CM1, WRF), simplified to run in a browser on your GPU (or, more slowly and coarsely, on the CPU).</li>
        <li><b>Clouds, rain, ice and hail.</b> Six kinds of water: vapour, cloud droplets, rain, cloud ice, snow and hail, with the processes that turn one into another (condensation, freezing, riming, melting, evaporation) and their own fall speeds. Evaporating rain and melting hail make the cold outflow.</li>
        <li><b>Start.</b> For the first 15 minutes one broad updraft (about 20 km across) is pushed up from the boundary layer, the standard way research models start a storm. Everything after that, the tower breaking the cap, the anvil, the mesocyclone, the hook and the hail, comes out of the equations.</li>
        <li><b>Radar and tornadoes.</b> Reflectivity is computed from the rain, snow and hail; velocity from the winds along the radar beam. A 1 km grid can't resolve a tornado, so one is flagged when strong rotation near the ground sits under the updraft for a minute, and its strength is estimated from that rotation.</li>
      </ol>
    </div>
    <div style="display:grid;gap:10px">
      <h2>Limits</h2>
      <ul>
        <li>The environment is the same everywhere and doesn't change: no fronts, drylines, terrain, daytime heating or neighbouring storms.</li>
        <li>The grid resolves the storm and its mesocyclone, not the tornado. Tornado strength is an estimate.</li>
        <li>Each kind of water has a fixed size distribution, so hail tops out near 2 inches and hail cores read high on radar.</li>
        <li>Storms in modest instability (Ohio Valley, Dixie) tend to fade after about 50 minutes.</li>
      </ul>
      <p class="refs">Klemp &amp; Wilhelmson (1978) and Bryan &amp; Fritsch (2002) for the model equations; Lin, Farley &amp; Orville (1983), Tao et al. (1989) and Gilmore et al. (2004) for the microphysics; Naylor &amp; Gilmore (2012) for the start; Thompson et al. (2003, 2012) for SCP and STP; Bunkers et al. (2000) for storm motion.</p>
    </div>
  </section>
</div>`;
