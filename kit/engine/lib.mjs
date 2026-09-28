// Shared helpers for the solo-ai-team kit. Node >= 18, no dependencies.
// Everything here is deterministic: no model calls, no network.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = {
  // shared: true in a repo other people commit to. Then nothing the kit does may reach the team:
  // /ship and /sweep leave git alone, the formatter never reformats lines you did not touch,
  // and the token guard never asks for marker comments in the code.
  shared: false,
  stacks: [],
  limits: { outputLines: 30, stopRetries: 3, formatTimeoutSec: 20, stopTimeoutSec: 180, fullTimeoutSec: 900 },
  review: {
    minLines: 300,
    splitLines: 400, // /ship suggests splitting into several PRs above this many changed lines (small batches)
    alwaysPaths: ['**/auth/**', '**/security/**', '**/migrations/**', '**/*.sql', '**/payment*/**', '.github/workflows/**'],
    ignore: ['**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/*.min.*', '**/*.snap', '**/*.svg'],
  },
  ignore: ['**/node_modules/**', '**/dist/**', '**/bin/**', '**/obj/**', '**/.angular/**', '**/coverage/**', '.claude/**', '.solo/**'],
  ui: { enabled: false, root: '.', baseUrl: 'http://localhost:4200', serve: 'npm start', routes: ['/'], viewports: [[1440, 900], [390, 844]], waitMs: 500 },
  tokenGuard: {
    enabled: false,
    files: ['**/*.{css,scss,sass,less,html,ts,tsx,jsx}'],
    allow: ['**/tokens.*', '**/theme.*', '**/tailwind.config.*', '**/assets/**'],
    rules: { hexColor: true, colorFunction: true, inlineStyle: true, styleBinding: true, arbitraryValue: true },
  },
  // Stop hook flags tests that got weaker than in HEAD: fewer cases, new skip/only markers, fewer asserts, deleted files
  testGuard: {
    enabled: true,
    files: [
      '**/*.{spec,test}.{ts,tsx,js,jsx,mjs,cjs}',
      '**/__tests__/**/*.{ts,tsx,js,jsx,mjs,cjs}',
      '**/*{Test,Tests}.cs',
      '**/*.{Test,Tests}/**/*.cs',
      '**/test_*.py',
      '**/*_test.py',
      '**/tests/**/*.py',
    ],
  },
  ship: { mode: 'manual', base: '' },
  proto: { dir: '_proto' },
};

// ---------- stdin / json ----------
export function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

// ---------- processes ----------
export function sh(cmd, { cwd, timeoutSec = 120, env = {} } = {}) {
  const res = spawnSync(cmd, {
    cwd,
    shell: true,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutSec * 1000,
    maxBuffer: 64 * 1024 * 1024,
    // plain, English, non-interactive output keeps summaries short and baselines stable on any OS locale
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1', DOTNET_CLI_UI_LANGUAGE: 'en', VSLANG: '1033', ...env },
  });
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const timedOut = res.error?.code === 'ETIMEDOUT' || (res.status === null && res.signal != null);
  const code = res.status ?? (timedOut ? 124 : 1);
  const spawnErr = res.error && !timedOut ? `\n[spawn error] ${res.error.message}` : '';
  return { code, out: `${stdout}${stdout && stderr ? '\n' : ''}${stderr}${spawnErr}`, timedOut };
}

// True when this module is the script node was started with (robust to symlinks and drive-letter case).
export function isMain(moduleUrl) {
  if (!process.argv[1]) return false;
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const a = real(fileURLToPath(moduleUrl));
  const b = real(path.resolve(process.argv[1]));
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// Read-only git calls. GIT_OPTIONAL_LOCKS=0 stops `git status`/`diff` from refreshing the index, so the kit
// never creates .git/index.lock while you (or VS Code) run git at the same time.
export function git(args, cwd) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

export function repoRoot(cwd = process.cwd()) {
  const top = git(['rev-parse', '--show-toplevel'], cwd);
  return path.resolve(top || cwd);
}

// Line numbers of `rel` that differ from HEAD (new or modified lines). null = unknown (untracked, no git):
// callers then treat the whole file as changed.
export function changedLines(root, rel) {
  const out = git(['diff', '-U0', '--no-color', '--no-ext-diff', 'HEAD', '--', rel], root);
  if (out === null) return null;
  if (!out) {
    const tracked = git(['ls-files', '--error-unmatch', '--', rel], root);
    return tracked === null ? null : new Set(); // untracked → unknown; tracked and unchanged → nothing new
  }
  const lines = new Set();
  for (const m of out.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i++) lines.add(start + i);
  }
  return lines;
}

