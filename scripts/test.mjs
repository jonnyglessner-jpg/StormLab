// Bundle the TypeScript tests for Node and run them with the built-in test runner.
import * as esbuild from 'esbuild';
import { readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const out = '.test-build';
await rm(out, { recursive: true, force: true });
const entries = readdirSync('tests').filter(f => f.endsWith('.test.ts')).map(f => `tests/${f}`);
await esbuild.build({ entryPoints: entries, outdir: out, bundle: true, platform: 'node', format: 'esm', target: 'node20', outExtension: { '.js': '.mjs' }, define: { __BUILD__: '"test"' }, logLevel: 'warning' });
const files = readdirSync(out).filter(f => f.endsWith('.mjs')).map(f => `${out}/${f}`);
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
