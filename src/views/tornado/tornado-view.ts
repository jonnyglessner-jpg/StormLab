// @ts-nocheck
/*
 * Tornado Lab: a swirl-ratio vortex model (one-cell, vortex breakdown, two-cell, multiple vortices, corner flow),
 * condensation funnel from cyclostrophic pressure, debris, damage swath and the parent storm's base.
 *
 * Ported as-is from the original single-page lab; type annotations are still to come (hence @ts-nocheck).
 * When the storm view sends a tornado (app.link), its cloud base, forward speed, precipitation type, swirl ratio
 * and core size are applied, and the rotational wind is solved so the peak ground wind matches.
 */
import { app } from '../../state';

const BODY = "<div class=\"wrap\">\n  <header>\n    <div class=\"eyebrow\">Swirl ratio \u00b7 corner flow \u00b7 vortex breakdown \u00b7 suction vortices</div>\n    <h1>Tornado Vortex Lab</h1>\n    <p class=\"lede\">A tornado built from its wind field. Swirl ratio, the balance between how much the air spins and how fast the updraft pulls it in, sets the vortex's structure: a narrow one-cell jet, a breakdown bubble aloft, a two-cell core with a central downdraft, or a ring of suction vortices. The funnel is wherever the resulting pressure drop makes rising air condense. Swirl drifts over time, so the structure keeps changing as you watch.</p>\n  </header>\n\n  <section class=\"bench\">\n    <div class=\"stagecol\">\n      <div class=\"stage\">\n        <canvas id=\"side\" aria-label=\"Side view of the simulated tornado, looking north\"></canvas>\n        <span class=\"tag tl\">Looking north \u00b7 storm moving east</span>\n        <span class=\"tag tr\" id=\"scaleTag\">\u2014</span>\n      </div>\n      <dl class=\"read\" aria-live=\"polite\">\n        <div class=\"wide\"><dt>Peak ground-relative wind</dt><dd><span id=\"rPeak\">\u2014</span><span class=\"ef\" id=\"rEF\">\u2014</span><small id=\"rPeakSub\">\u2014</small></dd></div>\n        <div class=\"wide\"><dt>Vortex structure</dt><dd><span id=\"rReg\">\u2014</span><small id=\"rRegSub\">\u2014</small></dd></div>\n        <div><dt>Lowest pressure</dt><dd id=\"rDp\">\u2014</dd></div>\n        <div><dt>Needed to condense at ground</dt><dd id=\"rNeed\">\u2014</dd></div>\n        <div><dt>Vortex breakdown</dt><dd id=\"rBd\">\u2014</dd></div>\n        <div><dt>Updraft</dt><dd id=\"rUp\">\u2014</dd></div>\n        <div><dt>Condensation funnel</dt><dd id=\"rFun\">\u2014</dd></div>\n        <div><dt>EF0+ path width</dt><dd id=\"rPath\">\u2014</dd></div>\n        <div><dt>Suction vortices</dt><dd id=\"rSub\">\u2014</dd></div>\n        <div><dt>Updraft radius</dt><dd id=\"rR0\">\u2014</dd></div>\n      </dl>\n      <div class=\"card\">\n        <div class=\"cardhead\">\n          <h2>Last 60 seconds</h2>\n          <div class=\"legend\">\n            <span><i class=\"ln\" style=\"color:var(--ink)\"></i>Swirl ratio</span>\n            <span><i class=\"ln\" style=\"color:var(--hot)\"></i>Peak ground wind</span>\n            <span><i class=\"ln d\" style=\"color:var(--accent)\"></i>Breakdown height, ground to cloud base</span>\n          </div>\n        </div>\n        <canvas id=\"hist\" aria-label=\"Swirl ratio, peak ground wind and breakdown height over the last 60 seconds\"></canvas>\n      </div>\n    </div>\n\n    <aside class=\"rack\" aria-label=\"Controls\">\n      <div style=\"display:grid;gap:8px\">\n        <h2>Presets</h2>\n        <div class=\"presets\" role=\"group\" aria-label=\"Presets\">\n          <button data-p=\"rope\">Rope</button>\n          <button data-p=\"classic\" aria-pressed=\"true\">Classic</button>\n          <button data-p=\"multi\">Multivortex</button>\n          <button data-p=\"wedge\">Wedge</button>\n          <button data-p=\"high\">High base</button>\n        </div>\n      </div>\n\n      <div class=\"sliders\">\n        <div class=\"sl swirl\">\n          <label for=\"sw\">Swirl ratio</label><output id=\"o_sw\"></output>\n          <input type=\"range\" id=\"sw\" min=\"0\" max=\"100\" step=\"1\">\n          <div class=\"ladder\" aria-hidden=\"true\">\n            <i style=\"width:9.5%;background:var(--rg1)\"></i><i style=\"width:15.8%;background:var(--rg2)\"></i><i style=\"width:34.7%;background:var(--rg3)\"></i><i style=\"width:40%;background:var(--rg4)\"></i>\n          </div>\n          <div class=\"ticks\" aria-hidden=\"true\">\n            <span style=\"left:0%\">0.05</span><span style=\"left:9.5%\">0.2</span><span style=\"left:25.3%\">0.45</span><span style=\"left:60%\">1</span><span style=\"left:80%\">2</span><span style=\"left:100%\">3</span>\n          </div>\n          <div class=\"rkey\">\n            <span><i class=\"sw\" style=\"background:var(--rg1)\"></i>One-cell</span>\n            <span><i class=\"sw\" style=\"background:var(--rg2)\"></i>Breakdown aloft</span>\n            <span><i class=\"sw\" style=\"background:var(--rg3)\"></i>Two-cell</span>\n            <span><i class=\"sw\" style=\"background:var(--rg4)\"></i>Multiple vortices</span>\n          </div>\n        </div>\n        <div class=\"sl\"><label for=\"un\">Unsteadiness</label><output id=\"o_un\"></output><input type=\"range\" id=\"un\" min=\"0\" max=\"100\" step=\"5\" value=\"50\"></div>\n        <div class=\"sl\"><label for=\"vrot\">Rotational wind aloft</label><output id=\"o_vrot\"></output><input type=\"range\" id=\"vrot\" min=\"20\" max=\"250\" step=\"1\"></div>\n        <div class=\"sl\"><label for=\"rc\">Core radius aloft</label><output id=\"o_rc\"></output><input type=\"range\" id=\"rc\" min=\"15\" max=\"500\" step=\"5\"></div>\n        <div class=\"sl\"><label for=\"zc\">Cloud base above ground</label><output id=\"o_zc\"></output><input type=\"range\" id=\"zc\" min=\"500\" max=\"5000\" step=\"50\"></div>\n        <div class=\"sl\"><label for=\"vt\">Forward speed</label><output id=\"o_vt\"></output><input type=\"range\" id=\"vt\" min=\"0\" max=\"60\" step=\"1\"></div>\n      </div>\n\n      <div class=\"row\">\n        <span>Precipitation</span>\n        <div class=\"seg\" role=\"group\" aria-label=\"Precipitation\">\n          <button data-r=\"lp\">Low</button><button data-r=\"classic\" aria-pressed=\"true\">Classic</button><button data-r=\"hp\">High</button>\n        </div>\n      </div>\n      <div class=\"row\">\n        <label><input type=\"checkbox\" id=\"air\" checked> Airflow tracers</label>\n        <label><input type=\"checkbox\" id=\"deb\" checked> Debris</label>\n        <label><input type=\"checkbox\" id=\"ltg\" checked> Lightning</label>\n      </div>\n      <div class=\"row\">\n        <button id=\"play\">Pause</button>\n        <div class=\"seg\" role=\"group\" aria-label=\"Playback speed\">\n          <button data-s=\"0.25\">\u00bc\u00d7</button><button data-s=\"0.5\">\u00bd\u00d7</button><button data-s=\"1\" aria-pressed=\"true\">1\u00d7</button><button data-s=\"2\">2\u00d7</button>\n        </div>\n      </div>\n    </aside>\n  </section>\n\n  <section class=\"lower\">\n    <div class=\"card\">\n      <div class=\"cardhead\">\n        <h2>Ground winds from above</h2>\n        <div class=\"seg\" role=\"group\" aria-label=\"Plan view mode\" style=\"margin-left:0\">\n          <button data-m=\"live\" aria-pressed=\"true\">Live</button><button data-m=\"swath\">Damage swath</button>\n        </div>\n      </div>\n      <canvas id=\"plan\" aria-label=\"Plan view of ground-relative wind speed, shaded by EF category\"></canvas>\n      <div class=\"legend\" id=\"efLegend\"></div>\n      <p class=\"cap\" id=\"planCap\">Ground-relative wind near the surface, north up. Forward motion adds to the rotation on the right (south) side of the track. Suction vortices show up as hot spots orbiting the core.</p>\n    </div>\n    <div class=\"card\">\n      <h2>Vertical cross-section</h2>\n      <canvas id=\"sec\" aria-label=\"Vertical cross-section through the vortex showing rotational wind and the in-up-out circulation\"></canvas>\n      <div class=\"legend\">\n        <span><i class=\"ramp\"></i>Rotational wind 0\u2013<span id=\"secMax\">\u2014</span> mph</span>\n        <span><i class=\"ln\" style=\"color:#e9efec\"></i>Streamlines</span>\n        <span><i class=\"ln d\" style=\"color:#e9efec\"></i>Funnel edge</span>\n      </div>\n      <p class=\"cap\">Averaged around the vortex, through its center. Air flows in along the ground and turns upward. When the swirl is high enough, a downdraft forms on the axis (dashed streamlines) and the core splits into two cells. The breakdown marker is where the narrow lower vortex abruptly widens.</p>\n    </div>\n  </section>\n\n  <section class=\"lower\">\n    <div class=\"card\">\n      <h2>Radial profile</h2>\n      <canvas id=\"prof\" aria-label=\"Wind speed and pressure drop versus distance from the center\"></canvas>\n      <div class=\"legend\">\n        <span><i class=\"ln\" style=\"color:var(--accent)\"></i>Rotational, at ground</span>\n        <span><i class=\"ln\" style=\"color:var(--muted)\"></i>Rotational, aloft</span>\n        <span><i class=\"ln d\" style=\"color:var(--hot)\"></i>Right of track</span>\n        <span><i class=\"ln\" style=\"color:var(--press)\"></i>Pressure drop at ground</span>\n      </div>\n      <p class=\"cap\">The gap between the ground and aloft curves is the corner flow. Below a vortex breakdown, the surface vortex contracts and can spin up to about twice as fast. Suction vortices add on top of these averaged winds in narrow spots.</p>\n    </div>\n    <div class=\"card\">\n      <h2>What swirl ratio sets</h2>\n      <div class=\"formula\">S = r\u2080 \u0393 / 2Q</div>\n      <p class=\"cap\">r\u2080 is the updraft radius, \u0393 the circulation of the inflowing air, and Q the volume of air the updraft lifts each second. Low S means the updraft wins and the vortex stays a tight one-cell jet. High S means rotation wins: the core can't hold all that spin, so air from aloft is forced down the middle, the core widens, and the shear around it rolls up into suction vortices.</p>\n      <ol class=\"cap\" style=\"padding-left:18px;display:grid;gap:6px;margin:0\">\n        <li><b>Below about 0.2.</b> One-cell vortex. Air rises along the axis. Near-ground winds are close to the winds aloft.</li>\n        <li><b>About 0.2 to 0.45.</b> A vortex breakdown appears aloft and descends as S rises. Below it, a narrow end-wall vortex spins up, peaking at about 2\u00d7 when the breakdown is just above the ground.</li>\n        <li><b>About 0.45 to 1.</b> The breakdown reaches the ground. Two-cell core: a central downdraft surrounded by a ring of rising air.</li>\n        <li><b>Above about 1.</b> Multiple vortices: 2, then 3 up to about 6 suction vortices as S keeps rising.</li>\n      </ol>\n    </div>\n  </section>\n\n  <section class=\"card notes\">\n    <div style=\"display:grid;gap:10px\">\n      <h2>What the model does</h2>\n      <ol>\n        <li><b>Rotation.</b> Burgers\u2013Rott profile in the one-cell parts of the vortex, Sullivan two-cell profile above a breakdown and wherever the breakdown has reached the ground. Both carry the same circulation, set by the wind and core radius aloft.</li>\n        <li><b>In-up-out flow.</b> A streamfunction, so mass is conserved exactly: an inflow layer feeding a Gaussian updraft of radius r\u2080, plus a central downdraft that descends to the breakdown's stagnation point and turns outward. The updraft speed comes from the swirl ratio, S = \u0393r\u2080/2Q, rather than being set by hand.</li>\n        <li><b>Corner flow.</b> Below a breakdown, the near-ground core contracts at constant circulation. The amplification peaks at about 2\u00d7 when the breakdown sits just above the surface, matching LES results.</li>\n        <li><b>Suction vortices.</b> Above S \u2248 1, a set of tilted subvortices orbits near the core radius at roughly half the parent's peak speed. Each carries its own rotation, pressure drop, and updraft, so they condense into their own tubes, loft debris, and leave cycloidal marks in the damage swath.</li>\n        <li><b>Unsteadiness.</b> Swirl ratio drifts around the value you set, on time scales of a few rotation periods, so the breakdown climbs and descends and the vortex moves between regimes. The lower vortex wanders around its mean position while the top stays anchored to the cloud. Above S \u2248 1, suction vortices form in the widest gap around the core, live for roughly one orbit, and decay. At zero unsteadiness they sit in a fixed ring.</li>\n        <li><b>Pressure and funnel.</b> Cyclostrophic balance, <code>dp/dr = \u03c1v\u00b2/r</code>, integrated at each height. Air condenses where the pressure drop equals the drop from that height to cloud base, <code>\u03c1g(z<sub>LCL</sub> \u2212 z)</code>.</li>\n      </ol>\n    </div>\n    <div style=\"display:grid;gap:10px\">\n      <h2>Limits</h2>\n      <ul>\n        <li>Swirl ratio thresholds come from laboratory vortex chambers. Real tornadoes can't be measured this way directly, and other definitions of S shift the numbers.</li>\n        <li>Core growth, subvortex count, spin and orbit speed follow lab and LES trends but are fitted, not solved.</li>\n        <li>No surface roughness, turbulence closure, or rear-flank downdraft. The unsteadiness is imposed (a random drift in swirl ratio, a wandering axis, subvortex lifetimes), not generated by the flow itself.</li>\n        <li>Unsteady corner-flow collapse can briefly push winds well past 2\u00d7 in LES. That isn't modeled.</li>\n      </ul>\n      <p class=\"refs\">Thresholds after Church et al. (1979) and Davies-Jones (1986). Corner-flow limit from <a href=\"https://ams.confex.com/ams/pdfpapers/115321.pdf\" target=\"_blank\" rel=\"noopener\">Lewellen &amp; Lewellen, On the limits to near-surface intensification of tornado vortices</a>. Regime sequence also in <a href=\"https://windeng.t.u-tokyo.ac.jp/ishihara/e/paper/2019-11.pdf\" target=\"_blank\" rel=\"noopener\">Ishihara et al.</a></p>\n    </div>\n  </section>\n</div>";

