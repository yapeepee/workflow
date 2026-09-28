#!/usr/bin/env node
// Lessons ledger (reshaped from the agent-harnesses verdict ledger).
// Counts recurring mistakes by category so a rule graduates from prose to a mechanical check
// once it has cost you `threshold` times (default 3) — Boris Cherny's "3-4 repeats → lint rule" habit.
//
//   node .solo/engine/ledger.mjs add <category> "<lesson>" [--task <slug>] [--source review|check|user|self]
//   node .solo/engine/ledger.mjs list [--since 7d|30d]
//   node .solo/engine/ledger.mjs enforce <category> "<how it is enforced now>"
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './lib.mjs';

const root = repoRoot();
const file = path.join(root, '.solo', 'ledger.json');
const load = () => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { version: 1, threshold: 3, entries: [], enforced: {} };
  }
};
const save = (db) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(db, null, 2)}\n`);
};
const today = () => new Date().toISOString().slice(0, 10);
const flag = (args, name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = (args) => args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

const [cmd, ...rest] = process.argv.slice(2);
const db = load();

if (cmd === 'add') {
  const [category, lesson] = positional(rest);
  if (!category || !lesson) {
    console.error('usage: ledger.mjs add <category> "<lesson>" [--task slug] [--source review|check|user|self]');
    process.exit(2);
  }
  const cat = category.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  db.entries.push({ date: today(), category: cat, lesson, task: flag(rest, '--task') || null, source: flag(rest, '--source') || null });
  save(db);
  const count = db.entries.filter((e) => e.category === cat).length;
  let msg = `logged [${cat}] — ${count} occurrence(s) total.`;
  if (db.enforced[cat]) {
    msg += ` NOTE: '${cat}' is enforced by "${db.enforced[cat].how}" since ${db.enforced[cat].date}; a new occurrence means that check has a gap — inspect it.`;
  } else if (count >= db.threshold) {
    msg += ` ESCALATE: '${cat}' reached ${count}. Propose a mechanical check (lint rule, test, check step or hook) instead of another prose rule.`;
  }
  console.log(msg);
} else if (cmd === 'list') {
  const since = flag(rest, '--since');
  const days = since ? parseInt(since, 10) : null;
  const cutoff = days ? new Date(Date.now() - days * 864e5).toISOString().slice(0, 10) : '0000';
  const rows = new Map();
  for (const e of db.entries) {
    const r = rows.get(e.category) || { total: 0, recent: 0, last: '', lastLesson: '' };
    r.total += 1;
    if (e.date >= cutoff) r.recent += 1;
    if (e.date >= r.last) {
      r.last = e.date;
      r.lastLesson = e.lesson;
    }
    rows.set(e.category, r);
  }
  const sorted = [...rows.entries()].filter(([, r]) => !days || r.recent > 0).sort((a, b) => b[1].recent - a[1].recent || b[1].total - a[1].total);
  if (!sorted.length) console.log(days ? `no lessons logged in the last ${days} days` : 'ledger is empty');
  for (const [cat, r] of sorted) {
    const status = db.enforced[cat] ? `enforced: ${db.enforced[cat].how}` : r.total >= db.threshold ? 'ESCALATE' : '';
    console.log(`${cat.padEnd(18)} total ${String(r.total).padStart(2)}${days ? `  last ${days}d ${String(r.recent).padStart(2)}` : ''}  last ${r.last}  ${status}\n    ↳ ${r.lastLesson}`);
  }
} else if (cmd === 'enforce') {
  const [category, how] = positional(rest);
  if (!category || !how) {
    console.error('usage: ledger.mjs enforce <category> "<how it is enforced>"');
    process.exit(2);
  }
  db.enforced[category] = { how, date: today() };
  save(db);
  console.log(`'${category}' marked as enforced by: ${how}. Remove the prose rule it replaces.`);
} else {
  console.log('usage: ledger.mjs add|list|enforce …  (see header of this file)');
  process.exit(cmd ? 2 : 0);
}
