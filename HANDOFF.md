# StormLab handoff: using the supercell in another engine

This note is for anyone (or any AI assistant) taking the storm out of this browser app and into a game engine. It says
what each piece is, which parts are engine-independent, and how the pieces talk to each other. The README covers the
project as a whole; this is the map for reuse.

Everything here is under the MIT licence (see LICENSE): use it, change it, ship it, keep the copyright line.

## What you are getting

StormLab draws a supercell from the **conceptual model** forecasters and storm spotters use (Lemon & Doswell 1979;
Markowski 2002), not from a fluid simulation. A setup (a sounding and hodograph) is turned into a *storm plan*; the
plan plus a storm time gives the position, size and strength of every feature; a renderer paints those features into a
3-D volume and ray-marches it. The three layers are separable, and the first two have no dependency on the browser.

| Layer | Files | Engine-independent? | Lines |
| --- | --- | --- | --- |
| Environment physics | `src/physics/thermo.ts`, `winds.ts`, `environment.ts`, `storm.ts`, `src/units.ts`, `src/presets.ts` | Yes: plain TypeScript, no DOM, no GPU | ~900 |
| Storm design (the prize) | `src/storm3d/design.ts` | Yes: pure functions in, numbers out | ~220 |
| Rendering | `src/storm3d/shaders.ts` (WGSL), `renderer.ts` (WebGPU), `src/render/noise.ts` | No: WebGPU, but the shader ideas port | ~900 |
| Camera | `src/views/storm/camera-rig.ts` | Yes, pure maths; mirrors a city-builder camera | ~150 |
| Page, player, captions | `src/views/storm/*` | No (DOM) | — |

The `src/sim/` folder is an earlier fluid-dynamics cloud model that is kept in the repo but not used on the page. You
don't need it.

## Layer 1: the environment

```ts
import { environment } from './src/physics/environment';
import { storm } from './src/physics/storm';
import { PRESETS } from './src/presets';
import { toEnv } from './src/units';

const E = environment(toEnv(PRESETS.plains));   // sounding, hodograph, CAPE, CIN, SRH, SCP, STP, Bunkers motion
const S = storm(E);                              // storm type (supercell / pulse / capped), rotation, tornado odds, LP/classic/HP
```

`PRESETS` holds seven setups (Plains outbreak, big hail day, Dixie HP, Ohio Valley, High Plains LP, capped bust, summer
pulse) as surface temperature/dewpoint, moisture depth, lapse rate, cap strength and winds. Make your own by changing
those numbers; `Environment` and `StormDiag` are documented in their files. The tornado-parameter code
(`tornadoParams`) gives a tornado's size, type and wind field from the storm's STP, which the separate Tornado Lab
page uses.

## Layer 2: the storm design

```ts
import { planStorm, stormAt, NSLOT } from './src/storm3d/design';

const P = planStorm(E, S);            // fixed for a setup: cloud base, storm top, motion, radii, which features it gets
const frame = stormAt(P, t, clock);   // t = storm time in minutes (0..P.duration), clock = wall-clock seconds for spin
frame.params                          // Float32Array, NSLOT x 4 numbers: everything the renderer needs (below)
frame.stage, frame.caption            // the stage name and teaching caption for this moment
frame.tornado                         // 0..1, tornado on the ground
```

Coordinates are kilometres in the storm's own frame (x east, y north, z up), which moves with the storm; the storm's
motion is `P.motion` (m/s) so ground position = storm frame + motion × time. The updraft sits at `up` (slot 16), offset
upstream of the origin so the anvil has room downstream.

**The life cycle** (supercell): towering cumulus 0–14 min, anvil spreading 10–20, rain and hail 14–28, striations and
inflow tail 18–34; then a 38-minute cycle starting at 30 min: wall cloud forms (0–6 into the cycle), rear-flank
downdraft surges and carves the horseshoe-shaped clear slot (8–16), tornado forms at the northern curl (14–16.5),
ropes out (21.5–26) and dies (26–28.5), the old circulation occludes rearward and a new wall cloud takes over. The
anticyclonic side: an anti-mesocyclone at the surge's southern curl in tornadic setups, and in the Plains setup's second
cycle a brief anticyclonic tornado. Pulse storms rain out and collapse by 50 min; capped setups only bubble.

**The parameter block** (`frame.params`, 21 slots of 4 floats; the WGSL struct `SP` in `shaders.ts` is the same layout):

