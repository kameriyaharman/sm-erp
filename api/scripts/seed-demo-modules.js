#!/usr/bin/env node
/**
 * Runs the per-module demo seeds that exist, in a fixed order, each in its own process
 * (they call process.exit). Each seed is idempotent and only acts when SEED_DEMO=true.
 * A failing seed fails the release, so a half-seeded demo never goes live silently.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ORDER = ['seed-demo-setup.js', 'seed-demo-finance.js', 'seed-demo-payments.js'];

for (const file of ORDER) {
  const full = path.join(dir, file);
  if (!existsSync(full)) continue;
  const run = spawnSync(process.execPath, [full], { stdio: 'inherit', env: process.env });
  if (run.status !== 0) {
    process.stderr.write(`${JSON.stringify({ level: 'error', message: 'Demo seed failed', script: file, status: run.status })}\n`);
    process.exit(run.status ?? 1);
  }
}
