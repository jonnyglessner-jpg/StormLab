/** Full-simulation mode of the storm view: run controls, model clock, live statistics, time series, tornadoes. */
import { MPH } from '../../physics/constants';
import { type Environment } from '../../physics/environment';
import { tornadoParams, type StormDiag } from '../../physics/storm';
import { type ChaserRenderer } from '../../render/chaser';
import { summarize, TornadoTracker, type SimSummary, type TornadoEvent } from '../../sim/diag';
import { createDriver, RUN_LENGTH, type DiagFrame, type SimDriver } from '../../sim/driver';
import { app } from '../../state';
import { fit, tok } from '../../ui/canvas';
import { EF_COLORS } from './efchart';

export const SIM_BAR_HTML = `
      <div class="row" id="simBar" hidden style="gap:10px">
        <button id="simRun" type="button" style="min-width:74px">Run</button>
        <button id="simReset" type="button">Restart</button>
        <div class="seg" role="group" aria-label="Simulation speed" id="simSpeed" style="margin-left:0">
          <button data-speed="60">1 min/s</button><button data-speed="180" aria-pressed="true">3 min/s</button><button data-speed="Infinity">Fastest</button>
        </div>
        <output id="simClock" style="font-family:var(--f-mono);font-size:13px">0:00</output>
        <span class="gpu-note" id="simNote"></span>
      </div>`;

export const SIM_CARD_HTML = `
      <div class="card" id="simCard" hidden>
        <div class="cardhead"><h2>Simulation</h2>
          <div class="legend"><span><i class="ln" style="color:var(--hot)"></i>Peak updraft</span><span><i class="ln" style="color:var(--press)"></i>Rotation at 1 km</span><span><i class="ln d" style="color:var(--accent)"></i>Rotation near the ground</span></div>
        </div>
        <dl class="read" aria-live="polite">
          <div><dt>Model time</dt><dd id="smT">—</dd></div>
          <div><dt>Peak updraft</dt><dd id="smW">—</dd></div>
          <div><dt>Rotation at 1 km</dt><dd id="smZ1">—</dd></div>
          <div><dt>Cold pool</dt><dd id="smCP">—</dd></div>
        </dl>
        <canvas id="smHist" style="display:block;width:100%;height:150px" aria-label="Updraft and rotation over the simulation"></canvas>
        <div id="smTor" style="display:grid;gap:6px"></div>
        <p class="cap" id="smCap">The cloud model solves the equations of motion for the atmosphere you set, on a grid of 1 km boxes 400 m deep. Nothing in the storm is drawn by hand: it grows from a forced updraft in its first 15 minutes, then runs on its own.</p>
      </div>`;

export interface SimHooks {
  root: HTMLElement;
  env(): Environment | null;
  storm(): StormDiag | null;
  renderer(): ChaserRenderer | null;
  redraw3D(): void;
  redrawRadar(): void;
}

