#!/usr/bin/env node
// SessionStart (startup | resume | clear | compact): re-inject the active task card and progress,
// so /clear is safe and cheaper than /compact. Prints nothing when there is no active task.
// Also guards the private files: git treats excluded files as expendable, so if a teammate ever commits a
// file with the same name, `git pull` silently replaces your copy. Keep a backup and warn when it happens.
import path from 'node:path';
import fs from 'node:fs';
import { activeTask, git, posix, readHead, readStdinJson, repoRoot } from './lib.mjs';

const input = readStdinJson();
const root = repoRoot(input.cwd || process.cwd());

const PRIVATE = ['CLAUDE.local.md', '.claude/settings.local.json'];
const warnings = [];
const trackedNow = new Set((git(['ls-files', '--', ...PRIVATE], root) || '').split('\n').filter(Boolean));
for (const rel of PRIVATE) {
  const file = path.join(root, rel);
  const backup = path.join(root, '.solo', 'backup', path.basename(rel));
  if (trackedNow.has(rel)) {
    const saved = fs.existsSync(backup) ? ` Your last private copy is in .solo/backup/${path.basename(rel)}.` : '';
    warnings.push(`[solo] WARNING: the team repo now tracks ${rel}, so it is no longer private.${saved} Do not edit ${rel} (changes would show up in git status); tell me about this at the start of your reply.`);
    continue;
  }
  try {
    const cur = fs.readFileSync(file);
    if (!fs.existsSync(backup) || !fs.readFileSync(backup).equals(cur)) {
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(backup, cur);
    }
  } catch {
    /* no such file yet */
  }
}

// Opened in a subfolder (e.g. VS Code on frontend/): the hooks still find the kit, but `node .solo/engine/...`
// commands only resolve from the repo root.
const started = process.env.CLAUDE_PROJECT_DIR ? path.resolve(process.env.CLAUDE_PROJECT_DIR) : null;
const fromRoot = started ? path.relative(root, started) : '';
if (fromRoot && !fromRoot.startsWith('..') && !path.isAbsolute(fromRoot) && fs.existsSync(path.join(root, '.solo', 'engine'))) {
  warnings.push(
    `[solo] This session started in ${posix(fromRoot)}/, but the kit lives at the repo root ${posix(root)}. Run kit commands from there, e.g. cd "${posix(root)}" && node .solo/engine/check.mjs --stage full. Opening VS Code at the repo root avoids this.`,
  );
}

const say = (lines) => process.stdout.write(`${[...warnings, ...lines].join('\n')}\n`);
const slug = activeTask(root);
const dir = slug ? path.join(root, '.solo', 'tasks', slug) : null;
if (!dir || !fs.existsSync(dir)) {
  if (warnings.length) say([]);
  process.exit(0);
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root) || '?';
const dirty = (git(['status', '--porcelain'], root) || '').split('\n').filter(Boolean).length;
const spec = readHead(path.join(dir, 'spec.md'), 30);
const progress = readHead(path.join(dir, 'progress.md'), 25);
const hasPlan = fs.existsSync(path.join(dir, 'plan.md'));

const lines = [
  `[solo] active task: ${slug} · branch ${branch} · ${dirty} uncommitted file(s)${hasPlan ? ` · plan: .solo/tasks/${slug}/plan.md` : ''}`,
];
if (spec) lines.push('--- spec.md ---', spec);
if (progress) lines.push('--- progress.md (continue from "Next") ---', progress);
say(lines);
