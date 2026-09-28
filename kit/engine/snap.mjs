#!/usr/bin/env node
// Visual evidence: screenshots of configured routes at configured viewports + browser console errors.
// Uses the project's own Playwright install (npm i -D playwright && npx playwright install chromium).
//
//   node .solo/engine/snap.mjs [--routes /,/login] [--out <dir>]
// Screenshots go to .solo/tasks/<active>/evidence/ by default.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { activeTask, loadConfig, repoRoot } from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const root = repoRoot();
const cfg = loadConfig(root);
const ui = cfg.ui;
if (!ui.enabled) {
  console.log('ui.enabled is false in .solo/config.json — nothing to capture.');
  process.exit(0);
}

const req = createRequire(path.join(root, ui.root || '.', 'package.json'));
let chromium;
for (const mod of ['playwright', '@playwright/test']) {
  try {
    chromium = req(mod).chromium;
    break;
  } catch {
    /* try next */
  }
}
if (!chromium) {
  console.log(`Playwright not found under ${ui.root || '.'}. Install: npm i -D playwright && npx playwright install chromium`);
  process.exit(3);
}

try {
  await fetch(ui.baseUrl, { signal: AbortSignal.timeout(4000) });
} catch {
  console.log(`Dev server not reachable at ${ui.baseUrl}. Start it in the background first: ${ui.serve} (cwd: ${ui.root || '.'})`);
  process.exit(3);
}

const routes = (arg('--routes') || '').split(',').filter(Boolean);
const list = routes.length ? routes : ui.routes;
const outDir = path.resolve(root, arg('--out') || path.join('.solo', 'tasks', activeTask(root) || '_adhoc', 'evidence'));
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const shots = [];
const errors = [];
try {
  for (const route of list) {
    for (const [w, h] of ui.viewports) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      page.on('console', (m) => m.type() === 'error' && errors.push(`${route} ${w}px: ${m.text()}`));
      page.on('pageerror', (e) => errors.push(`${route} ${w}px: ${e.message}`));
      const url = new URL(route, ui.baseUrl).href;
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 }).catch((e) => errors.push(`${route}: navigation ${e.message}`));
      await page.waitForTimeout(ui.waitMs);
      const name = `${route.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'root'}-${w}x${h}.png`;
      await page.screenshot({ path: path.join(outDir, name), fullPage: true });
      shots.push(path.relative(root, path.join(outDir, name)).split(path.sep).join('/'));
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`screenshots (${shots.length}):\n${shots.map((s) => `  ${s}`).join('\n')}`);
if (errors.length) {
  const uniq = [...new Set(errors)];
  console.log(`console errors (${uniq.length}):\n${uniq.slice(0, 10).map((e) => `  ${e.slice(0, 200)}`).join('\n')}`);
  process.exit(1);
}
console.log('console errors: none');