const fmtClock = (t: number) => `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;
const efOf = (ms: number) => { const m = ms / MPH; let k = 0; for (const [i, v] of [65, 86, 111, 136, 166, 201].entries()) if (m >= v) k = i; return k; };

export class SimPanel {
  driver: SimDriver | null = null;
  frame: DiagFrame | null = null;
  series: SimSummary[] = [];
  tracker: TornadoTracker | null = null;
  torNow: TornadoEvent | null = null;
  private starting = false;
  private speed = 180;
  private envAtStart: string | null = null;
  private $ = <T extends HTMLElement = HTMLElement>(id: string) => this.h.root.querySelector<T>('#' + id)!;

  constructor(private h: SimHooks) {
    this.$('simRun').addEventListener('click', () => this.toggle());
    this.$('simReset').addEventListener('click', () => this.restart());
    this.h.root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b => b.addEventListener('click', () => {
      this.speed = Number(b.dataset.speed);
      if (this.driver) this.driver.speed = this.speed;
      this.h.root.querySelectorAll('[data-speed]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    }));
    this.drawHist();
  }

  get running(): boolean { return !!this.driver?.running; }

  private async ensureDriver(): Promise<boolean> {
    if (this.driver) return true;
    const E = this.h.env();
    if (!E || this.starting) return false;
    if (!this.h.renderer()) { this.$('simNote').textContent = 'Starting the renderer… press Run again in a moment.'; return false; }
    this.starting = true;
    this.$('simNote').textContent = 'Setting up the model…';
    try {
      this.driver = await createDriver(E, this.h.renderer());
    } catch (e) {
      console.error(e);
      this.$('simNote').textContent = 'The simulation couldn’t start on this device.';
      this.starting = false;
      return false;
    }
    this.starting = false;
    this.envAtStart = JSON.stringify(E.o);
    this.tracker = new TornadoTracker(this.driver.g);
    this.series = []; this.torNow = null; this.frame = null;
    this.driver.speed = this.speed;
    this.driver.onDiag = f => this.onDiag(f);
    const g = this.driver.g;
    this.$('simNote').textContent = this.driver.kind === 'gpu'
      ? `On your GPU · ${g.NX}×${g.NY}×${g.NZ} grid, ${g.dx / 1000} km`
      : `On the CPU (no WebGPU) · coarser ${g.dx / 1000} km grid, slower`;
    this.$('smCap').textContent = `The cloud model solves the equations of motion for the atmosphere you set, on a grid of ${g.dx / 1000} km boxes ${g.dz} m deep. Nothing in the storm is drawn by hand: it grows from a forced updraft in its first 15 minutes, then runs on its own.`;
    return true;
  }

  async toggle(): Promise<void> {
    if (!(await this.ensureDriver()) || !this.driver) return;
    if (this.driver.t >= RUN_LENGTH) return;
    this.driver.running = !this.driver.running;
    this.$('simRun').textContent = this.driver.running ? 'Pause' : 'Run';
  }

  restart(): void {
    this.driver?.destroy(); this.driver = null;
    this.frame = null; this.series = []; this.torNow = null; this.tracker = null; this.focus = null;
    this.$('simRun').textContent = 'Run'; this.$('simClock').textContent = '0:00';
    for (const id of ['smT', 'smW', 'smZ1', 'smCP']) this.$(id).textContent = '—';
    this.$('smTor').innerHTML = '';
    this.$('simNote').textContent = '';
    this.drawHist(); this.h.redrawRadar(); this.h.redraw3D();
    void this.toggle();
  }

  /** Re-point the renderer at the simulation's volume (after the instant model has used it). */
  attach(): void { this.driver?.attach(); this.h.redraw3D(); }

  /** Called when the sliders change: the running simulation keeps its original environment. */
  envChanged(E: Environment): void {
    if (!this.driver) return;
    const same = JSON.stringify(E.o) === this.envAtStart;
    this.$('simNote').textContent = same ? '' : 'The sliders changed. Restart to simulate the new environment.';
  }

  tick(wallDt: number): void {
    const d = this.driver;
    if (!d) return;
    d.tick(wallDt);
    this.$('simClock').textContent = fmtClock(d.t);
    if (d.volumeDirty) { d.volumeDirty = false; this.h.redraw3D(); }
    if (d.running && d.t >= RUN_LENGTH) { d.running = false; this.$('simRun').textContent = 'Run'; this.$('simNote').textContent = 'Two hours simulated. Restart to run it again.'; }
  }

  /** where the camera should look in simulation mode: the main updraft, km from the domain centre */
  focus: [number, number] | null = null;

  private onDiag(f: DiagFrame): void {
    this.frame = f;
    const s = summarize(f.t, f.g, f.diag);
    this.series.push(s);
    if (s.wmax > 5) this.focus = [(s.upI + 0.5) * f.g.dx / 1000 - f.g.NX * f.g.dx / 2000, (s.upJ + 0.5) * f.g.dy / 1000 - f.g.NY * f.g.dy / 2000];
    this.torNow = this.tracker!.update(f.t, f.diag);
    this.$('smT').innerHTML = `${Math.round(f.t / 60)} min`;
    this.$('smW').innerHTML = `${Math.round(s.wmax)} m/s<small>${Math.round(s.wmax / MPH)} mph</small>`;
    this.$('smZ1').innerHTML = `${(s.zeta1 * 1000).toFixed(1)}<small>×10⁻³ s⁻¹ ${s.zeta1 >= 0.01 ? '· mesocyclone' : ''}</small>`;
    this.$('smCP').innerHTML = `${s.coldPool > -0.05 ? '0.0' : s.coldPool.toFixed(1)} °C<small>Coldest outflow vs. the environment</small>`;
    this.renderTornadoes();
    this.drawHist();
    this.h.redrawRadar();
  }

  private renderTornadoes(): void {
    const box = this.$('smTor'), evs = this.tracker?.events ?? [];
    if (!evs.length) { box.innerHTML = `<p class="cap">${this.series.length ? 'No tornado so far. The tracker watches for strong rotation near the ground under the low-level updraft.' : ''}</p>`; return; }
    box.innerHTML = evs.map((ev, i) => {
      const k = efOf(ev.peak), dur = ((ev.end ?? this.frame!.t) - ev.start) / 60;
      const status = ev.end === null ? '<b>On the ground now</b>' : `${dur.toFixed(0)} min`;
      return `<div class="row" style="gap:10px;align-items:center">
        <span class="ef" style="background:${EF_COLORS[k]};margin-left:0">EF${k}</span>
        <span style="font-size:13.5px">Tornado ${i + 1}: formed at ${Math.round(ev.start / 60)} min · ${status} · peak about ${Math.round(ev.peak / MPH)} mph</span>
        <button type="button" data-tor="${i}">Open in Tornado Lab</button></div>`;
    }).join('') + '<p class="cap">Estimated from the simulated near-ground rotation. The grid can’t resolve the tornado itself, so its strength is scaled from the parent circulation, not simulated directly.</p>';
    box.querySelectorAll<HTMLButtonElement>('[data-tor]').forEach(b => b.addEventListener('click', () => {
      const S = this.h.storm(), ev = evs[Number(b.dataset.tor)];
      if (!S || !S.forms || !ev) return;
      const tp = tornadoParams(S, ev.peak);
      app.link = { params: tp, label: 'sim', env: app.env!, stp: S.E.stp, ptor: S.ptor };
      location.hash = 'tornado';
    }));
  }

  private drawHist(): void {
    const c = this.$<HTMLCanvasElement>('smHist'), { ctx, w, h } = fit(c);
    ctx.clearRect(0, 0, w, h);
    const ml = 36, mr = 44, mt = 18, mb = 20, pw = w - ml - mr, ph = h - mt - mb;
    const X = (t: number) => ml + t / RUN_LENGTH * pw, Yw = (v: number) => mt + ph - Math.min(v, 80) / 80 * ph, Yz = (v: number) => mt + ph - Math.min(v * 1000, 40) / 40 * ph;
    ctx.font = '10.5px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) {
      const y = mt + ph * k / 4;
      ctx.strokeStyle = tok('--line'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke();
      ctx.fillStyle = tok('--hot'); ctx.textAlign = 'right'; ctx.fillText(String(80 - k * 20), ml - 5, y);
      ctx.fillStyle = tok('--press'); ctx.textAlign = 'left'; ctx.fillText(String(40 - k * 10), ml + pw + 5, y);
    }
    ctx.fillStyle = tok('--muted'); ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    for (let m = 0; m <= 120; m += 30) ctx.fillText(`${m} min`, X(m * 60), mt + ph + 5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('m/s', 4, 10); ctx.textAlign = 'right'; ctx.fillText('×10⁻³ s⁻¹', w - 2, 10); ctx.textAlign = 'left';
    // tornado intervals
    for (const ev of this.tracker?.events ?? []) {
      ctx.fillStyle = 'rgba(255,43,214,.16)';
      ctx.fillRect(X(ev.start), mt, Math.max(2, X(ev.end ?? (this.frame?.t ?? ev.start)) - X(ev.start)), ph);
    }
    const s = this.series;
    if (s.length < 2) return;
    const line = (f: (x: SimSummary) => number, Y: (v: number) => number, col: string, dash: number[]) => {
      ctx.beginPath(); s.forEach((p, i) => i ? ctx.lineTo(X(p.t), Y(f(p))) : ctx.moveTo(X(p.t), Y(f(p))));
      ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
    };
    line(p => p.zeta0, Yz, tok('--accent'), [4, 3]); line(p => p.zeta1, Yz, tok('--press'), []); line(p => p.wmax, Yw, tok('--hot'), []);
  }

  redrawCharts(): void { this.drawHist(); }

  destroy(): void { this.driver?.destroy(); this.driver = null; }
}