// HEAD line numbers that the working-tree version of `rel` touches (changed, deleted, or next to an insertion).
// null = the file is not in HEAD (new or untracked) or there is no git. Both diffs are measured against HEAD,
// so the numbers from before and after a formatter run are directly comparable.
export function headLinesTouched(root, rel) {
  if (git(['cat-file', '-e', `HEAD:${rel}`], root) === null) return null;
  const out = git(['diff', '-U0', '--no-color', '--no-ext-diff', 'HEAD', '--', rel], root);
  if (out === null) return null;
  const lines = new Set();
  for (const m of out.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count === 0) {
      lines.add(start);
      lines.add(start + 1);
    } else for (let i = 0; i < count; i++) lines.add(start + i);
  }
  return lines;
}

// ---------- config ----------
function deepMerge(base, over) {
  if (Array.isArray(over)) return over;
  if (over && typeof over === 'object') {
    const res = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
    for (const [k, v] of Object.entries(over)) res[k] = deepMerge(res[k], v);
    return res;
  }
  return over === undefined ? base : over;
}

// The kit lives in .solo/ (private, excluded from git). Older installs used .claude/solo.config.json.
export function configPath(root) {
  const current = path.join(root, '.solo', 'config.json');
  const legacy = path.join(root, '.claude', 'solo.config.json');
  return !fs.existsSync(current) && fs.existsSync(legacy) ? legacy : current;
}

export function loadConfig(root) {
  const file = configPath(root);
  let user = {};
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`invalid JSON in ${file}: ${e.message}`);
    }
  }
  return deepMerge(DEFAULTS, user);
}

// ---------- paths & globs ----------
export const posix = (p) => String(p).split(path.sep).join('/').replace(/\\/g, '/');

export function toRel(root, file) {
  if (!file) return null;
  const abs = path.isAbsolute(file) ? file : path.resolve(root, file);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return posix(rel);
}

const reCache = new Map();
export function globToRegExp(glob) {
  const key = glob;
  if (reCache.has(key)) return reCache.get(key);
  let g = posix(glob).replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        continue;
      }
      const alts = g
        .slice(i + 1, end)
        .split(',')
        .map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'));
      re += `(?:${alts.join('|')})`;
      i = end;
    } else if ('.+^$()|[]\\'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  const rx = new RegExp(`^${re}$`, process.platform === 'win32' ? 'i' : '');
  reCache.set(key, rx);
  return rx;
}

export const matchAny = (globs, rel) => (globs || []).some((g) => globToRegExp(g).test(rel));

const rootPrefix = (r) => {
  const p = posix(r || '').replace(/^\.\/?/, '').replace(/\/+$/, '');
  return p ? `${p}/` : '';
};

export const stackDir = (root, stack) => path.resolve(root, stack.root || '.');

// Assign each repo-relative file to the most specific stack whose root contains it
// and whose `files` globs match. Returns Map(stack -> [paths relative to stack root]).
export function assignFiles(stacks, relFiles) {
  const byDepth = [...stacks].sort((a, b) => rootPrefix(b.root).length - rootPrefix(a.root).length);
  const map = new Map(stacks.map((s) => [s, []]));
  for (const f of relFiles) {
    for (const s of byDepth) {
      const pre = rootPrefix(s.root);
      if (pre && !f.startsWith(pre)) continue;
      const inner = f.slice(pre.length);
      if (matchAny(s.files || ['**/*'], inner)) {
        map.get(s).push(inner);
        break;
      }
    }
  }
  return map;
}

export const quote = (p) => `"${String(p).replace(/"/g, '\\"')}"`;

export function expand(template, files) {
  const list = files.slice(0, 60);
  return template.replace(/\{files\}/g, list.map(quote).join(' ')).replace(/\{file\}/g, list.length ? quote(list[0]) : '');
}

// ---------- output shaping ----------
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ERRISH = /(error|fail|failed|failure|✖|✗|×|exception|cannot find|not found|expected|assert|panic)/i;
const PATHISH = /([\\/][\w.-]+\.\w{1,6})|(\w\.\w{1,6}$)/;
// Lines that cost tokens and never help fix anything (timings, banners, separators).
const NOISE = /^\s*(?:[⎯─━=_-]{6,}.*|Start at\b.*|Duration\b.*|RUN\s+v\d.*|Time:\s.*|Ran all test suites.*|Snapshots:\s.*)$/;

