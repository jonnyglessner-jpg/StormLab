# StormLab: Supercell Lab

An interactive supercell and tornado simulator for weather education. Pick one of seven severe-weather setups
(`src/presets.ts`): a Plains tornado outbreak, a big hail day, Dixie Alley HP, Ohio Valley spring, High Plains LP,
a capped bust day and a summer pulse storm. Then watch that setup's storm live out its life in 3-D, from towering
cumulus to tornado and rope-out, with its sounding and hodograph. Any tornado the storm produces opens in a
swirl-ratio vortex model.

Everything runs in the browser. The storm view needs **WebGPU** (Chrome or Edge).

## Run it

```sh
npm install
npm run dev        # http://localhost:5173, rebuilds on save
npm run check      # typecheck + physics tests + production build
```

Pushing to `main` runs the same checks on GitHub and deploys `dist/` to GitHub Pages
(Settings → Pages → Source: **GitHub Actions**).

## How it works

| Layer | Where | What it does |
| --- | --- | --- |
| Environment | `src/physics/thermo.ts`, `winds.ts`, `environment.ts` | Afternoon sounding (mixed layer, moist layer, cap, lapse rates), mixed-layer parcel with virtual temperature, hodograph, Bunkers storm motion, SRH, SCP, STP |
| Setups | `src/presets.ts` | The seven environments and what each one shows |
| Storm | `src/storm3d/design.ts` | Turns the environment into a storm plan and, for any minute of its life, the size and place of each feature (below) |
| Rendering | `src/storm3d/shaders.ts`, `renderer.ts` | WGSL compute pass paints the storm into a 3-D volume and lights it (sun and sky); render pass ray-marches it over a ground of fields and section roads, with the wall cloud, tail cloud, scud, inflow tail and tornado evaluated at full resolution near the ground |
| Cloud model | `src/sim/` | Kept in the repo, not on the page (see below) |
| Tornado | `src/views/tornado/tornado-view.ts` | Burgers–Rott / Sullivan vortex, swirl-ratio regimes, corner flow, suction vortices, condensation funnel, damage swath. `src/physics/storm.ts` turns a simulated tornado into its parameters |

## The designed storm

The storm page draws a supercell from the conceptual model spotters and forecasters use (Lemon & Doswell 1979),
not from a fluid simulation. `planStorm` reads the setup:

| From the setup | Sets |
| --- | --- |
| LCL | Cloud base height |
| CAPE, equilibrium level | Updraft width, storm top, overshooting top |
| 0–6 km shear | Updraft tilt, whether the storm is a supercell, a pulse storm or nothing (capped) |
| Storm-relative wind at 9–11 km | Anvil direction and length; where rain falls (LP, classic, HP) |
| 0–1 km SRH | Mesocyclone, wall cloud size and spin |
| STP, tornado probability, LCL | Whether there is a tornado, its size and shape (slender, cone, wedge) |
| Bunkers right-mover | Where the storm goes |

Near the ground the storm follows the rear-flank downdraft picture (Lemon & Doswell 1979; Markowski 2002): once the
RFD reaches the ground it surges out south and east of the wall cloud, eating a horseshoe-shaped clear slot into the
base. The cyclonic tornado forms at the surge's northern curl, under the wall cloud. At its southern curl the air turns
the other way: an anti-mesocyclone in the tornadic setups and, rarely (only the Plains outbreak storm, in its second
cycle), an anticyclonic tornado turning clockwise. Everything else turns counter-clockwise.

