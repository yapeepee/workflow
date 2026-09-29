# Solo AI Team

**English** | [繁體中文](README.zh-TW.md)

> A Claude Code workflow for a one-person team, sized for a Max 5x plan.
> **The model does the work, tools decide whether it is right, and you decide what to build and whether to accept it.**

[![selftest](https://github.com/yapeepee/workflow/actions/workflows/selftest.yml/badge.svg)](https://github.com/yapeepee/workflow/actions/workflows/selftest.yml)

A Claude Code setup — 15 skills, 4 subagents, 3 hooks, a status line and a zero-dependency Node engine — that replaces "Claude says it's done" with "the checks say it's done". It installs privately: inside a repo your whole team pulls, nothing it adds shows up in `git status`, gets committed or gets pushed.

## What it fixes

| failure | mechanism | where |
|---|---|---|
| Claude ends its turn with lint, type or test errors in what it just wrote | The Stop hook runs fast checks on the files edited this turn; on failure it blocks and hands back only the error lines, for at most 3 rounds | `hook-stop.mjs`, `check.mjs` |
| Plans are built on a subagent's summary, and nobody has seen the whole | A subagent starts with only its task message, not the conversation or the files already read, so the main session reads the code and plans itself; the scout only runs exhaustive searches, and side tasks that need the big picture run as a fork; `product.md` and `architecture.md` are imported by `CLAUDE.local.md`, so every session and subagent starts from the same rules | `CLAUDE.local.md`, `/spec` |
| New features are each built their own way instead of following the architecture | `architecture.md` lists the rules and, for each kind of change, the recipe and its reference file; `/spec` checks the architecture impact before planning and asks you before any new pattern; `/phase` compares each phase with its reference file; `/ship` checks the whole branch for drift | `/architecture`, `/spec`, `/phase`, `/ship` |
| Requirements change mid-build and the task card and tests drift from the code | Three-level triage: inside the phase, just do it; an acceptance change updates the card's Change log and its tests first; a new feature goes to the inbox. Claude never changes an acceptance line on its own, and new sessions get the Change log | `CLAUDE.local.md`, `hook-session-start.mjs` |
| A large task runs for hours before anything is reviewed or committed | `/phase` works through the plan one phase at a time: tests for that phase only, checks, a review of just that phase's diff, then a commit | `/phase`, `check.mjs --review-gate --base HEAD` |
| Your review time is the bottleneck | You review the task card, the phase plan, test names and evidence; code review runs only for a phase with 300+ changed lines or risky paths | `/phase`, `/ship` |
| Security review is a routine scan that reports nothing | `/secure`: one careful review of the whole branch against the project's own threat model; every finding needs a concrete attack, and the report lists what it verified | `/secure`, `security-reviewer` |
| Tests get "fixed" by skipping, deleting or loosening them | The test guard compares test files with HEAD (fewer tests, new skip/only markers, fewer assertions, deleted files); it blocks once, then keeps flagging them to you | `test-guard.mjs` |
| An old repo's existing errors bury the new ones | A baseline keyed by message text, not line numbers: only new errors block | `check.mjs --update-baseline` |
| `/clear` or a new session forgets where the work stands | The task card, the current phase and the progress notes are re-injected at every session start | `hook-session-start.mjs` |
| The same mistake keeps coming back | The ledger counts each specific mistake (a pattern); its third repeat prints ESCALATE: turn it into a lint rule, test or check step, then delete the prose rule | `ledger.mjs`, `/learn` |
| AI tooling leaks into a team repo: files in `git status`, reformatted lines, commits | Private install through `.git/info/exclude`; in shared repos no git writes, formatting stays next to your edit, no kit comments in the code | `install.mjs`, `hook-after-edit.mjs` |
| A broken `node_modules` makes Claude "fix" code or rewrite the lockfile | Such failures are labelled `ENV`, handed to you with the restore command, and never baselined | `check.mjs` |
| A check that edits files (`eslint --fix`) silently changes code | The installer drops `--fix`/`--write`/`-u`; the runner fingerprints tracked files around every step and fails the step with `CHANGED FILES` | `install.mjs`, `check.mjs` |
| Hard-coded colors and pixel values bypass the design system | Optional token guard, reporting only the lines you changed | `token-guard.mjs` |

## Quick start

Requires Node.js 18 or later, git and a recent Claude Code (`claude update`). Runs on Windows (native or WSL) and Linux; no bash, jq or Python needed.

```bash
git clone https://github.com/yapeepee/workflow.git solo-ai-team   # anywhere outside your project repos
cd solo-ai-team
node selftest.mjs                          # 82/82 passed
node install.mjs --user-only               # once per computer: skills, subagents, status line → ~/.claude
node install.mjs "<repo root>" --dry-run   # preview: lists every file it would create
node install.mjs "<repo root>"             # once per repo; ends with "git status: unchanged"
```

Then, in the repo: `node .solo/engine/check.mjs --stage full` (a repo with existing errors: run `--update-baseline` once) and open Claude Code at the repo root. In an existing project, run `/architecture` once, and `/product` in a project of your own; then start with `/spec <what you want>`. New projects, configuration and troubleshooting: [docs/USAGE.md](docs/USAGE.md).

## How a task flows

```
S  one area, under an hour      /spec → implement → /check → /ship
M  a few files or modules       /spec → /clear → plan mode (Shift+Tab) → you approve the phases
                                → /phase, once per phase → /ship → /learn
L  cross-cutting, over a day    /spec splits it into M tasks first

project level (now and then)    /product: product rules · /architecture: rules, recipes, reference files
                                every task's /spec, /phase and /ship checks against both
```

What you review is small and high-leverage: the task card, the phase plan, each phase's test names, the check results, the security report and screenshots. Besides the phase plan, you approve at two points: the task card of an M or L task, and any new architectural pattern; a change to an acceptance line also waits for you. The steps in between are checked by tools.

## Commands

| command | when | what happens |
|---|---|---|
| `/product [focus]` | when a project of your own starts; when a product rule changes | builds or updates `.solo/product.md` through an interview: roles, core flows, product rules (P1…), what it does not do, open questions |
| `/architecture [check]` | when you start on an existing project; now and then | the main session reads the whole codebase and writes `.solo/architecture.md`: rules (A1…), the recipe and reference file for each kind of change, known deviations; plus a list of problems and of rules a tool could check. `check` compares only the current changes |
| `/spec <request>` | before any non-trivial work | a task card with numbered, machine-checkable acceptance criteria, checked against the product rules and recipes; interviews you for large or vague requests; M and L cards need your approval, and so does any new pattern; with no request, picks 3 items from `.solo/inbox.md` |
| `/phase [n]` | each phase of an M task | tests for this phase only → implement by the recipe → checks → comparison with the reference file → code review of this phase's diff when it is large or risky → commit → phase marked done |
| `/test-first [n]` | tests for one phase on their own (`/phase` already does this) | a separate subagent writes failing acceptance tests: whoever writes the exam does not write the answers |
| `/check` | before calling anything done | full lint, types, tests and build through the compact runner; screenshots if UI capture is configured |
| `/secure [focus]` | run by `/ship`; any time you want an early look | a careful review of the whole branch against `.solo/security.md`, which its first run builds with you |
| `/ship [manual\|commit\|pr\|direct]` | once per task, after the last phase | full check → test guard → review of anything not yet reviewed → `/secure` → decisions and `architecture.md` check → `ship.md` with the acceptance map, the PR text and a metrics line; in shared repos, git is left to you |
| `/learn` | end of a task | lessons go into the ledger under a pattern; the third repeat of the same mistake escalates to a mechanical check |
| `/handoff` | context above 60 %, or a long break | progress goes to a file; after `/clear` the next session picks it up |
| `/bugfix <symptom>` | a bug | reproduce → root cause → regression test → fix |
| `/proto <idea>` | comparing directions | 2–3 throwaway prototypes in parallel; the winner then goes through `/spec` |
| `/retro` | weekly | one bottleneck, one experiment; compares time to ship, findings fixed before shipping, and bugs that escaped |
| `/sweep` | weekly | delete dead code and unused dependencies in verified steps |
| `/refresh` | after a new model | prune rules that only patched an older model's weaknesses |

The main session reads the code, analyses and designs; a side task that needs the big picture runs as a fork (`/subtask <task>`), which inherits the whole conversation. Subagents: `scout` (Sonnet, read-only; exhaustive searches only, returning locations and the searches it ran, not conclusions), `test-author` (same model as your session; tests for one phase, never production code), `security-reviewer` (same model as your session; one careful pass over the whole branch), `prototyper` (Sonnet; one throwaway direction each).

Model: the kit does not pin the session's model, so Claude Code's default applies (Opus 5.5 at medium effort on Max, as of 2026-09). `/model opusplan` (Opus plans, Sonnet builds) saves usage. The four analysis skills are the exception: `/spec`, `/product`, `/architecture` and `/refresh` set `model: opus`, so they run on Opus whichever model the session uses, `opusplan` and Fable included.

## What runs by itself

| hook | when | what it does |
|---|---|---|
| PostToolUse | after every edit | formats the edited file if the repo declares Prettier (in shared repos, only formatting next to your edit is kept); optional token guard |
| Stop | when Claude ends a turn that edited files | fast checks and the test guard on the edited files; blocks with the error lines only, at most 3 rounds; the PASS line shows the seconds each step took; problems Claude cannot fix by editing code (broken dependencies, a check that edits files) go to you instead |
| SessionStart | start, resume, `/clear`, compact | re-injects the active task card (with its Change log), the current phase and progress; backs up your private files and warns if the team starts tracking them |
| status line | always | `Opus · ctx 34% · 5h 23% (resets 14:00) · 7d 41% · main* · task:login-form` |

## Private by default

Skills and subagents live in `~/.claude`, never in a repo. The project files (`.solo/`, `CLAUDE.local.md`, `.claude/settings.local.json`, `.worktreeinclude`) are hidden through `.git/info/exclude`, git's per-clone ignore list, which is never committed. The installer never edits a tracked file (not even `.gitignore`), never runs a git command that writes, and stops before writing anything if the repo already tracks one of those paths.

A repo counts as **shared** when anyone other than you (by `git config user.email`) appears in its last 200 commits. In a shared repo, `/phase` and `/ship` write the commits they would make to `ship.md` and leave git to you, `/sweep` records deletions without committing, formatting is kept only next to the lines you changed, and no kit-specific comment is ever written into the code.

## Layout

```
solo-ai-team/
├─ install.mjs          installer: never deletes, never edits tracked files, never runs git commands that write
├─ selftest.mjs         82 checks in throwaway git repos: engine, private install, shared-repo mode
├─ kit/
│  ├─ engine/           hooks, check runner, test guard, token guard, ledger, snap, status line
│  │                    (Node, no dependencies) → <repo>/.solo/engine/
│  ├─ skills/           15 skills → ~/.claude/skills/
│  ├─ agents/           scout, test-author, security-reviewer, prototyper → ~/.claude/agents/
│  ├─ settings.json     hooks and permission rules → merged into <repo>/.claude/settings.local.json
│  └─ templates/        CLAUDE.local.md, personal CLAUDE.md, decisions.md, inbox.md, product.md, architecture.md,
│                       framework rules (Angular, Angular legacy, React, .NET)
├─ docs/                USAGE (how) and ARCHITECTURE (why), in English and 繁體中文
└─ .github/workflows/   selftest on Ubuntu + Windows × Node 18/22
```

## Design in brief

1. **Tools decide "done".** Lint, types, tests and build judge the work; the model sees only the error lines.
2. **The big picture stays in the main session.** A subagent gets its task message, not the conversation, so the main session reads the code and plans; subagents take only independent work such as searches, tests and reviews. `product.md` and `architecture.md` hold rules rather than a tour, so every session starts from the same ones.
3. **Small loops.** A task is planned as short phases, and each phase is tested, checked, reviewed and committed before the next one starts.
4. **Models follow the judgment, not an old price list.** The default model does the work; the subagents that write tests or review security inherit it; only search and throwaway prototypes run on Sonnet; the most frequent judgments are zero-token scripts.
5. **Security is reviewed as a whole.** One careful, attacker-minded pass over the whole change, anchored on the project's threat model, instead of a routine scan or a review split into slices.
6. **Three repeats of the same mistake, then a mechanism.** A prose rule costs tokens every session and can be forgotten; the third repeat becomes a lint rule, test or check step, and the prose goes.
7. **Keep memory small.** A private `CLAUDE.local.md` under 150 lines, framework rules imported, workflows in skills that cost nothing until called.
8. **Deleting is work.** `/sweep` every week, `/refresh` after every new model.
9. **Leave no trace in a team repo.** The kit's own files never reach git, git writes happen only when you ask, and lines nobody changed are never reformatted.

The ten principles behind these, each traced from the practice it comes from to why it works to how the kit does it: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Verified / not verified

**Verified by `selftest.mjs` (82 checks)** on Windows 11, natively, and on Linux, both with Node 22 (2026-09-29), and by [CI](.github/workflows/selftest.yml) on Ubuntu + Windows × Node 18/22 on every push. It builds throwaway git repos (paths with spaces, a fake remote, two clones), runs git with an empty config of its own, and drives the hooks the way Claude Code calls them: `node <script>` with JSON on stdin.

- Engine: format-on-edit; Stop hook block → fix → pass → silent; the 3-round cap; seconds per step in the PASS line; subagent edits not chased; the token guard on changed lines and in shared mode; the test guard (JS/TS, xUnit, pytest; skipped, commented-out, deleted and moved tests); `ENV`, `CHANGED FILES`, `SUITE DID NOT RUN`, `disabledSteps`; the baseline across line shifts; the review gate, its split suggestion, and `--base HEAD` for one phase; ledger escalation only when the same mistake repeats; the status line; SessionStart injection of the task card, its Change log and the current phase; the hook launcher from a subfolder, and as a no-op where the kit is not installed; a repo opened through a junction or symlink.
- Installer: `git status` unchanged, `.gitignore` untouched, `git add -A` stages nothing; every skill and agent installed with the kit's marker; teammates committing their own Claude files; reinstalling keeps your own hooks, drops the model an older kit pinned and keeps a model you chose; `product.md` and `architecture.md` created and imported by `CLAUDE.local.md`, while an older `CLAUDE.local.md` only gets the imports and the new Workflow as a suggestion file; backup and warning when the team starts tracking `CLAUDE.local.md`; refusal when the repo tracks a personal path; shared vs. personal detection; `--fix` stripping; dependency health notes; `--shared --reconfigure`; installing through a junction or symlink.

**Checked by hand, not in CI (2026-09):** a real Angular 22 app in a Linux VM ([ARCHITECTURE §15](docs/ARCHITECTURE.md)); a TypeScript project with eslint, tsc, vitest and Prettier; the shared-repo formatter revert with real Prettier 3; git 2.43 overwriting an excluded file on pull; 8.3 short names, by running the whole selftest with its fixtures under a short-name path; the target `/phase` and `/ship` give the built-in `/code-review` (Claude Code 2.1.284, a throwaway repo): without it, the review covered a commit not yet pushed, and with it, only the uncommitted edit and the new file.

**Not verified:**

- **The model side.** Whether Claude writes good task cards, plans, tests and security reviews when it follows the skills. Fixtures do not measure judgment; only use does.
- **`/product`, `/architecture` and the requirement-change triage on a real task.** They rest on Claude Code's documentation (subagents do not see the conversation) and outside research ([ARCHITECTURE §18](docs/ARCHITECTURE.md)); not yet measured on real work.
- **The phase loop and `/secure` on a real task.** Both come from one real project's records (four milestones), and the selftest covers only their engine parts. Whether they shorten a task, and whether `/secure` finds what the generic scan missed, will show in `/ship`'s metrics line and in `/retro`; not measured yet.
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
- **Tasks ran for hours before anything was reviewed** (a real project, 2026-09). Plans of 24–54 KB; `/test-first` wrote tests for every phase at once, so nothing compiled until five phases were built; shipping at the end took four slices, and because the review gate measured against `origin/main`, each slice re-reviewed the earlier ones → `/phase` runs one phase at a time with its own tests, review and commit, the review gate takes `--base HEAD`, and plans are capped at about 150 lines.
- **A generic security scan reported nothing a dozen times, while code review found the real authorization hole** (same project). A screen outside the protected layout was reachable without signing in → `/secure` reviews the whole branch once per task against the project's threat model and traces attacker paths; every finding needs a concrete attack, and the report lists what it verified.
- **The Haiku scout undercounted, and plans were built on its summary** (same project). It found one of two occurrences in a file → the scout runs on Sonnet and returns locations and the searches it ran, not conclusions; counts and "nothing else uses it" are confirmed with the main model's own grep.
- **The ledger escalated five categories; one became a real check** (same project). Lessons that merely shared a category could not be caught by one check, and three were marked "enforced" with a note saying so → escalation counts a named pattern, one specific mistake, and categories only show trends.
- **Plans were built on subagent summaries, and a subagent never sees the whole** (2026-09, confirmed against Claude Code's documentation). A regular subagent starts with its own prompt, the task message, CLAUDE.md and git status, not the conversation or the files the main model read; the built-in Explore and Plan agents skip even CLAUDE.md. A stronger model cannot make up for that → the main session reads the code and plans itself (Opus 5.5 has a 1M context on Max); the scout only runs exhaustive searches; side tasks that need the big picture run as a fork; product and architecture rules live in `product.md` and `architecture.md`, imported by `CLAUDE.local.md`, so every session and every custom subagent loads them.
- **Claude changed acceptance lines on its own mid-build** (same project). When a measured result differed from what the spec assumed, Claude rewrote the acceptance line and the script behind it → requirement changes go through a three-level triage, Claude may only propose an acceptance change, and approved changes go into the card's Change log, which new sessions receive.
- **The kit pinned the model to an old price list** (2026-09). `opusplan` ran implementation on Sonnet because Opus used to cost far more, so that project's first milestones were most likely written by Sonnet 5 → the kit leaves the model to Claude Code's default, `test-author` and `security-reviewer` inherit it, and a reinstall removes the old pin.

## Lineage

Solo AI Team succeeds [`claude-quality-harness-v3`](https://github.com/yapeepee/agent-harnesses/tree/main/claude-quality-harness-v3) from [agent-harnesses](https://github.com/yapeepee/agent-harnesses). It keeps that harness's central rule, strong model at author-time and cheap model plus deterministic code at run-time, and applies it to model routing: the strong model where judgment matters (plans, tests, security review), a cheaper one for search, deterministic scripts for the most frequent checks. What changed is where mechanisms come from. v3 ran four review agents and a constitution on every project from the start; here a mechanism is built once the ledger shows the same mistake three times. Component-by-component mapping: [ARCHITECTURE §11](docs/ARCHITECTURE.md).

## Documentation

| document | read it for |
|---|---|
| [docs/USAGE.md](docs/USAGE.md) | installing; existing and new projects; every command; what runs automatically; configuration; troubleshooting; uninstalling |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | why it is built this way: ten principles and their sources, memory layers, verification, security review, usage budget, private install, lineage, the field test, the big picture and requirement changes |

The principles draw on practices that the Claude Code team and other practitioners have published; ARCHITECTURE cites every source. This is an independent project, not affiliated with Anthropic.

Every document exists in English and Traditional Chinese (`*.zh-TW.md`), switchable at the top. Machine-facing files (skill bodies, agents, templates, engine output) are English, which models parse most reliably. The one-line descriptions of the user-invoked skills are Traditional Chinese because that is what the author reads in the `/` menu, and `kit/templates/CLAUDE.user.md` holds the author's personal defaults (replies in Traditional Chinese, a "教我" learning mode).

## License

**All rights reserved.** This repository is published as a portfolio, for reading and evaluation only; no part of it may be copied, modified, redistributed, or used in any product or work without the author's written permission. See [LICENSE](LICENSE).
