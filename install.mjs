#!/usr/bin/env node
// Solo AI Team — installer. Private by default: nothing it writes can show up in `git status`,
// be committed or be pushed, so it is safe to use inside a repo that your whole team pulls.
//
//   node install.mjs --user-only                 once per computer: skills, agents, status line, personal CLAUDE.md
//   node install.mjs <repo-root> [options]       once per project
//
//   <repo-root>     the folder you start `claude` in (normally the one that contains .git)
//   --user          also (re)install the personal CLAUDE.md and status line during a project install
//   --user-only     personal layer only, no project
//   --reconfigure   re-detect stacks and regenerate the check commands in .solo/config.json
//                   (after adding ESLint, Prettier or a test runner; the old file is kept as a backup)
//   --shared        treat the repo as shared even if you are its only recent committer
//   --personal      treat the repo as yours alone (default when git history has a single author)
//   --force         update kit-owned files (engine, skills, agents). Your config, rules, CLAUDE.local.md and
//                   settings are never overwritten; .claude/settings.local.json is merged.
//   --dry-run       print what would happen, change nothing
//
// Where things go
//   ~/.claude/skills, ~/.claude/agents     the kit's skills and subagents (personal, shared by all your projects)
//   <repo>/.solo/                           engine, config, rules, ledger, decisions, task state
//   <repo>/CLAUDE.local.md                  your private project instructions (Claude Code's standard personal file)
//   <repo>/.claude/settings.local.json      hooks, model, permissions (Claude Code's standard personal settings file)
// All repo paths are added to .git/info/exclude — git's per-clone ignore list, which is never committed.
// The installer never edits tracked files (not even .gitignore) and never runs git commands that write.
// Shared repo (auto: more than one author in recent history): /ship and /sweep never touch git, the
// formatter never reformats lines nobody changed, and nothing kit-specific is written into the code.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.join(HERE, 'kit');
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
// git reports the repo root in its real spelling (8.3 short names expanded, junctions and symlinks resolved). A target
// spelled any other way would put the exclude rules under the wrong prefix and leave the kit visible in git status.
const realPath = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p; // missing target: reported below
  }
};
const TARGET = realPath(path.resolve(argv.find((a) => !a.startsWith('--')) || process.cwd()));
const DRY = flags.has('--dry-run');
const FORCE = flags.has('--force');
const USER_ONLY = flags.has('--user-only');
const RECONFIGURE = flags.has('--reconfigure');
const MARK = 'solo-ai-team';
const log = [];
const notes = [];

const posix = (p) => p.split(path.sep).join('/');
const relT = (p) => posix(path.relative(TARGET, p)) || '.';
const shown = (p) => (p.startsWith(TARGET) ? relT(p) : p.replace(os.homedir(), '~'));

function write(file, content, { overwrite = FORCE } = {}) {
  const exists = fs.existsSync(file);
  if (exists && !overwrite) {
    log.push(`  keep    ${shown(file)} (already exists)`);
    return false;
  }
  log.push(`  ${exists ? 'update' : 'create'}  ${shown(file)}`);
  if (!DRY) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return true;
}

function copyDir(src, dst) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else write(d, fs.readFileSync(s));
  }
}

function findFiles(dir, test, depth, acc = []) {
  if (depth < 0) return acc;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || ['node_modules', 'bin', 'obj', 'dist', 'build', 'coverage', 'vendor', 'wwwroot'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findFiles(p, test, depth - 1, acc);
    else if (test(e.name)) acc.push(p);
  }
  return acc;
}

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const readText = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return null;
  }
};
const major = (v) => parseInt(String(v || '').replace(/^[^\d]*/, ''), 10) || null;
const lockfileUp = (dir, name) => {
  for (let d = dir; d.startsWith(TARGET); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, name))) return true;
    if (d === TARGET) break;
  }
  return false;
};
// read-only git; GIT_OPTIONAL_LOCKS=0 so nothing (not even index.lock) is written
function git(args, cwd = TARGET) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

