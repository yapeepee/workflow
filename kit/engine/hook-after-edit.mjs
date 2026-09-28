#!/usr/bin/env node
// PostToolUse (Edit|Write): runs after every file edit. Must stay fast.
// 1) remembers the edited file for the Stop hook (state lives in the OS temp dir, not in the repo)
// 2) formats that one file with the stack's formatter (silent on success). In a shared repo the result is
//    kept only if the formatter stayed next to the lines this session changed; otherwise the file goes back
//    to its unformatted state, so a one-line fix never turns into a whole-file diff for your teammates.
// 3) optional design-token guard: exit 2 feeds violations straight back to Claude
import fs from 'node:fs';
import path from 'node:path';
import { assignFiles, changedLines, expand, headLinesTouched, loadConfig, loadState, matchAny, readStdinJson, repoRoot, saveState, sh, stackDir, toRel } from './lib.mjs';
import { formatViolations, scanText } from './token-guard.mjs';

const input = readStdinJson();
const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
if (!file) process.exit(0);

const cwd = input.cwd || process.cwd();
const root = repoRoot(cwd);
const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);
const rel = toRel(root, abs);
if (!rel || !fs.existsSync(abs)) process.exit(0);

let cfg;
try {
  cfg = loadConfig(root);
} catch (e) {
  process.stderr.write(`solo: ${e.message}\n`);
  process.exit(0); // a broken config must not block editing
}
if (matchAny(cfg.ignore, rel)) process.exit(0);

// Tests written by test-author are red on purpose, and prototypes are throwaway:
// don't make the Stop hook chase them.
const UNTRACKED_AGENTS = new Set(['test-author', 'prototyper']);
if (!UNTRACKED_AGENTS.has(input.agent_type)) {
  const state = loadState(input.session_id);
  state.edited = [...new Set([...(state.edited || []), abs])];
  state.suspended = false;
  saveState(input.session_id, state);
}

// Lines "near" the edit: the formatter may reflow the statement it is in, but nothing further away.
const NEAR = 3;
for (const [stack, files] of assignFiles(cfg.stacks, [rel])) {
  if (files.length && stack.format) {
    const before = cfg.shared ? fs.readFileSync(abs) : null;
    const edited = cfg.shared ? headLinesTouched(root, rel) : null; // null → new file: format freely
    sh(expand(stack.format, files), { cwd: stackDir(root, stack), timeoutSec: cfg.limits.formatTimeoutSec });
    if (edited) {
      const after = fs.readFileSync(abs);
      const formattedLines = !after.equals(before) ? headLinesTouched(root, rel) : null;
      const near = (n) => {
        for (let d = -NEAR; d <= NEAR; d++) if (edited.has(n + d)) return true;
        return false;
      };
      if (formattedLines && [...formattedLines].some((n) => !near(n))) fs.writeFileSync(abs, before); // would touch lines nobody changed → undo
    }
    break;
  }
}

const tg = cfg.tokenGuard;
if (tg.enabled && matchAny(tg.files, rel) && !matchAny(tg.allow, rel)) {
  // Only lines that differ from HEAD: pre-existing raw values in a legacy file are not this edit's problem
  // (audit them with `node .solo/engine/token-guard.mjs <files>` when you choose to).
  const touched = changedLines(root, rel);
  let found = scanText(fs.readFileSync(abs, 'utf8'), rel, tg).filter((v) => !touched || touched.has(v.line));
  if (cfg.shared && found.length) {
    // no marker comments in shared code, so an intentional raw value is reported once per session, not on every edit
    const state = loadState(input.session_id);
    const key = (v) => `${rel}|${v.rule}|${v.text.trim()}`;
    const seen = new Set(state.tokenGuardSeen || []);
    found = found.filter((v) => !seen.has(key(v)));
    state.tokenGuardSeen = [...seen, ...found.map(key)].slice(-500);
    saveState(input.session_id, state);
  }
  if (found.length) {
    process.stderr.write(`${formatViolations(rel, found, { shared: cfg.shared })}\n`);
    process.exit(2);
  }
}
process.exit(0);
