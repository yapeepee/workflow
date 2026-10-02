#!/usr/bin/env node
// Patch guard — catches patches on the lines a change touched. Whether a line is a patch depends on the architecture,
// so there are two layers:
//   - the kit's own list (UNIVERSAL below): what silences a check, an error made to disappear, a workaround its author
//     labels as one. These break the kit's own architecture, where tools decide whether the work is right, so they count
//     in every project, except where the project means them to be (`patchGuard.allow`: generated code by default, an
//     adapter around an untyped library).
//   - the project's `patchGuard.patterns`: rules from .solo/architecture.md that one changed line can break, such as a
//     branch on a tenant id outside its owner, each with the owner's paths in its own `allow`. /architecture proposes
//     them; /learn adds one when the ledger escalates a mistake that shows on one line.
// It forbids nothing: the Stop hook blocks once so Claude runs the fit check in CLAUDE.local.md (follow the owner ·
// adjust the structure first · keep a registered patch), then keeps flagging what stays to you. A special case that no
// rule describes leaves no mark; the fit check covers that. Only changed lines count, because a legacy patch was not
// this change's decision, and test files are the test guard's job. Pure text matching: no model calls.
//
//   node .solo/engine/patch-guard.mjs              changed lines vs HEAD
//   node .solo/engine/patch-guard.mjs --base auto  vs the branch point (what a PR would show)
import fs from 'node:fs';
import path from 'node:path';
import { branchPoint, changedLines, git, isMain, loadConfig, matchAny, repoRoot, toRel } from './lib.mjs';

const LANGS = {
  js: /\.(?:[mc]?[jt]sx?)$/i,
  markup: /\.(?:html?|vue|svelte)$/i,
  cs: /\.(?:cs|cshtml|razor)$/i,
  py: /\.py$/i,
  css: /\.(?:css|scss|sass|less)$/i,
};
const langOf = (rel) => Object.keys(LANGS).find((k) => LANGS[k].test(rel)) || null;

