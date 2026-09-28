#!/usr/bin/env node
// Status line: the budget dashboard you glance at before deciding what to do next.
//   Opus · ctx 34% · 5h 23% (resets 14:00) · 7d 41% · main* · task:login-form
// Self-contained (no imports from the kit) so it can live in ~/.claude/ and work in every project.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let d = {};
try {
  d = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  /* render what we can */
}

const color = (p, s) => (p == null ? s : `\x1b[${p >= 80 ? 31 : p >= 50 ? 33 : 32}m${s}\x1b[0m`);
const pct = (v) => (typeof v === 'number' ? Math.round(v) : null);
const hhmm = (sec) => {
  const t = new Date(sec * 1000);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
};
const run = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return r.status === 0 ? r.stdout.trim() : '';
};

const parts = [];
parts.push(d.model?.display_name || 'Claude');

const ctx = pct(d.context_window?.used_percentage);
if (ctx != null) parts.push(color(ctx, `ctx ${ctx}%${ctx >= 60 ? ' → /handoff + /clear' : ''}`));

const five = d.rate_limits?.five_hour;
const h5 = pct(five?.used_percentage);
if (h5 != null) parts.push(color(h5, `5h ${h5}%${five.resets_at ? ` (resets ${hhmm(five.resets_at)})` : ''}`));
const d7 = pct(d.rate_limits?.seven_day?.used_percentage);
if (d7 != null) parts.push(color(d7, `7d ${d7}%`));

const cwd = d.workspace?.current_dir || d.cwd || process.cwd();
const branch = run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
if (branch) parts.push(`${branch}${run(['status', '--porcelain'], cwd) ? '*' : ''}`);

const top = run(['rev-parse', '--show-toplevel'], cwd);
try {
  const slug = fs.readFileSync(path.join(top || cwd, '.solo', 'ACTIVE'), 'utf8').trim();
  if (slug) parts.push(`task:${slug}`);
} catch {
  /* no active task */
}

process.stdout.write(parts.join(' · '));