| Slot | Name | x | y | z | w |
| --- | --- | --- | --- | --- | --- |
| 0 | f | forward unit x | forward unit y | left unit x | left unit y |
| 1 | base | cloud base km | storm top km | clock s | storm time min |
| 2 | tower | top height km | radius km | amount 0..1 | striation 0..1 |
| 3 | tilt | tilt x km/km | tilt y | overshooting top 0..1 | meso spin rad/s (CCW) |
| 4 | anvil | direction x | direction y | length km | growth 0..1 |
| 5 | anvil2 | bottom km | top km | mammatus | backshear km |
| 6 | wall | centre x | centre y | radius km | amount |
| 7 | wall2 | lowering km | spin rad/s | tail cloud | scud |
| 8 | tail | inflow direction x | direction y | length km | amount |
| 9 | ffd | forward-flank rain core x | y | size scale | amount |
| 10 | hail | hail core x | y | radius km | amount |
| 11 | rfd | clear slot | slot radius | rear-flank rain | HP wrap |
| 12 | flank | flanking-line direction x | y | growth | tower count |
| 13 | tor | tornado ground x | y | amount | type (0 slender..1 wedge) |
| 14 | tor2 | ground radius km | top radius km | condensation reach | rope-out |
| 15 | tor3 | tornado top x | y | debris | — |
| 16 | up | updraft centre x | y | — | — |
| 17 | grid | (filled by the renderer: cells, levels, half-width, top) | | | |
| 18 | rfdb | RFD surge centre x | y | radius km | horseshoe amount |
| 19 | anti | southern curl x | y | anti-mesocyclone | anticyclonic tornado |
| 20 | slab | (renderer only) | | | |

Angles in the design are measured in the storm's frame: 0 = downstream (the direction of motion), +90° = left of the
motion, which is north for a storm moving north-east. The horseshoe is an arc round the RFD surge from +60° (northern
arm, where the wall cloud and tornado sit on its inner side) through the east to −170° (southern arm, the
anticyclonic curl), open to the rear.

**Porting it:** `design.ts` has no imports beyond `clamp`, `Environment`, `StormDiag` and a wind interpolator. It
translates line-for-line to C#, C++ or GDScript. If you only want the storm and not the physics, feed `planStorm`
hand-picked numbers instead of an `Environment` (see the fields of `StormPlan`).

## Layer 3: rendering

The WebGPU renderer (`renderer.ts`) runs three WGSL passes from `shaders.ts`:

1. **BUILD** paints the features into an RGBA8 3-D texture (288×288×144 at high detail over a 100 km × 100 km × 18 km
   box; 176×176×72 at low): R = cloud, G = precipitation, B = a coarse copy of the near-ground features (for shadows),
   A = material (water cloud with its billowiness, or ice for the anvil). Each feature is an analytic shape plus
   noise; the file is commented feature by feature.
2. **LIGHT** marches toward the sun and straight up on a grid a third of that resolution, and precomputes the shading
   of undersides and of the anvil's ice.
3. **RENDER** ray-marches the volume from the camera: crisp billowed edges for water cloud, layered translucent ice
   for the anvil, striations turning with the mesocyclone, and, near the ground, the wall cloud, horseshoe lip,
   inflow tail and tornado evaluated analytically at full detail (`nearField`, `tornado`, `antiTornado`), so a
   tornado tens of metres wide stays sharp.

**In a game engine** you would most likely keep the design layer and redo the rendering natively:

- **Volumetric route:** port BUILD to a compute shader writing a 3-D texture, and RENDER to a ray-march in a
  full-screen or box-bounded material (Unity HDRP volumetric clouds, Unreal volumetric cloud material, Godot
  compute + ray-march). WGSL → HLSL/GLSL is mostly syntax. The noise is a tiling 48³ texture from `src/render/noise.ts`.
- **Mesh/particle route:** use the parameter block to place and scale meshes or particle systems (a striated barrel
  mesh for the mesocyclone whose UVs scroll with `tilt.w`, a lowered disc for the wall cloud, a cone for the tornado,
  billboards for the flanking towers, an oval sheet for the anvil). Cheaper, and every number you need is in the table.

Whichever route, step `stormAt` on the game's storm clock and re-read the parameters each frame.

## Running the reference

```sh
npm install
npm run dev        # http://localhost:5173, Chrome or Edge (needs WebGPU)
npm run check      # typecheck, 35 unit tests, production build
```

The live build is at https://jonnyglessner-jpg.github.io/StormLab/. In the browser console, `window.__stormlab`
exposes `setPreset(key)`, `setTime(min)`, `captureImage(w, h)` and `state()`, which is how the screenshots in the
README were made.

## Things to know

- The storm is designed, not simulated: its parts are in the right places at the right times, and the turbulence is
  drawn, not solved. Every storm of a setup follows the same life cycle.
- Mammatus are switched off in the build pass (they read as holes at the volume's resolution).
- The radar view from the earlier simulation (`src/views/storm/sim-radar.ts`) is shelved but kept.
- Performance: the volume is rebuilt a few times a second spread over four frames; lighting is per rebuild, not per
  frame; render resolution adapts to the measured frame time. If your engine can afford it, bump the volume
  resolution in `QUALITY_HIGH` for more detail near the ground.
