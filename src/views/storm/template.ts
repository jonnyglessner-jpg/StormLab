/** Markup for the storm view. */
import { PRESETS } from '../../presets';


const presetCards = Object.entries(PRESETS).map(([k, p]) =>
  `<button class="pcard" data-pre="${k}" aria-pressed="false"><b>${p.name}</b><span>${p.blurb}</span></button>`).join('');

export const STORM_HTML = `
<div class="wrap">
  <header>
    <div class="eyebrow">Supercell anatomy · from towering cumulus to tornado · drawn on your GPU</div>
    <h1>Supercell Lab</h1>
    <p class="lede">Pick a severe-weather setup and watch its storm live out its life: the tower breaking the cap, the anvil, the striated updraft, the inflow tail, the wall cloud, the rear-flank downdraft's clear slot, and the tornado. The setup decides how strong, how wet and how rotating the storm is, and which way it goes.</p>
  </header>
  <section class="bench">
    <div class="stagecol" id="svCol">
      <div class="stage">
        <canvas id="svGL" aria-label="Three-dimensional view of the storm" style="display:block;width:100%;aspect-ratio:16/10;min-height:260px;cursor:grab;touch-action:none"></canvas>
        <span class="tag tl" id="svTagL">—</span>
        <div id="svNoGPU" class="startover" hidden><p>This storm view needs WebGPU: Chrome or Edge on a recent computer.</p></div>
      </div>
      <div id="svStage" class="stagecap" aria-live="polite"><b id="svStageName">—</b><span id="svStageText">—</span><button type="button" id="svTorLink" hidden>Open this tornado in the Tornado Lab</button></div>
      <div class="row" style="gap:10px">
        <button type="button" id="plPlay" style="min-width:74px">Pause</button>
        <input type="range" id="plTime" min="0" max="110" step="0.1" value="0" aria-label="Storm time" style="flex:1 1 220px;accent-color:var(--accent)">
        <output id="plClock" style="font-family:var(--f-mono);font-size:13px;min-width:5ch">0 min</output>
        <div class="seg" role="group" aria-label="Speed" style="margin-left:0">
          <button data-speed="0.5">½×</button><button data-speed="1" aria-pressed="true">1×</button><button data-speed="3">3×</button>
        </div>
      </div>
      <div class="row" style="gap:10px">
        <label title="Keep the camera moving with the storm, like a chaser driving alongside"><input type="checkbox" id="plFollow" checked> Move with the storm</label>
        <div class="seg" role="group" aria-label="Detail" style="margin-left:0">
          <button data-q="high" aria-pressed="true">High detail</button><button data-q="low">Faster</button>
        </div>
        <button id="svFull" type="button" title="Full screen (F11); Esc to leave">Full screen</button>
        <button id="svSave" type="button">Save image</button>
        <span class="gpu-note">WASD move · Q/E rotate · R/F tilt · scroll zoom · right-drag pan · drag rotate · double-click finds the storm</span>
        <span class="gpu-note" id="svGpu"></span>
      </div>
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
      <h2>How the storm is built</h2>
      <ol>
        <li><b>Atmosphere.</b> Each setup is a sounding and a hodograph: a well-mixed afternoon boundary layer up to cloud base, a humid layer above it on days with deep moisture, a capping inversion, the setup's mid-level lapse rate, and south-west flow veering with height. CAPE, CIN, helicity and the composite parameters are worked out from them the way forecasters do.</li>
        <li><b>From atmosphere to storm.</b> Instability sets the updraft's strength and width; storm-relative winds aloft set the anvil's direction and whether rain falls far from the updraft (LP), next to it (classic) or wraps around it (HP); low-level helicity sets the mesocyclone, the wall cloud and the tornado; the Bunkers right-mover sets where the storm goes.</li>
        <li><b>Anatomy.</b> The storm is built from the supercell model forecasters and spotters use (Lemon &amp; Doswell 1979): updraft and overshooting top, anvil with mammatus, flanking line, striated rain-free base, inflow tail, wall cloud with tail cloud and scud, forward-flank rain and hail, and the rear-flank downdraft whose clear slot wraps around the wall cloud.</li>
        <li><b>Life cycle.</b> Towering cumulus, cumulonimbus, a rotating supercell, a wall cloud, the rear-flank surge, a tornado, its rope-out as the storm occludes, and a new cycle.</li>
        <li><b>Tornado.</b> Whether one forms, its size and its shape (slender, cone or wedge) come from the setup's Significant Tornado Parameter and cloud base, using the same climatology as the Tornado Lab.</li>
      </ol>
    </div>
    <div style="display:grid;gap:10px">
      <h2>Limits</h2>
      <ul>
        <li>The storm is drawn from how supercells are observed to look and behave, not solved from the equations of motion. Its parts are in the right places at the right times, but their turbulence is drawn, not simulated.</li>
        <li>Every storm in a setup follows the same life cycle. Real storms vary: many supercells never produce a tornado, and some produce several.</li>
        <li>No terrain, fronts or neighbouring storms.</li>
      </ul>
      <p class="refs">Lemon &amp; Doswell (1979) for supercell structure; Rasmussen &amp; Straka (1998) for LP, classic and HP storms; Thompson et al. (2003, 2012) for SCP and STP; Bunkers et al. (2000) for storm motion.</p>
    </div>
  </section>
</div>`;
