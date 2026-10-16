// Build (or serve with live rebuild) the app with esbuild.
//   node scripts/build.mjs           -> dist/
//   node scripts/build.mjs --serve   -> http://localhost:5173
import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const serve = process.argv.includes('--serve');
const outdir = 'dist';
await rm(outdir, { recursive: true, force: true });
await mkdir(`${outdir}/assets`, { recursive: true });

const common = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  minify: !serve,
  logLevel: 'info',
  legalComments: 'none',
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 10)) }
};
const builds = [
  { ...common, entryPoints: { app: 'src/main.ts' }, outdir: `${outdir}/assets` },
  { ...common, entryPoints: { 'sim.worker': 'src/sim/sim.worker.ts' }, outdir: `${outdir}/assets` }
];

const copyStatic = async () => {
  await cp('index.html', `${outdir}/index.html`);
  if (existsSync('public')) await cp('public', outdir, { recursive: true });
};

if (serve) {
  const ctxs = await Promise.all(builds.map(b => esbuild.context(b)));
  await copyStatic();
  await Promise.all(ctxs.map(c => c.watch()));
  const { port } = await ctxs[0].serve({ servedir: outdir, port: 5173 });
  console.log(`Serving on http://localhost:${port}`);
} else {
  await Promise.all(builds.map(b => esbuild.build(b)));
  await copyStatic();
}