// The kit's own list. Each entry: { name, in, re }
//   in   languages from LANGS
//   re   tested against a changed line plus the line after it, so `catch (e) {` followed by `}` can match;
//        a match has to start on the changed line
// Left out on purpose: TODO (the kit routes follow-ups to the inbox, but teams write TODO by convention, and /sweep
// collects them every week), and a catch that returns a default value (a patch only where the architecture says errors
// propagate, so that one is a project pattern).
const UNIVERSAL = [
  // a type checker told to look away
  { name: '@ts-ignore', in: ['js'], re: /@ts-(?:ignore|nocheck|expect-error)\b/ },
  { name: 'any', in: ['js'], re: /\bas\s+any\b|:\s*any\b|<\s*any\s*>|,\s*any\s*>/ },
  { name: '$any()', in: ['markup', 'js'], re: /\$any\s*\(/ },
  // "trust me, it is not null"; rules/dotnet.md allows it with a comment, which Claude can point to when blocked
  { name: 'non-null !', in: ['js', 'cs'], re: /[\w)\]]!(?=[.[)\],;\n])/ },
  // a linter or compiler told to look away
  { name: 'eslint-disable', in: ['js', 'markup'], re: /eslint-disable/ },
  { name: 'warnings off', in: ['cs'], re: /#pragma\s+warning\s+disable\b|#nullable\s+disable\b|\[\s*(?:assembly:\s*)?SuppressMessage\s*\(/ },
  { name: 'checker off', in: ['py'], re: /#\s*(?:type:\s*ignore|noqa\b|pylint:\s*disable|pyright:\s*ignore)/ },
  // an error made to disappear
  { name: 'empty catch', in: ['js', 'cs'], re: /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}|\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)\s*=>\s*\{\s*\}\s*\)/ },
  { name: 'except: pass', in: ['py'], re: /^\s*except\b[^:\n]*:\s*pass\b/ },
  // its author says so
  { name: 'workaround comment', in: Object.keys(LANGS), re: /(?:\/\/|\/\*|<!--|#)[^\n]*\b(?:HACK|FIXME|XXX|[Ww]ork-?arounds?)\b/ },
];

// The project's patterns come from JSON, so their regexes are strings; a broken one is reported, never fatal.
export function compilePatterns(cfg) {
  const pg = cfg.patchGuard || {};
  const invalid = [];
  const project = (pg.patterns || []).flatMap((p) => {
    try {
      if (!p.re) throw new Error('no "re"');
      return [{ rule: p.rule || '', name: p.name || 'pattern', in: p.in || Object.keys(LANGS), re: new RegExp(p.re), allow: p.allow || [] }];
    } catch (e) {
      invalid.push(`${p.rule || p.name || 'a pattern'}: ${e.message}`);
      return [];
    }
  });
  return { patterns: [...UNIVERSAL.map((p) => ({ ...p, rule: '', allow: pg.allow || [] })), ...project], invalid };
}

// only: the 1-based line numbers to report (the changed ones), or null for every line
function scan(text, patterns, only) {
  const lines = text.split(/\r?\n/);
  const found = [];
  lines.forEach((line, i) => {
    if (only && !only.has(i + 1)) return;
    const window = `${line}\n${lines[i + 1] ?? ''}`;
    for (const p of patterns) {
      const at = window.search(p.re);
      if (at >= 0 && at < line.length) found.push({ line: i + 1, rule: p.rule, name: p.name, text: line.trim().slice(0, 120) });
    }
  });
  return found;
}

/**
 * @param files absolute or repo-relative paths to inspect; null = every file changed vs base, untracked ones included
 * @param base  git ref the changed lines are measured against (default HEAD)
 * @returns [{ file, line, rule, name, text }]  rule: the architecture rule a project pattern stands for, '' for the kit's own
 */
export function findPatches(root, cfg, { files = null, base = 'HEAD' } = {}) {
  if (cfg.patchGuard?.enabled === false) return [];
  const { patterns } = compilePatterns(cfg);
  const isCode = (rel) => langOf(rel) && !matchAny(cfg.ignore, rel) && !matchAny(cfg.testGuard?.files, rel);
  const candidates = files
    ? files.map((f) => toRel(root, f)).filter(Boolean)
    : [
        ...(git(['diff', '--name-only', '--no-color', base], root) || '').split('\n'),
        ...(git(['ls-files', '--others', '--exclude-standard'], root) || '').split('\n'),
      ].filter(Boolean);
  const findings = [];
  for (const rel of [...new Set(candidates)].filter(isCode)) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const active = patterns.filter((p) => p.in.includes(langOf(rel)) && !matchAny(p.allow, rel));
    if (!active.length) continue;
    const only = changedLines(root, rel, base); // null: a new or untracked file, where every line is new
    if (only && !only.size) continue;
    for (const f of scan(fs.readFileSync(abs, 'utf8'), active, only)) findings.push({ file: rel, ...f });
  }
  return findings;
}

// Line numbers move while Claude edits above a finding, so a finding is known by its file, kind and text.
export const signature = (findings) =>
  findings
    .map((f) => `${f.file}|${f.rule}|${f.name}|${f.text}`)
    .sort()
    .join('\n');

const row = (f) => `  ${f.file}:${f.line}  ${f.rule ? `${f.rule} ` : ''}${f.name}: ${f.text}`;

export function formatPatches(findings) {
  return [
    'Patch guard: changed lines add patches that the checks cannot see.',
    ...findings.slice(0, 12).map(row),
    ...(findings.length > 12 ? [`  … ${findings.length - 12} more`] : []),
    'For each one, run the fit check in CLAUDE.local.md and show the searches you ran; a finding that names a rule breaks that rule in .solo/architecture.md, so start there. Then follow the owner, adjust the structure first, or keep it as a patch with a line under Known deviations.',
  ].join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const root = repoRoot();
  const cfg = loadConfig(root);
  const i = argv.indexOf('--base');
  const asked = i >= 0 && argv[i + 1] ? argv[i + 1] : 'HEAD';
  const base = asked === 'auto' ? branchPoint(root, cfg) : asked;
  for (const bad of compilePatterns(cfg).invalid) console.log(`skipped patchGuard.patterns entry ${bad} (fix it in .solo/config.json)`);
  const findings = findPatches(root, cfg, { base });
  if (!findings.length) {
    console.log('PATCH GUARD: PASS (no patch on a changed line)');
    return 0;
  }
  console.log(`PATCH GUARD: ${findings.length} patch(es) on changed lines (vs ${base.slice(0, 12)})`);
  for (const f of findings) console.log(row(f));
  console.log('Each one needs the fit check, and a line under Known deviations in .solo/architecture.md if it stays.');
  return 1;
}

if (isMain(import.meta.url)) {
  process.exitCode = main();
}