export function mountTornado(root: HTMLElement): () => void {
  root.innerHTML = BODY;
  let __alive = true;
  const __cleanup = [];

  const MPH = 0.44704, YD = 0.9144, FT = 0.3048, RHO = 1.15, G = 9.81, TAU2 = 2 * Math.PI;
  const EFT = [65, 86, 111, 136, 166, 201];
  const EFC = ['#4cc3ff', '#3ccf6e', '#ffd23f', '#ff9a2e', '#ef4040', '#e655d6'];
  const S_BD = 0.2, S_TD = 0.45, S_MV = 1.0;
  const PRESETS = {
    rope:    { vrot: 90,  rc: 25,  zc: 1200, vt: 20, sw: 0.30 },
    classic: { vrot: 140, rc: 90,  zc: 1250, vt: 30, sw: 0.60 },
    multi:   { vrot: 125, rc: 170, zc: 1000, vt: 30, sw: 1.50 },
    wedge:   { vrot: 150, rc: 330, zc: 1000, vt: 25, sw: 2.40 },
    high:    { vrot: 105, rc: 60,  zc: 4500, vt: 15, sw: 0.15 }
  };
  const S = Object.assign({}, PRESETS.classic);
  let speed = 1, showAir = true, showDebris = true, planMode = 'live', unsteady = 0.5, precip = 'classic';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let showLtg = !reduceMotion;
  let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $ = id => document.getElementById(id);
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const dsstep = (a, b, x) => { const t = (x - a) / (b - a); return (t <= 0 || t >= 1) ? 0 : 6 * t * (1 - t) / (b - a); };
  const efIndex = mph => { let k = -1; for (let i = 0; i < 6; i++) if (mph >= EFT[i]) k = i; return k; };
  const p2s = p => p <= 60 ? 0.05 + 0.95 * p / 60 : 1 + 2 * (p - 60) / 40;
  const s2p = s => s <= 1 ? (s - 0.05) / 0.95 * 60 : 60 + (s - 1) / 2 * 40;
  const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.732;

  /* ---------- profile shapes ---------- */
  const B1 = 1.2564;
  const phiB = x => x < 1e-6 ? B1 * x : (1 - Math.exp(-B1 * x * x)) / x;
  const PB1 = phiB(1);
  const SUL = (() => {
    const dt = 0.01, TN = 8000, H = new Float64Array(TN + 1);
    let ein = 0, h = 0, pe = 1, pf = 1;
    for (let i = 1; i <= TN; i++) {
      const t = i * dt, e = (1 - Math.exp(-t)) / t;
      ein += 0.5 * (pe + e) * dt; pe = e;
      const f = Math.exp(-t + 3 * ein); h += 0.5 * (pf + f) * dt; pf = f; H[i] = h;
    }
    const Hinf = H[TN];
    let best = 0, ip = 1;
    for (let i = 1; i <= TN; i++) { const v = H[i] / Math.sqrt(i * dt); if (v > best) { best = v; ip = i; } }
    const xip = ip * dt, XM = 12, NX = 1200, phi = new Float64Array(NX + 2);
    for (let k = 1; k <= NX + 1; k++) {
      const x = k * XM / NX, xi = xip * x * x;
      let Hx = Hinf;
      if (xi < TN * dt) { const f = xi / dt, i = Math.floor(f); Hx = H[i] + (H[i + 1] - H[i]) * (f - i); }
      phi[k] = Hx / Hinf / x;
    }
    return { phi, XM, NX };
  })();
  function phiS(x) {
    if (x >= SUL.XM) return 1 / x;
    const f = x / SUL.XM * SUL.NX, i = Math.floor(f);
    return SUL.phi[i] + (SUL.phi[i + 1] - SUL.phi[i]) * (f - i);
  }
  const PBT = (() => {
    const N = 700, lo = -3, hi = 3, x = new Float64Array(N + 1), p = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) x[i] = Math.pow(10, lo + (hi - lo) * i / N);
    const v = t => phiB(t) / PB1;
    p[N] = 0.5 * v(x[N]) ** 2;
    for (let i = N - 1; i >= 0; i--) p[i] = p[i + 1] + 0.5 * (v(x[i]) ** 2 / x[i] + v(x[i + 1]) ** 2 / x[i + 1]) * (x[i + 1] - x[i]);
    return { x, p, N, p0: p[0] };
  })();
  function pbInv(q) {
    if (q >= PBT.p0) return 0;
    if (q <= PBT.p[PBT.N]) return PBT.x[PBT.N] * Math.sqrt(PBT.p[PBT.N] / q);
    let a = 0, b = PBT.N;
    while (b - a > 1) { const m = (a + b) >> 1; if (PBT.p[m] > q) a = m; else b = m; }
    const t = (PBT.p[a] - q) / (PBT.p[a] - PBT.p[b]);
    return PBT.x[a] + (PBT.x[b] - PBT.x[a]) * t;
  }

  /* ---------- model ---------- */
  const NZ = 128, NR = 500, LO = -2.4, HI = 2.3;
  const AMPS = [0.25, 0.5, 0.75, 1];
  const BUF = {
    lvRc: new Float64Array(NZ), lvTau: new Float64Array(NZ), rT: new Float64Array(NR + 1),
    pT: new Float64Array(NZ * (NR + 1)), rfL: new Float64Array(NZ), tube: new Float64Array(AMPS.length * NZ)
  };
  let M = {}, AN = { peak: 0, pathW: 0, r65: 0 };
  function tauOf(z) {
    if (M.zb === Infinity) return 0;
    return Math.max(sstep(M.zb - 0.3 * M.Lz, M.zb + M.Lz, z), M.full2);
  }
  function derive(sw) {
    const V = S.vrot * MPH, rc = S.rc * YD, zc = S.zc * FT, vt = S.vt * MPH;
    const zb = sw < S_BD ? Infinity : zc * (1 - sstep(S_BD, S_TD, sw));
    M = { zb, Lz: Math.max(0.6 * rc, 25), full2: sstep(S_TD, S_TD + 0.08, sw) };
    const tTop = tauOf(zc), K = V * rc / ((1 - tTop) * PB1 + tTop * phiS(1));
    const I = 1 + 0.95 * Math.exp(-(((sw - 0.4) / (sw <= 0.4 ? 0.15 : 0.1)) ** 2));
    const f = Math.min(0.8, 0.03 + 0.25 * sw), r0 = rc / f, Wbar = K / (r0 * sw);
    const hin = clamp(0.3 * r0, 25, 350);
    const gam = 0.4 * sstep(0.2, 0.6, sw), sig = sstep(0.17, 0.23, sw);
    const rd = 0.6 * rc, Lz = M.Lz, Ld = Math.max(1.2 * rc, 40);
    const hc = Math.max(0.45 * Math.min(zb, zc), 0.7 * rc);
    M = { V, rc, zc, vt, sw, K, zb, I, f, r0, Wbar, hin, gam, sig, rd, Lz, Ld, hc, full2: M.full2 };
    M.A = r0 * r0 * Wbar / 2;
    M.B = rd * rd * Wbar * (1 + gam) * sig / 2;
    M.lvRc = BUF.lvRc; M.lvTau = BUF.lvTau; M.rT = BUF.rT; M.pT = BUF.pT; M.rfL = BUF.rfL; M.tube = BUF.tube;
    for (let j = 0; j < NZ; j++) {
      const z = zc * j / (NZ - 1), tau = tauOf(z), Ic = 1 + (I - 1) * Math.exp(-z / hc);
      M.lvRc[j] = rc * ((1 - tau) / Ic + tau); M.lvTau[j] = tau;
    }
    for (let i = 0; i <= NR; i++) M.rT[i] = rc * Math.pow(10, LO + (HI - LO) * i / NR);
    for (let j = 0; j < NZ; j++) {
      const o = j * (NR + 1), rcz = M.lvRc[j], tau = M.lvTau[j];
      M.pT[o + NR] = RHO * K * K / (2 * M.rT[NR] ** 2);
      let vb = vAt(M.rT[NR], rcz, tau);
      for (let i = NR - 1; i >= 0; i--) {
        const a = M.rT[i], b = M.rT[i + 1], va = vAt(a, rcz, tau);
        M.pT[o + i] = M.pT[o + i + 1] + RHO * 0.5 * (va * va / a + vb * vb / b) * (b - a);
        vb = va;
      }
    }
    for (let j = 0; j < NZ; j++) M.rfL[j] = rfSolve(j, RHO * G * (zc - zc * j / (NZ - 1)));
    M.rfL[NZ - 1] = isFinite(M.rfL[NZ - 2]) ? M.rfL[NZ - 2] * 1.12 : 4 * rc;
    let jb = NZ - 1; while (jb > 0 && M.rfL[jb - 1] > 0) jb--;
    M.zBot = (jb === 0 && M.rfL[0] > 0) ? 0 : zc * jb / (NZ - 1);
    M.dp0 = M.pT[0]; M.need0 = RHO * G * zc;
    M.lean = (vt / (60 * MPH)) * 0.22 * zc;
    M.vg = 0; for (let i = 0; i <= NR; i++) M.vg = Math.max(M.vg, vAt(M.rT[i], M.lvRc[0], M.lvTau[0]));
    // suction vortices: target count from swirl, spin and size from a continuous count
    M.n = sw < S_MV ? 0 : Math.min(6, 2 + Math.floor((sw - S_MV) / 0.4 + 1e-9));
    const nu = Math.max(2, Math.min(6, 2 + (sw - S_MV) / 0.4));
    M.ro = rc;
    M.vp0 = vAt(rc, M.lvRc[0], M.lvTau[0]);
    M.Om = 0.5 * M.vp0 / M.ro;
    M.vsPeak = M.vp0 * 0.5 * Math.pow(2 / nu, 0.4);
    M.rs = rc * 0.28 / Math.sqrt(nu / 2);
    M.Hs = clamp(2.5 * rc, 60, 0.8 * zc);
    M.tilt = 0.8;
    M.tubeTop = new Float64Array(AMPS.length);
    for (let a = 0; a < AMPS.length; a++) {
      const o = a * NZ, am = AMPS[a];
      for (let j = 0; j < NZ; j++) {
        const z = zc * j / (NZ - 1), vsz = am * M.vsPeak * Math.exp(-z / M.Hs), need = RHO * G * (zc - z), dpp = dpLev(M.ro, j);
        if (dpp >= need) M.tube[o + j] = -1;
        else { const q = (need - dpp) / (RHO * vsz * vsz); M.tube[o + j] = q >= PBT.p0 ? 0 : 0.8 * M.rs * Math.tanh(pbInv(q) / 0.8); }
      }
      let jt = 0; while (jt < NZ - 1 && M.tube[o + jt] >= 0) jt++;
      M.tubeTop[a] = zc * jt / (NZ - 1);
    }
    M.tubeGround = M.n > 0 && M.tube[(AMPS.length - 1) * NZ] !== 0;
    M.dpMin = Math.max(M.dp0, M.n ? dpLev(M.ro, 0) + RHO * M.vsPeak * M.vsPeak * PBT.p0 : 0);
  }
  function vAt(r, rcz, tau) {
    const x = r / rcz;
    return (M.K / rcz) * ((1 - tau) * phiB(x) + (tau > 0 ? tau * phiS(x) : 0));
  }
  function lvl(z) { const f = clamp(z / M.zc, 0, 1) * (NZ - 1), j = Math.min(NZ - 2, Math.floor(f)); return [j, f - j]; }
  function vtanZ(r, z) {
    const [j, t] = lvl(z);
    return vAt(r, M.lvRc[j] + (M.lvRc[j + 1] - M.lvRc[j]) * t, M.lvTau[j] + (M.lvTau[j + 1] - M.lvTau[j]) * t);
  }
  function dpLev(r, j) {
    const o = j * (NR + 1);
    if (r <= M.rT[0]) return M.pT[o];
    if (r >= M.rT[NR]) return RHO * M.K * M.K / (2 * r * r);
    const f = (Math.log10(r / M.rc) - LO) / (HI - LO) * NR, i = Math.floor(f), t = f - i;
    return M.pT[o + i] * (1 - t) + M.pT[o + i + 1] * t;
  }
  function rfSolve(j, need) {
    const o = j * (NR + 1);
    if (need >= M.pT[o]) return 0;
    if (need <= 0) return Infinity;
    if (need < M.pT[o + NR]) return M.K * Math.sqrt(RHO / (2 * need));
    let a = 0, b = NR;
    while (b - a > 1) { const m = (a + b) >> 1; if (M.pT[o + m] > need) a = m; else b = m; }
    const t = (M.pT[o + a] - need) / (M.pT[o + a] - M.pT[o + b]);
    return M.rT[a] + (M.rT[b] - M.rT[a]) * t;
  }
  function rfAt(z) {
    if (z >= M.zc) return M.rfL[NZ - 1];
    const [j, t] = lvl(z);
    return M.rfL[j] * (1 - t) + M.rfL[j + 1] * t;
  }
  function tubeLev(ai, z) {
    if (z >= M.zc) return 0;
    const o = ai * NZ, [j, t] = lvl(z), a = M.tube[o + j], b = M.tube[o + j + 1];
    if (a <= 0 || b <= 0) return (a > 0 && t < 0.5) ? a : (b > 0 && t >= 0.5 ? b : 0);
    return a * (1 - t) + b * t;
  }
  function tubeAt(z, amp) {
    const f = amp * 4 - 1;
    if (f <= 0) return tubeLev(0, z) * Math.max(0, amp * 4);
    const i = Math.min(2, Math.floor(f)), t = Math.min(1, f - i);
    return tubeLev(i, z) * (1 - t) + tubeLev(i + 1, z) * t;
  }
  function tubeTopAt(amp) {
    const f = clamp(amp * 4 - 1, 0, 3), i = Math.min(2, Math.floor(f)), t = f - i;
    return M.tubeTop[i] * (1 - t) + M.tubeTop[i + 1] * t;
  }
  // axis: lean of the whole column plus a wandering lower end
  const WB = { x: 0, y: 0, phi: 0, n1: 0, n2: 0 };
  const wz = z => Math.pow(1 - clamp(z / M.zc, 0, 1), 1.5);
  const axX = z => M.lean * Math.pow(clamp(z / M.zc, 0, 1), 1.5) + WB.x * wz(z);
  const axY = z => WB.y * wz(z);
  function psiAt(r, z) {
    let p = M.A * (1 - Math.exp(-z / M.hin)) * (1 - Math.exp(-r * r / (M.r0 * M.r0)));
    if (M.B > 0 && M.zb !== Infinity) p -= M.B * sstep(M.zb, M.zb + M.Ld, z) * (1 - Math.exp(-r * r / (M.rd * M.rd)));
    return p;
  }
  function merid(r, z, o) {
    r = Math.max(r, 0.05); z = Math.max(z, 0);
    const e0 = Math.exp(-r * r / (M.r0 * M.r0)), ez = Math.exp(-z / M.hin);
    let u = -M.A * (ez / M.hin) * (1 - e0) / r, w = M.Wbar * (1 - ez) * e0;
    if (M.B > 0 && M.zb !== Infinity) {
      const D = sstep(M.zb, M.zb + M.Ld, z), Dp = dsstep(M.zb, M.zb + M.Ld, z);
      if (D > 0 || Dp > 0) {
        const ed = Math.exp(-r * r / (M.rd * M.rd));
        u += M.B * Dp * (1 - ed) / r; w -= 2 * M.B * D * ed / (M.rd * M.rd);
      }
    }
    o[0] = u; o[1] = w;
  }

  /* ---------- suction vortex slots ---------- */
  const NSV = 8;
  const SVt = { th: new Float64Array(NSV), amp: new Float64Array(NSV), age: new Float64Array(NSV), life: new Float64Array(NSV), on: new Uint8Array(NSV) };
  const SVc = new Float64Array(NSV), SVs = new Float64Array(NSV), svAct = [];
  let svSpawnT = 0;
  function svTrig() {
    svAct.length = 0;
    for (let k = 0; k < NSV; k++) if (SVt.on[k] && SVt.amp[k] > 0.01) { SVc[k] = Math.cos(SVt.th[k]); SVs[k] = Math.sin(SVt.th[k]); svAct.push(k); }
  }
  function svRing(n, th0, staggered) {
    const Torb = TAU2 / M.Om;
    for (let k = 0; k < NSV; k++) {
      if (k < n) {
        SVt.on[k] = 1; SVt.th[k] = th0 + TAU2 * k / n;
        if (staggered) { SVt.life[k] = svLife(Torb); SVt.age[k] = SVt.life[k] * (0.2 + 0.5 * Math.random()); SVt.amp[k] = svEnv(SVt.age[k] / SVt.life[k]); }
        else { SVt.life[k] = Infinity; SVt.age[k] = 0; SVt.amp[k] = 1; }
      } else { SVt.on[k] = 0; SVt.amp[k] = 0; }
    }
    svTrig();
  }
  const svLife = Torb => Torb * (2.6 - 1.8 * unsteady) * (0.6 + 0.8 * Math.random());
  const svEnv = a => sstep(0, 0.18, a) * (1 - sstep(0.7, 1, a));
  function svUpdate(dt) {
    for (let k = 0; k < NSV; k++) if (SVt.on[k]) SVt.th[k] += M.Om * dt;
    if (unsteady < 0.02) {
      let cnt = 0, fin = false;
      for (let k = 0; k < NSV; k++) if (SVt.on[k]) { cnt++; if (isFinite(SVt.life[k])) fin = true; }
      if (cnt !== M.n || fin) svRing(M.n, SVt.th[0] || -Math.PI / 2, false);
    } else {
      const Torb = TAU2 / M.Om;
      let healthy = 0;
      for (let k = 0; k < NSV; k++) {
        if (!SVt.on[k]) continue;
        if (!isFinite(SVt.life[k])) { SVt.life[k] = svLife(Torb); SVt.age[k] = SVt.life[k] * 0.3 * Math.random(); }
        SVt.age[k] += dt;
        const a = SVt.age[k] / SVt.life[k];
        SVt.amp[k] = svEnv(a);
        if (a >= 1) { SVt.on[k] = 0; SVt.amp[k] = 0; } else if (a < 0.7) healthy++;
      }
      svSpawnT -= dt;
      if (M.n > 0 && healthy < M.n && svSpawnT <= 0) {
        let free = -1; for (let k = 0; k < NSV; k++) if (!SVt.on[k]) { free = k; break; }
        if (free >= 0) {
          const angs = [];
          for (let k = 0; k < NSV; k++) if (SVt.on[k]) angs.push(((SVt.th[k] % TAU2) + TAU2) % TAU2);
          let th;
          if (!angs.length) th = Math.random() * TAU2;
          else {
            angs.sort((p, q) => p - q);
            let best = -1, at = 0;
            for (let i = 0; i < angs.length; i++) {
              const g = (i + 1 < angs.length ? angs[i + 1] : angs[0] + TAU2) - angs[i];
              if (g > best) { best = g; at = angs[i] + g / 2; }
            }
            th = at + (Math.random() - 0.5) * 0.35 * best;
          }
          SVt.on[free] = 1; SVt.th[free] = th; SVt.age[free] = 0; SVt.amp[free] = 0; SVt.life[free] = svLife(Torb);
          svSpawnT = Torb * 0.12;
        }
      }
    }
    svTrig();
  }

  const mt = [0, 0];
  function vel(rx, ry, z, out) {
    const r = Math.hypot(rx, ry) + 1e-6, vt = vtanZ(r, z);
    merid(r, z, mt);
    const c = rx / r, s = ry / r;
    let vx = mt[0] * c - vt * s, vy = mt[0] * s + vt * c, vz = mt[1];
    const na = svAct.length;
    if (na) {
      const zz = Math.max(z, 0), dec = Math.exp(-zz / M.Hs);
      if (dec > 0.02) {
        const ph = -M.tilt * zz / M.Hs, cp = Math.cos(ph), sp = Math.sin(ph);
        const vsb = M.vsPeak * dec, wf = 0.5 * (1 - Math.exp(-zz / M.hin)), irs = 1 / M.rs;
        for (let q0 = 0; q0 < na; q0++) {
          const k = svAct[q0], am = SVt.amp[k];
          const ca = SVc[k] * cp - SVs[k] * sp, sa = SVs[k] * cp + SVc[k] * sp;
          const dx = rx - M.ro * ca, dy = ry - M.ro * sa, d = Math.sqrt(dx * dx + dy * dy) + 1e-6, q = d * irs;
          const v = vsb * am * (1 - Math.exp(-B1 * q * q)) / (q * PB1);
          vx -= v * dy / d; vy += v * dx / d;
          if (q < 3) vz += wf * vsb * am * Math.exp(-q * q);
        }
      }
    }
    out[0] = vx; out[1] = vy; out[2] = vz;
  }
  function analyze() {
    const thr = 65 * MPH, vt = M.vt, o = [0, 0, 0];
    const save = { th: SVt.th.slice(), amp: SVt.amp.slice(), age: SVt.age.slice(), life: SVt.life.slice(), on: SVt.on.slice() };
    let r65p = 0;
    for (let i = NR; i >= 0; i--) if (vAt(M.rT[i], M.lvRc[0], M.lvTau[0]) + vt >= thr) { r65p = M.rT[i]; break; }
    const L0 = Math.max(1.3 * r65p, 2.5 * M.rc, M.n ? M.ro + 4 * M.rs : 0, 100);
    const NG = 110, phases = M.n ? 4 : 1;
    let ymin = Infinity, ymax = -Infinity, rmax = 0, peak = 0;
    for (let p = 0; p < phases; p++) {
      svRing(M.n, -Math.PI / 2 + (p / phases) * (TAU2 / Math.max(M.n, 1)), false);
      for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
        const x = -L0 + 2 * L0 * (i + 0.5) / NG, y = -L0 + 2 * L0 * (j + 0.5) / NG;
        vel(x, y, 2, o);
        const m = Math.hypot(o[0] + vt, o[1]);
        if (m > peak) peak = m;
        if (m >= thr) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; rmax = Math.max(rmax, Math.hypot(x, y)); }
      }
    }
    svRing(M.n, -Math.PI / 2, false);
    const Rm = Math.max(1.5 * M.rc, M.n ? M.ro + 2 * M.rs : 0);
    for (let ir = 1; ir <= 120; ir++) for (let it = 0; it < 90; it++) {
      const r = Rm * ir / 120, th = -Math.PI / 2 + (it / 90 - 0.5) * 1.6;
      vel(r * Math.cos(th), r * Math.sin(th), 2, o);
      peak = Math.max(peak, Math.hypot(o[0] + vt, o[1]));
    }
    for (const k in save) SVt[k].set(save[k]);
    svTrig();
    AN = { peak, pathW: ymax > ymin ? ymax - ymin : 0, r65: rmax, vg: M.vg, sw: M.sw };
  }
  const Lplan = () => Math.max(AN.r65 * 1.25, M.rc * 3, 120);

  /* ---------- unsteady swirl ---------- */
  const FL = { t: 0, ou: 0, s: 0, nextDerive: 0, ph: [0, 1.3, 2.1] };
  function swirlNow(dt) {
    const Tr = TAU2 * M.rc / M.V;
    FL.t += dt;
    const tauOU = 1.5 * Tr;
    FL.ou += -FL.ou / tauOU * dt + 0.6 * Math.sqrt(2 * dt / tauOU) * gauss();
    const per = [2, 3.3, 5.4];
    const F = 0.6 * (0.5 * Math.sin(TAU2 * FL.t / (per[0] * Tr) + FL.ph[0]) + 0.3 * Math.sin(TAU2 * FL.t / (per[1] * Tr) + FL.ph[1]) + 0.2 * Math.sin(TAU2 * FL.t / (per[2] * Tr) + FL.ph[2])) + 0.4 * FL.ou;
    return clamp(S.sw * Math.exp(0.45 * unsteady * F), 0.05, 3.5);
  }
  function wobble(dt) {
    const Aw = unsteady * M.rc * (0.45 - 0.25 * Math.min(S.sw, 1)), tau = 2 * TAU2 * M.rc / M.V;
    WB.phi += 0.2 * M.V / M.rc * dt;
    WB.n1 += -WB.n1 / tau * dt + Math.sqrt(2 * dt / tau) * gauss();
    WB.n2 += -WB.n2 / tau * dt + Math.sqrt(2 * dt / tau) * gauss();
    WB.x = Aw * (0.7 * Math.cos(WB.phi) + 0.35 * WB.n1);
    WB.y = Aw * (0.7 * Math.sin(WB.phi) + 0.35 * WB.n2);
  }

  /* ---------- canvases ---------- */
  const DPR = () => Math.min(window.devicePixelRatio || 1, 2);
  function fit(c) {
    const d = DPR(), w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
    const ctx = c.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); return { ctx, w, h };
  }
  const side = $('side'), plan = $('plan'), prof = $('prof'), sec = $('sec'), hist = $('hist');
  const heatC = document.createElement('canvas'), secC = document.createElement('canvas');
  let VW = {};
  function computeView() {
    const { w, h } = fit(side);
    const Hg = h * 0.83, X0 = w * 0.40;
    const s1 = Hg / (1.32 * M.zc);
    const rg = rfAt(0.25 * M.zc);
    const wNeed = Math.max(2.4 * M.rc, (rg > 0 && isFinite(rg)) ? 1.25 * rg : 0, S.sw >= S_MV ? 1.6 * (M.ro + M.rs) : 0, 90);
    const s = Math.min(s1, (w * 0.40) / wNeed);
    VW = { w, h, Hg, X0, s, Rdom: w * 0.62 / s };
    const ftPerPx = 1 / (s * FT), opts = [50, 100, 200, 250, 500, 1000, 2000, 5000];
    let pick = opts[0]; for (const o of opts) if (o / ftPerPx <= 130) pick = o;
    VW.bar = { ft: pick, px: pick / ftPerPx };
  }

  /* ---------- particles ---------- */
  const NT = 2600, ND = 2600, NS = 340, NC = 190, NP = 750;
  const T = { x: new Float32Array(NT), y: new Float32Array(NT), z: new Float32Array(NT), vx: new Float32Array(NT), vy: new Float32Array(NT), vz: new Float32Array(NT), age: new Float32Array(NT), life: new Float32Array(NT) };
  const D = { x: new Float32Array(ND), y: new Float32Array(ND), z: new Float32Array(ND), vx: new Float32Array(ND), vy: new Float32Array(ND), vz: new Float32Array(ND), tau: new Float32Array(ND), big: new Uint8Array(ND), life: new Float32Array(ND), on: new Uint8Array(ND) };
  const SF = { z: new Float32Array(NS), th: new Float32Array(NS), dark: new Uint8Array(NS) };
  const CB = { r: new Float32Array(NC), th: new Float32Array(NC), shade: new Float32Array(NC), sz: new Float32Array(NC) };
  const PP = { x: new Float32Array(NP), y: new Float32Array(NP), age: new Float32Array(NP), vx: new Float32Array(NP), vy: new Float32Array(NP) };
  let scroll = 0, simT = 0, curPeak = 0, maxSoFar = 0;
  const tmp = [0, 0, 0];
  function spawnT(i, anywhere) {
    const r = Math.random() < 0.55 ? M.rc * (0.15 + Math.random() * 3.5) : VW.Rdom * Math.sqrt(Math.random());
    const th = Math.random() * TAU2;
    const z = anywhere ? M.zc * Math.pow(Math.random(), 1.3) : (Math.random() < 0.7 ? M.hin * Math.random() : M.zc * Math.random());
    T.x[i] = axX(z) + r * Math.cos(th); T.y[i] = axY(z) + r * Math.sin(th); T.z[i] = z;
    T.age[i] = 0; T.life[i] = 12 + Math.random() * 30;
  }
  function spawnS(i) { SF.z[i] = Math.random(); SF.th[i] = Math.random() * TAU2; SF.dark[i] = Math.random() < 0.5 ? 1 : 0; }
  function spawnC(i) {
    const wc = Math.max(4 * M.rc, 180);
    CB.r[i] = M.rc * 0.6 + Math.random() * (wc - M.rc * 0.6); CB.th[i] = Math.random() * TAU2;
    CB.shade[i] = Math.random(); CB.sz[i] = 0.6 + Math.random() * 0.9;
  }
  function spawnP(i, edge) {
    const L = Lplan();
    if (edge) { const a = Math.random() * TAU2, r = L * (1.05 + Math.random() * 0.35); PP.x[i] = r * Math.cos(a); PP.y[i] = r * Math.sin(a); }
    else { PP.x[i] = (Math.random() * 2 - 1) * L; PP.y[i] = (Math.random() * 2 - 1) * L; }
    PP.age[i] = Math.random() * 4;
  }
  function resetParticles() {
    for (let i = 0; i < NT; i++) spawnT(i, true);
    D.on.fill(0);
    for (let i = 0; i < NS; i++) spawnS(i);
    for (let i = 0; i < NC; i++) spawnC(i);
    for (let i = 0; i < NP; i++) spawnP(i, false);
    PF.on.fill(0); SC.on.fill(0);
    LT.start = -1; LT.next = simT + 3 + Math.random() * 5;
  }
  let dNext = 0;
  function spawnDebris(dt) {
    if (!showDebris) return;
    const tries = Math.round(150 * dt + Math.random());
    const Rsp = Math.max(3 * M.rc, svAct.length ? M.ro + 3 * M.rs : 0);
    for (let k = 0; k < tries; k++) {
      const r = Rsp * Math.sqrt(0.01 + 0.99 * Math.random()), th = Math.random() * TAU2;
      const x = r * Math.cos(th), y = r * Math.sin(th);
      vel(x, y, 2, tmp);
      const mag = Math.hypot(tmp[0] + M.vt, tmp[1]);
      if (Math.random() > clamp((mag - 38) / 30, 0, 1)) continue;
      let i = -1;
      for (let n = 0; n < ND; n++) { const j = (dNext + n) % ND; if (!D.on[j]) { i = j; break; } }
      if (i < 0) return; dNext = i + 1;
      const big = true, vterm = big ? 10 + Math.random() * 16 : 1.5 + Math.random() * 5;
      D.on[i] = 1; D.big[i] = big ? 1 : 0; D.tau[i] = vterm / G; D.life[i] = 0;
      D.x[i] = axX(0.5) + x; D.y[i] = axY(0.5) + y; D.z[i] = 0.5;
      D.vx[i] = tmp[0] * 0.3; D.vy[i] = tmp[1] * 0.3; D.vz[i] = 4 + Math.random() * (big ? 8 : 14);
    }
  }

  /* ---------- damage swath (ground-fixed grid) ---------- */
  const NYs = 160, NXs = 480, SWG = new Float32Array(NXs * NYs);
  let swX0 = 0, swDx = 1;
  function resetSwath() { SWG.fill(0); swDx = 2 * Lplan() / NYs; swX0 = scroll - Lplan() * 1.6; }
  function accumSwath() {
    const L = Lplan(), Lu = Math.min(L, Math.max(AN.r65 * 1.08, M.rc * 2.2)), xg = scroll, o = tmp;
    if (xg + Lu - swX0 > NXs * swDx) {
      const cs = Math.ceil((xg + Lu - swX0) / swDx) - NXs + 40;
      if (cs >= NXs) resetSwath();
      else { SWG.copyWithin(0, cs * NYs); SWG.fill(0, (NXs - cs) * NYs); swX0 += cs * swDx; }
    }
    const i0 = Math.max(0, Math.floor((xg - Lu - swX0) / swDx)), i1 = Math.min(NXs - 1, Math.ceil((xg + Lu - swX0) / swDx));
    const j0 = Math.max(0, Math.floor((L - Lu) / swDx)), j1 = Math.min(NYs - 1, Math.ceil((L + Lu) / swDx));
    const ox = WB.x * wz(2), oy = WB.y * wz(2);
    let pk = 0;
    for (let i = i0; i <= i1; i++) {
      const x = swX0 + (i + 0.5) * swDx - xg;
      for (let j = j0; j <= j1; j++) {
        const y = L - (j + 0.5) * swDx;
        if (x * x + y * y > Lu * Lu) continue;
        vel(x - ox, y - oy, 2, o);
        const m = Math.hypot(o[0] + M.vt, o[1]), k = i * NYs + j;
        if (m > SWG[k]) SWG[k] = m;
        if (m > pk) pk = m;
      }
    }
    curPeak = pk;
    maxSoFar = Math.max(maxSoFar, pk);
  }

  /* ---------- history ---------- */
  const HN_ = 240, HDT = 0.25;
  const HS = { s: new Float32Array(HN_), pk: new Float32Array(HN_), zb: new Float32Array(HN_), n: 0, next: 0 };
  function pushHist() {
    if (HS.n === HN_) { HS.s.copyWithin(0, 1); HS.pk.copyWithin(0, 1); HS.zb.copyWithin(0, 1); HS.n--; }
    HS.s[HS.n] = M.sw; HS.pk[HS.n] = curPeak / MPH;
    HS.zb[HS.n] = M.zb === Infinity ? -1 : M.zb / M.zc;
    HS.n++;
  }

  function step(dt) {
    if (unsteady > 0) {
      const sNow = swirlNow(dt);
      FL.nextDerive -= dt;
      if (FL.nextDerive <= 0 && Math.abs(sNow - M.sw) > 0.002) { derive(sNow); FL.nextDerive = 0.12; }
      wobble(dt);
    } else if (M.sw !== S.sw) { derive(S.sw); WB.x = WB.y = 0; }
    else { WB.x = WB.y = 0; }
    svUpdate(dt);
    const fast = M.V * M.I + M.Wbar + M.vsPeak, small = Math.min(M.rc / M.I, svAct.length ? M.rs * 2 : Infinity);
    const n = clamp(Math.ceil(dt * fast / (0.15 * small)), 1, 8), h = dt / n;
    scroll += M.vt * dt; simT += dt;
    for (let sub = 0; sub < n; sub++) {
      for (let i = 0; i < NT; i++) {
        const z = T.z[i], a = axX(z), b = axY(z);
        vel(T.x[i] - a, T.y[i] - b, z, tmp);
        T.vx[i] = tmp[0]; T.vy[i] = tmp[1]; T.vz[i] = tmp[2];
        T.x[i] += tmp[0] * h; T.y[i] += tmp[1] * h; T.z[i] = Math.max(0, z + tmp[2] * h);
        T.age[i] += h;
        const r = Math.hypot(T.x[i] - a, T.y[i] - b);
        if (T.z[i] >= M.zc || r > VW.Rdom * 1.3 || T.age[i] > T.life[i]) spawnT(i, false);
      }
      for (let i = 0; i < ND; i++) {
        if (!D.on[i]) continue;
        const z = D.z[i], a = axX(z), b = axY(z);
        vel(D.x[i] - a, D.y[i] - b, z, tmp);
        const it = 1 / D.tau[i];
        D.vx[i] += (tmp[0] - D.vx[i]) * it * h;
        D.vy[i] += (tmp[1] - D.vy[i]) * it * h;
        D.vz[i] += ((tmp[2] - D.vz[i]) * it - G) * h;
        D.x[i] += D.vx[i] * h; D.y[i] += D.vy[i] * h; D.z[i] += D.vz[i] * h; D.life[i] += h;
        const r = Math.hypot(D.x[i] - a, D.y[i] - b);
        if (D.z[i] < 0 || D.z[i] > M.zc * 0.95 || r > VW.Rdom * 1.4 || D.life[i] > 30) D.on[i] = 0;
      }
    }
    spawnDebris(dt);
    for (let j = 0; j < NZ; j++) {
      const z = M.zc * j / (NZ - 1), rf = M.rfL[j], r = (rf > 0 && isFinite(rf)) ? Math.min(rf, 3 * M.rc) : M.rc;
      PH[j] += 0.85 * vtanZ(r, z) / r * dt;
    }
    // couple neighbouring levels so differential rotation shears the texture smoothly instead of slicing it
    for (let it = 0; it < 3; it++) for (let j = 1; j < NZ - 1; j++) PH[j] += 0.3 * (0.5 * (PH[j - 1] + PH[j + 1]) - PH[j]);
    // cap the accumulated twist so the texture spirals gently instead of shearing into horizontal streaks
    const jm = NZ >> 1;
    for (let j = jm + 1; j < NZ; j++) PH[j] = PH[j - 1] + clamp(PH[j] - PH[j - 1], -0.03, 0.03);
    for (let j = jm - 1; j >= 0; j--) PH[j] = PH[j + 1] + clamp(PH[j] - PH[j + 1], -0.03, 0.03);
    if (Math.abs(PH[0]) > TAU2 * 4096) { const o = PH[0] - (PH[0] % (TAU2 * 64)); for (let j = 0; j < NZ; j++) PH[j] -= o; }
    FS.vs = (FS.vs - 0.25 * M.Wbar * dt / Math.max(0.6, M.zc / 220)) % 256;
    FS.vt = (FS.vt - 0.2 * M.Wbar * dt / Math.max(1, 0.9 * M.rc / 16)) % 256;
    spawnPuffs(dt); stepPuffs(dt); stepScud(dt);
    if (LT.start < 0 && simT > LT.next) { const P = PRECIP[precip]; LT.start = simT; LT.u = Math.random(); LT.pts = buildBolt(); LT.next = simT + P.ltg[0] + Math.random() * (P.ltg[1] - P.ltg[0]); }
    for (let i = 0; i < NC; i++) CB.th[i] += 0.5 * vtanZ(CB.r[i], M.zc) / CB.r[i] * dt;
    const L = Lplan(), ox = WB.x * wz(4), oy = WB.y * wz(4);
    for (let i = 0; i < NP; i++) {
      vel(PP.x[i] - ox, PP.y[i] - oy, 4, tmp);
      PP.vx[i] = tmp[0]; PP.vy[i] = tmp[1];
      const mag = Math.hypot(tmp[0], tmp[1]) * dt, lim = 0.6 * Math.min(M.rc / M.I, svAct.length ? M.rs : Infinity);
      const k = mag > lim ? lim / mag : 1;
      PP.x[i] += tmp[0] * dt * k; PP.y[i] += tmp[1] * dt * k;
      PP.age[i] += dt;
      const r = Math.hypot(PP.x[i] - ox, PP.y[i] - oy);
      if (r < 0.2 * M.rc || r > L * 1.5 || PP.age[i] > 18) spawnP(i, true);
    }
    accumSwath();
    HS.next -= dt;
    if (HS.next <= 0) { pushHist(); HS.next += HDT; histDirty = true; }
  }

  /* ---------- side view ---------- */
  const trees = [];
  (function () { let x = 0; while (x < 700) { const w = 6 + Math.random() * 22; trees.push([x, w, 4 + Math.random() * 9]); x += w * (0.5 + Math.random() * 0.9); } })();
  function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function tileNoise(N, lx, ly, oct, seed) {
    const rnd = mulberry(seed), out = new Float32Array(N * N); let amp = 1, tot = 0;
    for (let o = 0; o < oct; o++) {
      const gx = lx << o, gy = ly << o, g = new Float32Array(gx * gy);
      for (let i = 0; i < g.length; i++) g[i] = rnd();
      for (let y = 0; y < N; y++) {
        const fy = y / N * gy, j0 = Math.floor(fy), ty = fy - j0, wy = ty * ty * (3 - 2 * ty), j1 = (j0 + 1) % gy;
        for (let x = 0; x < N; x++) {
          const fx = x / N * gx, i0 = Math.floor(fx), tx = fx - i0, wx = tx * tx * (3 - 2 * tx), i1 = (i0 + 1) % gx;
          const a = g[j0 * gx + i0], b = g[j0 * gx + i1], c = g[j1 * gx + i0], d = g[j1 * gx + i1];
          out[y * N + x] += amp * ((a + (b - a) * wx) * (1 - wy) + (c + (d - c) * wx) * wy);
        }
      }
      tot += amp; amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= tot;
    return out;
  }
  const TEX_S = tileNoise(256, 6, 48, 3, 11), TEX_T = tileNoise(256, 10, 10, 4, 23);
  function makePuff(rgb, seed) {
    const N = 64, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d'), img = x.createImageData(N, N), nt = tileNoise(N, 4, 4, 3, seed);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const dx = (i + 0.5) / N * 2 - 1, dy = (j + 0.5) / N * 2 - 1, d = Math.hypot(dx, dy);
      if (d >= 1) continue;
      const n = nt[j * N + i];
      const a = Math.pow(1 - d * d, 1.5) * clamp(0.85 + 1.8 * (n - 0.5) - 0.45 * d, 0, 1);
      const lit = 1 + 0.28 * (-dx * 0.55 - dy * 0.8) + 0.25 * (n - 0.5);
      const p = (j * N + i) * 4;
      img.data[p] = clamp(rgb[0] * lit, 0, 255); img.data[p + 1] = clamp(rgb[1] * lit, 0, 255); img.data[p + 2] = clamp(rgb[2] * lit, 0, 255);
      img.data[p + 3] = a * 255;
    }
    x.putImageData(img, 0, 0); return c;
  }
  const PUFF = {
    dust: [makePuff([158, 130, 100], 3), makePuff([168, 142, 112], 4), makePuff([146, 120, 92], 5)],
    dark: [makePuff([96, 82, 68], 6), makePuff([108, 92, 74], 7)],
    scud: [makePuff([100, 108, 112], 8), makePuff([112, 120, 124], 9), makePuff([92, 100, 104], 10)],
    base: [makePuff([56, 63, 67], 12), makePuff([64, 71, 75], 13), makePuff([50, 57, 61], 14)],
    wall: [makePuff([70, 78, 82], 15), makePuff([80, 88, 92], 16), makePuff([62, 70, 74], 17)]
  };
  const RAIN = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const x = c.getContext('2d'), r = mulberry(5); x.lineCap = 'round';
    for (let i = 0; i < 240; i++) {
      const px = r() * 128, py = r() * 256, L = 10 + r() * 28;
      x.strokeStyle = `rgba(214,222,230,${(0.05 + r() * 0.18).toFixed(3)})`; x.lineWidth = 0.6 + r() * 0.7;
      for (const oy of [-256, 0]) { x.beginPath(); x.moveTo(px, py + oy); x.lineTo(px - L * 0.1, py + oy + L); x.stroke(); }
    }
    return c;
  })();
  let rainPat = null;
  const PRECIP = {
    lp:      { sky: ['#4a555b', '#7a8786', '#b9c2b5'], core: 0.26, hail: 0.08, rfd: 0, wrap: 0, slot: 1, ltg: [18, 40] },
    classic: { sky: ['#2f373b', '#55605e', '#9da896'], core: 0.6, hail: 0.18, rfd: 0.32, wrap: 0, slot: 1, ltg: [7, 18] },
    hp:      { sky: ['#23292c', '#3e4745', '#717c73'], core: 0.82, hail: 0.22, rfd: 0.62, wrap: 0.5, slot: 0, ltg: [4, 11] }
  };

  // funnel texture state, rotation phase per height level, texture scroll
  const PH = new Float64Array(NZ);
  const FS = { vs: 0, vt: 0 };
  const FC = document.createElement('canvas'); let fctx = null, FImg = null;
  function sizeFunnelCanvas() {
    const w2 = Math.ceil(VW.w / 2), h2 = Math.ceil(VW.h / 2);
    if (FC.width !== w2 || FC.height !== h2 || !FImg) { FC.width = w2; FC.height = h2; fctx = FC.getContext('2d'); FImg = fctx.createImageData(w2, h2); }
  }
  const wallW = () => Math.max(4 * M.rc, 180);
  function slotLift(x) {
    const P = PRECIP[precip]; if (!P.slot) return 0;
    const wc = wallW(), d = (axX(M.zc) - x) / wc;
    return d > 1.05 && d < 3.4 ? 0.1 * M.zc * Math.sin(Math.PI * (d - 1.05) / 2.35) : 0;
  }
  function zBase(x) {
    const wc = wallW(), d = Math.abs(x - axX(M.zc)) / wc;
    return M.zc - (d < 1 ? 0.11 * M.zc * 0.5 * (1 + Math.cos(Math.PI * d)) : 0) + slotLift(x);
  }

  function drawFunnelTex(ctx) {
    const { Hg, X0, s, w, h } = VW, zc = M.zc;
    // full resolution unless the funnel is very large on screen
    const big = rfAt(0.5 * zc) * s > 220, SC_ = big ? 2 : 1;
    const W2 = Math.ceil(w / SC_), H2 = Math.ceil(h / SC_);
    if (FC.width !== W2 || FC.height !== H2 || !FImg || FImg.width !== W2) { FC.width = W2; FC.height = H2; fctx = FC.getContext('2d'); FImg = fctx.createImageData(W2, H2); }
    const d = FImg.data; d.fill(0);
    const LvT = Math.max(1, 0.9 * M.rc / 16);
    const dustOn = clamp((AN.peak / MPH - 85) / 40, 0, 1), dH = (0.08 + 0.2 * dustOn) * zc, touch = M.zBot < 1;
    const OPT = 9, cap = VW.Rdom * 1.3, wcap = 0.42 * wallW(), zbA = zBase(axX(zc));
    const squash = r => r < wcap ? r : wcap + (r - wcap) * 0.12;
    const yTop = Math.max(0, Math.floor((Hg - zc * 1.02 * s) / SC_)), yBot = Math.min(H2 - 1, Math.ceil(Hg / SC_));
    let bx0 = W2, bx1 = -1, by0 = H2, by1 = -1;
    // texture azimuth: features move left to right across the near side (counterclockwise seen from above)
    const uOf = phi => Math.floor(phi / TAU2 * 256) & 255;
    for (let hy = yTop; hy <= yBot; hy++) {
      const z = (Hg - (hy + 0.5) * SC_) / s; if (z < 0 || z > zc * 1.02) continue;
      const rf0 = rfAt(z); if (!(rf0 > 0)) continue;
      const tau = M.zb === Infinity ? 0 : tauOf(z);
      const fj = clamp(z / zc, 0, 1) * (NZ - 1), j0 = Math.min(NZ - 2, Math.floor(fj)), ph = -(PH[j0] + (PH[j0 + 1] - PH[j0]) * (fj - j0));
      const fT = z / LvT + FS.vt, iT = Math.floor(fT), tT = fT - iT, vT = (iT & 255) * 256, vT1 = ((iT + 1) & 255) * 256;
      const fE = z / (LvT * 3) + FS.vt / 3, iE = Math.floor(fE), tE = fE - iE, vE = (iE & 255) * 256, vE1 = ((iE + 1) & 255) * 256;
      const uLl = uOf(ph - 1.5708), uRr = uOf(ph + 1.5708);
      const nL = TEX_T[vE + uLl] * (1 - tE) + TEX_T[vE1 + uLl] * tE, nR = TEX_T[vE + uRr] * (1 - tE) + TEX_T[vE1 + uRr] * tE;
      const rs0 = squash(rf0), eAbs = (0.03 + 0.1 * tau) * Math.min(rs0, 1.2 * M.rc) * 2;
      const rL = Math.min(rs0 + eAbs * (nL - 0.5), cap) * s / SC_, rR = Math.min(rs0 + eAbs * (nR - 0.5), cap) * s / SC_;
      if (rL < 0.4 && rR < 0.4) continue;
      const cx = (X0 + (axX(z) + tau * 0.04 * rf0 * Math.sin(z / M.rc * 1.3 - simT * 1.1)) * s) / SC_;
      const thick = 2 * rf0 / OPT;
      const df = touch ? dustOn * (1 - sstep(0, dH, z)) : 0, tb = 0.8 * sstep(0.7 * zbA, zbA, z);
      const cr = (210 * (1 - df) + 150 * df) * (1 - tb) + 82 * tb, cg = (214 * (1 - df) + 124 * df) * (1 - tb) + 90 * tb, cb = (217 * (1 - df) + 96 * df) * (1 - tb) + 94 * tb;
      const wideK = clamp(1.5 * M.rc / rf0, 0.4, 1), aT = (0.05 + 0.12 * tau) * wideK;
      const x0 = Math.max(0, Math.floor(cx - rL)), x1 = Math.min(W2 - 1, Math.ceil(cx + rR));
      if (x0 < bx0) bx0 = x0; if (x1 > bx1) bx1 = x1; if (hy < by0) by0 = hy; if (hy > by1) by1 = hy;
      const row = hy * W2;
      for (let hx = x0; hx <= x1; hx++) {
        const dx = hx + 0.5 - cx, R = dx < 0 ? rL : rR, u = dx / R;
        if (u <= -1 || u >= 1) continue;
        const nz = Math.sqrt(1 - u * u), ui = uOf(Math.asin(u) + ph);
        const tt = TEX_T[vT + ui] * (1 - tT) + TEX_T[vT1 + ui] * tT;
        const lum = (0.42 + 0.53 * Math.max(0, -0.55 * u + 0.83 * nz)) * (1 + aT * (tt - 0.5) * 2);
        const a = (1 - Math.exp(-thick * nz)) * sstep(0, 0.45, nz) * (1 - tau * 0.25 * Math.max(0, 0.5 - tt) * 2);
        if (a < 0.01) continue;
        const p = (row + hx) * 4;
        d[p] = clamp(cr * lum, 0, 255); d[p + 1] = clamp(cg * lum, 0, 255); d[p + 2] = clamp(cb * lum, 0, 255); d[p + 3] = clamp(a, 0, 1) * 255;
      }
    }
    if (bx1 < bx0) return;
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    fctx.putImageData(FImg, 0, 0, bx0, by0, bw, bh);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(FC, bx0, by0, bw, bh, bx0 * SC_, by0 * SC_, bw * SC_, bh * SC_);
  }
  const STOPS = [0, .12, .3, .5, .7, .88, 1];
  function tubeRow(ctx, cx, py, rr, hgt, dust, alphaK) {
    const g = ctx.createLinearGradient(cx - rr, 0, cx + rr, 0);
    for (const k of STOPS) {
      const u = 2 * k - 1, nz = Math.sqrt(Math.max(0, 1 - u * u));
      const lum = 0.4 + 0.5 * Math.max(0, -0.55 * u + 0.83 * nz);
      const a = (0.25 + 0.65 * Math.pow(nz, 0.55)) * clamp(rr / 3, 0.4, 1) * alphaK;
      const R = (210 * (1 - dust) + 150 * dust) * lum, Gc = (214 * (1 - dust) + 124 * dust) * lum, B = (217 * (1 - dust) + 96 * dust) * lum;
      g.addColorStop(k, `rgba(${R | 0},${Gc | 0},${B | 0},${a.toFixed(3)})`);
    }
    ctx.fillStyle = g; ctx.fillRect(cx - rr, py, 2 * rr, hgt);
  }
  function drawTubes(ctx, front) {
    if (!svAct.length) return;
    const { Hg, X0, s } = VW, zc = M.zc;
    const dustOn = clamp((AN.peak / MPH - 85) / 40, 0, 1);
    for (let q0 = 0; q0 < svAct.length; q0++) {
      const k = svAct[q0], amp = SVt.amp[k], top = tubeTopAt(amp);
      if (top <= 0) continue;
      for (let py = Hg; py >= Hg - zc * s; py -= 2) {
        const z = (Hg - py) / s; if (z >= top) break;
        const rt = tubeAt(z, amp); if (!(rt > 0)) continue;
        const a = SVt.th[k] - M.tilt * z / M.Hs;
        if ((Math.sin(a) < 0) !== front) continue;
        const rr = rt * s; if (rr < 0.4) continue;
        const cx = X0 + (axX(z) + M.ro * Math.cos(a)) * s;
        const dust = clamp(1 - z / (0.14 * zc), 0, 1) * dustOn;
        const fade = clamp((top - z) / (0.35 * top), 0, 1);
        tubeRow(ctx, cx, py - 2, rr, 2.4, dust, (front ? 0.95 : 0.7) * Math.sqrt(fade));
      }
    }
  }

  /* ---------- debris cloud puffs ---------- */
  const NPF = 700;
  const PF = { x: new Float32Array(NPF), y: new Float32Array(NPF), z: new Float32Array(NPF), vx: new Float32Array(NPF), vy: new Float32Array(NPF), vz: new Float32Array(NPF), sz: new Float32Array(NPF), sz0: new Float32Array(NPF), age: new Float32Array(NPF), life: new Float32Array(NPF), kind: new Uint8Array(NPF), spr: new Uint8Array(NPF), on: new Uint8Array(NPF) };
  let pfNext = 0;
  function spawnPuffs(dt) {
    if (!showDebris) return;
    const Rsp = Math.max(2.5 * M.rc, svAct.length ? M.ro + 3 * M.rs : 0);
    const tries = Math.round(1100 * dt + Math.random());
    for (let k = 0; k < tries && pfCount < 480; k++) {
      const r = Rsp * Math.sqrt(Math.random()), th = Math.random() * TAU2, x = r * Math.cos(th), y = r * Math.sin(th);
      vel(x, y, 2, tmp);
      const mph = Math.hypot(tmp[0] + M.vt, tmp[1]) / MPH, p = clamp((mph - 70) / 70, 0, 1);
      if (Math.random() > p) continue;
      let i = -1;
      for (let n = 0; n < NPF; n++) { const j = (pfNext + n) % NPF; if (!PF.on[j]) { i = j; break; } }
      if (i < 0) return; pfNext = i + 1;
      PF.on[i] = 1; PF.x[i] = axX(1) + x; PF.y[i] = axY(1) + y; PF.z[i] = 1 + Math.random() * 4;
      PF.vx[i] = tmp[0] * 0.5; PF.vy[i] = tmp[1] * 0.5; PF.vz[i] = 2 + Math.random() * 6;
      PF.sz0[i] = PF.sz[i] = Math.max(3, (0.09 + 0.12 * Math.random()) * M.rc);
      PF.age[i] = 0; PF.life[i] = 3 + Math.random() * 5; pfCount++;
      PF.kind[i] = Math.random() < 0.2 + 0.35 * p ? 1 : 0; PF.spr[i] = (Math.random() * 3) | 0;
    }
  }
  let pfCount = 0;
  function stepPuffs(dt) {
    const k = 1.6, cap = 0.3 * M.rc; pfCount = 0;
    for (let i = 0; i < NPF; i++) {
      if (!PF.on[i]) continue;
      const z = PF.z[i], a = axX(z), b = axY(z);
      vel(PF.x[i] - a, PF.y[i] - b, z, tmp);
      PF.vx[i] += (tmp[0] * 0.85 - PF.vx[i]) * k * dt;
      PF.vy[i] += (tmp[1] * 0.85 - PF.vy[i]) * k * dt;
      PF.vz[i] += (tmp[2] * 0.9 - 0.8 - PF.vz[i]) * k * dt;
      let dx = PF.vx[i] * dt, dy = PF.vy[i] * dt, dz = PF.vz[i] * dt;
      const L = Math.hypot(dx, dy, dz); if (L > cap) { const f = cap / L; dx *= f; dy *= f; dz *= f; }
      PF.x[i] += dx; PF.y[i] += dy; PF.z[i] = Math.max(0.5, z + dz);
      PF.sz[i] += PF.sz0[i] * 0.55 * dt; PF.age[i] += dt;
      if (PF.age[i] > PF.life[i]) PF.on[i] = 0; else pfCount++;
    }
  }
  const PCb = document.createElement('canvas'), PCf = document.createElement('canvas');
  function drawPuffs(ctx0, front) {
    if (!showDebris) return;
    const c = front ? PCf : PCb, w2 = Math.ceil(VW.w / 2), h2 = Math.ceil(VW.h / 2);
    if (c.width !== w2 || c.height !== h2) { c.width = w2; c.height = h2; }
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, w2, h2);
    const X0 = VW.X0 / 2, Hg = VW.Hg / 2, s = VW.s / 2, zc = M.zc, dustOn = clamp((AN.peak / MPH - 85) / 40, 0, 1);
    const h0 = (0.15 + 0.2 * dustOn) * zc, h1 = (0.35 + 0.25 * dustOn) * zc;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (let i = 0; i < NPF; i++) {
      if (!PF.on[i]) continue;
      const z = PF.z[i];
      if (((PF.y[i] - axY(z)) < 0) !== front) continue;
      const a = PF.age[i] / PF.life[i];
      const al = (PF.kind[i] ? 0.42 : 0.3) * sstep(0, 0.12, a) * (1 - sstep(0.55, 1, a)) * (1 - sstep(h0, h1, z));
      if (al < 0.01) continue;
      const dpx = clamp(PF.sz[i] * 2 * s, 2, 70), spr = PF.kind[i] ? PUFF.dark[PF.spr[i] % 2] : PUFF.dust[PF.spr[i]];
      const px = X0 + PF.x[i] * s - dpx / 2, py = Hg - z * s - dpx / 2;
      ctx.globalAlpha = al;
      ctx.drawImage(spr, px, py, dpx, dpx);
      if (px < bx0) bx0 = px; if (px + dpx > bx1) bx1 = px + dpx; if (py < by0) by0 = py; if (py + dpx > by1) by1 = py + dpx;
    }
    ctx.globalAlpha = 1;
    bx0 = Math.max(0, Math.floor(bx0)); by0 = Math.max(0, Math.floor(by0)); bx1 = Math.min(w2, Math.ceil(bx1)); by1 = Math.min(h2, Math.ceil(by1));
    if (bx1 <= bx0 || by1 <= by0) return;
    ctx0.imageSmoothingEnabled = true;
    ctx0.drawImage(c, bx0, by0, bx1 - bx0, by1 - by0, bx0 * 2, by0 * 2, (bx1 - bx0) * 2, (by1 - by0) * 2);
  }

  /* ---------- inflow scud and cloud base ---------- */
  const NSC = 30;
  const SC = { x: new Float32Array(NSC), y: new Float32Array(NSC), z: new Float32Array(NSC), sz: new Float32Array(NSC), age: new Float32Array(NSC), life: new Float32Array(NSC), spr: new Uint8Array(NSC), on: new Uint8Array(NSC) };
  function stepScud(dt) {
    const wc = wallW(), xR = (VW.w - VW.X0) / VW.s;
    for (let i = 0; i < NSC; i++) {
      if (!SC.on[i]) {
        if (Math.random() > 0.35 * dt * 4) continue;
        SC.on[i] = 1; SC.x[i] = axX(M.zc) + Math.max(1.3 * wc, xR * (0.55 + 0.6 * Math.random()));
        SC.y[i] = (Math.random() - 0.5) * 2.5 * wc; SC.z[i] = M.zc * (0.8 + 0.12 * Math.random());
        SC.sz[i] = Math.max(8, wc * (0.04 + 0.06 * Math.random())); SC.age[i] = 0; SC.life[i] = 18 + 22 * Math.random();
        SC.spr[i] = (Math.random() * 3) | 0;
        continue;
      }
      const dx = SC.x[i] - axX(SC.z[i]), dy = SC.y[i] - axY(SC.z[i]), r = Math.hypot(dx, dy) + 1;
      const U = 6 + 0.12 * M.V, tg = 0.5 * vtanZ(Math.max(r, M.rc), M.zc);
      SC.x[i] += (-U * dx / r - tg * dy / r) * dt; SC.y[i] += (-U * dy / r + tg * dx / r) * dt;
      SC.z[i] += (0.6 + 2.5 * Math.exp(-r / wc)) * dt; SC.age[i] += dt;
      if (SC.z[i] > zBase(SC.x[i]) || r < 0.35 * wc || SC.age[i] > SC.life[i]) SC.on[i] = 0;
    }
  }
  function drawScud(ctx) {
    const { X0, Hg, s } = VW;
    for (let i = 0; i < NSC; i++) {
      if (!SC.on[i]) continue;
      const zb = zBase(SC.x[i]), al = 0.5 * sstep(0, 2.5, SC.age[i]) * (1 - sstep(zb - 0.07 * M.zc, zb, SC.z[i])) * (1 - sstep(0.8, 1, SC.age[i] / SC.life[i]));
      if (al < 0.01) continue;
      const wpx = SC.sz[i] * s * 2.8, hpx = wpx * 0.3;
      ctx.globalAlpha = al;
      ctx.drawImage(PUFF.scud[SC.spr[i]], X0 + SC.x[i] * s - wpx / 2, Hg - SC.z[i] * s - hpx / 2, wpx, hpx);
    }
    ctx.globalAlpha = 1;
  }
  const BS = (() => { const r = mulberry(31), a = []; for (let i = 0; i < 54; i++) a.push({ f: -0.08 + 1.16 * r(), sz: 60 + 120 * r(), v: (r() * 3) | 0, al: 0.35 + 0.35 * r() }); return a; })();

  /* ---------- rain curtains and lightning ---------- */
  function curtain(ctx, xa, xb, yBot, rgb, a, slant, phase) {
    if (xb < -60 || xa > VW.w + 60 || a <= 0.005 || xb <= xa) return;
    const { X0, s } = VW, steps = 28;
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) { const x = xa + (xb - xa) * i / steps, y = Hgy(x) - 4; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    for (let i = steps; i >= 0; i--) { const x = xa + (xb - xa) * i / steps + slant; ctx.lineTo(x, yBot - 10 * (0.5 + 0.5 * Math.sin(i * 1.9 + phase))); }
    ctx.closePath(); ctx.clip();
    const lo = Math.min(xa, xa + slant), hi = Math.max(xb, xb + slant), e = clamp(70 / (hi - lo), 0.02, 0.45);
    const g = ctx.createLinearGradient(lo, 0, hi, 0);
    const c = `${rgb[0]},${rgb[1]},${rgb[2]}`;
    g.addColorStop(0, `rgba(${c},0)`); g.addColorStop(e, `rgba(${c},${a})`); g.addColorStop(1 - e, `rgba(${c},${a})`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g; ctx.fillRect(lo - 5, 0, hi - lo + 10, yBot + 12);
    if (rainPat) {
      try { rainPat.setTransform(new DOMMatrix([1, 0, -slant / Math.max(1, yBot), 1, phase * 37 % 128, (simT * 380) % 256])); } catch (err) { }
      ctx.globalAlpha = Math.min(0.9, a * 1.3); ctx.fillStyle = rainPat; ctx.fillRect(lo - 5, 0, hi - lo + 10, yBot + 12);
    }
    ctx.restore();
  }
  function Hgy(x) { return VW.Hg - zBase((x - VW.X0) / VW.s) * VW.s; }
  const LT = { next: 8, start: -1, u: 0, pts: null };
  function buildBolt() {
    const r = Math.random, pts = [[0, 0]]; let x = 0, y = 0;
    while (y < 1) { y += 0.04 + r() * 0.06; x += (r() - 0.5) * 0.06; pts.push([x, Math.min(1, y)]); }
    const br = []; const bi = 3 + ((r() * (pts.length - 6)) | 0); let bx = pts[bi][0], by = pts[bi][1]; br.push([bx, by]);
    for (let k = 0; k < 5; k++) { by += 0.05 + r() * 0.05; bx += (r() < 0.5 ? -1 : 1) * (0.02 + r() * 0.04); br.push([bx, by]); }
    return [pts, br];
  }
  function lightningIntensity() {
    if (LT.start < 0) return 0;
    const t = simT - LT.start;
    if (t > 0.5) { LT.start = -1; return 0; }
    return t < 0.06 ? 1 : t < 0.11 ? 0.25 : t < 0.2 ? 0.85 : 0.85 * Math.exp(-(t - 0.2) / 0.08);
  }

  function renderSide() {
    const { ctx, w, h } = fit(side);
    if (!rainPat) rainPat = ctx.createPattern(RAIN, 'repeat');
    const { Hg, X0, s } = VW, P = PRECIP[precip];
    const sx = x => X0 + x * s, sy = z => Hg - z * s;
    const axPx = sx(axX(M.zc)), wcPx = wallW() * s;
    // sky
    let g = ctx.createLinearGradient(0, 0, 0, Hg);
    g.addColorStop(0, P.sky[0]); g.addColorStop(0.5, P.sky[1]); g.addColorStop(1, P.sky[2]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, Hg);
    if (P.slot) {
      const sxc = axPx - 2.2 * wcPx;
      g = ctx.createRadialGradient(sxc, sy(M.zc * 0.95), 0, sxc, sy(M.zc * 0.95), Math.max(1.6 * wcPx, 120));
      g.addColorStop(0, 'rgba(226,222,196,0.55)'); g.addColorStop(1, 'rgba(226,222,196,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, Hg);
    }
    g = ctx.createLinearGradient(0, Hg - 60, 0, Hg);
    g.addColorStop(0, 'rgba(214,220,196,0)'); g.addColorStop(1, 'rgba(214,220,196,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, Hg - 60, w, 60);
    // forward-flank rain and hail core, far behind
    const coreA = axPx + 1.35 * wcPx, li = (showLtg && !reduceMotion) ? lightningIntensity() : 0;
    curtain(ctx, coreA, w + 80, Hg, [66, 78, 88], P.core, -26, 0.7);
    curtain(ctx, coreA + 0.25 * (w - coreA), coreA + 0.55 * (w - coreA) + 40, Hg, [176, 186, 194], P.hail, -18, 2.1);
    if (li > 0 && LT.pts) {
      const lx = coreA + 40 + LT.u * Math.max(40, w - coreA - 80), top = Hgy(lx), H = Hg - top;
      ctx.fillStyle = `rgba(220,226,236,${(0.22 * li).toFixed(3)})`; ctx.fillRect(Math.max(0, coreA), 0, w - coreA, Hg);
      if (li > 0.5) for (const path of LT.pts) {
        ctx.beginPath(); path.forEach(([px, py], i) => { const X = lx + px * H, Y = top + py * H; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        ctx.strokeStyle = 'rgba(210,220,255,0.35)'; ctx.lineWidth = 5; ctx.stroke();
        ctx.strokeStyle = 'rgba(250,252,255,0.95)'; ctx.lineWidth = path === LT.pts[0] ? 1.8 : 1; ctx.stroke();
      }
    }
    // tree line and ground
    const PT = 700, off0 = ((-scroll * s * 0.35) % PT + PT) % PT;
    ctx.fillStyle = '#313c30'; ctx.beginPath(); ctx.moveTo(0, Hg);
    for (let rep = -1; rep * PT < w + PT; rep++) for (const t of trees) {
      const x = t[0] + rep * PT + off0 - PT; if (x < -40 || x > w + 40) continue;
      ctx.moveTo(x, Hg); ctx.ellipse(x + t[1] / 2, Hg, t[1] / 2, t[2], 0, Math.PI, 0);
    }
    ctx.fill();
    g = ctx.createLinearGradient(0, Hg, 0, h);
    g.addColorStop(0, '#4b583d'); g.addColorStop(1, '#283222');
    ctx.fillStyle = g; ctx.fillRect(0, Hg, w, h - Hg);
    ctx.strokeStyle = 'rgba(30,38,26,0.35)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 1; k < 7; k++) { const y = Hg + (h - Hg) * Math.pow(k / 7, 1.8); ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    // rear-flank curtain behind the tornado
    curtain(ctx, axPx - 2.7 * wcPx, axPx - 0.75 * wcPx, Hg, [92, 104, 112], P.rfd * 0.7, 22, 1.3);

    const drawTracers = front => {
      if (!showAir) return;
      ctx.beginPath();
      for (let i = 0; i < NT; i++) {
        const y = T.y[i]; if ((y < 0) !== front) continue;
        const z = T.z[i], r = Math.hypot(T.x[i] - axX(z), y - axY(z));
        if (z > zBase(T.x[i])) continue;
        if (r < rfAt(z)) continue;
        const x1 = sx(T.x[i]), y1 = sy(z);
        ctx.moveTo(x1, y1); ctx.lineTo(x1 - T.vx[i] * 0.07 * s, y1 + T.vz[i] * 0.07 * s);
      }
      ctx.strokeStyle = front ? 'rgba(200,226,230,0.32)' : 'rgba(180,206,210,0.18)';
      ctx.lineWidth = 1; ctx.stroke();
    };
    const drawDebris = front => {
      if (!showDebris) return;
      ctx.fillStyle = front ? 'rgba(34,28,22,0.9)' : 'rgba(52,44,36,0.7)';
      for (let i = 0; i < ND; i++) {
        if (!D.on[i] || D.z[i] < 3 || (D.y[i] < 0) !== front) continue;
        const q = 1.4 + (i % 4) * 0.6, x = sx(D.x[i]), y = sy(D.z[i]);
        ctx.save(); ctx.translate(x, y); ctx.rotate(simT * (3 + (i % 5)) + i); ctx.fillRect(-q, -q * 0.35, q * 2, q * 0.7); ctx.restore();
      }
    };
    drawTracers(false); drawPuffs(ctx, false); drawDebris(false);
    drawTubes(ctx, false);
    drawFunnelTex(ctx);
    drawTubes(ctx, true);
    drawPuffs(ctx, true); drawDebris(true); drawTracers(true);

    // cloud base, its underside texture, wall cloud and scud
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0);
    for (let x = w; x >= -4; x -= 4) ctx.lineTo(x, Hgy(x));
    ctx.closePath();
    g = ctx.createLinearGradient(0, 0, 0, sy(M.zc));
    g.addColorStop(0, '#2c3337'); g.addColorStop(1, '#3d464a');
    ctx.fillStyle = g; ctx.fill();
    if (li > 0) { ctx.fillStyle = `rgba(200,210,226,${(0.12 * li).toFixed(3)})`; ctx.fill(); }
    for (const b of BS) {
      const px = b.f * w, d = b.sz, y = Hgy(px);
      ctx.globalAlpha = b.al * (1 - 0.6 * clamp(slotLift((px - X0) / s) / (0.1 * M.zc), 0, 1));
      ctx.drawImage(PUFF.base[b.v], px - d / 2, y - d * 0.62, d, d * 0.7);
    }
    ctx.globalAlpha = 1;
    for (const front of [false, true]) for (let i = 0; i < NC; i++) {
      const r = CB.r[i], th = CB.th[i], sn = Math.sin(th);
      if ((sn < 0) !== front) continue;
      const x = axX(M.zc) + r * Math.cos(th), px = sx(x); if (px < -80 || px > w + 80) continue;
      const dd = (16 + Math.min(70, r * s * 0.22)) * CB.sz[i], py = Hgy(px) - dd * 0.12 - sn * Math.min(10, r * s * 0.04);
      ctx.globalAlpha = 0.5 + 0.3 * -sn;
      ctx.drawImage(PUFF.wall[i % 3], px - dd / 2, py - dd * 0.35, dd, dd * 0.6);
    }
    ctx.globalAlpha = 1;
    drawScud(ctx);
    // rain wrapping in front of the tornado (high-precipitation storms)
    if (P.wrap > 0) curtain(ctx, axPx - 1.7 * wcPx + 0.25 * wcPx * Math.sin(simT * 0.05), axPx + 0.35 * wcPx, h + 30, [104, 116, 124], P.wrap, 30, 2.7);

    // foreground poles and fence
    const poleY = Hg + 6, pSp = 150, pOff = ((-scroll * s * 1.4) % pSp + pSp) % pSp;
    ctx.strokeStyle = 'rgba(26,30,24,0.85)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let x = pOff - pSp; x < w + pSp; x += pSp) { ctx.moveTo(x, poleY); ctx.lineTo(x, poleY - 24); ctx.moveTo(x - 6, poleY - 21); ctx.lineTo(x + 6, poleY - 21); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(26,30,24,0.45)'; ctx.lineWidth = 0.8; ctx.beginPath();
    for (let x = pOff - pSp; x < w + pSp; x += pSp) { ctx.moveTo(x - 6, poleY - 21); ctx.quadraticCurveTo(x + pSp / 2 - 6, poleY - 15, x + pSp - 6, poleY - 21); }
    ctx.stroke();
    const fY = h - (h - Hg) * 0.38, fSp = 42, fOff = ((-scroll * s * 3) % fSp + fSp) % fSp;
    ctx.strokeStyle = 'rgba(22,24,18,0.9)'; ctx.lineWidth = 2.5; ctx.beginPath();
    for (let x = fOff - fSp; x < w + fSp; x += fSp) { ctx.moveTo(x, fY); ctx.lineTo(x, fY - 15); }
    ctx.stroke();
    ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(22,24,18,0.6)'; ctx.beginPath();
    ctx.moveTo(0, fY - 11); ctx.lineTo(w, fY - 11); ctx.moveTo(0, fY - 5); ctx.lineTo(w, fY - 5); ctx.stroke();

    ctx.font = '11px "JetBrains Mono", monospace';
    if (M.zb !== Infinity && M.zb > 0.04 * M.zc && M.zb < 0.97 * M.zc) {
      const yb = sy(M.zb), xb = sx(axX(M.zb)) - Math.max(rfAt(M.zb), M.rc) * s - 14;
      ctx.strokeStyle = 'rgba(236,242,240,0.8)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xb - 40, yb); ctx.lineTo(xb + 8, yb); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(236,242,240,0.92)'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText('Breakdown', xb - 4, yb - 3); ctx.textAlign = 'left';
    }
    const bx = 14, by = h - 14;
    ctx.strokeStyle = '#e4ebe7'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by); ctx.lineTo(bx + VW.bar.px, by); ctx.lineTo(bx + VW.bar.px, by - 5); ctx.stroke();
    ctx.fillStyle = '#e4ebe7'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${VW.bar.ft.toLocaleString()} ft`, bx + 4, by - 4);
  }

  /* ---------- plan view ---------- */
  function efRGB(ms) {
    const mph = ms / MPH, k = efIndex(mph);
    if (k >= 0) { const c = EFC[k]; return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
    const t = clamp(mph / 65, 0, 1);
    return [27 + 30 * t, 34 + 36 * t, 36 + 38 * t];
  }
  const HN = 150;
  heatC.width = HN; heatC.height = HN;
  const heatCtx = heatC.getContext('2d'), heatImg = heatCtx.createImageData(HN, HN);
  function buildLiveHeat() {
    const L = Lplan(), o = tmp, d = heatImg.data, ox = WB.x * wz(2), oy = WB.y * wz(2);
    for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
      const x = -L + 2 * L * (i + 0.5) / HN, y = L - 2 * L * (j + 0.5) / HN;
      vel(x - ox, y - oy, 2, o);
      const c = efRGB(Math.hypot(o[0] + M.vt, o[1])), p = (j * HN + i) * 4;
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
    }
    heatCtx.putImageData(heatImg, 0, 0);
  }
  function buildSwathHeat() {
    const L = Lplan(), xg = scroll, d = heatImg.data;
    for (let i = 0; i < HN; i++) {
      const x = xg - 1.5 * L + 2 * L * (i + 0.5) / HN, ix = Math.floor((x - swX0) / swDx);
      for (let j = 0; j < HN; j++) {
        const jy = Math.floor((j + 0.5) / HN * NYs);
        const m = (ix >= 0 && ix < NXs) ? SWG[ix * NYs + jy] : 0;
        const c = efRGB(m), p = (j * HN + i) * 4;
        d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
      }
    }
    heatCtx.putImageData(heatImg, 0, 0);
  }
  function arrow(ctx, x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - 8 * Math.cos(a - 0.45), y2 - 8 * Math.sin(a - 0.45)); ctx.lineTo(x2 - 8 * Math.cos(a + 0.45), y2 - 8 * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
  }
  function renderPlan() {
    const { ctx, w, h } = fit(plan);
    const L = Lplan(), s = w / (2 * L);
    if (planMode === 'live') buildLiveHeat(); else buildSwathHeat();
    ctx.imageSmoothingEnabled = true; ctx.drawImage(heatC, 0, 0, w, h);
    const cx = planMode === 'live' ? w / 2 : w * 0.75, cy = h / 2;
    if (planMode === 'live' && showAir) {
      ctx.beginPath();
      for (let i = 0; i < NP; i++) {
        const x = cx + PP.x[i] * s, y = cy - PP.y[i] * s;
        if (x < 0 || x > w || y < 0 || y > h) continue;
        ctx.moveTo(x, y); ctx.lineTo(x - PP.vx[i] * 0.10 * s, y + PP.vy[i] * 0.10 * s);
      }
      ctx.strokeStyle = 'rgba(240,246,244,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillStyle = '#eef3f1';
    if (planMode === 'swath') {
      ctx.setLineDash([2, 5]); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke(); ctx.setLineDash([]);
    }
    const ccx = cx + WB.x * s, ccy = cy - WB.y * s;
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(ccx, ccy, M.rc * s, 0, TAU2); ctx.stroke(); ctx.setLineDash([]);
    ctx.textBaseline = 'middle';
    ctx.fillText('Core', ccx + M.rc * s * 0.72 + 4, ccy - M.rc * s * 0.72 - 4);
    ctx.strokeStyle = '#eef3f1'; ctx.lineWidth = 1.5;
    arrow(ctx, 22, 40, 22, 14); ctx.fillText('N', 30, 22);
    if (M.vt > 0) {
      arrow(ctx, w - 92, 22, w - 30, 22);
      ctx.textAlign = 'right'; ctx.fillText(`${S.vt} mph`, w - 30, 40); ctx.textAlign = 'left';
    }
    if (planMode === 'swath') { ctx.textAlign = 'left'; ctx.fillText('Max wind so far', 12, h - 40); }
    const opts = [25, 50, 100, 200, 250, 500, 1000];
    let yd = 25; for (const o of opts) if (o * YD * s <= w * 0.3) yd = o;
    const px = yd * YD * s, bx = 12, by = h - 12;
    ctx.beginPath(); ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by); ctx.lineTo(bx + px, by); ctx.lineTo(bx + px, by - 5); ctx.stroke();
    ctx.textBaseline = 'bottom'; ctx.fillText(`${yd} yd`, bx + 4, by - 4);
  }

  /* ---------- theme helpers ---------- */
  function tok(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function niceStep(range, target) {
    const raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  }

  /* ---------- cross-section ---------- */
  const VIR = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
  function vir(t) {
    t = clamp(t, 0, 1) * 4; const i = Math.min(3, Math.floor(t)), f = t - i, a = VIR[i], b = VIR[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  let secScale = null;
  function drawSection() {
    const { ctx, w, h } = fit(sec);
    ctx.clearRect(0, 0, w, h);
    const muted = tok('--muted'), line = tok('--line');
    const ml = 62, mr = 8, mt = 10, mb = 34, pw = w - ml - mr, ph = h - mt - mb;
    if (!secScale) secScale = { Rx: clamp(1.3 * M.r0, 3.2 * M.rc, 8 * M.rc), vmax: 0 };
    const Rx = secScale.Rx, Zt = M.zc;
    const NXc = 150, NZc = 110;
    const vf = new Float32Array((NXc + 1) * (NZc + 1)), pf = new Float32Array((NXc + 1) * (NZc + 1));
    let vmax = 0, pmax = 0, pmin = 0;
    for (let jz = 0; jz <= NZc; jz++) {
      const z = Zt * jz / NZc;
      for (let ix = 0; ix <= NXc; ix++) {
        const r = Math.abs(-Rx + 2 * Rx * ix / NXc) + 1e-3, k = jz * (NXc + 1) + ix;
        vf[k] = vtanZ(r, z); pf[k] = psiAt(r, z);
        vmax = Math.max(vmax, vf[k]); pmax = Math.max(pmax, pf[k]); pmin = Math.min(pmin, pf[k]);
      }
    }
    if (!secScale.vmax) secScale.vmax = vmax * 1.15;
    const vref = Math.max(secScale.vmax, vmax);
    secC.width = NXc + 1; secC.height = NZc + 1;
    const sctx = secC.getContext('2d'), img = sctx.createImageData(NXc + 1, NZc + 1);
    for (let jz = 0; jz <= NZc; jz++) for (let ix = 0; ix <= NXc; ix++) {
      const c = vir(Math.sqrt(vf[jz * (NXc + 1) + ix] / vref)), p = ((NZc - jz) * (NXc + 1) + ix) * 4;
      img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(secC, ml, mt, pw, ph);
    $('secMax').textContent = Math.round(vref / MPH);
    const X = ix => ml + ix / NXc * pw, Y = jz => mt + ph - jz / NZc * ph;
    const contour = (lev, dash, alpha) => {
      ctx.beginPath();
      for (let jz = 0; jz < NZc; jz++) for (let ix = 0; ix < NXc; ix++) {
        const k = jz * (NXc + 1) + ix;
        const a = pf[k], b = pf[k + 1], c = pf[k + NXc + 2], d = pf[k + NXc + 1];
        const pts = [];
        const edge = (v1, v2, x1, y1, x2, y2) => { if ((v1 < lev) !== (v2 < lev)) { const t = (lev - v1) / (v2 - v1); pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]); } };
        edge(a, b, ix, jz, ix + 1, jz); edge(b, c, ix + 1, jz, ix + 1, jz + 1); edge(c, d, ix + 1, jz + 1, ix, jz + 1); edge(d, a, ix, jz + 1, ix, jz);
        for (let q = 0; q + 1 < pts.length; q += 2) { ctx.moveTo(X(pts[q][0]), Y(pts[q][1])); ctx.lineTo(X(pts[q + 1][0]), Y(pts[q + 1][1])); }
      }
      ctx.setLineDash(dash); ctx.strokeStyle = `rgba(240,246,244,${alpha})`; ctx.lineWidth = 1.1; ctx.stroke(); ctx.setLineDash([]);
    };
    for (const f of [0.04, 0.1, 0.18, 0.28, 0.4, 0.55, 0.72, 0.9]) contour(f * pmax, [], 0.75);
    if (pmin < -1e-4 * M.A) for (const f of [0.2, 0.5, 0.8]) contour(f * pmin, [3, 3], 0.85);
    const o = [0, 0], sxm = pw / (2 * Rx), szm = ph / Zt;
    let umax = 1e-6; const arr = [];
    for (let iz = 0; iz < 7; iz++) for (let ixa = 0; ixa < 14; ixa++) {
      const xm = -Rx + 2 * Rx * (ixa + 0.5) / 14, z = Zt * (Math.pow((iz + 0.6) / 7, 1.6));
      merid(Math.abs(xm), z, o);
      const dx = Math.sign(xm) * o[0] * sxm, dy = -o[1] * szm, m = Math.hypot(o[0], o[1]);
      umax = Math.max(umax, m); arr.push([ml + (xm + Rx) * sxm, mt + ph - z * szm, dx, dy, m]);
    }
    ctx.fillStyle = 'rgba(240,246,244,0.9)';
    for (const [x, y, dx, dy, m] of arr) {
      const L = Math.hypot(dx, dy); if (L < 1e-9 || m < 0.04 * umax) continue;
      const ux = dx / L, uy = dy / L, sz = 3 + 3 * Math.sqrt(m / umax);
      ctx.globalAlpha = 0.35 + 0.6 * Math.sqrt(m / umax);
      ctx.beginPath(); ctx.moveTo(x + ux * sz, y + uy * sz);
      ctx.lineTo(x - ux * sz * 0.6 - uy * sz * 0.6, y - uy * sz * 0.6 + ux * sz * 0.6);
      ctx.lineTo(x - ux * sz * 0.6 + uy * sz * 0.6, y - uy * sz * 0.6 - ux * sz * 0.6);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.beginPath(); ctx.rect(ml, mt, pw, ph); ctx.clip();
    ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.4;
    for (const sg of [-1, 1]) {
      ctx.beginPath(); let on = false;
      for (let jz = 0; jz <= 200; jz++) {
        const z = Zt * jz / 200, rf = rfAt(z);
        if (rf > 0 && rf < Rx * 1.05) { const x = ml + (sg * rf + Rx) * sxm, y = mt + ph - z * szm; on ? ctx.lineTo(x, y) : ctx.moveTo(x, y); on = true; } else on = false;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
    ctx.font = '11px "JetBrains Mono", monospace';
    if (M.zb !== Infinity) {
      const yb = mt + ph - Math.min(M.zb, Zt) * szm, xb = ml + pw / 2;
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(xb, Math.min(yb, mt + ph - 4), 4, 0, TAU2); ctx.fill(); ctx.stroke();
      const lab = M.zb <= 1 ? 'Stagnation point' : (M.zb >= Zt * 0.98 ? 'Breakdown at cloud base' : 'Breakdown');
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      const ty = Math.max(mt + 14, Math.min(yb, mt + ph - 4) - 6);
      ctx.strokeText(lab, xb + 8, ty); ctx.fillText(lab, xb + 8, ty);
    }
    ctx.fillStyle = muted; ctx.strokeStyle = line; ctx.lineWidth = 1;
    const rStep = niceStep(Rx / YD, 3);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let v = -Math.floor(Rx / YD / rStep) * rStep; v * YD <= Rx + 1e-6; v += rStep) {
      const x = ml + (v * YD + Rx) * sxm;
      ctx.beginPath(); ctx.moveTo(x, mt + ph); ctx.lineTo(x, mt + ph + 4); ctx.stroke();
      ctx.fillText(Math.abs(Math.round(v)), x, mt + ph + 6);
    }
    ctx.fillText('distance from center (yd)', ml + pw / 2, mt + ph + 19);
    const zStep = niceStep(Zt / FT, 4);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = 0; v * FT <= Zt + 1e-6; v += zStep) {
      const y = mt + ph - v * FT * szm;
      ctx.beginPath(); ctx.moveTo(ml - 4, y); ctx.lineTo(ml, y); ctx.stroke();
      ctx.fillText(Math.round(v).toLocaleString(), ml - 6, y);
    }
    ctx.save(); ctx.translate(11, mt + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('height (ft)', 0, 0); ctx.restore();
  }

  /* ---------- radial profile ---------- */
  let profScale = null;
  function drawProfile() {
    const { ctx, w, h } = fit(prof);
    ctx.clearRect(0, 0, w, h);
    const muted = tok('--muted'), line = tok('--line'), acc = tok('--accent'), press = tok('--press'), hot = tok('--hot');
    const ml = 44, mr = 46, mt = 18, mb = 34, pw = w - ml - mr, ph = h - mt - mb;
    if (!profScale) {
      const vMaxMph = (M.vg * (unsteady > 0 ? 1.25 : 1) + M.vt) / MPH;
      const vStep = niceStep(vMaxMph * 1.1, 5);
      const pMb = Math.max(M.dp0 * (unsteady > 0 ? 1.5 : 1), M.need0) / 100, pStep = niceStep(pMb * 1.1, 5);
      profScale = { Rp: Math.max(4 * M.rc, Math.min(AN.r65 * 1.2, 12 * M.rc)), vStep, vTop: Math.ceil(vMaxMph * 1.08 / vStep) * vStep, pStep, pTop: Math.ceil(pMb * 1.08 / pStep) * pStep };
    }
    const { Rp, vStep, pStep } = profScale;
    const vTop = profScale.vTop = Math.max(profScale.vTop, Math.ceil((M.vg + M.vt) / MPH / vStep) * vStep);
    const pTop = profScale.pTop = Math.max(profScale.pTop, Math.ceil(M.dp0 / 100 / pStep) * pStep);
    const zA = 0.7 * M.zc;
    const X = r => ml + r / Rp * pw, Yv = v => mt + ph - v / vTop * ph, Yp = p => mt + ph - p / pTop * ph;
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.lineWidth = 1; ctx.textBaseline = 'middle';
    for (let v = 0; v <= vTop + 1e-6; v += vStep) {
      ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(ml, Yv(v)); ctx.lineTo(ml + pw, Yv(v)); ctx.stroke();
      ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.fillText(Math.round(v), ml - 6, Yv(v));
    }
    ctx.textAlign = 'left';
    for (let p = 0; p <= pTop + 1e-6; p += pStep) { ctx.fillStyle = press; ctx.fillText(Math.round(p), ml + pw + 6, Yp(p)); }
    ctx.setLineDash([2, 4]);
    for (let k = 0; k < 6; k++) {
      if (EFT[k] > vTop) break;
      ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(ml, Yv(EFT[k])); ctx.lineTo(ml + pw, Yv(EFT[k])); ctx.stroke();
      ctx.fillStyle = muted; ctx.fillText(`EF${k}`, ml + pw - 30, Yv(EFT[k]) - 7);
    }
    ctx.setLineDash([]);
    const xStep = niceStep(Rp / YD, 5);
    ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    for (let yd = 0; yd * YD <= Rp + 1e-6; yd += xStep) { ctx.fillStyle = muted; ctx.fillText(Math.round(yd), X(yd * YD), mt + ph + 6); }
    ctx.fillText('distance from center (yd)', ml + pw / 2, mt + ph + 19);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = muted; ctx.fillText('mph', 4, mt - 4);
    ctx.fillStyle = press; ctx.textAlign = 'right'; ctx.fillText('mb', w - 4, mt - 4); ctx.textAlign = 'left';
    const n = 240;
    ctx.beginPath(); ctx.moveTo(X(0), Yp(0));
    for (let i = 0; i <= n; i++) { const r = Rp * i / n; ctx.lineTo(X(r), Yp(dpLev(r, 0) / 100)); }
    ctx.lineTo(X(Rp), Yp(0)); ctx.closePath();
    ctx.globalAlpha = 0.12; ctx.fillStyle = press; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const r = Rp * i / n, y = Yp(dpLev(r, 0) / 100); i ? ctx.lineTo(X(r), y) : ctx.moveTo(X(r), y); }
    ctx.strokeStyle = press; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([1.5, 3]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ml, Yp(M.need0 / 100)); ctx.lineTo(ml + pw, Yp(M.need0 / 100)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = press; ctx.textAlign = 'right'; ctx.fillText('needed for funnel at ground', ml + pw - 4, Yp(M.need0 / 100) - 5); ctx.textAlign = 'left';
    const curve = (f, col, dash, lw) => {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const r = Rp * i / n, y = Yv(Math.max(0, f(r)) / MPH); i ? ctx.lineTo(X(r), y) : ctx.moveTo(X(r), y); }
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
    };
    curve(r => vtanZ(r, zA), muted, [], 1.5);
    if (M.vt > 0) curve(r => vtanZ(r, 0) + M.vt, hot, [5, 4], 2);
    curve(r => vtanZ(r, 0), acc, [], 2.2);
  }

  /* ---------- history chart ---------- */
  let histDirty = true;
  function drawHist() {
    const { ctx, w, h } = fit(hist);
    ctx.clearRect(0, 0, w, h);
    const ink = tok('--ink'), muted = tok('--muted'), line = tok('--line'), hot = tok('--hot'), acc = tok('--accent');
    const rg = [tok('--rg1'), tok('--rg2'), tok('--rg3'), tok('--rg4')];
    const ml = 34, mr = 44, mt = 8, mb = 20, pw = w - ml - mr, ph = h - mt - mb;
    let smax = S.sw * 1.6, pmax = 0;
    for (let i = 0; i < HS.n; i++) { smax = Math.max(smax, HS.s[i] * 1.1); pmax = Math.max(pmax, HS.pk[i]); }
    const sStep = niceStep(smax, 3), sTop = Math.ceil(smax / sStep) * sStep;
    const pStep = niceStep(Math.max(pmax * 1.1, 80), 3), pTop = Math.ceil(Math.max(pmax * 1.1, 80) / pStep) * pStep;
    const X = i => ml + pw - (HS.n - 1 - i) * HDT / 60 * pw;
    const Ys = v => mt + ph - v / sTop * ph, Yp = v => mt + ph - v / pTop * ph;
    const bands = [[0, S_BD], [S_BD, S_TD], [S_TD, S_MV], [S_MV, 99]];
    ctx.globalAlpha = 0.22;
    bands.forEach((b, k) => { const y1 = Ys(Math.min(b[1], sTop)), y0 = Ys(b[0]); if (b[0] < sTop) { ctx.fillStyle = rg[k]; ctx.fillRect(ml, y1, pw, y0 - y1); } });
    ctx.globalAlpha = 1;
    ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.lineWidth = 1; ctx.textBaseline = 'middle';
    for (let v = 0; v <= sTop + 1e-6; v += sStep) {
      ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(ml, Ys(v)); ctx.lineTo(ml + pw, Ys(v)); ctx.stroke();
      ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.fillText(v.toFixed(sStep < 1 ? 1 : 0), ml - 5, Ys(v));
    }
    ctx.textAlign = 'left'; ctx.fillStyle = hot;
    for (let v = 0; v <= pTop + 1e-6; v += pStep) ctx.fillText(Math.round(v), ml + pw + 5, Yp(v));
    ctx.textBaseline = 'top'; ctx.fillStyle = muted;
    ctx.textAlign = 'left'; ctx.fillText('−60 s', ml, mt + ph + 5);
    ctx.textAlign = 'right'; ctx.fillText('now', ml + pw, mt + ph + 5);
    ctx.textAlign = 'center'; ctx.fillText('mph', w - mr / 2 + 4, mt + ph + 5);
    if (HS.n < 2) return;
    ctx.save(); ctx.beginPath(); ctx.rect(ml, mt, pw, ph); ctx.clip();
    const line2 = (arr, Y, col, lw, dash, skipNeg) => {
      ctx.beginPath(); let on = false;
      for (let i = 0; i < HS.n; i++) {
        if (skipNeg && arr[i] < 0) { on = false; continue; }
        const x = X(i), y = Y(arr[i]); on ? ctx.lineTo(x, y) : ctx.moveTo(x, y); on = true;
      }
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
    };
    line2(HS.zb, v => mt + ph - v * ph, acc, 1.5, [4, 3], true);
    line2(HS.pk, Yp, hot, 1.6, [], false);
    line2(HS.s, Ys, ink, 2, [], false);
    ctx.restore();
  }

  /* ---------- readouts and controls ---------- */
  function readouts() {
    const peak = AN.peak / MPH, k = efIndex(peak);
    $('rPeak').textContent = `${Math.round(peak)} mph`;
    const ef = $('rEF');
    if (k >= 0) { ef.hidden = false; ef.textContent = `EF${k}`; ef.style.background = EFC[k]; } else ef.hidden = true;
    const parts = [`${Math.round(AN.vg / MPH)} mph rotation at ground`];
    if (S.sw >= S_MV) parts.push('suction vortex spin');
    if (S.vt > 0) parts.push(`${S.vt} forward`);
    let sub = `At S = ${S.sw.toFixed(2)}: ` + parts.join(' + ') + '.';
    if (unsteady > 0 && maxSoFar > 0) sub += ` Highest gust so far ${Math.round(maxSoFar / MPH)} mph.`;
    if (peak > 300) sub += ' Beyond the strongest radar-measured tornado winds.';
    $('rPeakSub').textContent = sub;
    const fac = (M.vg / M.V).toFixed(2), sNow = M.sw.toFixed(2);
    let name, rs;
    if (M.sw < S_BD) { name = 'One-cell vortex'; rs = `Air rises along the axis. Ground winds ${fac}× the winds aloft.`; }
    else if (M.sw < S_TD) { name = 'Breakdown aloft'; rs = `Narrow one-cell vortex below the breakdown, wider turbulent two-cell core above. Ground winds ${fac}× aloft.`; }
    else if (M.sw < S_MV) { name = 'Two-cell vortex'; rs = 'Breakdown has reached the ground. A central downdraft is ringed by rising air.'; }
    else { name = `Multiple vortices · ${M.n}`; rs = `Two-cell parent with suction vortices orbiting near the core radius.`; }
    if (unsteady > 0) rs = `Swirl ratio now ${sNow}. ` + rs;
    $('rReg').textContent = name; $('rRegSub').textContent = rs;
    $('rDp').innerHTML = `${Math.round(M.dpMin / 100)} mb<small>${M.n && M.dpMin > M.dp0 + 1 ? 'Inside a suction vortex' : 'At the center, ground level'}</small>`;
    $('rNeed').innerHTML = `${Math.round(M.need0 / 100)} mb`;
    let bd;
    if (M.zb === Infinity) bd = 'None<small>Swirl too low</small>';
    else if (M.zb <= 1) bd = 'At ground<small>Stagnation point on the surface</small>';
    else if (M.zb >= 0.98 * M.zc) bd = 'Cloud base<small>Just forming aloft</small>';
    else bd = `${Math.round(M.zb / FT).toLocaleString()} ft<small>Above ground</small>`;
    $('rBd').innerHTML = bd;
    const wd = M.Wbar * ((1 + M.gam) * M.sig - 1);
    $('rUp').innerHTML = `${Math.round(M.Wbar / MPH)} mph<small>${wd > 0.5 ? `Downdraft ${Math.round(wd / MPH)} mph on the axis` : 'Rising along the axis'}</small>`;
    const fun = $('rFun');
    if (M.zBot < 1) fun.innerHTML = 'Touches down<small>Condensed to the ground</small>';
    else if (M.tubeGround) fun.innerHTML = 'Subvortex tubes<small>Parent funnel ' + Math.round(M.zBot / FT).toLocaleString() + ' ft up</small>';
    else fun.innerHTML = `${Math.round(M.zBot / FT).toLocaleString()} ft<small>Gap between tip and ground</small>`;
    $('rPath').innerHTML = AN.pathW > 0 ? `${Math.round(AN.pathW / YD).toLocaleString()} yd<small>Winds of 65 mph or more, at S = ${S.sw.toFixed(2)}</small>` : 'None<small>Below EF0 winds</small>';
    let live = 0; for (let q = 0; q < svAct.length; q++) if (SVt.amp[svAct[q]] > 0.5) live++;
    $('rSub').innerHTML = (M.n || live) ? `${live}<small>${unsteady > 0 ? `Target ${M.n}. ` : ''}${Math.round(M.vsPeak / MPH)} mph spin, orbiting at ${Math.round(M.Om * M.ro / MPH)} mph</small>` : 'None<small>Form above S ≈ 1</small>';
    $('rR0').innerHTML = `${Math.round(M.r0 / YD).toLocaleString()} yd<small>${(M.r0 / M.rc).toFixed(1)}× the core radius</small>`;
    $('scaleTag').textContent = unsteady > 0 ? `S = ${sNow} now · set ${S.sw.toFixed(2)}` : `S = ${S.sw.toFixed(2)} · cloud base ${Math.round(S.zc).toLocaleString()} ft`;
  }
  const units = { sw: v => p2s(+v).toFixed(2), vrot: v => `${v} mph`, rc: v => `${v} yd`, zc: v => `${Number(v).toLocaleString()} ft`, vt: v => `${v} mph` };
  function syncInputs() {
    for (const k in units) {
      $(k).value = k === 'sw' ? Math.round(s2p(S.sw)) : S[k];
      $('o_' + k).textContent = k === 'sw' ? S.sw.toFixed(2) : units[k](S[k]);
    }
    $('un').value = Math.round(unsteady * 100); $('o_un').textContent = `${Math.round(unsteady * 100)}%`;
  }
  let pending = false;
  function rebuild() {
    derive(S.sw);
    svRing(M.n, -Math.PI / 2, false);
    analyze();
    WB.x = WB.y = 0; WB.n1 = WB.n2 = 0; FL.ou = 0; FL.t = 0; FL.nextDerive = 0;
    FL.ph = [Math.random() * TAU2, Math.random() * TAU2, Math.random() * TAU2];
    computeView();
    secScale = null; profScale = null;
    if (unsteady > 0) svRing(M.n, Math.random() * TAU2, true);
    resetParticles(); resetSwath();
    HS.n = 0; HS.next = 0; maxSoFar = 0;
    for (let i = 0; i < 10; i++) step(1 / 60);
    resetSwath(); maxSoFar = 0; HS.n = 0;
    drawSection(); drawProfile(); readouts(); histDirty = true;
  }
  // While a slider is moving: cheap update of the wind field only. Full rebuild once it settles.
  let settleTimer = 0, lastSec = 0;
  function quickUpdate() {
    derive(S.sw); computeView();
    AN.vg = M.vg; AN.sw = S.sw;
    readouts(); drawProfile();
    const now = performance.now();
    if (now - lastSec > 150) { drawSection(); lastSec = now; }
  }
  function settle() {
    clearTimeout(settleTimer); settleTimer = 0;
    rebuild(); if (paused) { renderSide(); renderPlan(); drawHist(); }
  }
  function schedule() {
    clearTimeout(settleTimer); settleTimer = setTimeout(settle, 300);
    if (pending) return; pending = true;
    requestAnimationFrame(() => { pending = false; quickUpdate(); if (paused) { renderSide(); renderPlan(); } });
  }
  for (const k in units) $(k).addEventListener('input', e => {
    if (k === 'sw') { S.sw = Math.round(p2s(+e.target.value) * 100) / 100; $('o_sw').textContent = S.sw.toFixed(2); }
    else { S[k] = +e.target.value; $('o_' + k).textContent = units[k](S[k]); }
    document.querySelectorAll('[data-p]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    schedule();
  });
  $('un').addEventListener('input', e => {
    const was = unsteady;
    unsteady = +e.target.value / 100; $('o_un').textContent = `${Math.round(unsteady * 100)}%`;
    if (unsteady === 0 && was > 0) { derive(S.sw); svRing(M.n, -Math.PI / 2, false); WB.x = WB.y = 0; drawSection(); drawProfile(); }
    readouts();
  });
  for (const k in units) $(k).addEventListener('change', () => { if (settleTimer) settle(); });
  document.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => {
    Object.assign(S, PRESETS[b.dataset.p]); syncInputs();
    document.querySelectorAll('[data-p]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    settle();
  }));
  document.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => {
    speed = +b.dataset.s;
    document.querySelectorAll('[data-s]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
  }));
  document.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
    planMode = b.dataset.m;
    document.querySelectorAll('[data-m]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    $('planCap').textContent = planMode === 'live'
      ? 'Ground-relative wind near the surface, north up. Forward motion adds to the rotation on the right (south) side of the track. Suction vortices show up as hot spots orbiting the core.'
      : 'Highest wind each patch of ground has felt so far, as the tornado moves east. Suction vortices leave looping cycloidal marks, and the wandering core makes the swath ragged.';
    renderPlan();
  }));
  document.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => {
    precip = b.dataset.r;
    document.querySelectorAll('[data-r]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    LT.next = simT + 1 + Math.random() * 3;
    if (paused) renderSide();
  }));
  $('ltg').checked = showLtg;
  $('ltg').addEventListener('change', e => { showLtg = e.target.checked; });
  $('air').addEventListener('change', e => { showAir = e.target.checked; if (paused) { renderSide(); renderPlan(); } });
  $('deb').addEventListener('change', e => { showDebris = e.target.checked; if (!showDebris) D.on.fill(0); if (paused) renderSide(); });
  const playBtn = $('play');
  function setPlay() { playBtn.textContent = paused ? 'Play' : 'Pause'; }
  playBtn.addEventListener('click', () => { paused = !paused; setPlay(); });

  $('efLegend').innerHTML = '<span><i class="sw" style="background:#2f3b3f"></i>&lt;65</span>' +
    EFT.map((v, k) => `<span><i class="sw" style="background:${EFC[k]}"></i>EF${k} ${v}${k < 5 ? '–' + (EFT[k + 1] - 1) : '+'}</span>`).join('');

  const redrawThemed = () => { drawProfile(); drawSection(); drawHist(); };
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) { mq.addEventListener('change', redrawThemed); __cleanup.push(() => mq.removeEventListener('change', redrawThemed)); }
  const __mo = new MutationObserver(redrawThemed); __mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); __cleanup.push(() => __mo.disconnect());
  const __ro = new ResizeObserver(() => { if (!__alive) return; computeView(); redrawThemed(); if (paused) { renderSide(); renderPlan(); } }); __ro.observe(root); __cleanup.push(() => __ro.disconnect()); __cleanup.push(() => clearTimeout(settleTimer));


  const __L = app.link;
  if (__L && __L.params) {
    const p = __L.params;
    S.zc = clamp(p.zc, 500, 5000); S.vt = clamp(p.vt, 0, 60); S.rc = clamp(p.rc, 15, 500); S.sw = clamp(p.sw, 0.05, 3);
    precip = p.precip;
    document.querySelectorAll('[data-r]').forEach(x => x.setAttribute('aria-pressed', x.dataset.r === precip ? 'true' : 'false'));
    document.querySelectorAll('[data-p]').forEach(x => x.setAttribute('aria-pressed', 'false'));
    // find the rotational wind aloft that gives the storm's peak ground-relative wind
    let lo = 20, hi = 250;
    for (let i = 0; i < 12; i++) { const mid = 0.5 * (lo + hi); S.vrot = mid; derive(S.sw); svRing(M.n, -Math.PI / 2, false); analyze(); if (AN.peak / MPH < p.peakMph) lo = mid; else hi = mid; }
    S.vrot = Math.round(0.5 * (lo + hi));
    const ban = document.createElement('div');
    ban.className = 'card'; ban.style.cssText = 'grid-template-columns:minmax(0,1fr) auto;align-items:center;border-color:var(--accent)';
    const kind = __L.label === 'roll' ? 'A tornado rolled from your storm' : 'The typical tornado from your storm';
    ban.innerHTML = `<div><b>${kind}</b><p class="cap">Peak winds near ${p.peakMph} mph. Cloud base ${Number(p.zc).toLocaleString()} ft, moving ${p.vt} mph, ${p.precip === 'hp' ? 'HP (rain-wrapped)' : p.precip === 'lp' ? 'LP' : 'classic'} storm, from an environment with STP ${__L.stp.toFixed(1)}. Swirl ratio and core size follow from the storm's rotation and updraft. The sliders below hold these values; change them freely.</p></div><div class="row" style="gap:8px"><a href="#storm" style="color:var(--accent);font-weight:500">Back to the storm</a><button type="button" id="__unlink">Use presets instead</button></div>`;
    root.querySelector('.bench').before(ban);
    ban.querySelector('#__unlink').addEventListener('click', () => { app.link = null; ban.remove(); Object.assign(S, PRESETS.classic); precip = 'classic'; document.querySelectorAll('[data-r]').forEach(x => x.setAttribute('aria-pressed', x.dataset.r === 'classic' ? 'true' : 'false')); document.querySelectorAll('[data-p]').forEach(x => x.setAttribute('aria-pressed', x.dataset.p === 'classic' ? 'true' : 'false')); syncInputs(); settle(); });
  }
  syncInputs(); setPlay(); rebuild();

  let last = performance.now(), slowT = 0, planTick = 0;
  function loop(now) {
    if (!__alive) return;
    const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
    if (!paused) {
      step(dt * speed);
      slowT += dt;
      if (slowT > 0.5) { slowT = 0; readouts(); if (unsteady > 0) { drawSection(); drawProfile(); } }
    }
    renderSide();
    if (++planTick % 2 === 0 || paused) renderPlan();
    if (histDirty) { drawHist(); histDirty = false; }
    requestAnimationFrame(loop);
  }
  renderSide(); renderPlan();
  requestAnimationFrame(loop);

  return () => { __alive = false; __cleanup.forEach(f => { try { f(); } catch (e) {} }); };
}
