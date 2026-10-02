#!/usr/bin/env node
// Self-test for the solo-ai-team engine. Run it on the machine where you use Claude Code:
//
//   node selftest.mjs
//
// It builds a throwaway git repo in your temp folder (with a space in its path, like "D:\My Projects"),
// wires a fake stack whose "linter" and "formatter" are tiny node scripts (no npm install needed),
// then drives the hooks exactly the way Claude Code does: node <script> with JSON on stdin.
// Nothing outside the temp folder is touched, and git runs with an empty config of its own, so your global
// git settings cannot change the result. Exit code 0 = everything passed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// install.mjs flags typed here by mistake used to be ignored: the run printed "82/82 passed" and installed nothing.
const stray = process.argv.slice(2);
if (stray.length) {
  const shown = stray.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
  console.error(`selftest.mjs takes no arguments (got: ${shown}).\nTo install or upgrade the kit, run: node install.mjs ${shown}`);
  process.exit(2);
}

const KIT =path.join(path.dirname(fileURLToPath(import.meta.url)), 'kit');
// Fixtures use the canonical spelling of the temp folder, which os.tmpdir() may not (C:\Users\RUNNER~1\… on CI's
// Windows runner, /var → /private/var on macOS), so the path assertions below compare like with like.
// Other spellings of a repo path have checks of their own (junction or symlink).
const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'solo selftest ')));
// Claude Code adds **/.claude/settings.local.json to the global git excludes. Inherited, that rule made a fixture's
// `git add -A` stage nothing, and let "git status is empty" pass without the installer's own exclude doing the work.
const gitConfig = path.join(base, 'git config');
fs.mkdirSync(gitConfig);
fs.writeFileSync(path.join(gitConfig, 'config'), '');
Object.assign(process.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(gitConfig, 'config'), XDG_CONFIG_HOME: gitConfig });
const repo = path.join(base, 'my repo');
const solo = path.join(repo, '.solo', 'engine');
const results = [];
const check = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail });

