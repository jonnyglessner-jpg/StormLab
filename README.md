# StormLab: Supercell Lab

An interactive supercell and tornado simulator for weather education. Set the atmosphere with eight sliders and
watch the storm it supports. You see the sounding, hodograph, storm type, radar reflectivity and velocity, and a 3-D
chaser view. Any tornado the storm produces opens in a swirl-ratio vortex model.

Everything runs in the browser. The 3-D view renders with **WebGPU** where available and falls back to WebGL2.

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
| Environment | `src/physics/thermo.ts`, `winds.ts`, `environment.ts` | Afternoon sounding (mixed layer, cap, lapse rates), mixed-layer parcel with virtual temperature, hodograph, Bunkers storm motion, SRH, SCP, STP |
| Storm | `src/physics/storm.ts` | Updraft, storm mode from shear, mesocyclone strength from √SRH, LP/classic/HP from storm-relative anvil wind, hail size, tornado odds and EF distribution from STP |
| Storm flow | `src/physics/flow.ts` | Analytic storm-relative flow: environment, flow around the updraft, anelastic updraft inflow/outflow, mesocyclone, rear-flank downdraft and outflow |
| Radar & cloud | `src/physics/trajectories.ts`, `volume.ts` | Thousands of rain/snow/hail trajectories make the reflectivity (hook, inflow notch, forward-flank core) and the precipitation/anvil part of the cloud volume |
| Rendering | `src/render/chaser-webgpu.ts` | WGSL compute pass lights the volume (sun and sky), render pass ray-marches it; `chaser-webgl.ts` is the fallback |
| Tornado | `src/views/tornado/tornado-view.ts` | Burgers–Rott / Sullivan vortex, swirl-ratio regimes, corner flow, suction vortices, condensation funnel, damage swath |

The physics runs in a Web Worker (`src/workers/storm.worker.ts`), so the sliders stay responsive.

Each page has a "Limits" section. The instant model is a steady diagnostic model whose tornado odds are
climatological, scaled from SPC studies (Thompson et al. 2003/2012, Smith et al. 2015). The full simulation below
is the time-stepping alternative.

## Full simulation (cloud model)

**Full simulation** mode grows the storm in a 3-D cloud model, the same kind of model research groups use
(CM1, WRF), simplified enough to run in a browser:

| Piece | Where | Details |
| --- | --- | --- |
| Equations | `src/sim/model-cpu.ts` | Anelastic, on a staggered (Arakawa C) grid, in a frame moving with the Bunkers right-mover |
| Advection | | Semi-Lagrangian with MacCormack correction and a min/max limiter; departure points computed once per grid layout and shared by every field on it |
| Microphysics | `src/sim/micro.ts` | Six classes: vapour, cloud water, rain, cloud ice, snow and hail. Kessler autoconversion and accretion; ice, snow and hail processes after Lin, Farley & Orville (1983) and Gilmore et al. (2004); mixed-phase saturation adjustment after Tao et al. (1989); rain, snow and hail fall at their own speeds |
| Mixing | | Vertical eddy diffusion plus a 4th-order horizontal filter against 2-gridpoint noise |
| Pressure | | Projection onto div(ρ₀u) = 0, solved by red-black vertical-line relaxation |
| Boundaries | | Lateral sponge, Rayleigh damping above 12 km, free-slip ground |
| Start | | Updraft nudging for 15 min (Naylor & Gilmore 2012, as in CM1) |
| GPU | `src/sim/gpu-kernels.ts`, `model-gpu.ts` | WGSL kernels mirroring the CPU code; 96 × 96 × 40 grid, 1 km × 400 m, or an optional 160 × 160 × 40 grid at 500 m (about 6× the work) |
| Fallback | `src/sim/sim.worker.ts` | CPU reference in a worker on a coarser grid when WebGPU is missing |
| Output | `src/sim/diag.ts` | Radar reflectivity (rain, snow and hail) and velocity at 600 m, vorticity, cold pool, rain, hail size at the ground and a ground-relative hail swath; tornado tracker |

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

The **moisture depth** slider now sets how far humid air extends above cloud base before the cap. Deeper moisture
also weakens the cap (the Plains CIN goes from −53 J/kg with none to −4 J/kg at 3,000 ft). Plains storms (peak
updraft at 50 / 60 / 70 min, 1 km grid):

| Moisture above cloud base | 50 min | 60 min | 70 min |
| --- | --- | --- | --- |
| None | 20 m/s | 13 m/s | 3 m/s |
| 2,000 ft | 36 m/s | 22 m/s | 9 m/s |
| 4,000 ft (preset default) | 41 m/s | 42 m/s | 32 m/s |

The presets now carry moisture depths: Plains and Dixie 4,000 ft, Ohio Valley 3,000 ft, the summer pulse 1,500 ft,
and none for the High Plains LP and the capped case. Ohio Valley and Dixie storms last longer than before but still
fade after about 50–55 minutes.

**Limits.** Single-moment microphysics: each class has a fixed size distribution, so hail size is estimated from
the hail content (the model tops out near 2 in and can't make giant hail), and hail cores read high on radar (up
to about 80 dBZ). No surface friction, no radiation, a uniform environment. Storms fed by a shallow moist layer, and
moderate-CAPE storms, fade within an hour. A 1 km grid resolves the storm and its mesocyclone, not the tornado. Tornadoes are flagged when
strong near-ground rotation sits under the low-level updraft for at least a minute, and their strength is an
estimate scaled from that circulation.

## Tests

`npm test` runs the physics tests in Node, for both models:
- **Instant model:** checks against reference values and expected behaviour. These include Bolton saturation
  pressure, the LCL rule, Bunkers deviation, zero helicity for a straight hodograph, the setup storm types, tornado
  frequency over many rolls, and radar structure (the hook is stronger than the inflow notch).
- **Cloud model:** a calm atmosphere stays at rest, a uniform wind is carried unchanged, mass is conserved, a warm
  bubble rises, a moist sounding makes a storm with rain, an ice anvil and hail at the ground, a capped one stays
  quiet, microphysics conserves water and energy, fall speeds, reflectivity and hail sizes are realistic, the hail
  swath lands where the storm motion puts it, and the tornado tracker rules hold.

Browser checks (headless Chromium with WebGPU):
- `tests/browser/sim-compare.ts` runs the CPU and GPU cloud models side by side.
- `?capture-only` skips on-screen WebGPU presentation, which loses the device in some headless setups.
- `window.__stormlab.captureImage(w, h)` renders a frame offscreen.
- `window.__stormlab.sim()` returns the simulation's state.
- `?renderer=webgl` forces the fallback renderer, and with it the CPU simulation.

## Roadmap

1. Storm longevity in moderate-CAPE environments (Ohio Valley, Dixie): storms still fade after about 50–55 minutes.
2. Typed port of the tornado view (currently ported as-is with `@ts-nocheck`).
3. Tornado and wall cloud drawn in the 3-D view, and a storm-following camera for the simulation.
