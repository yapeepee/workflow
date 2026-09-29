#!/usr/bin/env node
// Compact verification runner — the single place where "is it done?" is decided by tools, not by the model.
//
//   node .solo/engine/check.mjs --stage stop --changed     fast checks on files changed vs HEAD
//   node .solo/engine/check.mjs --stage stop --files a b   fast checks on given files
//   node .solo/engine/check.mjs --stage full               everything (lint, types, tests, build)
//   node .solo/engine/check.mjs --update-baseline          accept current failures as known (legacy repos)
//   node .solo/engine/check.mjs --review-gate              should the branch get a code review / be split?
//   node .solo/engine/check.mjs --review-gate --base HEAD  the same question for the uncommitted work only (one /phase)
//
// Output is short on purpose: pass/fail per step, the error lines that matter, and a pointer to the full log.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  assignFiles, expand, git, isMain, loadConfig, matchAny, normalizeIssues, repoRoot, sh, stackDir, summarize, toRel, writeLog,
} from './lib.mjs';

export function changedFiles(root) {
  const tracked = git(['diff', '--name-only', 'HEAD'], root) ?? git(['diff', '--name-only'], root) ?? '';
  const untracked = git(['ls-files', '--others', '--exclude-standard'], root) ?? '';
  return [...new Set(`${tracked}\n${untracked}`.split('\n').map((s) => s.trim()).filter(Boolean))];
}

const baselineFile = (root, stack, step) => path.join(root, '.solo', 'baseline', `${stack.name}-${step.name}.txt`);

// Failures caused by the machine, not by the code: half-installed or missing dependencies, a tool that isn't installed.
// Claude must not try to "fix" these by editing code (or by running npm install, which rewrites the team's lockfile).
const ENV_PATTERNS = [
  /Cannot find module ['"][^'"\n]*node_modules/i,
  /ERR_MODULE_NOT_FOUND[^\n]*node_modules/i,
  /Cannot find package ['"][^'"\n]+['"] imported from/i,
  /is not recognized as an internal or external command/i,
  /: command not found/i,
  /could not determine executable to run/i,
  /NETSDK1004|project\.assets\.json' not found/i,
];
export const isEnvFailure = (out) => ENV_PATTERNS.some((re) => re.test(out || ''));

// A test runner that could not even load the tests (compile or load errors) ran nothing. Recording that as a
// "known issue" would turn the step green while zero tests run, so it is reported, never baselined.
const NO_RUN_PATTERNS = [/Found \d+ load errors?/i, /Executed 0 of 0/i, /No test files found/i, /Test Suites: (\d+) failed, \1 total/];
export const suiteDidNotRun = (out) => NO_RUN_PATTERNS.some((re) => re.test(out || ''));

// Checks must not change files. Fingerprint each tracked file's diff against HEAD before and after a step;
// anything that differs afterwards was changed by the step itself (eslint --fix, a build writing into src, …).
function trackedDiffs(root) {
  const out = git(['diff', 'HEAD', '--no-color', '--no-ext-diff', '--binary'], root);
  if (out === null) return null; // no HEAD yet, or not a git repo: can't tell
  const map = new Map();
  for (const chunk of out.split(/^(?=diff --git )/m)) {
    const m = chunk.match(/^diff --git a\/(.+?) b\//);
    if (m) map.set(m[1], createHash('sha1').update(chunk.trimEnd()).digest('hex')); // the last chunk loses its newline to trim()
  }
  return map;
}
function changedBy(before, after) {
  if (!before || !after) return [];
  return [...after].filter(([f, h]) => before.get(f) !== h).map(([f]) => f).concat([...before.keys()].filter((f) => !after.has(f)));
}

// the command that reinstalls exactly what the lockfile says (never rewrites tracked files)
export function restoreCommand(root, stack) {
  const dir = stackDir(root, stack);
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'pnpm-lock.yaml'))) return 'pnpm install --frozen-lockfile';
    if (fs.existsSync(path.join(d, 'yarn.lock'))) return 'yarn install --frozen-lockfile';
    if (fs.existsSync(path.join(d, 'package-lock.json'))) return 'npm ci';
    if (fs.readdirSync(d).some((f) => /\.(sln|slnx|csproj)$/i.test(f))) return 'dotnet restore';
    if (path.resolve(d) === path.resolve(root) || path.dirname(d) === d) break;
  }
  return 'npm ci';
}