function git(...args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}
function hook(script, payload, cwd = repo) {
  const r = spawnSync(process.execPath, [path.join(solo, script)], { cwd, input: JSON.stringify(payload), encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function tool(script, args) {
  const r = spawnSync(process.execPath, [path.join(solo, script), ...args], { cwd: repo, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const write = (rel, text) => {
  const f = path.join(repo, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  return f;
};

try {
  // ---------- setup ----------
  fs.mkdirSync(solo, { recursive: true });
  for (const f of fs.readdirSync(path.join(KIT, 'engine'))) fs.copyFileSync(path.join(KIT, 'engine', f), path.join(solo, f));
  git('init', '-q');
  git('config', 'user.email', 'selftest@example.com');
  git('config', 'user.name', 'selftest');
  write('tools/fmt.cjs', "const fs=require('fs');for(const f of process.argv.slice(2)){fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/[ \\t]+$/gm,''))}\n");
  write(
    'tools/lint.cjs',
    "const fs=require('fs');let bad=0;for(const f of process.argv.slice(2)){fs.readFileSync(f,'utf8').split(/\\r?\\n/).forEach((l,i)=>{if(l.includes('BAD')){bad++;console.log(`${f}:${i+1}:1 error no-BAD token BAD is not allowed`)}})}if(bad){console.log(`Found ${bad} errors`);process.exit(1)}\n",
  );
  write(
    '.solo/config.json',
    JSON.stringify(
      {
        stacks: [
          {
            name: 'app',
            root: 'app',
            files: ['**/*.ts'],
            format: 'node ../tools/fmt.cjs {file}',
            stop: [{ name: 'lint', run: 'node ../tools/lint.cjs {files}' }],
            full: [{ name: 'lint', run: 'node ../tools/lint.cjs {files}' }],
          },
        ],
        tokenGuard: { enabled: true, files: ['**/*.css'] },
      },
      null,
      2,
    ),
  );
  write('app/src/ok.ts', 'export const ok = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'init');

  // ---------- lib: globs & paths ----------
  const lib = await import(pathToFileURL(path.join(solo, 'lib.mjs')).href);
  check('glob **/*.ts matches nested', lib.matchAny(['**/*.ts'], 'a/b/c.ts') && lib.matchAny(['**/*.ts'], 'c.ts'));
  check('glob braces', lib.matchAny(['src/**/*.{ts,html}'], 'src/x/y.html') && !lib.matchAny(['src/**/*.{ts,html}'], 'src/y.css'));
  check('glob dir/**', lib.matchAny(['**/auth/**'], 'web/src/auth/token.ts') && !lib.matchAny(['**/auth/**'], 'web/src/author.ts'));
  check('toRel inside / outside repo', lib.toRel(repo, path.join(repo, 'app', 'src', 'ok.ts')) === 'app/src/ok.ts' && lib.toRel(repo, base) === null);
  check('git reads never take optional index locks', fs.readFileSync(path.join(solo, 'lib.mjs'), 'utf8').includes("GIT_OPTIONAL_LOCKS: '0'"));
  check('repoRoot from a subfolder', lib.repoRoot(path.join(repo, 'app')).toLowerCase() === path.resolve(repo).toLowerCase());

  // ---------- PostToolUse: format + tracking (file name with a space) ----------
  const sid = `selftest-${Date.now()}`;
  const badFile = write('app/src/my file.ts', 'export const x = "BAD";   \n');
  let r = hook('hook-after-edit.mjs', { session_id: sid, cwd: repo, tool_name: 'Edit', tool_input: { file_path: badFile } });
  check('after-edit exits 0', r.code === 0, r.err);
  check('formatter ran on the edited file (path with spaces)', !/ +\n/.test(fs.readFileSync(badFile, 'utf8')), fs.readFileSync(badFile, 'utf8'));

  // ---------- Stop: block on failure, pass after fix ----------
  r = hook('hook-stop.mjs', { session_id: sid, cwd: repo, hook_event_name: 'Stop' });
  let j = r.out ? JSON.parse(r.out) : {};
  check('stop blocks when checks fail', j.decision === 'block' && /BAD is not allowed/.test(j.reason || ''), r.out || r.err);
  check('stop output is relative + compact', !(j.reason || '').includes(repo) && (j.reason || '').includes('full log: .solo/logs/'), j.reason);

  fs.writeFileSync(badFile, 'export const x = "fine";\n');
  hook('hook-after-edit.mjs', { session_id: sid, cwd: repo, tool_name: 'Edit', tool_input: { file_path: badFile } });
  r = hook('hook-stop.mjs', { session_id: sid, cwd: repo, hook_event_name: 'Stop' });
  j = r.out ? JSON.parse(r.out) : {};
  check('stop passes after the fix', !j.decision && /PASS/.test(j.systemMessage || ''), r.out || r.err);
  check('the PASS line shows how long each step took', /app\/lint \d+\.\d+s/.test(j.systemMessage || ''), j.systemMessage);
  r = hook('hook-stop.mjs', { session_id: sid, cwd: repo, hook_event_name: 'Stop' });
  check('stop is silent when nothing was edited', r.code === 0 && r.out === '', r.out);

  // ---------- retry cap ----------
  const sid2 = `${sid}-cap`;
  fs.writeFileSync(badFile, 'export const x = "BAD";\n');
  hook('hook-after-edit.mjs', { session_id: sid2, cwd: repo, tool_name: 'Write', tool_input: { file_path: badFile } });
  const decisions = [];
  for (let i = 0; i < 5; i++) {
    const o = hook('hook-stop.mjs', { session_id: sid2, cwd: repo }).out;
    decisions.push(o ? JSON.parse(o).decision || 'msg' : 'silent');
  }
  check('stop gives up after 3 rounds, then stays quiet', decisions.join(',') === 'block,block,block,msg,silent', decisions.join(','));
  fs.writeFileSync(badFile, 'export const x = "fine";\n');

  // ---------- subagent edits that must not be chased ----------
  const sid3 = `${sid}-agent`;
  hook('hook-after-edit.mjs', { session_id: sid3, cwd: repo, agent_type: 'test-author', tool_name: 'Write', tool_input: { file_path: badFile } });
  check('test-author edits are not tracked', hook('hook-stop.mjs', { session_id: sid3, cwd: repo }).out === '');

  // ---------- token guard via PostToolUse ----------
  const css = write('app/src/button.css', ':root { --brand: #0055ff; }\n.btn { color: #fff; }\n');
  r = hook('hook-after-edit.mjs', { session_id: sid3, cwd: repo, tool_name: 'Write', tool_input: { file_path: css } });
  check('token guard exit 2 with the violation on stderr', r.code === 2 && /L2 hexColor/.test(r.err) && !/L1/.test(r.err), r.err);

  // token guard only reports lines changed vs HEAD (legacy raw values are not this edit's problem)
  write('app/src/legacy.css', '.old { color: #123456; }\n');
  git('add', '-A');
  git('commit', '-qm', 'legacy css');
  const legacyCss = write('app/src/legacy.css', '.old { color: #123456; }\n.new { color: #abcdef; }\n');
  r = hook('hook-after-edit.mjs', { session_id: sid3, cwd: repo, tool_name: 'Edit', tool_input: { file_path: legacyCss } });
  check('token guard ignores untouched legacy lines', r.code === 2 && /L2 hexColor/.test(r.err) && !/L1 /.test(r.err), r.err);

  // ---------- shared repo: the formatter never reformats lines nobody changed; no marker comments ----------
  const messy = `${Array.from({ length: 12 }, (_, i) => `export const v${i} = ${i};   `).join('\n')}\n`;
  write('app/src/team.ts', messy);
  write('app/src/tidy.ts', 'export const a = 1;\nexport const b = 2;\n');
  git('add', 'app/src/team.ts', 'app/src/tidy.ts');
  git('commit', '-qm', 'team files');
  const cfgFile = path.join(repo, '.solo', 'config.json');
  const cfgSaved = fs.readFileSync(cfgFile, 'utf8');
  fs.writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(cfgSaved), shared: true }, null, 2));
  const sidS = `${sid}-shared`;
  const teamEdit = `${messy}export const added = 1;   \n`;
  const teamFile = write('app/src/team.ts', teamEdit);
  hook('hook-after-edit.mjs', { session_id: sidS, cwd: repo, tool_name: 'Edit', tool_input: { file_path: teamFile } });
  check('shared: formatter undone when it would reformat lines nobody changed', fs.readFileSync(teamFile, 'utf8') === teamEdit, fs.readFileSync(teamFile, 'utf8').slice(-80));
  const tidyFile = write('app/src/tidy.ts', 'export const a = 1;\nexport const b = 2;\nexport const c = 3;   \n');
  hook('hook-after-edit.mjs', { session_id: sidS, cwd: repo, tool_name: 'Edit', tool_input: { file_path: tidyFile } });
  check('shared: formatter kept when it stays on the edited lines', fs.readFileSync(tidyFile, 'utf8') === 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n', JSON.stringify(fs.readFileSync(tidyFile, 'utf8')));
  const sharedCss = write('app/src/shared.css', '.x { color: #fff; }\n');
  r = hook('hook-after-edit.mjs', { session_id: sidS, cwd: repo, tool_name: 'Write', tool_input: { file_path: sharedCss } });
  check('shared: token guard never asks for marker comments in the code', r.code === 2 && /do not add token-guard-ignore/.test(r.err) && !/put a "token-guard-ignore/.test(r.err), r.err);
  r = hook('hook-after-edit.mjs', { session_id: sidS, cwd: repo, tool_name: 'Edit', tool_input: { file_path: sharedCss } });
  check('shared: a raw value kept on purpose is reported once per session', r.code === 0, r.err);
  fs.writeFileSync(cfgFile, cfgSaved);
  git('checkout', '--', 'app/src/team.ts', 'app/src/tidy.ts');
  fs.rmSync(sharedCss);

  // ---------- test guard: a test may not get weaker than in HEAD without being flagged ----------
  const tgm = await import(pathToFileURL(path.join(solo, 'test-guard.mjs')).href);
  check(
    'test guard ignores regex .test() calls and catches commented-out tests',
    tgm.compareTestFile("it('a', () => expect(/x/.test(s)).toBe(true));\nit('b', () => expect(1).toBe(1));", "it('a', () => expect(/x/.test(s)).toBe(true));\n// it('b', () => expect(1).toBe(1));", 'x.spec.ts').join() === 'tests 2 → 1,assertions 2 → 1' &&
      tgm.compareTestFile("it('a', () => expect(/x/.test(s)).toBe(true));", "it('a', () => expect(/x/.test(s)).toBe(true));", 'x.spec.ts').length === 0,
  );
  check(
    'test guard knows xUnit and pytest skips',
    tgm.compareTestFile('[Fact]\nvoid A() { Assert.True(x); }', '[Fact(Skip = "flaky")]\nvoid A() { Assert.True(x); }', 'ApiTests.cs').join() === 'skip/only markers +1' &&
      tgm.compareTestFile('def test_a():\n    assert x\n', '@pytest.mark.skip\ndef test_a():\n    assert x\n', 'test_api.py').join() === 'skip/only markers +1',
  );
  const specBefore = "describe('calc', () => {\n  it('adds', () => { expect(1 + 1).toBe(2); });\n  it('subtracts', () => { expect(2 - 1).toBe(1); });\n});\n";
  write('app/src/calc.spec.ts', specBefore);
  git('add', 'app/src/calc.spec.ts');
  git('commit', '-qm', 'calc tests');
  const sidT = `${sid}-tests`;
  const spec = write('app/src/calc.spec.ts', specBefore.replace("it('subtracts'", "it.skip('subtracts'"));
  hook('hook-after-edit.mjs', { session_id: sidT, cwd: repo, tool_name: 'Edit', tool_input: { file_path: spec } });
  r = hook('hook-stop.mjs', { session_id: sidT, cwd: repo });
  j = r.out ? JSON.parse(r.out) : {};
  check('test guard blocks once when a test gets skipped', j.decision === 'block' && /Test guard/.test(j.reason || '') && /skip\/only markers \+1/.test(j.reason || ''), r.out || r.err);
  r = hook('hook-stop.mjs', { session_id: sidT, cwd: repo });
  j = r.out ? JSON.parse(r.out) : {};
  check('…then lets it through and keeps showing it to you', !j.decision && /PASS/.test(j.systemMessage || '') && /tests weaker than HEAD.*calc\.spec\.ts/.test(j.systemMessage || ''), r.out || r.err);
  const sidT2 = `${sid}-tests2`;
  write('app/src/calc.spec.ts', `${specBefore.replace("  it('subtracts'", "  // it('subtracts'")}export const BAD = 1;\n`);
  hook('hook-after-edit.mjs', { session_id: sidT2, cwd: repo, tool_name: 'Edit', tool_input: { file_path: spec } });
  r = hook('hook-stop.mjs', { session_id: sidT2, cwd: repo });
  j = r.out ? JSON.parse(r.out) : {};
  check(
    'failing checks and a commented-out test are reported together',
    j.decision === 'block' && /Automated checks failed/.test(j.reason || '') && /tests 2 → 1/.test(j.reason || ''),
    r.out || r.err,
  );
  write('app/src/calc.spec.ts', specBefore.replace("  it('subtracts'", "  // it('subtracts'"));
  hook('hook-after-edit.mjs', { session_id: sidT2, cwd: repo, tool_name: 'Edit', tool_input: { file_path: spec } });
  r = hook('hook-stop.mjs', { session_id: sidT2, cwd: repo });
  j = r.out ? JSON.parse(r.out) : {};
  check('after the fix: PASS, test change still flagged, no second block', !j.decision && /tests weaker than HEAD/.test(j.systemMessage || ''), r.out || r.err);
  git('checkout', '--', 'app/src/calc.spec.ts');
  fs.rmSync(spec);
  r = tool('test-guard.mjs', []);
  check('test guard CLI reports a deleted test file', r.code === 1 && /calc\.spec\.ts: deleted/.test(r.out), r.out);
  write('app/src/moved/calc.spec.ts', specBefore);
  r = tool('test-guard.mjs', []);
  check('moving a test file (plain mv) is not a deletion', r.code === 0 && /PASS/.test(r.out), r.out);
  fs.rmSync(path.join(repo, 'app', 'src', 'moved'), { recursive: true, force: true });
  git('checkout', '--', 'app/src/calc.spec.ts');

  // ---------- patch guard: a suppression on a changed line blocks once; one already in HEAD is not this edit's ----------
  write('app/src/legacy-patch.ts', 'export const a = (globalThis as any).a;\n');
  git('add', 'app/src/legacy-patch.ts');
  git('commit', '-qm', 'legacy patch');
  const sidP = `${sid}-patch`;
  const patched = write('app/src/legacy-patch.ts', 'export const a = (globalThis as any).a;\nexport const b = (globalThis as any).b;\n');
  hook('hook-after-edit.mjs', { session_id: sidP, cwd: repo, tool_name: 'Edit', tool_input: { file_path: patched } });
  r = hook('hook-stop.mjs', { session_id: sidP, cwd: repo });
  j = r.out ? JSON.parse(r.out) : {};
  check(
    'patch guard blocks once for a suppression on a changed line, not for the one already in HEAD',
    j.decision === 'block' && /Patch guard/.test(j.reason || '') && /legacy-patch\.ts:2 /.test(j.reason || '') && !/legacy-patch\.ts:1 /.test(j.reason || '') && /fit check/.test(j.reason || ''),
    r.out || r.err,
  );
  r = hook('hook-stop.mjs', { session_id: sidP, cwd: repo });
  j = r.out ? JSON.parse(r.out) : {};
  check('…then lets it through and keeps flagging it to you', !j.decision && /PASS/.test(j.systemMessage || '') && /patches added.*legacy-patch\.ts/.test(j.systemMessage || ''), r.out || r.err);
  // the CLI looks at the whole branch, as /ship does; test files are the test guard's job
  const trunk = git('rev-parse', '--abbrev-ref', 'HEAD');
  git('switch', '-q', '-c', 'patches');
  write('app/src/branch-patch.ts', 'export const c = (globalThis as any).c;\n');
  git('add', 'app/src/branch-patch.ts');
  git('commit', '-qm', 'a patch on the branch');
  write('app/src/mock.spec.ts', "it('mocks', () => { expect((globalThis as any).m).toBe(1); });\n");
  r = tool('patch-guard.mjs', ['--base', 'auto']);
  check(
    'patch guard CLI lists what a branch adds, never test files or lines already on the main branch',
    r.code === 1 && /branch-patch\.ts:1 /.test(r.out) && /legacy-patch\.ts:2 /.test(r.out) && !/legacy-patch\.ts:1 /.test(r.out) && !/mock\.spec\.ts/.test(r.out),
    r.out,
  );
  fs.rmSync(path.join(repo, 'app', 'src', 'mock.spec.ts'));
  git('checkout', '--', 'app/src/legacy-patch.ts');
  git('switch', '-q', trunk);
  // whether a line is a patch depends on the architecture: a rule's pattern stops outside its owner and names the rule,
  // and the places the architecture means suppressions to be (generated code by default) are left alone
  const cfgPlain = fs.readFileSync(cfgFile, 'utf8');
  const withRule = JSON.parse(cfgPlain);
  withRule.patchGuard = { patterns: [{ rule: 'A2', name: 'tenant branch', in: ['js'], re: 'tenant(?:Id)?\\s*===', allow: ['app/src/tenants/**'] }] };
  fs.writeFileSync(cfgFile, JSON.stringify(withRule, null, 2));
  write('app/src/orders.ts', "export const late = (tenantId: string) => tenantId === 'acme';\n");
  write('app/src/tenants/policy.ts', "export const late = (tenantId: string) => tenantId === 'acme';\n");
  write('app/src/generated/client.ts', 'export const c = (globalThis as any).c;\n');
  write('app/src/vendor/maps.ts', 'export const m = (globalThis as any).maps;\n');
  const ruleOut = tool('patch-guard.mjs', []).out;
  withRule.patchGuard.allow = ['app/src/vendor/**'];
  fs.writeFileSync(cfgFile, JSON.stringify(withRule, null, 2));
  const allowOut = tool('patch-guard.mjs', []).out;
  check("an architecture rule's pattern stops outside its owner, not inside it, and names the rule", /orders\.ts:1 {2}A2 tenant branch/.test(ruleOut) && !/tenants\/policy\.ts/.test(ruleOut), ruleOut);
  check(
    'places the architecture means suppressions to be are left alone (generated code by default, then patchGuard.allow)',
    !/generated\/client\.ts/.test(ruleOut) && /vendor\/maps\.ts/.test(ruleOut) && !/vendor\/maps\.ts/.test(allowOut),
    `${ruleOut}\n${allowOut}`,
  );
  fs.writeFileSync(cfgFile, cfgPlain);
  for (const f of ['orders.ts', 'tenants', 'generated', 'vendor']) fs.rmSync(path.join(repo, 'app', 'src', f), { recursive: true, force: true });

  // ---------- test guard --structural: a structural phase may move tests, never change what they assert ----------
  write('app/src/price.spec.ts', "describe('price', () => {\n  it('totals', () => { expect(total([1, 2])).toBe(3); });\n  it('discounts', () => { expect(discount(10)).toBe(9); });\n});\n");
  git('add', 'app/src/price.spec.ts');
  git('commit', '-qm', 'price tests');
  write('app/src/price.spec.ts', "describe('price', () => {\n  it('totals', () => { expect(total([1, 2])).toBe(3); });\n});\n");
  write('app/src/discount.spec.ts', "describe('discount', () => {\n  it('discounts', () => { expect(discount(10)).toBe(9); });\n});\n");
  r = tool('test-guard.mjs', ['--structural']);
  check('test guard --structural: a test moved to another file is not a change', r.code === 0 && /structural\): PASS/.test(r.out), r.out);
  write('app/src/discount.spec.ts', "describe('discount', () => {\n  it('discounts', () => { expect(discount(10)).toBe(8); });\n});\n");
  r = tool('test-guard.mjs', ['--structural']);
  check('test guard --structural reports an assertion whose expected value changed', r.code === 1 && /assertion changed or removed: .*toBe\(9\)/.test(r.out), r.out);
  fs.rmSync(path.join(repo, 'app', 'src', 'discount.spec.ts'));
  git('checkout', '--', 'app/src/price.spec.ts');

  // ---------- environment failures (broken node_modules) go to the user, not to Claude ----------
  write('tools/envfail.cjs', "console.error(\"Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'node_modules/yargs/build/lib/yargs-factory.js' imported from node_modules/yargs/index.mjs\");process.exit(1)\n");
  const cfgKeep = fs.readFileSync(cfgFile, 'utf8');
  const envCfg = JSON.parse(cfgKeep);
  envCfg.stacks = [{ name: 'app', root: 'app', files: ['**/*.ts'], stop: [{ name: 'deps', run: 'node ../tools/envfail.cjs' }], full: [{ name: 'deps', run: 'node ../tools/envfail.cjs' }] }];
  fs.writeFileSync(cfgFile, JSON.stringify(envCfg, null, 2));
  r = tool('check.mjs', ['--stage', 'full']);
  check('check runner labels broken dependencies as ENV with the restore command', r.code === 1 && /ENV: /.test(r.out) && /environment, not code: run npm ci/.test(r.out), r.out);
  const sidE = `${sid}-env`;
  hook('hook-after-edit.mjs', { session_id: sidE, cwd: repo, tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'app', 'src', 'ok.ts') } });
  r = hook('hook-stop.mjs', { session_id: sidE, cwd: repo });
  j = r.out ? JSON.parse(r.out) : {};
  check('Stop hook does not make Claude fight a broken environment', !j.decision && /could not run/.test(j.systemMessage || '') && /npm ci/.test(j.systemMessage || ''), r.out || r.err);
  r = tool('check.mjs', ['--update-baseline']);
  check('baseline refuses to record a broken environment as known issues', /baseline NOT saved/.test(r.out) && !fs.existsSync(path.join(repo, '.solo', 'baseline', 'app-deps.txt')), r.out);
  // a check must never change files (for example a team lint script with --fix)
  write('tools/mutate.cjs', "const fs=require('fs');fs.appendFileSync('src/ok.ts','// touched by a check\\n');\n");
  write('tools/norun.cjs', "console.log('ERROR [karma-server]: Error: Found 1 load error');process.exit(1)\n");
  envCfg.stacks = [
    {
      name: 'app',
      root: 'app',
      files: ['**/*.ts'],
      stop: [{ name: 'fixer', run: 'node ../tools/mutate.cjs' }],
      full: [{ name: 'fixer', run: 'node ../tools/mutate.cjs' }, { name: 'test', run: 'node ../tools/norun.cjs' }, { name: 'lint', run: 'node ../tools/lint.cjs src/ok.ts' }],
    },
  ];
  envCfg.disabledSteps = ['app/lint'];
  fs.writeFileSync(cfgFile, JSON.stringify(envCfg, null, 2));
  r = tool('check.mjs', ['--stage', 'full']);
  check('a check that changes a tracked file fails and names the file', r.code === 1 && /CHANGED FILES: this check modified app\/src\/ok\.ts/.test(r.out), r.out);
  check('a test suite that could not load is reported as not run', /SUITE DID NOT RUN/.test(r.out), r.out);
  check('disabledSteps skips a step and says why', /skip app\/lint — disabled in \.solo\/config\.json/.test(r.out), r.out);
  git('checkout', '--', 'app/src/ok.ts');
  const sidM = `${sid}-mutate`;
  hook('hook-after-edit.mjs', { session_id: sidM, cwd: repo, tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'app', 'src', 'ok.ts') } });
  r = hook('hook-stop.mjs', { session_id: sidM, cwd: repo });
  j = r.out ? JSON.parse(r.out) : {};
  check('Stop hook hands a file-changing check to you instead of blocking Claude', !j.decision && /CHANGED files/.test(j.systemMessage || ''), r.out || r.err);
  git('checkout', '--', 'app/src/ok.ts');
  envCfg.stacks[0].full = [{ name: 'test', run: 'node ../tools/norun.cjs' }];
  fs.writeFileSync(cfgFile, JSON.stringify(envCfg, null, 2));
  r = tool('check.mjs', ['--update-baseline']);
  check('baseline refuses a test suite that did not run', /baseline NOT saved: the test suite did not run/.test(r.out) && !fs.existsSync(path.join(repo, '.solo', 'baseline', 'app-test.txt')), r.out);
  fs.writeFileSync(cfgFile, cfgKeep);

  // ---------- SessionStart ----------
  write('.solo/ACTIVE', 'demo-task\n');
  write('.solo/tasks/demo-task/spec.md', '# Demo\nAcceptance:\n- [ ] works\n');
  write('.solo/tasks/demo-task/progress.md', 'Next:\n1. finish it\n');
  write(
    '.solo/tasks/demo-task/plan.md',
    '# Plan\n\n## Phase 1 — schema · status: done a1b2c3d\nFiles: db/schema.sql\n\n## Phase 2 — orders endpoint · status: todo\nFiles: api/orders.ts\nVerify: npm test -- orders\n\n## Phase 3 — list page · status: todo\nFiles: web/orders.tsx\n',
  );
  r = hook('hook-session-start.mjs', { session_id: sid, cwd: repo, source: 'clear' });
  check('session-start injects task card and progress', /active task: demo-task/.test(r.out) && /finish it/.test(r.out), r.out);
  check(
    'session-start injects the current phase from plan.md, and only that one',
    /current phase \(2 of 3\)/.test(r.out) && /Verify: npm test -- orders/.test(r.out) && !/Phase 1 — schema/.test(r.out) && !/Phase 3 — list page/.test(r.out),
    r.out,
  );
  write('.solo/tasks/demo-task/plan.md', '# Plan\n\n## Phase 1: schema\n\n## Phase 2: orders endpoint\n'); // written before phases had a status
  r = hook('hook-session-start.mjs', { session_id: sid, cwd: repo, source: 'clear' });
  check('a plan without status markers is not guessed at', /active task: demo-task/.test(r.out) && !/current phase/.test(r.out), r.out);
  // a requirement changed after approval must reach the next session, even when the card is longer than the injected head
  write(
    '.solo/tasks/demo-task/spec.md',
    `# Demo\n${Array.from({ length: 45 }, (_, i) => `- scope line ${i + 1}`).join('\n')}\nAcceptance:\n- [ ] AC1 works\n\n## Change log\n- 2026-09-30 · export as CSV too · AC3 added\n`,
  );
  r = hook('hook-session-start.mjs', { session_id: sid, cwd: repo, source: 'clear' });
  check(
    "session-start injects the spec's Change log even past the card's head",
    /Change log \(approved changes/.test(r.out) && /export as CSV too · AC3 added/.test(r.out) && /more lines in spec\.md/.test(r.out),
    r.out,
  );
  write('.solo/tasks/demo-task/spec.md', '# Demo\nAcceptance:\n- [ ] works\n\n## Change log\n\n## Notes\n- not a change\n');
  r = hook('hook-session-start.mjs', { session_id: sid, cwd: repo, source: 'clear' });
  check('an empty Change log adds nothing, and the next section is not read as changes', /# Demo/.test(r.out) && !/Change log \(approved/.test(r.out) && !/not a change/.test(r.out), r.out);
  // /spec sends an M task through /clear before plan mode: the planning session must still get the phase format
  const planFile = path.join(repo, '.solo', 'tasks', 'demo-task', 'plan.md');
  const planKeep = fs.readFileSync(planFile, 'utf8');
  fs.rmSync(planFile);
  write('.solo/tasks/demo-task/spec.md', '# Demo\nSize: M\nAcceptance:\n- [ ] AC1 works\n');
  r = hook('hook-session-start.mjs', { session_id: sid, cwd: repo, source: 'clear' });
  check(
    'an M task without a plan gets the phase format, Type and Pattern lines included',
    /plan format for this M task/.test(r.out) && /Pattern: <recipe/.test(r.out) && /Type: behavior \| structural/.test(r.out) && /status: todo/.test(r.out),
    r.out,
  );
  fs.writeFileSync(planFile, planKeep);

  // ---------- hooks exactly as Claude Code runs them (exec form from kit/settings.json) ----------
  const kitSettings = JSON.parse(fs.readFileSync(path.join(KIT, 'settings.json'), 'utf8'));
  const runKitHook = (event, payload, startDir) => {
    const h = kitSettings.hooks[event][0].hooks[0];
    const res = spawnSync(h.command === 'node' ? process.execPath : h.command, h.args, {
      cwd: startDir,
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: startDir },
    });
    return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
  };
  const sub = path.join(repo, 'app'); // e.g. VS Code opened on frontend/ instead of the repo root
  r = runKitHook('SessionStart', { session_id: sid, cwd: sub, source: 'startup' }, sub);
  check('hooks find the kit when the session starts in a subfolder', r.code === 0 && /active task: demo-task/.test(r.out) && /started in app\//.test(r.out), r.out || r.err);
  const viaLauncher = write('app/src/launcher.ts', 'export const l = 1;   \n');
  r = runKitHook('PostToolUse', { session_id: `${sid}-launcher`, cwd: sub, tool_name: 'Write', tool_input: { file_path: viaLauncher } }, sub);
  check('PostToolUse through the launcher formats the edited file', r.code === 0 && fs.readFileSync(viaLauncher, 'utf8') === 'export const l = 1;\n', r.err);
  fs.rmSync(viaLauncher);
  r = runKitHook('Stop', { session_id: 'no-kit-here', cwd: base }, base);
  check('launcher is a silent no-op where the kit is not installed', r.code === 0 && r.out === '' && r.err === '', r.err);
  // A session started through a junction or symlink: git reports the real path, Claude Code passes the one it started in.
  const alias = path.join(base, 'alias');
  fs.symlinkSync(repo, alias, 'junction'); // no admin rights needed on Windows; a plain symlink elsewhere
  const aliasFile = path.join(alias, 'app', 'src', 'alias.ts');
  fs.writeFileSync(aliasFile, 'export const a = "BAD";   \n');
  hook('hook-after-edit.mjs', { session_id: `${sid}-alias`, cwd: alias, tool_name: 'Write', tool_input: { file_path: aliasFile } }, alias);
  const aliasFormatted = fs.readFileSync(aliasFile, 'utf8') === 'export const a = "BAD";\n';
  r = hook('hook-stop.mjs', { session_id: `${sid}-alias`, cwd: alias }, alias);
  j = r.out ? JSON.parse(r.out) : {};
  check('a repo opened through a junction or symlink: edits are still formatted and checked', aliasFormatted && j.decision === 'block' && /BAD is not allowed/.test(j.reason || ''), r.out || r.err);
  fs.rmSync(aliasFile);

  // ---------- check runner: baseline ----------
  write('app/src/legacy.ts', 'export const y = "BAD";\n');
  tool('check.mjs', ['--update-baseline']);
  r = tool('check.mjs', ['--stage', 'stop', '--files', 'app/src/legacy.ts']);
  check('baseline: known issue passes', r.code === 0 && /known issue/.test(r.out), r.out);
  write('app/src/legacy.ts', '// moved down\nexport const y = "BAD";\n');
  r = tool('check.mjs', ['--stage', 'stop', '--files', 'app/src/legacy.ts']);
  check('baseline: survives line shifts', r.code === 0, r.out);
  write('app/src/fresh.ts', 'export const z = "BAD";\n');
  r = tool('check.mjs', ['--stage', 'stop', '--files', 'app/src/fresh.ts']);
  check('baseline: new issue fails with its original line', r.code === 1 && /fresh\.ts:1:1 error/.test(r.out), r.out);

  // ---------- review gate, ledger, statusline ----------
  r = tool('check.mjs', ['--review-gate']);
  check('review gate answers, and names its base either way', /^REVIEW (REQUIRED|OPTIONAL)/m.test(r.out) && / vs [0-9a-f]{7,}/.test(r.out), r.out);
  write('app/src/big.ts', Array.from({ length: 450 }, (_, i) => `export const v${i} = ${i};`).join('\n'));
  const bigGate = tool('check.mjs', ['--review-gate']).out;
  fs.rmSync(path.join(repo, 'app', 'src', 'big.ts'));
  const smallGate = tool('check.mjs', ['--review-gate']).out;
  check('review gate suggests splitting only a large change', /SPLIT SUGGESTED/.test(bigGate) && !/SPLIT/.test(smallGate), `${bigGate}\n${smallGate}`);
  // one /phase is reviewed on its own: earlier phases are committed on the branch, --base HEAD leaves them out
  const mainBranch = git('rev-parse', '--abbrev-ref', 'HEAD');
  git('switch', '-q', '-c', 'feature');
  write('app/src/phase1.ts', Array.from({ length: 450 }, (_, i) => `export const p${i} = ${i};`).join('\n'));
  git('add', 'app/src/phase1.ts');
  git('commit', '-qm', 'phase 1');
  write('app/src/phase2.ts', 'export const q = 1;\n');
  const branchGate = tool('check.mjs', ['--review-gate']).out;
  const phaseGate = tool('check.mjs', ['--review-gate', '--base', 'HEAD']).out;
  check('review gate --base HEAD looks only at the uncommitted phase', /SPLIT SUGGESTED/.test(branchGate) && /^REVIEW /m.test(phaseGate) && !/SPLIT/.test(phaseGate), `${branchGate}\n${phaseGate}`);
  fs.rmSync(path.join(repo, 'app', 'src', 'phase2.ts'));
  git('switch', '-q', mainBranch);
  let last = '';
  for (let i = 1; i <= 3; i++) last = tool('ledger.mjs', ['add', 'null-handling', `lesson ${i}`, '--pattern', 'unchecked-optional', '--task', 'demo-task']).out;
  check('ledger escalates when the same mistake (pattern) happens a 3rd time', /ESCALATE/.test(last), last);
  let mixed = '';
  for (let i = 1; i <= 3; i++) mixed = tool('ledger.mjs', ['add', 'tooling', `unrelated lesson ${i}`, '--pattern', `one-off-${i}`]).out;
  check('three different mistakes in one category do not escalate', !/ESCALATE/.test(mixed) && /tooling/.test(tool('ledger.mjs', ['list']).out), mixed);
  const sl = spawnSync(process.execPath, [path.join(solo, 'statusline.mjs')], {
    input: JSON.stringify({ model: { display_name: 'Opus' }, workspace: { current_dir: repo }, context_window: { used_percentage: 64 }, rate_limits: { five_hour: { used_percentage: 20, resets_at: 1800000000 } } }),
    encoding: 'utf8',
  });
  check('statusline renders budget + task', /ctx 64%/.test(sl.stdout) && /5h 20%/.test(sl.stdout) && /task:demo-task/.test(sl.stdout), sl.stdout || sl.stderr);

  // ---------- installer: private by default, invisible to git, survives teammates' pulls ----------
  const INSTALL = path.join(path.dirname(KIT), 'install.mjs');
  const fakeHome = path.join(base, 'home dir');
  fs.mkdirSync(fakeHome, { recursive: true });
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const g = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
    return (r.stdout || '').trim();
  };
  const remote = path.join(base, 'remote.git');
  const team = path.join(base, 'team clone');
  const mine = path.join(base, 'my clone');
  g(base, 'init', '-q', '--bare', remote);
  g(base, 'clone', '-q', remote, team);
  fs.writeFileSync(path.join(team, 'package.json'), JSON.stringify({ name: 'app', scripts: { build: 'tsc' }, devDependencies: { typescript: '5' } }));
  fs.writeFileSync(path.join(team, 'tsconfig.json'), '{}');
  fs.writeFileSync(path.join(team, '.gitignore'), 'node_modules/\n');
  g(team, 'add', '-A');
  g(team, 'commit', '-qm', 'init');
  fs.writeFileSync(path.join(team, 'README.md'), '# app\n');
  g(team, 'add', '-A');
  g(team, '-c', 'user.email=u@example.com', 'commit', '-qm', 'docs', '--author', 'u <u@example.com>'); // a second author → shared repo
  g(team, 'push', '-q', 'origin', 'HEAD');
  g(base, 'clone', '-q', remote, mine);
  const gitignoreBefore = fs.readFileSync(path.join(mine, '.gitignore'), 'utf8');
  const inst = spawnSync(process.execPath, [INSTALL, mine], { encoding: 'utf8', env });
  check('installer runs', inst.status === 0, inst.stderr || inst.stdout);
  check('installer reports git status unchanged', /git status: unchanged/.test(inst.stdout), inst.stdout.slice(-600));
  check('git status is empty after install', g(mine, 'status', '--porcelain') === '', g(mine, 'status', '--porcelain'));
  check('.gitignore untouched', fs.readFileSync(path.join(mine, '.gitignore'), 'utf8') === gitignoreBefore);
  check(
    'private files exist in the repo',
    ['.solo/engine/check.mjs', '.solo/engine/test-guard.mjs', '.solo/config.json', '.solo/inbox.md', 'CLAUDE.local.md', '.claude/settings.local.json'].every((f) => fs.existsSync(path.join(mine, f))) &&
      ['.solo/inbox.md', '.solo/security.md'].every((p) => fs.readFileSync(path.join(mine, '.worktreeinclude'), 'utf8').includes(p)),
  );
  // every skill and agent carries the kit marker, which is how a later install knows it may update them
  const kitFiles = [
    ...fs.readdirSync(path.join(KIT, 'skills')).map((s) => path.join('skills', s, 'SKILL.md')),
    ...fs.readdirSync(path.join(KIT, 'agents')).map((a) => path.join('agents', a)),
  ];
  check(
    'every kit skill and agent went to ~/.claude, marked as the kit\'s',
    kitFiles.every((f) => fs.existsSync(path.join(fakeHome, '.claude', f)) && fs.readFileSync(path.join(fakeHome, '.claude', f), 'utf8').includes('solo-ai-team')),
    kitFiles.filter((f) => !fs.existsSync(path.join(fakeHome, '.claude', f))).join(', '),
  );
  check('git add -A would not stage any kit file', g(mine, 'add', '-A', '--dry-run') === '');
  const mineCfg = JSON.parse(fs.readFileSync(path.join(mine, '.solo', 'config.json'), 'utf8'));
  const mineLocal = fs.readFileSync(path.join(mine, 'CLAUDE.local.md'), 'utf8');
  check('two authors → shared mode: /ship manual, shared-repo rule in CLAUDE.local.md', mineCfg.shared === true && mineCfg.ship.mode === 'manual' && /This is a shared repo/.test(mineLocal) && /Mode: shared repo/.test(inst.stdout), JSON.stringify({ shared: mineCfg.shared, ship: mineCfg.ship }));
  const wtNow = fs.readFileSync(path.join(mine, '.worktreeinclude'), 'utf8');
  check(
    'product.md and architecture.md start as stubs, imported by CLAUDE.local.md and copied into worktrees',
    ['product.md', 'architecture.md'].every((f) => /Not written yet/.test(fs.readFileSync(path.join(mine, '.solo', f), 'utf8')) && mineLocal.includes(`@.solo/${f}`) && wtNow.includes(`.solo/${f}`)),
    mineLocal.slice(0, 200),
  );
  // an older kit's CLAUDE.local.md: no imports, no triage or fit-check rules, plus a line of your own. The installer adds the
  // imports in place, never rewrites your lines, and offers the new Workflow as a suggestion to merge.
  // without --force, older kit files stay in place; say so, or a new CLAUDE.local.md sits next to last month's skills
  const specSkill = path.join(fakeHome, '.claude', 'skills', 'spec', 'SKILL.md');
  const specNow = fs.readFileSync(specSkill, 'utf8');
  fs.writeFileSync(specSkill, `${specNow}\n<!-- an older version -->\n`);
  const noForce = spawnSync(process.execPath, [INSTALL, mine], { encoding: 'utf8', env });
  check(
    'a reinstall without --force names the kit files it kept and the command that updates them',
    noForce.status === 0 && /older than this kit/.test(noForce.stdout) && /--user-only --force/.test(noForce.stdout) && fs.readFileSync(specSkill, 'utf8').includes('an older version'),
    noForce.stdout.slice(-700),
  );
  fs.writeFileSync(specSkill, specNow);
  const localFile = path.join(mine, 'CLAUDE.local.md');
  const older = mineLocal
    .replace(/^@\.solo\/(product|architecture)\.md\n/gm, '')
    .replace(/^- Requirement changes during the work[\s\S]*?\n(?=- Done means)/m, '')
    .replace('## Gotchas\n', '## Gotchas\n- my own rule\n');
  fs.writeFileSync(localFile, older);
  fs.writeFileSync(path.join(mine, '.solo', 'architecture.md'), '# Architecture\n- A1 MUST keep mine\n');
  const upgrade = spawnSync(process.execPath, [INSTALL, mine, '--force'], { encoding: 'utf8', env });
  const upgraded = fs.readFileSync(localFile, 'utf8');
  check(
    'an older CLAUDE.local.md gets the imports in place and the new Workflow as a suggestion, your lines kept',
    upgrade.status === 0 &&
      (upgraded.match(/^@\.solo\/product\.md$/gm) || []).length === 1 &&
      (upgraded.match(/^@\.solo\/architecture\.md$/gm) || []).length === 1 &&
      upgraded.includes('- my own rule') &&
      !upgraded.includes('Requirement changes during the work') &&
      !upgraded.includes('Design misfit during the work') &&
      ['Requirement changes during the work', 'Design misfit during the work'].every((rule) => fs.readFileSync(path.join(mine, '.solo', 'CLAUDE.local.suggested.md'), 'utf8').includes(rule)) &&
      /CLAUDE\.local\.suggested\.md/.test(upgrade.stdout) &&
      fs.readFileSync(path.join(mine, '.solo', 'architecture.md'), 'utf8').includes('A1 MUST keep mine') &&
      g(mine, 'status', '--porcelain') === '',
    upgrade.stdout.slice(-800) + upgraded.slice(0, 300),
  );
  const rerun = spawnSync(process.execPath, [INSTALL, mine, '--force'], { encoding: 'utf8', env });
  check('a second run adds no duplicate imports', rerun.status === 0 && fs.readFileSync(localFile, 'utf8') === upgraded, rerun.stdout.slice(-400));
  fs.writeFileSync(localFile, mineLocal); // back to the fresh install for the tests below
  fs.mkdirSync(path.join(mine, mineCfg.proto.dir, 'idea', 'v1'), { recursive: true });
  fs.writeFileSync(path.join(mine, mineCfg.proto.dir, 'idea', 'v1', 'a.ts'), 'export const p = 1;\n');
  check('prototype folder is invisible to git', g(mine, 'status', '--porcelain') === '', g(mine, 'status', '--porcelain'));
  fs.rmSync(path.join(mine, mineCfg.proto.dir), { recursive: true, force: true });
  // a teammate later commits Claude files of their own — my pull must still work
  fs.writeFileSync(path.join(team, 'CLAUDE.md'), '# team rules\n');
  fs.mkdirSync(path.join(team, '.claude', 'skills', 'deploy'), { recursive: true });
  fs.writeFileSync(path.join(team, '.claude', 'settings.json'), '{}');
  fs.writeFileSync(path.join(team, '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\n---\n');
  g(team, 'add', '-A');
  g(team, 'commit', '-qm', 'team claude setup');
  g(team, 'push', '-q', 'origin', 'HEAD');
  let pulled = true;
  try {
    g(mine, 'pull', '-q', '--no-rebase');
  } catch (e) {
    pulled = String(e.message);
  }
  check("pull works after teammates commit their own CLAUDE.md / .claude files", pulled === true, pulled);
  check('after the pull: my private files intact, status still clean', fs.existsSync(path.join(mine, 'CLAUDE.local.md')) && g(mine, 'status', '--porcelain') === '');

  // reinstalling (e.g. a newer kit) replaces the kit's own hook entries and keeps everyone else's
  const localSettings = path.join(mine, '.claude', 'settings.local.json');
  const sj = JSON.parse(fs.readFileSync(localSettings, 'utf8'));
  sj.hooks.Stop.push({ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.solo/engine/hook-stop.mjs'] }] }); // older kit version
  sj.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo mine' }] }); // a hook of your own
  sj.model = 'opusplan'; // what older kits wrote
  fs.writeFileSync(localSettings, JSON.stringify(sj));
  const again = spawnSync(process.execPath, [INSTALL, mine], { encoding: 'utf8', env });
  const merged = JSON.parse(fs.readFileSync(localSettings, 'utf8'));
  check(
    'reinstall replaces old kit hooks and keeps your own',
    again.status === 0 && merged.hooks.Stop.length === 2 && merged.hooks.Stop.some((grp) => JSON.stringify(grp).includes('echo mine')) && merged.hooks.SessionStart.length === 1 && merged.hooks.PostToolUse.length === 1,
    again.stderr || JSON.stringify(merged.hooks.Stop).slice(0, 300),
  );
  const droppedOldModel = !('model' in merged);
  merged.model = 'sonnet'; // a model you chose yourself
  fs.writeFileSync(localSettings, JSON.stringify(merged));
  spawnSync(process.execPath, [INSTALL, mine], { encoding: 'utf8', env });
  check(
    'reinstall drops the model an older kit pinned (opusplan) and keeps one you chose',
    droppedOldModel && /opusplan/.test(again.stdout) && JSON.parse(fs.readFileSync(localSettings, 'utf8')).model === 'sonnet',
    again.stdout.slice(-500),
  );

  // git treats excluded files as expendable: if a teammate ever commits a file with the same name,
  // `git pull` silently replaces my copy. SessionStart keeps a backup and warns.
  const startHook = (cwd) =>
    spawnSync(process.execPath, [path.join(cwd, '.solo', 'engine', 'hook-session-start.mjs')], { cwd, input: JSON.stringify({ session_id: 'bk', cwd, source: 'startup' }), encoding: 'utf8' });
  fs.appendFileSync(path.join(mine, 'CLAUDE.local.md'), '- my own lesson\n');
  const quiet = startHook(mine);
  const myRules = fs.readFileSync(path.join(mine, 'CLAUDE.local.md'), 'utf8');
  fs.writeFileSync(path.join(team, 'CLAUDE.local.md'), 'team version\n');
  g(team, 'add', '-A');
  g(team, 'commit', '-qm', 'team commits a CLAUDE.local.md');
  g(team, 'push', '-q', 'origin', 'HEAD');
  g(mine, 'pull', '-q', '--no-rebase');
  const warned = startHook(mine);
  check(
    'team starts tracking CLAUDE.local.md → warning, my version kept in .solo/backup',
    quiet.stdout === '' &&
      /WARNING: the team repo now tracks CLAUDE\.local\.md/.test(warned.stdout) &&
      fs.existsSync(path.join(mine, '.solo', 'backup', 'CLAUDE.local.md')) &&
      fs.readFileSync(path.join(mine, '.solo', 'backup', 'CLAUDE.local.md'), 'utf8') === myRules,
    `${quiet.stdout}${warned.stdout}${warned.stderr}`,
  );

  // a repo that tracks one of the kit's personal paths: stop before writing anything
  const tracked = path.join(base, 'tracked repo');
  fs.mkdirSync(path.join(tracked, '.claude'), { recursive: true });
  g(tracked, 'init', '-q');
  fs.writeFileSync(path.join(tracked, '.claude', 'settings.local.json'), '{}\n');
  g(tracked, 'add', '-A');
  g(tracked, 'commit', '-qm', 'oops');
  const refused = spawnSync(process.execPath, [INSTALL, tracked], { encoding: 'utf8', env });
  check(
    'refuses to install over a path the team tracks, writes nothing',
    refused.status === 1 && /Stopped before writing anything/.test(refused.stderr) && !fs.existsSync(path.join(tracked, '.solo')) && g(tracked, 'status', '--porcelain') === '',
    refused.stderr || refused.stdout,
  );

  // a repo with a single author → personal mode; switching to shared later keeps everything private
  const own = path.join(base, 'own repo');
  fs.mkdirSync(own, { recursive: true });
  g(own, 'init', '-q');
  g(own, 'config', 'user.email', 't@example.com'); // me: the only author
  fs.writeFileSync(path.join(own, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(own, 'package.json'), JSON.stringify({ name: 'own', devDependencies: { typescript: '5' } }));
  fs.writeFileSync(path.join(own, 'tsconfig.json'), '{}');
  g(own, 'add', '-A');
  g(own, 'commit', '-qm', 'init');
  const ownInst = spawnSync(process.execPath, [INSTALL, own], { encoding: 'utf8', env });
  const ownCfg = () => JSON.parse(fs.readFileSync(path.join(own, '.solo', 'config.json'), 'utf8'));
  const ownLocal = () => fs.readFileSync(path.join(own, 'CLAUDE.local.md'), 'utf8');
  check(
    'one author → personal mode: /ship pr, commit rule without the shared-repo rule',
    ownInst.status === 0 && ownCfg().shared === false && ownCfg().ship.mode === 'pr' && /Never commit or push/.test(ownLocal()) && !/This is a shared repo/.test(ownLocal()),
    ownInst.stderr || JSON.stringify(ownCfg()),
  );
  // a team lint script with --fix is never run as-is: the kit runs the same eslint call without --fix
  const fixer = path.join(base, 'fixer repo');
  fs.mkdirSync(fixer, { recursive: true });
  g(fixer, 'init', '-q');
  fs.writeFileSync(path.join(fixer, 'package.json'), JSON.stringify({ name: 'f', scripts: { lint: 'npx eslint "src/**/*.{ts,html}" --quiet --fix' }, devDependencies: { eslint: '9', typescript: '5' } }));
  fs.writeFileSync(path.join(fixer, 'tsconfig.json'), '{}');
  g(fixer, 'add', '-A');
  g(fixer, 'commit', '-qm', 'init');
  const fixInst = spawnSync(process.execPath, [INSTALL, fixer], { encoding: 'utf8', env });
  const fixCfg = JSON.parse(fs.readFileSync(path.join(fixer, '.solo', 'config.json'), 'utf8'));
  const fullLint = fixCfg.stacks[0].full.find((st) => st.name === 'lint')?.run || '';
  check(
    'installer strips --fix from a team lint script',
    fullLint === 'npx --no-install eslint "src/**/*.{ts,html}" --quiet' && /uses --fix/.test(fixInst.stdout),
    `${fullLint}\n${fixInst.stdout.slice(0, 400)}`,
  );

  // a teammate's repo where they are the only author is still shared
  const colleague = path.join(base, 'colleague repo');
  fs.mkdirSync(colleague, { recursive: true });
  g(colleague, 'init', '-q');
  g(colleague, 'config', 'user.email', 't@example.com'); // me
  fs.writeFileSync(path.join(colleague, 'README.md'), '# theirs\n');
  g(colleague, 'add', '-A');
  g(colleague, 'commit', '-qm', 'init', '--author', 'u <u@example.com>');
  const colInst = spawnSync(process.execPath, [INSTALL, colleague], { encoding: 'utf8', env });
  check(
    "someone else's repo is shared even when they are its only author",
    colInst.status === 0 && JSON.parse(fs.readFileSync(path.join(colleague, '.solo', 'config.json'), 'utf8')).shared === true && g(colleague, 'status', '--porcelain') === '',
    colInst.stderr || colInst.stdout.slice(-400),
  );

  check('installer notices dependencies that are not installed', /dependencies are not installed/.test(ownInst.stdout), ownInst.stdout.slice(0, 600));
  // a half-installed package: its package.json is there, its entry file is gone
  fs.mkdirSync(path.join(own, 'node_modules', 'typescript', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(own, 'node_modules', 'typescript', 'package.json'), JSON.stringify({ name: 'typescript', main: './lib/typescript.js' }));
  const reInst = spawnSync(process.execPath, [INSTALL, own, '--shared', '--reconfigure'], { encoding: 'utf8', env });
  check('installer notices a half-installed node_modules', /node_modules looks incomplete .*typescript/.test(reInst.stdout), reInst.stdout.slice(0, 600));
  check(
    '--shared --reconfigure switches to shared mode and stays out of git',
    reInst.status === 0 && ownCfg().shared === true && ownCfg().ship.mode === 'manual' && /This is a shared repo/.test(ownLocal()) && g(own, 'status', '--porcelain') === '',
    reInst.stderr || reInst.stdout.slice(-500),
  );

  // installing through a junction or symlink: the exclude rules must land under the repo's real root
  const realRepo = path.join(base, 'real repo');
  fs.mkdirSync(realRepo, { recursive: true });
  g(realRepo, 'init', '-q');
  fs.writeFileSync(path.join(realRepo, 'README.md'), '# real\n');
  g(realRepo, 'add', '-A');
  g(realRepo, 'commit', '-qm', 'init');
  const linkToRepo = path.join(base, 'link to repo');
  fs.symlinkSync(realRepo, linkToRepo, 'junction');
  const linkInst = spawnSync(process.execPath, [INSTALL, linkToRepo], { encoding: 'utf8', env });
  check(
    'installing through a junction or symlink keeps the kit out of git status',
    linkInst.status === 0 && /git status: unchanged/.test(linkInst.stdout) && g(realRepo, 'status', '--porcelain') === '' && fs.existsSync(path.join(realRepo, '.worktreeinclude')),
    linkInst.stderr || linkInst.stdout.slice(-500),
  );
} catch (e) {
  check('selftest crashed', false, e.stack);
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? `\n      ${String(r.detail).split('\n').slice(0, 8).join('\n      ')}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed — node ${process.version} on ${process.platform}`);
process.exitCode = failed ? 1 : 0;
