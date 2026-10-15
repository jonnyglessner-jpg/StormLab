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

Each page has a "Limits" section. In short, the storm is a steady diagnostic model, not a time-stepping cloud
model. Tornado odds are climatological, scaled from SPC studies (Thompson et al. 2003/2012, Smith et al. 2015).

## Tests

`npm test` checks the physics against reference values and expected behaviour, including Bolton saturation
pressure, the LCL rule, Bunkers deviation, zero helicity for a straight hodograph, the setup storm types, the
tornado frequency over many rolls, and radar structure (hook stronger than the inflow notch).

For headless-browser checks, `?capture-only` skips on-screen WebGPU presentation (some headless GPUs lose the
device when a WebGPU canvas is presented), and `window.__stormlab.captureImage(w, h)` renders a frame offscreen.
`?renderer=webgl` forces the fallback renderer.

## Roadmap

1. A time-stepping cloud model on the GPU (WebGPU compute): the storm grows, the mesocyclone cycles, and tornadoes
   form and decay over time instead of being drawn from climatology.
2. Typed port of the tornado view (currently ported as-is with `@ts-nocheck`).
3. Tornado and wall cloud in the 3-D view.
