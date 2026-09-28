#!/usr/bin/env node
// Test guard — a mechanical check for the agent "making the tests pass" by weakening them
// (Kent Beck's warning sign: "any indication that the genie was cheating").
// Compares test files with a git base (HEAD by default) and reports:
//   - fewer test cases (deleted or commented out)
//   - new skip / only / focus markers (xit, it.skip, fit, .only, [Fact(Skip=...)], [Ignore], @pytest.mark.skip …)
//   - fewer assertions
//   - deleted test files (renames are fine)
// Pure text comparison: no model calls, no test run.
//
//   node .solo/engine/test-guard.mjs              changed test files vs HEAD
//   node .solo/engine/test-guard.mjs --base auto  vs the branch point (what a PR would show)
import fs from 'node:fs';
import path from 'node:path';
import { git, isMain, loadConfig, matchAny, repoRoot, toRel } from './lib.mjs';

// (?<![.\w$]) keeps `/re/.test(x)` and `commit(` from counting as tests
const JS = {
  tests: /(?<![.\w$])(?:x|f)?(?:it|test)(?:\.(?:skip|only|each|concurrent|failing|todo))*\s*[(`]/g,
  markers: /(?<![.\w$])(?:xit|xtest|xdescribe|fit|ftest|fdescribe)\s*\(|(?<![.\w$])(?:it|test|describe)\.(?:skip|only)\b|(?<![.\w$])pending\s*\(/g,
  asserts: /(?<![.\w$])expect\s*\(|(?<![.\w$])assert(?:\.\w+)?\s*\(/g,
  strip: (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
};
const CS = {
  tests: /\[\s*(?:Fact|Theory|Test|TestMethod|DataTestMethod|TestCase)\b/g,
  markers: /\bSkip\s*=|\[\s*Ignore\b|\[\s*Explicit\b|\bAssert\.Inconclusive\s*\(/g,
  asserts: /\bAssert\.\w+\s*\(|\.Should\(\)/g,
  strip: JS.strip,
};
const PY = {
  tests: /^\s*(?:async\s+)?def\s+test_\w*/gm,
  markers: /@pytest\.mark\.(?:skip|skipif|xfail)\b|@unittest\.skip|\bpytest\.skip\s*\(/g,
  asserts: /^\s*assert\b|\bself\.assert\w+\s*\(/gm,
  strip: (s) => s.replace(/#.*$/gm, ''),
};
const langOf = (file) => (/\.(?:[mc]?[jt]sx?)$/i.test(file) ? JS : /\.cs$/i.test(file) ? CS : /\.py$/i.test(file) ? PY : null);

export function countSignals(text, lang) {
  const body = lang.strip(text);
  const n = (re) => (body.match(re) || []).length;
  return { tests: n(lang.tests), markers: n(lang.markers), asserts: n(lang.asserts) };
}

// what changed in a single test file, in words ([] = nothing weakened)
export function compareTestFile(before, after, file) {
  const lang = langOf(file);
  if (!lang || before == null) return []; // not a known language, or a brand-new file
  const a = countSignals(before, lang);
  const b = countSignals(after, lang);
  const out = [];
  if (b.tests < a.tests) out.push(`tests ${a.tests} → ${b.tests}`);
  if (b.markers > a.markers) out.push(`skip/only markers +${b.markers - a.markers}`);
  if (b.asserts < a.asserts) out.push(`assertions ${a.asserts} → ${b.asserts}`);
  return out;
}

// name-status vs base: { deleted: [paths], renamedFrom: Map(newPath → oldPath) }
// A file moved with plain `mv` shows up as "deleted" plus an untracked file; a same-named untracked file counts as the move.
function statusVs(root, base) {
  const out = git(['diff', '--name-status', '-M', '--no-color', base], root) || '';
  let deleted = [];
  const renamedFrom = new Map();
  for (const row of out.split('\n').filter(Boolean)) {
    const [st, p1, p2] = row.split('\t');
    if (st === 'D') deleted.push(p1);
    else if (st && st.startsWith('R') && p2) renamedFrom.set(p2, p1);
  }
  if (deleted.length) {
    const untracked = (git(['ls-files', '--others', '--exclude-standard'], root) || '').split('\n').filter(Boolean);
    deleted = deleted.filter((d) => {
      const moved = untracked.find((u) => path.posix.basename(u) === path.posix.basename(d) && !renamedFrom.has(u));
      if (moved) renamedFrom.set(moved, d);
      return !moved;
    });
  }
  return { deleted, renamedFrom };
}

/**
 * @param root  repo root
 * @param cfg   loaded config
 * @param files absolute or repo-relative paths to inspect; null = every changed file vs base
 * @param base  git ref to compare with (default HEAD)
 * @returns [{ file, text }] one entry per weakened or deleted test file
 */
export function findWeakenedTests(root, cfg, { files = null, base = 'HEAD' } = {}) {
  const tg = cfg.testGuard || {};
  if (tg.enabled === false) return [];
  if (git(['rev-parse', '--verify', '--quiet', base], root) === null) return []; // no commits yet
  const isTest = (rel) => matchAny(tg.files, rel) && !matchAny(cfg.ignore, rel);
  const { deleted, renamedFrom } = statusVs(root, base);
  const candidates = files
    ? files.map((f) => toRel(root, f)).filter(Boolean)
    : (git(['diff', '--name-only', '--no-color', base], root) || '').split('\n').filter(Boolean);
  const findings = [];
  for (const rel of [...new Set(candidates)].filter(isTest)) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue; // deletions are reported below
    const before = git(['show', `${base}:${renamedFrom.get(rel) || rel}`], root);
    const changes = compareTestFile(before, fs.readFileSync(abs, 'utf8'), rel);
    if (changes.length) findings.push({ file: rel, text: `${rel}: ${changes.join('; ')}` });
  }
  for (const rel of deleted.filter(isTest)) findings.push({ file: rel, text: `${rel}: deleted` });
  return findings;
}

export const signature = (findings) =>
  findings
    .map((f) => f.text)
    .sort()
    .join('\n');

export function formatWeakened(findings) {
  return [
    'Test guard: tests look weaker than in HEAD.',
    ...findings.slice(0, 12).map((f) => `  ${f.text}`),
    ...(findings.length > 12 ? [`  … ${findings.length - 12} more`] : []),
    'Restore them unless removing or skipping them is the point of this task. If it is, say why in one sentence.',
    'Never delete, skip, comment out or loosen a test to make checks pass.',
  ].join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const root = repoRoot();
  const cfg = loadConfig(root);
  let base = 'HEAD';
  const i = argv.indexOf('--base');
  if (i >= 0 && argv[i + 1]) base = argv[i + 1];
  if (base === 'auto') {
    base = 'HEAD';
    for (const ref of [cfg.ship?.base, 'origin/HEAD', 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean)) {
      const mb = git(['merge-base', 'HEAD', ref], root);
      if (mb) {
        base = mb;
        break;
      }
    }
  }
  const findings = findWeakenedTests(root, cfg, { base });
  if (!findings.length) {
    console.log('TEST GUARD: PASS (no test was removed, skipped or loosened)');
    return 0;
  }
  console.log(`TEST GUARD: WEAKENED (vs ${base.slice(0, 12)})`);
  for (const f of findings) console.log(`  ${f.text}`);
  return 1;
}

if (isMain(import.meta.url)) {
  process.exitCode = main();
}