export function runStage({ root, cfg, stage, files = null, updateBaseline = false }) {
  const results = [];
  const scoped = files
    ? files
        .map((f) => toRel(root, f))
        .filter(Boolean)
        .filter((f) => !matchAny(cfg.ignore, f) && fs.existsSync(path.join(root, f)))
    : null;
  const assigned = scoped ? assignFiles(cfg.stacks, scoped) : null;
  let changedCache = null;

  for (const stack of cfg.stacks) {
    const steps = stack[stage] || [];
    if (!steps.length) continue;
    const stackFiles = assigned ? assigned.get(stack) : null;
    if (stage === 'stop' && assigned && stackFiles.length === 0) continue; // this stack wasn't touched

    for (const step of steps) {
      if ((cfg.disabledSteps || []).includes(`${stack.name}/${step.name}`)) {
        results.push({ stack: stack.name, step: step.name, status: 'skip', note: 'disabled in .solo/config.json (disabledSteps)' });
        continue;
      }
      let targets = stackFiles;
      if (/\{files?\}/.test(step.run)) {
        if (!targets) {
          changedCache ??= changedFiles(root).filter((f) => !matchAny(cfg.ignore, f));
          targets = assignFiles(cfg.stacks, changedCache).get(stack);
        }
        if (step.only) targets = targets.filter((f) => matchAny(step.only, f));
        if (!targets.length) {
          results.push({ stack: stack.name, step: step.name, status: 'skip', note: 'no matching files' });
          continue;
        }
      }
      const cmd = expand(step.run, targets || []);
      const timeoutSec = step.timeoutSec ?? (stage === 'stop' ? cfg.limits.stopTimeoutSec : cfg.limits.fullTimeoutSec);
      const before = trackedDiffs(root);
      const t0 = Date.now();
      const r = sh(cmd, { cwd: stackDir(root, stack), timeoutSec });
      const ms = Date.now() - t0;
      const mutated = changedBy(before, trackedDiffs(root));
      const logFile = writeLog(root, `${stack.name}-${step.name}`, `$ ${cmd}\n(cwd: ${stackDir(root, stack)})\n\n${r.out}`);
      let status = r.code === 0 ? 'pass' : 'fail';
      let note = r.timedOut ? `timed out after ${timeoutSec}s` : '';
      let fresh = null;
      const bf = baselineFile(root, stack, step);

      const env = status === 'fail' && !r.timedOut && isEnvFailure(r.out);
      const noRun = status === 'fail' && !r.timedOut && !env && suiteDidNotRun(r.out);
      if (updateBaseline && env) {
        note = `baseline NOT saved: dependencies look broken — run \`${restoreCommand(root, stack)}\` in ${toRel(root, stackDir(root, stack)) || '.'} first`;
      } else if (updateBaseline && noRun) {
        note = 'baseline NOT saved: the test suite did not run at all (compile or load errors)';
      } else if (updateBaseline) {
        fs.mkdirSync(path.dirname(bf), { recursive: true });
        if (status === 'fail' && !r.timedOut) {
          const issues = [...normalizeIssues(r.out, root).keys()].sort();
          fs.writeFileSync(bf, `${issues.join('\n')}\n`);
          note = `baseline saved: ${issues.length} known issue(s)`;
          status = 'pass';
        } else if (fs.existsSync(bf)) {
          fs.rmSync(bf);
          note = 'baseline removed (step passes)';
        }
      } else if (status === 'fail' && !r.timedOut && !noRun && step.baseline !== false && fs.existsSync(bf)) {
        const known = new Set(fs.readFileSync(bf, 'utf8').split(/\r?\n/).filter(Boolean));
        const now = normalizeIssues(r.out, root);
        fresh = [...now].filter(([key]) => !known.has(key)).map(([, shown]) => shown);
        if (now.size > 0 && fresh.length === 0) {
          status = 'pass';
          note = `${now.size} known issue(s) in baseline`;
        } else if (fresh.length) note = `${fresh.length} new issue(s) vs baseline`;
      }
      if (mutated.length) {
        status = 'fail'; // a check that edits files is broken, whatever its exit code
        note = `this step CHANGED ${mutated.length} tracked file(s)`;
      }
      const fix = env && status === 'fail' ? `${restoreCommand(root, stack)} (in ${toRel(root, stackDir(root, stack)) || 'the repo root'})` : null;
      results.push({
        stack: stack.name, step: step.name, status, ms, note, cmd, logFile, out: r.out, fresh,
        env: env && status === 'fail', fix, noRun: noRun && status === 'fail', mutated,
      });
    }
  }
  return { ok: results.every((x) => x.status !== 'fail'), results };
}

export function formatReport(res, cfg, root) {
  const lines = [];
  for (const r of res.results) {
    const tag = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'skip';
    const time = r.ms ? ` (${(r.ms / 1000).toFixed(1)}s)` : '';
    lines.push(`${tag} ${r.stack}/${r.step}${time}${r.note ? ` — ${r.note}` : ''}`);
    if (r.status === 'fail') {
      const body = r.fresh?.length ? r.fresh.slice(0, cfg.limits.outputLines).join('\n') : summarize(r.out, cfg.limits.outputLines, root);
      lines.push(body.split('\n').map((l) => `    ${l}`).join('\n'));
      if (r.env) lines.push(`    ENV: the project's dependencies look missing or half-installed — not a code problem. Don't edit code or run npm install for it; the user should run: ${r.fix}`);
      if (r.noRun) lines.push('    SUITE DID NOT RUN: the test runner could not load the tests, so no test ran. A baseline cannot cover this: fix the tests, or add this step to "disabledSteps" in .solo/config.json for now.');
      if (r.mutated?.length)
        lines.push(`    CHANGED FILES: this check modified ${r.mutated.slice(0, 5).join(', ')}${r.mutated.length > 5 ? ' …' : ''}. Checks must never change code — review with \`git diff\`, undo with \`git restore <file>\`, and fix the command in .solo/config.json.`);
      lines.push(`    full log: ${toRel(root, r.logFile)}`);
    }
  }
  if (!res.results.length) lines.push('skip (no configured steps for this stage/files — see .solo/config.json)');
  return lines.join('\n');
}

