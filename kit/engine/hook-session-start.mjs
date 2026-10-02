#!/usr/bin/env node
// SessionStart (startup | resume | clear | compact): re-inject the active task card and progress,
// so /clear is safe and cheaper than /compact. Prints nothing when there is no active task.
// Also guards the private files: git treats excluded files as expendable, so if a teammate ever commits a
// file with the same name, `git pull` silently replaces your copy. Keep a backup and warn when it happens.
import path from 'node:path';
import fs from 'node:fs';
import { activeTask, git, posix, readHead, readStdinJson, repoRoot, toRel } from './lib.mjs';

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
const fromRoot = process.env.CLAUDE_PROJECT_DIR ? toRel(root, path.resolve(process.env.CLAUDE_PROJECT_DIR)) : null;
if (fromRoot && fs.existsSync(path.join(root, '.solo', 'engine'))) {
  warnings.push(
    `[solo] This session started in ${fromRoot}/, but the kit lives at the repo root ${posix(root)}. Run kit commands from there, e.g. cd "${posix(root)}" && node .solo/engine/check.mjs --stage full. Opening VS Code at the repo root avoids this.`,
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
// The card is injected up to its Change log, which follows as its own block: /spec adds the log at the bottom, and a
// requirement changed after approval must reach the new session even when the card is longer than the injected head.
function specParts(file) {
  let lines;
  try {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    return { card: '', changes: [] };
  }
  const at = lines.findIndex((l) => /^##\s+Change\s*log\b/i.test(l));
  const body = at < 0 ? lines : lines.slice(0, at);
  const MAX = 40;
  const card = body.slice(0, MAX).join('\n').trimEnd() + (body.length > MAX ? `\n… (${body.length - MAX} more lines in spec.md)` : '');
  const rest = at < 0 ? [] : lines.slice(at + 1);
  const end = rest.findIndex((l) => /^#{1,2}\s/.test(l)); // the log ends at the next section
  const changes = (end < 0 ? rest : rest.slice(0, end)).filter((l) => l.trim() && !/^\s*(<!--|```)/.test(l));
  const KEEP = 10;
  return { card, changes: changes.length > KEEP ? [`… (${changes.length - KEEP} earlier changes in spec.md)`, ...changes.slice(-KEEP)] : changes };
}
const { card: spec, changes } = specParts(path.join(dir, 'spec.md'));
const progress = readHead(path.join(dir, 'progress.md'), 25);
const hasPlan = fs.existsSync(path.join(dir, 'plan.md'));

// /spec writes phases as "## Phase <n> — <goal> · status: todo" and /phase marks them "status: done".
// Only the first phase not done is injected: it is where work resumes, and later phases are not this session's job.
function currentPhase(file) {
  const phases = fs.readFileSync(file, 'utf8').split(/^(?=## Phase\b)/m).filter((s) => s.startsWith('## Phase'));
  const heading = (p) => p.split(/\r?\n/)[0];
  // a plan written before phases had a status would look entirely unfinished: say nothing rather than guess
  if (!phases.some((p) => /status:/i.test(heading(p)))) return null;
  const i = phases.findIndex((p) => !/status:\s*done/i.test(heading(p)));
  if (i < 0) return `--- plan.md: all ${phases.length} phases done → /ship ---`;
  return `--- plan.md: current phase (${i + 1} of ${phases.length}) ---\n${phases[i].trimEnd().split(/\r?\n/).slice(0, 20).join('\n')}`;
}

const lines = [
  `[solo] active task: ${slug} · branch ${branch} · ${dirty} uncommitted file(s)${hasPlan ? ` · plan: .solo/tasks/${slug}/plan.md` : ''}`,
];
if (spec) lines.push('--- spec.md ---', spec);
if (changes.length) lines.push('--- spec.md Change log (approved changes, newest last) ---', ...changes);
const phase = hasPlan ? currentPhase(path.join(dir, 'plan.md')) : null;
if (phase) lines.push(phase);
// /spec sends an M task through /clear before plan mode, so the phase format it describes would be lost with the old
// context. Carry it into the planning session until plan.md exists.
if (!hasPlan && /^Size:\s*M\b/m.test(spec)) {
  lines.push(
    `--- plan format for this M task: plan mode first; after the user approves, save the plan to .solo/tasks/${slug}/plan.md as short phases (about 150 lines in total), each small enough to review on its own ---`,
    '## Phase <n> — <goal> · status: todo',
    'Type: behavior | structural (no behavior change: no assertion may change)',
    'Files: <files it changes>',
    'Covers: <AC ids>',
    'Pattern: <recipe from .solo/architecture.md> — follow `<reference file>`',
    'Verify: <the command that proves this phase works>',
    '--- then /phase once per phase, and /ship after the last one ---',
  );
}
if (progress) lines.push('--- progress.md (continue from "Next") ---', progress);
say(lines);