// A formatter is only switched on when the repo declares one. Otherwise a single edit could reformat a
// whole file and hand your teammates a huge formatting-only diff.
const PRETTIER_CONFIGS = ['.prettierrc', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.yml', '.prettierrc.json5', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', '.prettierrc.toml', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs', 'prettier.config.ts'];
const hasPrettierConfig = (dir, pkg) => !!pkg?.prettier || [dir, TARGET].some((d) => PRETTIER_CONFIGS.some((f) => fs.existsSync(path.join(d, f))));

// A project whose node_modules is missing or half-installed fails every check with "Cannot find module".
// Check the direct dependencies once at install time: present, and their entry file really exists.
function dependencyHealth(dir, pkg) {
  const names = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
  const findPkg = (name) => {
    for (let d = dir; ; d = path.dirname(d)) {
      const p = path.join(d, 'node_modules', name);
      if (fs.existsSync(path.join(p, 'package.json'))) return p;
      if (path.resolve(d) === path.resolve(TARGET) || path.dirname(d) === d) return null;
    }
  };
  const entryFiles = (pj) => {
    const out = [];
    const pick = (e) => {
      if (!e) return;
      if (typeof e === 'string') out.push(e);
      else if (typeof e === 'object') for (const k of ['.', 'require', 'node', 'import', 'default']) pick(e[k]);
    };
    if (typeof pj?.main === 'string') out.push(pj.main);
    pick(pj?.exports);
    return out.filter((f) => /\.(c|m)?js$/.test(f));
  };
  const missing = [];
  const broken = [];
  for (const n of names) {
    const p = findPkg(n);
    if (!p) {
      missing.push(n);
      continue;
    }
    const files = entryFiles(readJson(path.join(p, 'package.json')));
    if (files.length && files.every((f) => !fs.existsSync(path.join(p, f)))) broken.push(n);
  }
  return { total: names.length, missing, broken };
}

// Checks must never change files. Team scripts often do (eslint --fix, prettier --write, jest -u), so those are
// never run as-is: a single eslint / ng lint call is re-run without --fix, anything else falls back to plain eslint.
const MUTATING = /(?:^|\s)--(?:fix|write)(?:[=\s]|$)|(?:^|\s)-u(?:\s|$)|--update-?snapshot/i;
function readOnlyLint(script, x) {
  if (!script || !MUTATING.test(script)) return null; // not mutating: caller runs the script itself
  const single = !/&&|\|\||[;|]/.test(script);
  const m = script.trim().match(/^(?:npx\s+(?:--no-install\s+)?)?(eslint|ng\s+lint)\b(.*)$/);
  if (!single || !m) return { run: `${x} eslint .`, note: 'its lint script does more than a single eslint call and changes files, so the kit runs plain `eslint .` instead' };
  const args = m[2].replace(/(?:^|\s)--fix(?:-dry-run)?(?:=\S+)?(?=\s|$)/g, '').replace(/\s+/g, ' ').trim();
  return { run: `${x} ${m[1].replace(/\s+/, ' ')}${args ? ` ${args}` : ''}`, note: 'its lint script uses --fix, so the kit runs the same command without --fix (checks never change your files)' };
}

// ---------------- stack detection ----------------
function nodeStack(dir) {
  const pkg = readJson(path.join(dir, 'package.json'));
  if (!pkg) return null;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (n) => n in deps;
  const scripts = pkg.scripts || {};
  const pm = lockfileUp(dir, 'pnpm-lock.yaml') ? 'pnpm' : lockfileUp(dir, 'yarn.lock') ? 'yarn' : 'npm';
  const x = { npm: 'npx --no-install', pnpm: 'pnpm exec', yarn: 'yarn' }[pm];
  const run = (s) => ({ npm: `npm run -s ${s}`, pnpm: `pnpm run -s ${s}`, yarn: `yarn -s ${s}` })[pm];
  const angular = has('@angular/core');
  const react = !angular && has('react');
  const kind = angular ? 'angular' : react ? 'react' : has('vue') ? 'vue' : 'node';
  if (kind === 'node' && !has('typescript') && !has('eslint') && !scripts.test && !scripts.build) return null; // tooling-only package.json

  const tsconfig = ['tsconfig.app.json', 'tsconfig.json'].find((f) => fs.existsSync(path.join(dir, f)));
  const lintOnly = angular && has('@angular-eslint/template-parser') ? ['**/*.{ts,js,html}'] : ['**/*.{ts,tsx,js,jsx,mjs,cjs,vue}'];
  const codeOnly = ['**/*.{ts,tsx,js,jsx,mjs,cjs,vue}'];
  const stop = [];
  const full = [];

  // Angular: ngc type-checks TypeScript AND templates (strictTemplates); plain tsc never sees template errors.
  const typecheck =
    angular && has('@angular/compiler-cli') && tsconfig
      ? { name: 'typecheck', run: `${x} ngc -p ${tsconfig} --noEmit` }
      : has('typescript') && tsconfig
        ? { name: 'typecheck', run: `${x} tsc --noEmit -p ${tsconfig}` }
        : null;
  const angularJson = angular ? readJson(path.join(dir, 'angular.json')) : null;
  const angularHasTest = !!angularJson && Object.values(angularJson.projects || {}).some((p) => p.architect?.test || p.targets?.test);

  if (has('eslint')) stop.push({ name: 'lint', run: `${x} eslint {files}`, only: lintOnly });
  if (typecheck) stop.push(typecheck);
  if (!angular && has('vitest')) stop.push({ name: 'tests', run: `${x} vitest related --run --passWithNoTests {files}`, only: codeOnly });
  else if (!angular && has('jest')) stop.push({ name: 'tests', run: `${x} jest --ci --passWithNoTests --findRelatedTests {files}`, only: codeOnly });

  const ro = readOnlyLint(scripts.lint, x);
  if (ro) {
    full.push({ name: 'lint', run: ro.run });
    notes.push(`${relT(dir) === '.' ? 'repo root' : relT(dir)}: ${ro.note}.`);
  } else if (scripts.lint) full.push({ name: 'lint', run: run('lint') });
  else if (has('eslint')) full.push({ name: 'lint', run: `${x} eslint .` });
  const buildTypechecks = /\b(ng build|tsc)\b/.test(scripts.build || ''); // ng build / tsc already type-check
  if (typecheck && !buildTypechecks) full.push(typecheck);
  if (angular) {
    if (angularHasTest) full.push({ name: 'test', run: `${x} ng test --watch=false${has('karma') ? ' --browsers=ChromeHeadless' : ''}` });
  } else if (has('vitest')) full.push({ name: 'test', run: `${x} vitest run --passWithNoTests` });
  else if (has('jest')) full.push({ name: 'test', run: `${x} jest --ci --passWithNoTests` });
  else if (scripts.test && !/no test specified/.test(scripts.test) && !MUTATING.test(scripts.test)) full.push({ name: 'test', run: run('test') });
  if (scripts.build) full.push({ name: 'build', run: run('build') });

  const label = relT(dir) === '.' ? 'repo root' : relT(dir);
  const restore = { npm: lockfileUp(dir, 'package-lock.json') ? 'npm ci' : 'npm install', pnpm: 'pnpm install --frozen-lockfile', yarn: 'yarn install --frozen-lockfile' }[pm];
  const health = dependencyHealth(dir, pkg);
  if (health.total && health.missing.length === health.total)
    notes.push(`${label}: dependencies are not installed. Run \`${restore}\` there before the first check.`);
  else if (health.missing.length || health.broken.length) {
    const bad = [...health.broken, ...health.missing];
    notes.push(
      `${label}: node_modules looks incomplete (${bad.length} of ${health.total} direct dependencies missing or broken, e.g. ${bad.slice(0, 4).join(', ')}). Run \`${restore}\` there before the first check; otherwise every check fails with "Cannot find module".`,
    );
  }
  if (!has('eslint')) notes.push(`${label}: no ESLint found — the Stop hook can't lint. For Angular: ng add angular-eslint`);
  if (!stop.some((st) => st.name === 'tests') && !full.some((st) => st.name === 'test'))
    notes.push(`${label}: no test runner found — checks can only prove it compiles, not that it behaves. /test-first needs a runner.`);
  let format = null;
  if (has('prettier') && hasPrettierConfig(dir, pkg)) format = `${x} prettier --write ${major(deps.prettier) >= 3 ? '--log-level' : '--loglevel'} warn {file}`;
  else if (has('prettier')) notes.push(`${label}: Prettier is installed but the repo has no Prettier config, so format-on-edit stays off (it could reformat whole files for your teammates). Add a .prettierrc to turn it on.`);

  const ui = {
    enabled: has('playwright') || has('@playwright/test'),
    baseUrl: angular ? 'http://localhost:4200' : has('vite') ? 'http://localhost:5173' : 'http://localhost:3000',
    serve: scripts.start ? run('start') : scripts.dev ? run('dev') : '',
  };
  return {
    kind,
    angularMajor: angular ? major(deps['@angular/core']) : null,
    ui,
    stack: { name: kind, root: relT(dir), files: ['**/*.{ts,tsx,js,jsx,mjs,cjs,vue,html,css,scss,json,md}'], format, stop, full },
  };
}

function dotnetStack() {
  const slns = findFiles(TARGET, (n) => /\.(sln|slnx)$/i.test(n), 2);
  const projects = findFiles(TARGET, (n) => /\.csproj$/i.test(n), 4);
  const entry = slns[0] || projects[0];
  if (!entry) return null;
  if (slns.length > 1) notes.push(`Several solution files found; using ${relT(slns[0])}. Edit .solo/config.json if that's wrong.`);
  const dir = path.dirname(entry);
  const name = path.basename(entry);
  const hasTests = projects.some((p) => /tests?\.csproj$/i.test(p));
  const build = { name: 'build', run: `dotnet build "${name}" --nologo -v q -clp:ErrorsOnly` };
  return {
    kind: 'dotnet',
    stack: {
      name: 'dotnet',
      root: relT(dir),
      files: ['**/*.{cs,csproj,cshtml,razor}'],
      format: null,
      stop: [build],
      full: [build, ...(hasTests ? [{ name: 'test', run: `dotnet test "${name}" --nologo -v q` }] : [])],
    },
  };
}

function pythonStack() {
  const pyproject = path.join(TARGET, 'pyproject.toml');
  const req = path.join(TARGET, 'requirements.txt');
  if (!fs.existsSync(pyproject) && !fs.existsSync(req)) return null;
  const text = [pyproject, req].map(readText).filter(Boolean).join('\n');
  const ruff = /\[tool\.ruff/.test(text) || /^ruff\b/m.test(text);
  const pytest = /pytest/.test(text) || fs.existsSync(path.join(TARGET, 'tests'));
  return {
    kind: 'python',
    stack: {
      name: 'python',
      root: '.',
      files: ['**/*.py'],
      format: /\[tool\.ruff/.test(text) ? 'ruff format {file}' : null,
      stop: ruff ? [{ name: 'lint', run: 'ruff check {files}' }] : [],
      full: [...(ruff ? [{ name: 'lint', run: 'ruff check .' }] : []), ...(pytest ? [{ name: 'test', run: 'python -m pytest -q' }] : [])],
    },
  };
}

function detect() {
  const found = [];
  for (const d of findFiles(TARGET, (n) => n === 'package.json', 2).map((f) => path.dirname(f))) {
    const s = nodeStack(d);
    if (s) found.push(s);
  }
  const dn = dotnetStack();
  if (dn) found.push(dn);
  const py = pythonStack();
  if (py) found.push(py);
  // unique names: when a kind appears more than once, suffix every one with its folder (angular-admin, angular-frontend)
  const count = new Map();
  for (const f of found) count.set(f.stack.name, (count.get(f.stack.name) || 0) + 1);
  for (const f of found) if (count.get(f.stack.name) > 1 && f.stack.root !== '.') f.stack.name = `${f.stack.name}-${path.basename(f.stack.root)}`;
  return found;
}

// ---------------- settings merge ----------------
function mergeSettings(existing, ours) {
  const res = { ...ours, ...existing };
  // Older kits pinned "opusplan" (Opus plans, Sonnet builds) because Opus used to cost far more. The kit now leaves the
  // model to Claude Code's default, so it drops the value it wrote itself; any other model is your choice and stays.
  if (existing.model === 'opusplan') {
    delete res.model;
    notes.push('Removed "model": "opusplan", which older versions of the kit set: Claude Code\'s default model applies now. To save usage, switch back with /model opusplan.');
  }
  res.env = { ...(ours.env || {}), ...(existing.env || {}) };
  res.permissions = { ...(ours.permissions || {}), ...(existing.permissions || {}) };
  for (const k of ['allow', 'ask', 'deny']) {
    res.permissions[k] = [...new Set([...(existing.permissions?.[k] || []), ...(ours.permissions?.[k] || [])])];
  }
  res.hooks = { ...(existing.hooks || {}) };
  // the kit's own hook entries are replaced (older versions pointed at ${CLAUDE_PROJECT_DIR}/.solo/engine/...);
  // everything else you or Claude Code added stays
  const isKitHook = (g) => {
    const t = JSON.stringify(g);
    return t.includes('.solo') && /hook-(session-start|after-edit|stop)\.mjs/.test(t);
  };
  for (const [event, groups] of Object.entries(ours.hooks || {})) {
    res.hooks[event] = [...(res.hooks[event] || []).filter((g) => !isKitHook(g)), ...groups];
  }
  return res;
}

// ---------------- personal layer (~/.claude) ----------------
const HOME_CLAUDE = path.join(os.homedir(), '.claude');

// Skills and agents are personal tools, like editor settings: they live in ~/.claude and never in a repo.
function installSkillsAndAgents() {
  for (const name of fs.readdirSync(path.join(KIT, 'skills'))) {
    const dst = path.join(HOME_CLAUDE, 'skills', name, 'SKILL.md');
    const cur = readText(dst);
    if (cur !== null && !cur.includes(MARK)) {
      notes.push(`~/.claude/skills/${name} already exists and is not from this kit — left untouched, so /${name} stays yours.`);
      continue;
    }
    write(dst, fs.readFileSync(path.join(KIT, 'skills', name, 'SKILL.md')));
  }
  for (const f of fs.readdirSync(path.join(KIT, 'agents'))) {
    const dst = path.join(HOME_CLAUDE, 'agents', f);
    const cur = readText(dst);
    if (cur !== null && !cur.includes(MARK)) {
      notes.push(`~/.claude/agents/${f} already exists and is not from this kit — left untouched.`);
      continue;
    }
    write(dst, fs.readFileSync(path.join(KIT, 'agents', f)));
  }
}

function installPersonalFiles() {
  const userMd = path.join(HOME_CLAUDE, 'CLAUDE.md');
  const tpl = fs.readFileSync(path.join(KIT, 'templates', 'CLAUDE.user.md'), 'utf8');
  if (fs.existsSync(userMd)) {
    write(path.join(HOME_CLAUDE, 'CLAUDE.solo-suggested.md'), tpl, { overwrite: true });
    notes.push('You already have ~/.claude/CLAUDE.md. Merge what you want from ~/.claude/CLAUDE.solo-suggested.md.');
  } else write(userMd, tpl);
  const statusScript = path.join(HOME_CLAUDE, 'solo-statusline.mjs');
  write(statusScript, fs.readFileSync(path.join(KIT, 'engine', 'statusline.mjs')), { overwrite: true });
  const userSettingsFile = path.join(HOME_CLAUDE, 'settings.json');
  const us = readJson(userSettingsFile) || {};
  if (us.statusLine) notes.push(`You already have a statusLine. To use the budget line instead: "command": "node \\"${posix(statusScript)}\\""`);
  else {
    us.statusLine = { type: 'command', command: `node "${posix(statusScript)}"`, padding: 0 };
    write(userSettingsFile, `${JSON.stringify(us, null, 2)}\n`, { overwrite: true });
  }
}

function printLog(title) {
  console.log(`\nsolo-ai-team → ${title}${DRY ? '  (dry run, nothing written)' : ''}\n`);
  if (log.length) console.log(`Files:\n${log.join('\n')}`);
  if (notes.length) console.log(`\nNotes:\n${notes.map((n) => `  - ${n}`).join('\n')}`);
}

// ---------------- main ----------------
if (USER_ONLY) {
  installSkillsAndAgents();
  installPersonalFiles();
  printLog('personal layer (~/.claude)');
  console.log('\nNext: install into a project with  node install.mjs "<repo root>"\n');
  process.exit(0);
}

const insideKit = (() => {
  const r = path.relative(HERE, TARGET);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
})();
if (insideKit) {
  console.error('Refusing to install into the kit folder itself. Pass the repo root: node install.mjs "<repo root>"  (or --user-only for the personal layer)');
  process.exit(1);
}
if (!fs.existsSync(TARGET)) {
  console.error(`Target not found: ${TARGET}`);
  process.exit(1);
}

const top = git(['rev-parse', '--show-toplevel']);
const commonDir = git(['rev-parse', '--git-common-dir']);
const excludeFile = commonDir ? path.resolve(TARGET, commonDir, 'info', 'exclude') : null;
// repo-relative prefix of TARGET, so exclude patterns still match when installing into a subfolder
const prefix = top ? posix(path.relative(realPath(top), TARGET)) : '';
const atTop = top !== null && prefix === '';
if (!top) notes.push('Not a git repository: nothing to hide the kit from. Hooks still work; /ship and worktrees need git.');
else if (!atTop) notes.push(`The git root is ${posix(top)}. Start claude in ${posix(TARGET)} (the folder you installed into), or reinstall at the git root.`);
const statusBefore = top ? git(['status', '--porcelain']) : null;
// Shared = someone other than you committed here recently (a teammate's repo counts even if they are its only author).
// Without a git user.email on this computer, every author counts as someone else.
const me = (git(['config', 'user.email']) || '').toLowerCase();
const authorEmails = top ? [...new Set((git(['log', '-200', '--format=%ae']) || '').split('\n').filter(Boolean).map((e) => e.toLowerCase()))] : [];
const others = authorEmails.filter((e) => e !== me).length;
const sharedRepo = flags.has('--shared') ? true : flags.has('--personal') ? false : others > 0;

// Never take over a path the team already tracks: the kit's files have to stay private to this clone.
if (top) {
  const taken = (git(['ls-files', '--', '.solo', 'CLAUDE.local.md', '.claude/settings.local.json']) || '').split('\n').filter(Boolean);
  if (taken.length) {
    console.error(
      [
        `Stopped before writing anything: this repo already tracks ${taken.slice(0, 5).join(', ')}${taken.length > 5 ? ' …' : ''}.`,
        'Those are personal paths; if the kit wrote there, your changes would show up in git status and could be committed.',
        'Ask the team to untrack them (git rm --cached <path>), or use just the personal layer: node install.mjs --user-only',
      ].join('\n'),
    );
    process.exit(1);
  }
}

const detected = detect();
const stacks = detected.map((d) => d.stack);
if (!stacks.length) {
  stacks.push({ name: 'project', root: '.', files: ['**/*'], format: null, stop: [], full: [] });
  notes.push('No known stack detected. Fill in stop/full commands in .solo/config.json (see README), or rerun with --reconfigure after creating the project — until then hooks only track edits.');
}
const uiSource = detected.find((d) => d.ui?.enabled);

// Code intelligence (LSP) plugins let Claude see type errors right after each edit instead of at the Stop hook.
// They are personal (user scope), so the installer only checks and tells you the commands.
const onPath = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore', windowsHide: true }).status === 0;
const userPlugins = readJson(path.join(os.homedir(), '.claude', 'settings.json'))?.enabledPlugins || {};
const lsp = [];
if (detected.some((d) => d.stack.stop.some((st) => st.name === 'typecheck') || ['angular', 'react', 'vue'].includes(d.kind)))
  lsp.push({ plugin: 'typescript-lsp', bin: 'typescript-language-server', install: 'npm install -g typescript-language-server typescript' });
if (detected.some((d) => d.kind === 'dotnet')) lsp.push({ plugin: 'csharp-lsp', bin: 'csharp-ls', install: 'dotnet tool install --global csharp-ls' });
for (const l of lsp) {
  const id = `${l.plugin}@claude-plugins-official`;
  if (onPath(l.bin) && userPlugins[id]) continue;
  notes.push(
    `Optional, once per computer — type errors right after each edit: ${onPath(l.bin) ? '' : `${l.install}, then `}in Claude Code: /plugin install ${id}`,
  );
}

// /proto puts throwaway prototypes inside the app's source tree (so they compile) but in a folder git ignores
const protoDir = (() => {
  const web = detected.find((d) => ['angular', 'react', 'vue'].includes(d.kind));
  const root = web ? web.stack.root : '.';
  const inRoot = (p) => posix(path.join(root, p)).replace(/^\.\//, '');
  const candidate = !web ? '_proto' : web.kind === 'angular' && fs.existsSync(path.join(TARGET, root, 'src', 'app')) ? inRoot('src/app/_proto') : fs.existsSync(path.join(TARGET, root, 'src')) ? inRoot('src/_proto') : inRoot('_proto');
  if (top && git(['ls-files', '--', candidate])) return '.solo/proto'; // the team uses that folder name
  return candidate;
})();

// 1) personal skills and agents (needed by every project)
installSkillsAndAgents();
if (flags.has('--user')) installPersonalFiles();

// 2) engine
copyDir(path.join(KIT, 'engine'), path.join(TARGET, '.solo', 'engine'));

// 3) config
const config = {
  '//': 'solo-ai-team config. stop = fast checks the Stop hook runs on edited files; full = /check and /ship. {file}/{files} are paths relative to the stack root. shared = other people commit to this repo: the kit never touches git or reformats their lines.',
  shared: sharedRepo,
  stacks,
  ui: uiSource
    ? { enabled: true, root: uiSource.stack.root, baseUrl: uiSource.ui.baseUrl, serve: uiSource.ui.serve, routes: ['/'], viewports: [[1440, 900], [390, 844]], waitMs: 500 }
    : { enabled: false },
  tokenGuard: { enabled: false },
  ship: { mode: sharedRepo ? 'manual' : 'pr', base: '' },
  proto: { dir: protoDir },
};
const configFile = path.join(TARGET, '.solo', 'config.json');
const oldConfig = readJson(configFile);
const explicitMode = flags.has('--shared') || flags.has('--personal');
let effectiveShared = sharedRepo; // what the engine will actually see after this run
if (oldConfig && RECONFIGURE) {
  const merged = { ...oldConfig, shared: explicitMode || oldConfig.shared === undefined ? sharedRepo : oldConfig.shared, stacks, ui: oldConfig.ui?.enabled ? oldConfig.ui : config.ui };
  if (explicitMode || oldConfig.shared === undefined) merged.ship = { ...(oldConfig.ship || {}), mode: merged.shared ? 'manual' : 'pr' };
  if (!oldConfig.proto) merged.proto = config.proto;
  effectiveShared = merged.shared;
  write(path.join(TARGET, '.solo', 'config.backup.json'), `${JSON.stringify(oldConfig, null, 2)}\n`, { overwrite: true });
  write(configFile, `${JSON.stringify(merged, null, 2)}\n`, { overwrite: true });
  notes.push('Re-detected stacks and replaced "stacks" in .solo/config.json; tokenGuard, ship, limits and a working ui section were kept. Previous version: .solo/config.backup.json');
} else {
  write(configFile, `${JSON.stringify(config, null, 2)}\n`, { overwrite: false });
  if (oldConfig) {
    effectiveShared = oldConfig.shared === true;
    notes.push(
      explicitMode || oldConfig.shared === undefined
        ? 'Kept your existing .solo/config.json, so the shared/personal mode was not changed. Run again with --reconfigure to apply it.'
        : 'Kept your existing .solo/config.json. After adding ESLint, Prettier or a test runner, run again with --reconfigure.',
    );
  }
}

// 4) framework rules (imported by CLAUDE.local.md)
const prefixOf = (root) => (root === '.' ? '' : `${root}/`);
const ruleImports = [];
for (const d of detected) {
  let tpl = null;
  if (d.kind === 'angular') tpl = d.angularMajor && d.angularMajor < 17 ? 'angular-legacy.md' : 'angular.md';
  else if (d.kind === 'react') tpl = 'react.md';
  else if (d.kind === 'dotnet') tpl = 'dotnet.md';
  if (!tpl) continue;
  const raw = fs.readFileSync(path.join(KIT, 'templates', 'rules', tpl), 'utf8');
  const body = raw.replace(/^---\n[\s\S]*?\n---\n\n?/, '').replace(/^# (.*)$/m, `# $1 — applies to \`${prefixOf(d.stack.root) || './'}\``);
  write(path.join(TARGET, '.solo', 'rules', `${d.stack.name}.md`), body, { overwrite: false });
  ruleImports.push(`@.solo/rules/${d.stack.name}.md`);
}

// 5) ledger, decisions, inbox (noticed-but-not-done work)
write(path.join(TARGET, '.solo', 'ledger.json'), `${JSON.stringify({ version: 1, threshold: 3, entries: [], enforced: {} }, null, 2)}\n`, { overwrite: false });
write(path.join(TARGET, '.solo', 'decisions.md'), fs.readFileSync(path.join(KIT, 'templates', 'decisions.md')), { overwrite: false });
write(path.join(TARGET, '.solo', 'inbox.md'), fs.readFileSync(path.join(KIT, 'templates', 'inbox.md')), { overwrite: false });

// 6) CLAUDE.local.md — Claude Code's standard personal instructions file; loads next to the team's CLAUDE.md
const commands = detected.length
  ? detected.map((d) => `- ${d.stack.name} (\`${d.stack.root}\`)${d.ui?.serve ? `: dev server \`${d.ui.serve}\`` : ''}`).join('\n')
  : '- TODO: how to run the app locally';
const topDirs = fs
  .readdirSync(TARGET, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !['node_modules', 'bin', 'obj', 'dist'].includes(e.name))
  .slice(0, 12)
  .map((e) => `- \`${e.name}/\` — TODO: one line`)
  .join('\n');
// A repo that relies on AGENTS.md stops loading it once a CLAUDE.local.md exists, unless we import it.
const needsAgentsImport = fs.existsSync(path.join(TARGET, 'AGENTS.md')) && !fs.existsSync(path.join(TARGET, 'CLAUDE.md'));
const imports = [...(needsAgentsImport ? ['@AGENTS.md'] : []), ...ruleImports];
let localMd = fs
  .readFileSync(path.join(KIT, 'templates', 'CLAUDE.local.md'), 'utf8')
  .replace('{{IMPORTS}}', imports.length ? `${imports.join('\n')}\n\n` : '')
  .replace('{{PROJECT}}', path.basename(TARGET))
  .replace('{{COMMANDS}}', commands)
  .replace('{{MAP}}', topDirs || '- TODO');
const SHARED_LINE = /^- This is a shared repo:.*\n/m;
const sharedLine = (localMd.match(SHARED_LINE) || [''])[0];
if (!effectiveShared) localMd = localMd.replace(SHARED_LINE, '');
const localMdFile = path.join(TARGET, 'CLAUDE.local.md');
const existingLocal = readText(localMdFile);
if (existingLocal !== null && !existingLocal.includes('/learn proposes additions, /refresh prunes')) {
  write(path.join(TARGET, '.solo', 'CLAUDE.local.suggested.md'), localMd, { overwrite: true });
  notes.push('You already have a CLAUDE.local.md. Merge what you want from .solo/CLAUDE.local.suggested.md (at least the imports and the Workflow section).');
} else if (!write(localMdFile, localMd, { overwrite: false }) && effectiveShared && sharedLine && existingLocal && !existingLocal.includes('This is a shared repo:')) {
  // switched to --shared later: add the shared-repo rule to the kit's own CLAUDE.local.md (a private file)
  const anchor = existingLocal.match(/^- Never commit or push.*\n/m);
  if (anchor) {
    const updated = existingLocal.replace(anchor[0], `${anchor[0]}${sharedLine}`);
    log.push('  update  CLAUDE.local.md (added the shared-repo rule)');
    if (!DRY) fs.writeFileSync(localMdFile, updated);
  } else notes.push(`Add this line to the Workflow section of CLAUDE.local.md: ${sharedLine.trim()}`);
}

// 7) .claude/settings.local.json — hooks, model, permissions (personal, merged with what is already there)
const ours = readJson(path.join(KIT, 'settings.json'));
const settingsFile = path.join(TARGET, '.claude', 'settings.local.json');
const existingSettings = readJson(settingsFile);
if (existingSettings) write(settingsFile, `${JSON.stringify(mergeSettings(existingSettings, ours), null, 2)}\n`, { overwrite: true });
else write(settingsFile, `${JSON.stringify(ours, null, 2)}\n`);

// 8) worktrees: copy the private files into new `claude -w` worktrees
const wtInclude = path.join(TARGET, '.worktreeinclude');
let ownWorktreeInclude = false;
const wtPatterns = ['.solo/engine/**', '.solo/rules/**', '.solo/checks/**', '.solo/baseline/**', '.solo/config.json', '.solo/ledger.json', '.solo/decisions.md', '.solo/inbox.md', '.solo/security.md', 'CLAUDE.local.md', '.claude/settings.local.json'];
const wtText = readText(wtInclude);
if (!atTop) {
  /* worktrees are created from the repo root; skip when installed into a subfolder */
} else if (wtText === null || wtText.includes(MARK)) {
  // ours (or missing): keep it in step with the kit's list of private files
  const fresh = `# ${MARK}: private files copied into new Claude Code worktrees\n${wtPatterns.join('\n')}\n`;
  if (wtText !== fresh) write(wtInclude, fresh, { overwrite: true });
  ownWorktreeInclude = true;
} else notes.push('The repo already has a .worktreeinclude (the team\'s). It was not changed, so `claude -w` worktrees will not get the kit — work in the main checkout.');

// 9) hide everything from git with the per-clone exclude file (never committed, never pushed)
const at = (p) => `/${prefix ? `${prefix}/` : ''}${p}`;
const protoInRepo = (readJson(configFile)?.proto?.dir || protoDir).replace(/\/+$/, '');
const excludeLines = [
  at('.solo/'),
  at('CLAUDE.local.md'),
  at('.claude/settings.local.json'),
  at('.claude/worktrees/'),
  ...(ownWorktreeInclude ? [at('.worktreeinclude')] : []),
  ...(protoInRepo.startsWith('.solo/') ? [] : [at(`${protoInRepo}/`)]),
];
if (excludeFile) {
  const cur = readText(excludeFile) || '';
  const have = new Set(cur.split(/\r?\n/).map((l) => l.trim()));
  const missing = excludeLines.filter((l) => !have.has(l));
  if (missing.length) {
    log.push(`  append  ${posix(path.relative(TARGET, excludeFile))} (${missing.join(', ')})`);
    if (!DRY) {
      fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
      fs.writeFileSync(excludeFile, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}# ${MARK} (private, per-clone; never committed)\n${missing.join('\n')}\n`);
    }
  }
}

// ---------------- report ----------------
printLog(TARGET);
console.log('\nDetected stacks:');
for (const s of stacks) {
  console.log(`  ${s.name.padEnd(18)} root ${s.root.padEnd(12)} format: ${s.format ? 'on' : 'off'} · stop: ${s.stop.map((x) => x.name).join(', ') || '-'} · full: ${s.full.map((x) => x.name).join(', ') || '-'}`);
}
const why = explicitMode
  ? (flags.has('--shared') ? '--shared' : '--personal')
  : !authorEmails.length
    ? 'no commits yet'
    : others
      ? `commits by ${others} other ${others === 1 ? 'person' : 'people'} in the last 200`
      : 'only your commits in the last 200';
console.log(
  effectiveShared
    ? `\nMode: shared repo (${why}) → /ship and /sweep leave git to you, the formatter never touches lines you did not change, no kit comments in the code.`
    : `\nMode: personal repo (${why}) → /ship can commit and open a PR when you ask, and every commit or push still asks first. If others commit here later, rerun with --shared --reconfigure.`,
);
if (top && !DRY) {
  const statusAfter = git(['status', '--porcelain']);
  console.log(
    statusAfter === statusBefore
      ? '\ngit status: unchanged — nothing to commit, nothing your teammates can see.'
      : `\nWARNING: git status changed after install:\n${statusAfter}\nPlease report this; the kit should never show up in git status.`,
  );
}
console.log(`
Next:
  1. Read .solo/config.json and CLAUDE.local.md; fill in the TODO lines.
  2. Existing errors in the repo? Accept them once: node .solo/engine/check.mjs --update-baseline
  3. Sanity check: node .solo/engine/check.mjs --stage full
  4. Open ${posix(TARGET)} in VS Code (the repo root is simplest) or run claude there   →   /spec <task>
`);
