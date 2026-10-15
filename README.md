# StormLab: Supercell Lab

An interactive supercell and tornado simulator for weather education. Set the atmosphere with seven sliders and
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
| Advection | | Semi-Lagrangian with MacCormack correction and a min/max limiter |
| Moist physics | | Kessler warm rain (Klemp & Wilhelmson 1978): saturation adjustment, autoconversion, accretion, rain evaporation, sedimentation |
| Mixing | | Vertical eddy diffusion plus a 4th-order horizontal filter against 2-gridpoint noise |
| Pressure | | Projection onto div(ρ₀u) = 0, solved by red-black vertical-line relaxation |
| Boundaries | | Lateral sponge, Rayleigh damping above 12 km, free-slip ground |
| Start | | Updraft nudging for 15 min (Naylor & Gilmore 2012, as in CM1) |
| GPU | `src/sim/gpu-kernels.ts`, `model-gpu.ts` | WGSL kernels mirroring the CPU code; 96 × 96 × 40 grid, 1 km × 400 m |
| Fallback | `src/sim/sim.worker.ts` | CPU reference in a worker on a coarser grid when WebGPU is missing |
| Output | `src/sim/diag.ts` | Radar reflectivity and velocity at 600 m, vorticity, cold pool, rain; tornado tracker |

The GPU kernels and the CPU reference agree to about 0.1 % after 60 steps with cloud and rain
(`tests/browser/sim-compare.ts`). Checked against CM1 with the same Weisman–Klemp environment, the model gives a
peak updraft of about 50–55 m/s (CM1: 52–60), mid-level rotation of 0.02–0.03 s⁻¹ (CM1: 0.02–0.03), and a −4 to −8 K
cold pool.

**Limits.** No ice (so no hail, graupel or anvil ice physics), no surface friction, no radiation, a uniform
environment. A 1 km grid resolves the storm and its mesocyclone, not the tornado. Tornadoes are flagged when strong
near-ground rotation sits under the low-level updraft for at least a minute, and their strength is an estimate
scaled from that circulation.

## Tests

`npm test` runs the physics tests in Node, for both models:
- **Instant model:** checks against reference values and expected behaviour. These include Bolton saturation
  pressure, the LCL rule, Bunkers deviation, zero helicity for a straight hodograph, the setup storm types, tornado
  frequency over many rolls, and radar structure (the hook is stronger than the inflow notch).
- **Cloud model:** a calm atmosphere stays at rest, a uniform wind is carried unchanged, mass is conserved, a warm
  bubble rises, a moist sounding makes a raining storm, a capped one stays quiet, and the tornado tracker rules hold.

Browser checks (headless Chromium with WebGPU):
- `tests/browser/sim-compare.ts` runs the CPU and GPU cloud models side by side.
- `?capture-only` skips on-screen WebGPU presentation, which loses the device in some headless setups.
- `window.__stormlab.captureImage(w, h)` renders a frame offscreen.
- `window.__stormlab.sim()` returns the simulation's state.
- `?renderer=webgl` forces the fallback renderer, and with it the CPU simulation.

## Roadmap

1. Ice microphysics (hail, graupel, a real ice anvil) and surface friction in the cloud model.
2. Typed port of the tornado view (currently ported as-is with `@ts-nocheck`).
3. Tornado and wall cloud drawn in the 3-D view, and a storm-following camera for the simulation.
