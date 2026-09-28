# Solo AI Team

**English** | [繁體中文](README.zh-TW.md)

> Anthropic's published way of building with Claude Code, scaled down to one developer on a Max 5x plan.
> **The model does the work, tools decide whether it is right, and you decide what to build and whether to accept it.**

[![selftest](https://github.com/yapeepee/workflow/actions/workflows/selftest.yml/badge.svg)](https://github.com/yapeepee/workflow/actions/workflows/selftest.yml)

A Claude Code setup — 11 skills, 3 subagents, 3 hooks, a status line and a zero-dependency Node engine — that replaces "Claude says it's done" with "the checks say it's done". It installs privately: inside a repo your whole team pulls, nothing it adds shows up in `git status`, gets committed or gets pushed.

Independent project, not affiliated with Anthropic; it adapts practices Anthropic and others have described in public ([sources](docs/ARCHITECTURE.md)).

## What it fixes

| failure | mechanism | where |
|---|---|---|
| Claude ends its turn with lint, type or test errors in what it just wrote | The Stop hook runs fast checks on the files edited this turn; on failure it blocks and hands back only the error lines, for at most 3 rounds | `hook-stop.mjs`, `check.mjs` |
| Tests get "fixed" by skipping, deleting or loosening them | The test guard compares test files with HEAD (fewer tests, new skip/only markers, fewer assertions, deleted files); it blocks once, then keeps flagging them to you | `test-guard.mjs` |
| An old repo's existing errors bury the new ones | A baseline keyed by message text, not line numbers: only new errors block | `check.mjs --update-baseline` |
| `/clear` or a new session forgets the task | The task card and progress are re-injected at every session start | `/spec`, `/handoff`, `hook-session-start.mjs` |
| The same mistake keeps coming back | The ledger counts mistakes by category; the third one prints ESCALATE: turn it into a lint rule, test or check step, then delete the prose rule | `ledger.mjs`, `/learn` |
| AI tooling leaks into a team repo: files in `git status`, reformatted lines, commits | Private install through `.git/info/exclude`; in shared repos no git writes, formatting stays next to your edit, no kit comments in the code | `install.mjs`, `hook-after-edit.mjs` |
| A broken `node_modules` makes Claude "fix" code or rewrite the lockfile | Such failures are labelled `ENV`, handed to you with the restore command, and never baselined | `check.mjs` |
| A check that edits files (`eslint --fix`) silently changes code | The installer drops `--fix`/`--write`/`-u`; the runner fingerprints tracked files around every step and fails the step with `CHANGED FILES` | `install.mjs`, `check.mjs` |
| Your review time is the bottleneck | You review the task card, plan, test names and evidence; code review runs only at 300+ changed lines or on risky paths, and a split is suggested at 400+ | `/ship`, `check.mjs --review-gate` |
| Hard-coded colors and pixel values bypass the design system | Optional token guard, reporting only the lines you changed | `token-guard.mjs` |

## Quick start

Requires Node.js 18 or later, git and a recent Claude Code (`claude update`). Runs on Windows (native or WSL) and Linux; no bash, jq or Python needed.

```bash
git clone https://github.com/yapeepee/workflow.git solo-ai-team   # anywhere outside your project repos
cd solo-ai-team
node selftest.mjs                          # 69/69 passed
node install.mjs --user-only               # once per computer: skills, subagents, status line → ~/.claude
node install.mjs "<repo root>" --dry-run   # preview: lists every file it would create
node install.mjs "<repo root>"             # once per repo; ends with "git status: unchanged"
```

Then, in the repo: `node .solo/engine/check.mjs --stage full` (a repo with existing errors: run `--update-baseline` once), open Claude Code at the repo root and start with `/spec <what you want>`. New projects, configuration and troubleshooting: [docs/USAGE.md](docs/USAGE.md).

## How a task flows

```
S  one area, under an hour      /spec → implement → /check → /ship
M  a few files or modules       /spec → /clear → plan mode (Shift+Tab) → you approve the plan
                                → /test-first (non-trivial behavior) → implement → /check → /ship → /learn
L  cross-cutting, over a day    /spec splits it into M tasks first
```

What you review is small and high-leverage: the task card, the plan, the test names, the check results and screenshots. The steps in between are checked by tools.

## Commands

| command | when | what happens |
|---|---|---|
| `/spec <request>` | before any non-trivial work | a task card with machine-checkable acceptance criteria; interviews you for large or vague requests; with no request, picks 3 items from `.solo/inbox.md` |
| `/test-first` | M/L tasks with non-trivial behavior | a separate subagent writes failing acceptance tests: whoever writes the exam does not write the answers |
| `/check` | before calling anything done | full lint, types, tests and build through the compact runner; screenshots if UI capture is configured |
| `/ship [manual\|commit\|pr\|direct]` | delivering | full check → test guard → review gate → `ship.md` with the commit plan and PR text; in shared repos, git is left to you |
| `/learn` | end of a task | lessons go into the ledger; the third repeat escalates to a mechanical check |
| `/handoff` | context above 60 %, or a long break | progress goes to a file; after `/clear` the next session picks it up |
| `/bugfix <symptom>` | a bug | reproduce → root cause → regression test → fix |
| `/proto <idea>` | comparing directions | 2–3 throwaway prototypes in parallel; the winner then goes through `/spec` |
| `/retro` | weekly | one bottleneck, one experiment |
| `/sweep` | weekly | delete dead code and unused dependencies in verified steps |
| `/refresh` | after a new model | prune rules that only patched an older model's weaknesses |

Subagents: `scout` (Haiku, read-only, finds code), `test-author` (Sonnet, writes tests, never production code), `prototyper` (Sonnet, one throwaway direction each).

## What runs by itself

| hook | when | what it does |
|---|---|---|
| PostToolUse | after every edit | formats the edited file if the repo declares Prettier (in shared repos, only formatting next to your edit is kept); optional token guard |
| Stop | when Claude ends a turn that edited files | fast checks and the test guard on the edited files; blocks with the error lines only, at most 3 rounds; problems Claude cannot fix by editing code (broken dependencies, a check that edits files) go to you instead |
| SessionStart | start, resume, `/clear`, compact | re-injects the active task card and progress; backs up your private files and warns if the team starts tracking them |
| status line | always | `Opus · ctx 34% · 5h 23% (resets 14:00) · 7d 41% · main* · task:login-form` |

## Private by default

Skills and subagents live in `~/.claude`, never in a repo. The project files (`.solo/`, `CLAUDE.local.md`, `.claude/settings.local.json`, `.worktreeinclude`) are hidden through `.git/info/exclude`, git's per-clone ignore list, which is never committed. The installer never edits a tracked file (not even `.gitignore`), never runs a git command that writes, and stops before writing anything if the repo already tracks one of those paths.

A repo counts as **shared** when anyone other than you (by `git config user.email`) appears in its last 200 commits. In a shared repo, `/ship` writes the commit plan and PR text to `ship.md` and leaves git to you, `/sweep` records deletions without committing, formatting is kept only next to the lines you changed, and no kit-specific comment is ever written into the code.

## Layout

```
solo-ai-team/
├─ install.mjs          installer: never deletes, never edits tracked files, never runs git commands that write
├─ selftest.mjs         69 checks in throwaway git repos: engine, private install, shared-repo mode
├─ kit/
│  ├─ engine/           hooks, check runner, test guard, token guard, ledger, snap, status line
│  │                    (Node, no dependencies) → <repo>/.solo/engine/
│  ├─ skills/           11 skills → ~/.claude/skills/
│  ├─ agents/           scout, test-author, prototyper → ~/.claude/agents/
│  ├─ settings.json     hooks, model (opusplan), permission rules → merged into <repo>/.claude/settings.local.json
│  └─ templates/        CLAUDE.local.md, personal CLAUDE.md, decisions.md, inbox.md,
│                       framework rules (Angular, Angular legacy, React, .NET)
├─ docs/                USAGE (how) and ARCHITECTURE (why), in English and 繁體中文
└─ .github/workflows/   selftest on Ubuntu + Windows × Node 18/22
```

## Design in brief

1. **Tools decide "done".** Lint, types, tests and build judge the work; the model sees only the error lines.
2. **Plan on the strong model, build on the cheaper one.** `opusplan` runs plan mode on Opus and implementation on Sonnet; Haiku scouts; the most frequent judgments are zero-token scripts.
3. **Three strikes, then a mechanism.** A prose rule costs tokens every session and can be forgotten; the third repeat of a mistake becomes a lint rule, test or check step, and the prose goes.
4. **Keep memory small.** A private `CLAUDE.local.md` under 150 lines, framework rules imported, workflows in skills that cost nothing until called.
5. **Deleting is work.** `/sweep` every week, `/refresh` after every new model.
6. **Leave no trace in a team repo.** The kit's own files never reach git, git writes happen only when you ask, and lines nobody changed are never reformatted.

The ten principles behind these, each traced from what Anthropic does to why it works to how the kit does it: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Verified / not verified

**Verified by `selftest.mjs` (69 checks)** on Windows 11, natively, with Node 22 (2026-09-28), and by [CI](.github/workflows/selftest.yml) on Ubuntu + Windows × Node 18/22 on every push. It builds throwaway git repos (paths with spaces, a fake remote, two clones), runs git with an empty config of its own, and drives the hooks the way Claude Code calls them: `node <script>` with JSON on stdin.

- Engine: format-on-edit; Stop hook block → fix → pass → silent; the 3-round cap; subagent edits not chased; the token guard on changed lines and in shared mode; the test guard (JS/TS, xUnit, pytest; skipped, commented-out, deleted and moved tests); `ENV`, `CHANGED FILES`, `SUITE DID NOT RUN`, `disabledSteps`; the baseline across line shifts; the review gate and split suggestion; ledger escalation; the status line; SessionStart injection; the hook launcher from a subfolder, and as a no-op where the kit is not installed; a repo opened through a junction or symlink.
- Installer: `git status` unchanged, `.gitignore` untouched, `git add -A` stages nothing; teammates committing their own Claude files; reinstalling keeps your own hooks; backup and warning when the team starts tracking `CLAUDE.local.md`; refusal when the repo tracks a personal path; shared vs. personal detection; `--fix` stripping; dependency health notes; `--shared --reconfigure`; installing through a junction or symlink.

**Checked by hand, not in CI (2026-09):** a real Angular 22 app in a Linux VM ([ARCHITECTURE §15](docs/ARCHITECTURE.md)); a TypeScript project with eslint, tsc, vitest and Prettier; the shared-repo formatter revert with real Prettier 3; git 2.43 overwriting an excluded file on pull; 8.3 short names, by running the whole selftest with its fixtures under a short-name path (2026-09-28).

**Not verified:**

- **The model side.** Whether Claude writes good task cards, plans and tests when it follows the skills. Fixtures do not measure judgment; only use does.
- **A live Claude Code session.** The selftest replays the exact hook `command` and `args` from `kit/settings.json`, which is how Claude Code runs them, but it is a replay.
- **Usage savings.** No numbers yet. Measure with `/usage` and the status line.
- **macOS.** Never run.

## Failure log → mechanism

Most mechanisms here exist because something concrete went wrong.

- **Angular template errors got past `tsc`** (field test, 2026-09). A template calling a `title()` that did not exist passed `tsc --noEmit` (about 23 s) → for Angular, the Stop hook runs `ngc -p tsconfig.app.json --noEmit`, which type-checks templates too (about 41 s).
- **The kit left a `.git/index.lock` behind in a real repo** (field test, 2026-09). A `git status` from a VM raced git on the host → every git read in the kit runs with `GIT_OPTIONAL_LOCKS=0`, and the selftest asserts it.
- **132 token-guard hits on a real app, most of them wrong** (field test, 2026-09). `<style>` blocks, `assets/` and a page builder's legitimate `[style.*]` bindings → `<style>` is scanned as CSS, `assets/**` is allowed, `styleBinding` can be switched off (132 → 37), and edits report only the lines they changed.
- **A real team lint script ran `eslint --fix`** (2026-09). Used as a check, it would rewrite the team's files → the installer drops `--fix`/`--write`/`-u`, and the runner fails any step that changes a tracked file (`CHANGED FILES`).
- **git replaced a private file on pull without asking** (tested with git 2.43). git treats excluded files as expendable, so a teammate committing a file with the same name overwrites yours → SessionStart backs up `CLAUDE.local.md` and `settings.local.json` to `.solo/backup/` and warns as soon as they become tracked.
- **The selftest crashed on a real Claude Code machine** (2026-09-28, found in the pre-release review). Claude Code adds `**/.claude/settings.local.json` to the global git excludes, so a fixture's `git add -A` staged nothing: 60/61, with the last 7 checks never run. On such machines "git status is empty" also passed without the installer's own exclude doing anything → the selftest now runs git with an empty config of its own, and CI runs it on Ubuntu and Windows.
- **A Windows clone would have broken the rules templates** (2026-09-28, found in the pre-release review). Git for Windows defaults to `core.autocrlf=true`, and the installer strips template front matter with a `\n`-anchored regex, so a CRLF checkout leaked `paths: "{{ROOT}}…"` into every session → `.gitattributes` pins LF, and CI fails on any CRLF checkout.
- **CI's first Windows run failed, 31/52** (2026-09-28, the first CI run). The runner's temp folder is `C:\Users\RUNNER~1\…`, an 8.3 short name, while git reports the long path, so no edited file mapped into the test repo. Real use hits the same wall when a project is opened through a short name, a junction or a symlink: the hooks skipped every edit without a word, and the installer's exclude rules missed, leaving the kit in `git status`. The author's user name is short enough never to produce one → when a path looks outside the repo, the engine compares real paths (`fs.realpathSync.native`) before giving up, the installer resolves its target the same way, and the selftest checks a repo opened through a junction or symlink.

## Lineage

Solo AI Team succeeds [`claude-quality-harness-v3`](https://github.com/yapeepee/agent-harnesses/tree/main/claude-quality-harness-v3) from [agent-harnesses](https://github.com/yapeepee/agent-harnesses). It keeps that harness's central rule, strong model at author-time and cheap model plus deterministic code at run-time, and makes it the model-routing backbone: Opus plans, Sonnet builds, Haiku scouts, scripts judge. What changed is where mechanisms come from. v3 ran four review agents and a constitution on every project from the start; here a mechanism is built once the ledger shows the same mistake three times. Component-by-component mapping: [ARCHITECTURE §11](docs/ARCHITECTURE.md).

## Documentation

| document | read it for |
|---|---|
| [docs/USAGE.md](docs/USAGE.md) | installing; existing and new projects; every command; what runs automatically; configuration; troubleshooting; uninstalling |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | why it is built this way: ten principles taken from Anthropic, memory layers, verification, usage budget, private install, security, lineage, the field test |

Every document exists in English and Traditional Chinese (`*.zh-TW.md`), switchable at the top. Machine-facing files (skill bodies, agents, templates, engine output) are English, which models parse most reliably. The one-line descriptions of the user-invoked skills are Traditional Chinese because that is what the author reads in the `/` menu, and `kit/templates/CLAUDE.user.md` holds the author's personal defaults (replies in Traditional Chinese, a "教我" learning mode).

## License

**All rights reserved.** This repository is published as a portfolio, for reading and evaluation only; no part of it may be copied, modified, redistributed, or used in any product or work without the author's written permission. See [LICENSE](LICENSE).