The anvil is drawn as thin layers of ice, not lumpy cloud: from above an oval canopy drawn out along the wind aloft,
backsheared upwind of the updraft, flat-topped and thinning downstream into streaky, translucent cirrus. The tower
flares smoothly into it, and its cauliflower texture blends out into the ice. The scene is lit by an early-evening sun
low in the west (the Plains' peak tornado hours). The view can go full screen (button or F).

`stormAt` gives every feature's size and place at any minute: towering cumulus (0–14 min), anvil (10–20), rain
and hail (14–28), striations, inflow tail and flanking line (18–34), then repeating 38-minute cycles of wall cloud,
rear-flank downdraft and clear slot, tornado (when the setup supports one), rope-out as the storm occludes, and a new
wall cloud. Pulse storms rain out and collapse; capped setups only bubble.

## The cloud model (off the page)

An earlier version grew the storm in a 3-D cloud model, the same kind of model research groups use
(CM1, WRF), simplified enough to run in a browser. It reproduced storm strength and rotation but not a storm's
look (its updrafts, at 0.5–1 km spacing, were too coarse for wall clouds, inflow tails and tornadoes), so the page
now uses the designed storm. The code and its tests are kept:

| Piece | Where | Details |
| --- | --- | --- |
| Equations | `src/sim/model-cpu.ts` | Anelastic, on a staggered (Arakawa C) grid, in a frame moving with the Bunkers right-mover; the 3-D view puts it back on the ground, so the storm drives across a one-mile grid of section roads |
| Advection | | Semi-Lagrangian with MacCormack correction and a min/max limiter; departure points computed once per grid layout and shared by every field on it |
| Microphysics | `src/sim/micro.ts` | Six classes: vapour, cloud water, rain, cloud ice, snow and hail. Kessler autoconversion and accretion; ice, snow and hail processes after Lin, Farley & Orville (1983) and Gilmore et al. (2004); mixed-phase saturation adjustment after Tao et al. (1989); rain, snow and hail fall at their own speeds |
| Mixing | | Horizontal eddy diffusion (500 m²/s at 1 km, in proportion to the grid spacing) for sub-grid turbulence, vertical eddy diffusion, and a 4th-order horizontal filter against 2-gridpoint noise. Without the horizontal mixing updrafts collapse into several grid-scale cores instead of one broad, rotating updraft |
| Pressure | | Projection onto div(ρ₀u) = 0, solved by red-black vertical-line relaxation |
| Boundaries | | Lateral sponge, Rayleigh damping above 12 km, free-slip ground |
| Start | `src/sim/start.ts` | One broad updraft (20 km across) forced for 15 min, as in CM1 (Naylor & Gilmore 2012), plus 0.1 K boundary-layer noise. A field of smaller forced towers was tried and dropped: they competed, and the storm split into several weak cells instead of one mesocyclone |
| GPU | `src/sim/gpu-kernels.ts`, `model-gpu.ts` | WGSL kernels mirroring the CPU code; 96 × 96 × 40 grid, 1 km × 400 m, or an optional 160 × 160 × 40 grid at 500 m (about 6× the work) |
| Fallback | `src/sim/sim.worker.ts` | CPU reference in a worker on a coarser grid when WebGPU is missing |
| Output | `src/sim/diag.ts`, `src/views/storm/sim-radar.ts` | A radar-app map (fixed radar site, fictional counties, highways and towns; drag to scroll, wheel to zoom) with the storm moving across it: reflectivity (rain, snow and hail) and storm-relative velocity at 600 m, vorticity, cold pool, rain, hail size at the ground and a ground-relative hail swath; tornado tracker |

The microphysics is written once, in a subset of syntax that is valid both as JavaScript and as WGSL, so the CPU
reference and the GPU kernels run the same code. The GPU and CPU models agree to about 0.2 % after 130 steps,
including ice, hail and hail reaching the ground (`tests/browser/sim-compare.ts`).

Checked against CM1 with the same Weisman–Klemp environment at 1 km:

| | This model | CM1 |
| --- | --- | --- |
| Peak updraft | 58–70 m/s | 52–60 m/s |
| Rotation at 1 km | 0.01–0.04 s⁻¹ | 0.013–0.018 s⁻¹ |
| Cold pool | −8 to −11 K | −4 to −8 K |
| Hail at the ground | up to about 1¾ in | — |

With ice the WK storm stays strong through the hour. The Plains preset peaks at about 25 minutes and decays by
about 50. Tests on that storm (1 km unless noted, peak updraft at 50 / 60 min):

| Change | 50 min | 60 min |
| --- | --- | --- |
| None | 20 m/s | 13 m/s |
| 500 m grid | 31 m/s | 12 m/s |
| 250 m vertical spacing | 21 m/s | 8 m/s |
| 96 km domain | 19 m/s | 5 m/s |
| Weaker horizontal filter, or a quarter of the vertical diffusion | 19–21 m/s | 10–13 m/s |
| Weaker rain evaporation (warmer cold pool) | 23 m/s | 10 m/s |
| Air at 3–10 km moistened to 75% humidity | 26 m/s | 16 m/s |
| Air at 1.2–3 km moistened to 75% humidity | 54 m/s | 47 m/s |

So the storm was starved by the layer just above the moist boundary layer: the Plains sounding's moisture was only
about 1.1 km deep, with 50–60% humidity from there to 3 km, and the storm feeds on air from the lowest 3 km. Grid
spacing, mixing, the domain and the microphysics don't change the outcome.

Each setup's sounding now has a **moisture depth**: how far humid air extends above cloud base before the cap. Deeper moisture
also weakens the cap (the Plains CIN goes from −53 J/kg with none to −4 J/kg at 3,000 ft). Plains storms (peak
updraft at 50 / 60 / 70 min, 1 km grid):

| Moisture above cloud base | 50 min | 60 min | 70 min |
| --- | --- | --- | --- |
| None | 20 m/s | 13 m/s | 3 m/s |
| 2,000 ft | 36 m/s | 22 m/s | 9 m/s |
| 4,000 ft (preset default) | 41 m/s | 42 m/s | 32 m/s |

These runs predate the horizontal mixing.

The setups carry moisture depths: Plains and Dixie 4,000 ft, Ohio Valley 3,000 ft, the summer pulse 1,500 ft,
and none for the High Plains LP and the capped case. Ohio Valley and Dixie storms last longer than before but still
fade after about 50–55 minutes.

**Limits.** Single-moment microphysics: each class has a fixed size distribution, so hail size is estimated from
the hail content (the model tops out near 2 in and can't make giant hail), and hail cores read high on radar (up
to about 80 dBZ). No surface friction, no radiation, a uniform environment. Storms fed by a shallow moist layer, and
moderate-CAPE storms, fade within an hour. A 1 km grid resolves the storm and its mesocyclone, not the tornado. Tornadoes are flagged when
strong near-ground rotation sits under the low-level updraft for at least a minute, and their strength is an
estimate scaled from that circulation.

## Tests

`npm test` runs the physics tests in Node:
- **Environment:** checks against reference values and expected behaviour. These include Bolton saturation
  pressure, the LCL rule, moisture depth, Bunkers deviation, zero helicity for a straight hodograph, the setups'
  storm types, and the tornado parameters a simulated tornado is given.
- **Cloud model:** a calm atmosphere stays at rest, a uniform wind is carried unchanged, mass is conserved, a warm
  bubble rises, a moist sounding makes a storm with rain, an ice anvil and hail at the ground, a capped one stays
  quiet, microphysics conserves water and energy, fall speeds, reflectivity and hail sizes are realistic, the hail
  swath lands where the storm motion puts it, and the tornado tracker rules hold.

- **Designed storm:** each setup gets the storm it should (tornadic Plains supercell, capped bust, no tornado from
  the pulse storm), storms move north-east, and every minute of every storm's life is finite and labelled.

Browser checks (headless Chromium with WebGPU):
- `tests/browser/storm3d.ts` renders the designed storm at chosen setups, times and camera positions.
- `tests/browser/sim-compare.ts` runs the CPU and GPU cloud models side by side.
- `?capture-only` skips on-screen WebGPU presentation, which loses the device in some headless setups.
- `window.__stormlab.captureImage(w, h)` renders a frame offscreen; `setPreset(key)`, `setTime(min)` and `camera`
  set up the shot; `state()` gives the time, stage and tornado strength.

## Roadmap

1. Teaching layer: a guided tour through the stages, with labels on the storm's features.
2. A fallback for browsers without WebGPU.
3. Typed port of the tornado view (currently ported as-is with `@ts-nocheck`).

Shelved: radar (reflectivity and velocity drawn from the same storm). The radar map code from the cloud model is
kept in `src/views/storm/sim-radar.ts`.