export const stripAnsi = (s) => String(s).replace(ANSI, '');

// Keep what a model needs to fix the problem: error lines (+1 line of context),
// with the last seen file header for tools that print "file\n  line:col error ...".
export function summarize(text, max = 30, rootAbs = '') {
  let clean = stripAnsi(text);
  if (rootAbs) for (const r of new Set([rootAbs, posix(rootAbs)])) clean = clean.split(`${r}/`).join('').split(`${r}\\`).join('');
  const lines = clean.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() && !NOISE.test(l));
  if (lines.length <= max) return lines.join('\n');
  const picked = [];
  let header = '';
  let headerUsed = '';
  for (let i = 0; i < lines.length && picked.length < max; i++) {
    const l = lines[i];
    const indented = /^\s/.test(l);
    if (!indented && PATHISH.test(l) && !ERRISH.test(l)) {
      header = l;
      continue;
    }
    if (!ERRISH.test(l)) continue;
    if (indented && header && header !== headerUsed) {
      picked.push(header);
      headerUsed = header;
    }
    picked.push(l);
    const next = lines[i + 1];
    if (next && !ERRISH.test(next) && /^\s/.test(next) && picked.length < max) picked.push(next);
  }
  const body = picked.length ? picked : lines.slice(-max);
  return `${body.join('\n')}\n… (${lines.length} lines total)`;
}

// Tool summary lines ("✖ 4 problems", "Found 2 errors", "Build FAILED", "3 Error(s)") change whenever
// anything changes, so they are never used as baseline keys.
const TOTALS = /^\s*(?:✖\s*\d+\s+problems?|found\s+\d+\s+errors?|\d+\s+errors?\b|build failed|\d+\s+error\(s\)|\d+\s+warning\(s\)|test files\b|tests\s+\d|fail(?:ed)?\s*$)/i;

// Normalize tool output into issue keys that survive line shifts and different checkout paths,
// so a baseline can tell known issues from new ones. Returns Map(key -> original line for display).
export function normalizeIssues(text, rootAbs = '') {
  const issues = new Map();
  const roots = [rootAbs, posix(rootAbs)].filter(Boolean).map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const rootRe = roots.length ? new RegExp(`(${roots.join('|')})[\\\\/]?`, 'gi') : null;
  const unroot = (s) => (rootRe ? s.replace(rootRe, '') : s);
  let header = '';
  for (const raw of stripAnsi(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const indented = /^\s/.test(line);
    if (!indented && PATHISH.test(line) && !ERRISH.test(line)) {
      header = unroot(line.trim()).replace(/\\/g, '/');
      continue;
    }
    if (!/(error|✖|✗|×|FAIL)/i.test(line) || TOTALS.test(line)) continue;
    let key = unroot(line.trim())
      .replace(/^\d+:\d+\s+/, '')
      .replace(/\(\d+,\d+\)/g, '')
      .replace(/:\d+(:\d+)?/g, '')
      .replace(/\b\d+(\.\d+)?\s?m?s\b/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\\/g, '/')
      .trim();
    if (indented && header) key = `${header} ${key}`;
    if (!issues.has(key)) issues.set(key, indented && header ? `${header}  ${unroot(line.trim())}` : unroot(line.trim()));
  }
  return issues;
}

export function writeLog(root, name, content) {
  const dir = path.join(root, '.solo', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name.replace(/[^\w.-]/g, '_')}.log`);
  fs.writeFileSync(file, stripAnsi(content));
  return file;
}

// ---------- per-session state (outside the repo) ----------
const stateDir = path.join(os.tmpdir(), 'claude-solo');
const stateFile = (id) => path.join(stateDir, `${String(id || 'nosession').replace(/[^\w.-]/g, '_')}.json`);

export function loadState(id) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(id), 'utf8'));
  } catch {
    return { edited: [], fails: 0, suspended: false };
  }
}

export function saveState(id, state) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile(id), JSON.stringify(state));
}

// ---------- task files ----------
export function activeTask(root) {
  try {
    const slug = fs.readFileSync(path.join(root, '.solo', 'ACTIVE'), 'utf8').trim();
    return /^[\w.-]+$/.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

export function readHead(file, maxLines) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const head = lines.slice(0, maxLines).join('\n').trimEnd();
    return lines.length > maxLines ? `${head}\n… (${lines.length - maxLines} more lines in ${path.basename(file)})` : head;
  } catch {
    return '';
  }
}