function detectBase(root) {
  for (const ref of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
    const mb = git(['merge-base', 'HEAD', ref], root);
    if (mb) return mb;
  }
  return 'HEAD';
}

// base: HEAD reviews one phase before its commit; the default (the branch point) reviews everything a PR would show.
// Measuring a phase against the branch point would make every phase re-review the ones already committed.
export function reviewGate(root, cfg, base = cfg.ship.base || detectBase(root)) {
  const counted = (f) => !matchAny(cfg.ignore, f) && !matchAny(cfg.review.ignore, f);
  let lines = 0;
  const files = [];
  for (const row of (git(['diff', '--numstat', base], root) || '').split('\n').filter(Boolean)) {
    const [add, del, file] = row.split('\t');
    if (!file || !counted(file)) continue;
    files.push(file);
    lines += (parseInt(add, 10) || 0) + (parseInt(del, 10) || 0);
  }
  for (const f of (git(['ls-files', '--others', '--exclude-standard'], root) || '').split('\n').filter(Boolean)) {
    if (!counted(f)) continue;
    files.push(f);
    try {
      lines += fs.readFileSync(path.join(root, f), 'utf8').split('\n').length;
    } catch {
      /* binary or unreadable */
    }
  }
  const risky = files.filter((f) => matchAny(cfg.review.alwaysPaths, f));
  const reasons = [];
  if (lines >= cfg.review.minLines) reasons.push(`${lines} changed lines >= ${cfg.review.minLines}`);
  if (risky.length) reasons.push(`risky paths: ${risky.slice(0, 5).join(', ')}${risky.length > 5 ? ' …' : ''}`);
  const split = lines >= (cfg.review.splitLines ?? Infinity);
  return { required: reasons.length > 0, lines, files: files.length, risky, reasons, base, split };
}

function parseArgs(argv) {
  const a = { stage: 'full', files: null, changed: false, updateBaseline: false, reviewGate: false, base: undefined };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--stage') a.stage = argv[++i];
    else if (k === '--base') a.base = argv[++i];
    else if (k === '--changed') a.changed = true;
    else if (k === '--update-baseline') a.updateBaseline = true;
    else if (k === '--review-gate') a.reviewGate = true;
    else if (k === '--files') {
      a.files = [];
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) a.files.push(argv[++i]);
    } else if (k === '-h' || k === '--help') a.help = true;
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  const root = repoRoot();
  let cfg;
  try {
    cfg = loadConfig(root);
  } catch (e) {
    console.error(`CONFIG ERROR: ${e.message}`);
    return 2;
  }

  if (a.reviewGate) {
    const g = reviewGate(root, cfg, a.base);
    console.log(
      g.required
        ? `REVIEW REQUIRED — ${g.reasons.join('; ')} (${g.files} files vs ${g.base.slice(0, 10)})`
        : `REVIEW OPTIONAL — ${g.lines} changed lines in ${g.files} files, no risky paths (threshold ${cfg.review.minLines})`,
    );
    if (g.split) console.log(`SPLIT SUGGESTED — ${g.lines} changed lines >= ${cfg.review.splitLines}: propose smaller PRs that each pass the checks on their own`);
    return 0;
  }

  if (a.updateBaseline) {
    for (const stage of ['stop', 'full']) {
      const res = runStage({ root, cfg, stage, updateBaseline: true });
      console.log(`[${stage}]\n${formatReport(res, cfg, root)}`);
    }
    console.log('Baselines are in .solo/baseline/ (private; .worktreeinclude copies them into new worktrees). Never commit them to a shared repo.');
    return 0;
  }

  if (!['stop', 'full'].includes(a.stage)) {
    console.error('--stage must be "stop" or "full"');
    return 2;
  }
  const files = a.files ?? (a.changed ? changedFiles(root) : null);
  if (a.stage === 'stop' && files && files.length === 0) {
    console.log('RESULT: PASS (no changed files)');
    return 0;
  }
  const res = runStage({ root, cfg, stage: a.stage, files: a.stage === 'stop' ? files ?? changedFiles(root) : files });
  console.log(formatReport(res, cfg, root));
  const failing = res.results.filter((r) => r.status === 'fail');
  const envOnly = failing.length > 0 && failing.every((r) => r.env);
  console.log(
    res.ok
      ? 'RESULT: PASS'
      : `RESULT: FAIL (${failing.length} failing step${failing.length > 1 ? 's' : ''})${envOnly ? ` — environment, not code: run ${failing[0].fix} and check again` : ''}`,
  );
  return res.ok ? 0 : 1;
}

if (isMain(import.meta.url)) {
  process.exitCode = main();
}
