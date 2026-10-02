#!/usr/bin/env node
// Stop hook: when Claude is about to end its turn, run the fast "stop" checks on the files it edited.
// - No edits this turn → does nothing (costs nothing).
// - Checks pass → clears the edit list, shows a one-line PASS to you (not to the model).
// - Checks fail → blocks the stop and hands Claude only the error lines that matter.
// - Still failing after limits.stopRetries rounds → lets Claude stop and pauses until the next edit,
//   so an unfixable failure can't burn your usage in a loop.
// - Only environment failures (dependencies missing or half-installed) → does not block, because Claude can't fix
//   those by editing code; tells you the restore command instead (npm ci / dotnet restore).
// - Guards see what passing checks hide: tests that got weaker than in HEAD (test-guard.mjs), and patches on changed
//   lines such as a suppression or a swallowed error (patch-guard.mjs). Each distinct finding blocks once, so Claude
//   restores it, runs the fit check or says why; after that the PASS line keeps showing it to you.
import fs from 'node:fs';
import { loadConfig, loadState, out, readStdinJson, repoRoot, saveState } from './lib.mjs';
import { formatReport, runStage } from './check.mjs';
import { findPatches, formatPatches, signature as patchSignature } from './patch-guard.mjs';
import { findWeakenedTests, formatWeakened, signature as testSignature } from './test-guard.mjs';

const input = readStdinJson();
const sid = input.session_id;
const state = loadState(sid);
const edited = (state.edited || []).filter((f) => fs.existsSync(f));
if (!edited.length || state.suspended) process.exit(0);

const root = repoRoot(input.cwd || process.cwd());
let cfg;
try {
  cfg = loadConfig(root);
} catch (e) {
  out({ systemMessage: `solo: ${e.message}` });
  process.exit(0);
}

const res = runStage({ root, cfg, stage: 'stop', files: edited });
const ran = res.results.filter((r) => r.status !== 'skip');

const guards = [
  {
    seenKey: 'testGuardSeen',
    find: findWeakenedTests,
    signature: testSignature,
    format: formatWeakened,
    flag: (found) => `tests weaker than HEAD, review before committing: ${found.map((w) => w.file).join(', ')}`,
  },
  {
    seenKey: 'patchGuardSeen',
    find: findPatches,
    signature: patchSignature,
    format: formatPatches,
    flag: (found) => `patches added, each one kept needs a Known deviations line: ${[...new Set(found.map((p) => p.file))].join(', ')}`,
  },
].map((g) => {
  let found = [];
  try {
    found = g.find(root, cfg, { files: edited });
  } catch {
    /* a guard must never break the Stop hook */
  }
  const sig = found.length ? g.signature(found) : '';
  const seen = new Set(state[g.seenKey] || []);
  return { ...g, found, sig, seen, fresh: found.length > 0 && !seen.has(sig) };
});
const fresh = guards.filter((g) => g.fresh);
const markSeen = () => {
  for (const g of fresh) state[g.seenKey] = [...g.seen, g.sig].slice(-50); // only once Claude has actually been shown it
};

if (res.ok && !fresh.length) {
  saveState(sid, { ...state, edited: [], fails: 0, suspended: false });
  const flagged = guards
    .filter((g) => g.found.length)
    .map((g) => ` · ⚠ ${g.flag(g.found)}`)
    .join('');
  // seconds per step, because this runs every turn: a step that is always slow belongs in "full" only
  if (ran.length || flagged) out({ systemMessage: `solo check PASS${ran.length ? `: ${ran.map((r) => `${r.stack}/${r.step} ${(r.ms / 1000).toFixed(1)}s`).join(', ')}` : ''}${flagged}` });
  process.exit(0);
}

const failing = res.results.filter((r) => r.status === 'fail');
const notClaudes = (r) => r.env || r.mutated?.length; // broken machine or a check that edits files: yours to fix, not Claude's
if (!res.ok && failing.every(notClaudes)) {
  saveState(sid, state); // keep the edit list: the checks run again after it is fixed
  const env = failing.filter((r) => r.env);
  const mut = failing.filter((r) => r.mutated?.length);
  out({
    systemMessage: [
      env.length ? `solo check could not run: the project's dependencies look broken (${env.map((r) => `${r.stack}/${r.step}`).join(', ')}). Run ${env[0].fix} — this is not a code problem.` : '',
      mut.length ? `solo check ${mut.map((r) => `${r.stack}/${r.step}`).join(', ')} CHANGED files (${mut.flatMap((r) => r.mutated).slice(0, 5).join(', ')}): undo with git restore and fix that command in .solo/config.json.` : '',
    ].filter(Boolean).join(' '),
  });
  process.exit(0);
}

if (res.ok) {
  // checks are green but a guard found something new: ask once, then let it through (flagged) on the next stop
  markSeen();
  saveState(sid, { ...state, edited });
  out({ decision: 'block', reason: fresh.map((g) => g.format(g.found)).join('\n\n') });
  process.exit(0);
}

state.fails = (state.fails || 0) + 1;
if (state.fails > cfg.limits.stopRetries) {
  saveState(sid, { ...state, edited, fails: 0, suspended: true });
  out({
    systemMessage: `solo check still FAILING after ${cfg.limits.stopRetries} auto-fix rounds — paused until the next edit to save usage. Run /check for details.`,
  });
  process.exit(0);
}
markSeen();
saveState(sid, { ...state, edited });
out({
  decision: 'block',
  reason: [
    `Automated checks failed on files changed in this session (round ${state.fails}/${cfg.limits.stopRetries}).`,
    'Fix the root cause. Do not weaken or skip tests, add ignores/any/!, or disable rules.',
    'If the failure is pre-existing or unrelated to your change, say so in one sentence and stop.',
    ...(failing.some((r) => r.env) ? ['Steps marked ENV are broken dependencies on this machine: leave them to the user, do not edit code or run npm install for them.'] : []),
    '',
    formatReport(res, cfg, root),
    ...fresh.flatMap((g) => ['', g.format(g.found)]),
  ].join('\n'),
});
