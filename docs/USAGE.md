# Usage

**English** | [繁體中文](USAGE.zh-TW.md)

How to install it, use it day to day, configure it and troubleshoot it. The design rationale is in [ARCHITECTURE.md](ARCHITECTURE.md).

## 0. Before you start

- **Requirements**: Node.js 18 or later, git, and the latest Claude Code (run `claude update` for the terminal version; update the VS Code extension from its extensions page). The kit relies on recent features: the exec form for hooks, the `effort` and `context: fork` skill fields, and worktrees.
- **Platforms**: Windows (native or WSL) and Linux. Every script is Node, so bash, jq and Python are not needed. macOS has not been tested.
- **Where the kit goes**: any folder outside a repo, for example `D:\tools\solo-ai-team`. Inside a project repo, it would show up in `git status`. No path is hard-coded; once installed, Claude Code never reads the kit folder again, so you only need it to reinstall or update.
- **Two kinds of commands**: installer commands (`node install.mjs`, `node selftest.mjs`) run in the kit folder; check commands (`node .solo/engine/…`) run in the project folder. Below, `D:\work\team-app` stands for your project root (the folder that contains `.git`). In WSL the commands are the same, with Linux paths such as `~/work/team-app`.
- **Personal defaults template**: `kit/templates/CLAUDE.user.md` holds the author's personal defaults (replies in Traditional Chinese; saying "教我" or "learning mode" switches to learning mode). The first install makes it your `~/.claude/CLAUDE.md`. If you already have that file, it is not overwritten; the template is saved as `~/.claude/CLAUDE.solo-suggested.md` for you to merge yourself.

## 1. Once per computer

```powershell
git clone https://github.com/yapeepee/workflow.git D:\tools\solo-ai-team
cd D:\tools\solo-ai-team
node selftest.mjs              # should print 89/89 passed
node install.mjs --user-only   # skills, subagents, status line, personal CLAUDE.md → ~/.claude
```

An existing `~/.claude/CLAUDE.md`, a status line of your own, or a skill with the same name is never overwritten; the installer only tells you to merge by hand. If a work computer can't sign in to GitHub, copying the folder over as a zip works too.

Also recommended: code intelligence plugins. With them, Claude sees type errors right after each edit instead of waiting for the end-of-turn check.

```powershell
npm install -g typescript-language-server typescript   # TypeScript, Angular, React
dotnet tool install --global csharp-ls                 # C# (only for .NET projects)
```

Then run `/plugin install typescript-lsp@claude-plugins-official` in Claude Code; for C# projects, also run `/plugin install csharp-lsp@claude-plugins-official`. The TypeScript language server does not check Angular templates, so template errors are still caught by the Stop hook's `ngc`; with the Angular Language Service extension installed in VS Code, Claude can also read template errors from the Problems panel through `getDiagnostics`.

If you use Claude Code inside WSL, do this section inside WSL too: Windows and WSL each have their own `~/.claude`, and the two are not shared.

## 2. Existing project (including shared team repos)

| Step | Command | What to check |
|---|---|---|
| 0. Install dependencies (project folder) | `npm ci` (`dotnet restore` for .NET) | The project itself must build for the checks to mean anything. When copying a project, don't copy `node_modules` along |
| 1. Preview (kit folder) | `node install.mjs "D:\work\team-app" --dry-run` | Lists the files it would create; writes nothing |
| 2. Install (kit folder) | `node install.mjs "D:\work\team-app"` | A team repo shows `Mode: shared repo`; the last line is `git status: unchanged` |
| 3. Read the Notes | — | Missing tools (ESLint, a test framework, a Prettier config file) and an incomplete `node_modules` are listed here; the more is missing, the less the automatic checks can do |
| 4. Full check (project folder) | `node .solo/engine/check.mjs --stage full` | All PASS means you can start working |
| 5. The project already has errors | `node .solo/engine/check.mjs --update-baseline` | Existing errors are recorded as known issues; from then on only new errors block |
| 6. Write the architecture rules | `/architecture` | The main session reads the whole codebase itself and writes `.solo/architecture.md` (rules, the recipe and reference file for each kind of change, known deviations) once you approve; the review report and the improvement items go straight into `.solo/`. It also proposes the TODO lines of `CLAUDE.local.md`. This uses a lot of context, so `/clear` afterwards |
| 7. Product rules (projects of your own) | `/product` | Builds `.solo/product.md` through an interview: roles, core flows, product rules, what it does not do. Skip it in a team's project |
| 8. Start working | Open the project root in VS Code (or run `claude` at the root) and type `/spec <request>` | The team's `CLAUDE.md` loads alongside your `CLAUDE.local.md`; the kit never touches the team's files |

`CLAUDE.local.md` always carries one rule: never commit or push unless you explicitly ask. A shared repo adds another: follow the team's existing conventions and never add kit-specific comments to the code.

Optional settings (`.solo/config.json`):

- UI projects can turn on token-guard: `"tokenGuard": { "enabled": true }`. Projects such as page builders, which use `[style.*]` bindings legitimately, should turn `styleBinding` off: `"tokenGuard": { "enabled": true, "rules": { "styleBinding": false } }`.
- If Playwright is installed, set `ui.enabled` to `true`, and `/check` and `/ship` will take screenshots as evidence.

If you later add ESLint, a Prettier config or a test framework, run `node install.mjs "D:\work\team-app" --reconfigure` in the kit folder.

## 3. New project

Create the project with the framework's CLI and set up lint, formatting and tests from the start. Install the kit last: the installer only wires up tools that already exist.

```powershell
# Angular (ng new creates the git repo)
ng new shop; cd shop
ng add angular-eslint
npm i -D prettier
Set-Content .prettierrc '{}' -Encoding ascii

# React (Vite)
npm create vite@latest shop -- --template react-ts; cd shop
npm i -D vitest prettier
Set-Content .prettierrc '{}' -Encoding ascii
git init

# ASP.NET Core
dotnet new sln -n Shop
dotnet new webapi -o Api
dotnet new xunit -o Api.Tests
dotnet sln add Api/Api.csproj Api.Tests/Api.Tests.csproj
git init
```

- `.prettierrc` is the signal that tells the installer "this project uses Prettier"; without it, format-on-edit stays off. `-Encoding ascii` keeps older PowerShell versions from writing a BOM at the start of the file; in WSL use `echo '{}' > .prettierrc` instead.
- For Angular, make sure `angular.json` has a `test` target; without one, the full check runs no tests.

| Step | How |
|---|---|
| 1. Install (kit folder) | `node install.mjs "D:\work\shop"` (use the new project's path) |
| 2. Full check (project folder) | `node .solo/engine/check.mjs --stage full`; a new project should pass everything, with no baseline needed |
| 3. Product rules and first decisions | Run `/product` to build `.solo/product.md` through an interview; write the framework version, state management approach and styling strategy in `.solo/decisions.md`. `/spec` reads both when planning |
| 4. Turn on token-guard from day one | Add `"tokenGuard": { "enabled": true }` to `.solo/config.json` and define tokens in Tailwind v4's `@theme`; a new project has no old violations, so this is the cheapest moment |
| 5. First task | Build a minimal end-to-end feature (for example one page plus one API) to confirm that `/spec` → plan mode → `/phase` → `/ship` works in this project |
| 6. Make the first feature the recipe | Run `/architecture`: it writes this feature up as the first rules and reference files, and later features follow them |

If you installed the kit before creating the project, run `node install.mjs "<repo>" --reconfigure` once.

## 4. How a task flows

`/spec` sizes the task, and the next step depends on the size:

```
S (under an hour, one area)
  /spec → implement → /check → /ship

M (a few files or modules)
  /spec → /clear → Shift+Tab into plan mode → you approve the phase plan
        → /phase (once per phase) → /ship → /learn

L (cross-cutting, or more than a day)
  /spec splits it into M tasks first

Project level (now and then)
  /product       product rules (P1…): who uses it, core flows, what it does not do
  /architecture  architecture rules (A1…), the recipe and reference file for each kind of change
  every task's /spec, /phase and /ship checks against both
```

Besides the phase plan, you approve at two points: the task card of an M or L task, and anything that needs a new architectural pattern (a new way of doing something, a new dependency, a structural change, a patch that breaks a rule). A change to an acceptance line also waits for you. Before planning, /spec checks the architecture impact: which recipe each kind of change follows, and which reference file. While architecture.md is not written yet, it takes the closest existing feature as the reference and proposes adding that recipe.

Each `/phase`: tests for this phase only → implement (with a fit check before any patch) → check → code review (only when this phase's diff is large or risky) → commit → mark it done in plan.md. `/ship` runs once, after the last phase: the full check, the test guard, `/secure` (a security review of the whole branch) and a check against the architecture decisions and the patches the branch adds, and then it writes `ship.md`.

For a complete example (who does each step, with which model, and what you review), see [ARCHITECTURE §3](ARCHITECTURE.md).

### Adding or changing a requirement mid-build

Just tell Claude. It first decides which level the change belongs to, then handles it accordingly:

1. **Inside the current phase, with no acceptance line changing**, such as a wording change: Claude does it and adds one line to the task card's Change log, marked `in scope`.
2. **It changes the scope or an acceptance line**: Claude first adds a line to the task card's Change log, updates the affected acceptance lines and their tests, then re-plans the phases not started yet. The current phase is finished and committed first, unless the change makes it moot.
3. **It is really a new feature**: Claude adds it to `.solo/inbox.md` for a later `/spec`, without interrupting the current phase.

Claude never changes an acceptance line on its own; it proposes the change and waits for you. A change to a product rule also updates `product.md` and `decisions.md`. New sessions receive the Change log automatically, so nothing is lost after `/clear`.

### When a change does not fit the structure

Before Claude adds a special case for one id, type, role or tenant, a flag parameter, a near-copy of a function, a suppression (`as any`, `!`, `@ts-ignore`, `eslint-disable`, `#pragma`) or a catch that hides an error, it runs a fit check. It names the concept being decided, finds every place that already decides it, reads the module that owns it according to `architecture.md`, and shows you the searches it ran. Then one of three things happens:

1. **Follow**: the owner already has a place for it (a recipe, a strategy, a table, an extension point), so the change goes there.
2. **Adjust**: the concept is already special-cased in two or more places, so this would be the third. Claude first proposes a structural change, as its own phase that changes no behavior, and waits for your approval. That phase is done only when `test-guard --structural` finds every assertion unchanged.
3. **Patch**: a true one-off, or code that cannot change now (a hotfix, vendor code, another team's module). It stays, with one line under Known deviations in `architecture.md` (path · what it bypasses · why · remove when), so later sessions know not to copy it. A patch that breaks a rule (A…) waits for your approval.

You do not have to spot these yourself: when a changed line adds a suppression, an empty catch, a workaround comment, or a pattern one of your architecture rules forbids, the Stop hook's patch guard blocks once. Those patterns come from the architecture, because whether a line is a patch depends on it: `/architecture` turns each rule that one line can break into a `patchGuard.patterns` entry, with the owner's paths allowed, after you approve. A special case that no rule describes leaves no such mark, so for those the fit check depends on Claude, and on review.

## 5. Situation → command

| Situation | Command | What happens |
|---|---|---|
| A project of your own starts, or a product rule changes | `/product [focus]` | Builds or updates `.solo/product.md` through an interview |
| You just took over an existing project, or want to know whether its architecture holds up | `/architecture` | The main session reads the whole codebase and writes the rules, recipes and reference files, listing problems and rules a tool could check; `/clear` afterwards |
| You want to know whether the current changes drift from the architecture | `/architecture check [base]` | Compares only the changes with `architecture.md`: violations, new patterns that need a decision, rules that are out of date |
| A new feature or a change in requirements | `/spec <request>` | Writes a task card with numbered acceptance criteria that can be checked mechanically, checked against the product rules and recipes; for L tasks or vague requests, it interviews you one question at a time; M and L cards need your approval |
| Adding or changing a requirement mid-build | Just tell Claude | Claude sorts it first (see §4): inside the phase, it just does it; an acceptance change updates the card's Change log and its tests first; a new feature goes to the inbox |
| A change does not fit the structure (you want a special case, a flag parameter or an `as any`) | Just tell Claude | Claude runs the fit check first (see §4): it shows its searches, then follows the owner, proposes a structural phase first, or keeps a patch with a line under Known deviations |
| Not sure what to do next | `/spec` (no request) | Picks three items from `.solo/inbox.md` and suggests them |
| Planning an M task | `/clear`, then Shift+Tab | The new session loads the task card automatically; the plan is a few short phases, saved as `plan.md` once you approve it |
| Doing the next phase of an M task | `/phase` | Tests for this phase only → implement by the recipe → check → compare with the reference file → code review when needed → commit → mark it done |
| Writing the tests for one phase first, on their own | `/test-first [n]` | A separate subagent writes failing tests first (`/phase` already includes this step); you only review the test names |
| A bug | `/bugfix <symptom>` | Reproduces it, finds the root cause, adds a regression test, and only then fixes it |
| You think it's done | `/check` | Runs the full lint, type check, tests and build |
| Handing it over (after the last phase) | `/ship` | Runs the full check, `/secure`, a check against the architecture decisions and `architecture.md`, and maps every acceptance line to its proof; in a shared repo it only writes the commit plan and PR description to `ship.md`, and you commit yourself |
| You want a security review early | `/secure [focus]` | Reviews the whole branch carefully against `.solo/security.md`; on the first run, it builds that threat model with you |
| You want Claude to commit or open the PR | `/ship commit` or `/ship pr` | Asks you before every commit and push |
| End of a task | `/learn` | Records the lessons; when the same mistake (pattern) shows up a third time, it becomes a mechanical check |
| Context above 60%, or leaving for more than an hour | `/handoff`, then `/clear` | Progress is written to a file, and the new session picks it up automatically |
| Comparing approaches | `/proto <idea>` | Builds 2 to 3 throwaway prototypes; once you pick a direction, it goes through `/spec` |
| Long mechanical work (a migration, for example) | `/goal <condition>` | Built into Claude Code; the condition must state the done criteria and the maximum number of rounds |
| You want to write the code yourself and learn | Tell Claude "教我" | Claude guides you through writing it instead of handing you the answer |
| Every Monday | `/retro` | Finds the week's biggest bottleneck and picks one improvement experiment; compares time to ship, findings fixed before shipping, and bugs found after shipping |
| Every Friday | `/sweep` | Deletes dead code and unused dependencies; never commits in a shared repo |
| After a new model ships | `/refresh` | Deletes rules that are no longer needed |

The main session reads the code, analyses and designs itself, because a subagent starts with only its task message and never sees your conversation. A side task that needs the big picture runs as a fork: `/subtask <task>` inherits the whole conversation and reuses the prompt cache. Subagents: `scout` (Sonnet, read-only; exhaustive searches only, such as "every place that uses X"; it reports only locations and the searches it actually ran, never conclusions), `test-author` (inherits the main model; called by `/phase` or `/test-first`; writes the tests for one phase only, never production code), `security-reviewer` (inherits the main model; called by `/secure`; reviews the whole branch carefully), `prototyper` (Sonnet; called by `/proto`; one per direction).

## 6. What happens without a command

- After every edit, projects with a Prettier config format the edited file; in a shared repo, only formatting near your change is kept.
- Before each turn ends, the kit checks the files changed in that turn. When a check fails, Claude fixes it itself, for up to 3 rounds; after that the check pauses until the next edit. The PASS message shows how many seconds each step took.
- When a test is deleted, commented out, marked skip, or loses assertions, Claude is blocked once and must explain why; after that, every PASS message keeps listing those files.
- When a changed line adds a suppression (`as any`, `@ts-ignore`, `eslint-disable` …), an empty catch, a workaround comment or a pattern an architecture rule forbids, Claude is blocked once and must run the fit check; after that, every PASS message keeps listing those files.
- When the only cause of a failure is broken dependencies (for example a `node_modules` that is not installed properly), Claude is not blocked; you are told which restore command to run instead.
- When Claude notices a problem unrelated to the task, it writes it to `.solo/inbox.md` instead of dealing with it on the spot.
- After a new session, `/clear` or a compact, the current task card (with its Change log), the current phase and progress load automatically.
- Every session and every custom subagent loads `.solo/product.md` and `.solo/architecture.md` (imported by `CLAUDE.local.md`); the built-in `/code-review` sees them too. Until they are written, each is two lines naming the command that builds it.
- The status line always shows: `Opus · ctx 34% · 5h 23% (resets 14:00) · 7d 41% · main* · task:login-form`.

## 7. Usage and interruptions

- In the status line, `ctx` is the context this session has used, and `5h` and `7d` are usage; each turns yellow at 50% and red at 80%. When `ctx` reaches 60%, the status line prompts you to run `/handoff` and then `/clear`.
- Model: the kit does not pin the session's model; it uses Claude Code's default (as of 2026-09, Opus 5.5 at medium effort on Max). When usage runs tight, use `/model opusplan` (Opus plans, Sonnet implements). `/spec`, `/product`, `/architecture` and `/refresh` set `model: opus`, so they run on Opus whichever model the session uses.
- On the Max 5x plan, run at most 2 implementation sessions at a time, each in its own worktree (`claude -w <name>`).
- If you have corrected the same thing twice and it is still wrong, run `/clear` and start again, with what you learned written into the new prompt.
- When Claude starts going in circles, builds something you did not ask for, or wants to change the tests, press Esc to interrupt.

## 8. Where files go after install, and who can see them

| Location | Contents | Who can see it |
|---|---|---|
| `~/.claude/skills/`, `~/.claude/agents/` | 15 skills, 4 subagents | Only you; not in any repo |
| `~/.claude/CLAUDE.md`, `~/.claude/solo-statusline.mjs` | Personal defaults, the usage status line | Only you |
| `<repo>/.solo/` | engine, `config.json`, `rules/`, `ledger.json`, `decisions.md`, `inbox.md`, `product.md` (product rules), `architecture.md` (architecture rules and recipes), `architecture-review-*.md` (review reports), `security.md` (the threat model), task state, logs, baselines | Only you (excluded through `.git/info/exclude`) |
| `<repo>/CLAUDE.local.md` | Your instructions for this project | Only you (Claude Code's standard personal file name, also excluded) |
| `<repo>/.claude/settings.local.json` | hooks, model, permissions | Only you (Claude Code's standard personal settings file, also excluded) |
| `<repo>/.worktreeinclude` | Makes `claude -w` worktrees get the private files above too | Only you (excluded; not created when the team already has this file) |
| `<repo>/<proto.dir>/` (Angular example: `src/app/_proto/`) | `/proto`'s throwaway prototypes; appears only once used | Only you (excluded) |
| `<repo>/.git/info/exclude` | Exclude rules for the paths above (appended as a `# solo-ai-team` block) | Only you (it lives in `.git/`, which git never commits or pushes) |

- If the team later commits its own `CLAUDE.md`, `.claude/settings.json` or `.claude/skills/`, you pull as usual without conflicts, and both sets of settings apply.
- The cost: private files are not in git, so they have no version history and do not follow you to a new computer or a fresh clone. Once `CLAUDE.local.md`, `.solo/product.md`, `.solo/architecture.md`, `.solo/decisions.md` and `.solo/ledger.json` have built up content, back them up yourself now and then.
- Git treats ignored files as expendable: if a teammate ever commits a `CLAUDE.local.md` or `.claude/settings.local.json` with the same name, `git pull` silently replaces yours with theirs. So at every session start the kit backs up those two files to `.solo/backup/`; when it finds they have become tracked files, it has Claude tell you in its first sentence and stops editing them.
- The code Claude changes at your request (features, bug fixes, tests) stays in the working tree, of course: that is the work itself. It shows up in `git status`, and whether to commit it is up to you.

## 9. Shared-repo mode

The installer looks at the last 200 commits: if any author is not you (judged by `git config user.email`), the repo counts as shared, even when a single colleague is the only other author. You can also force it with `--shared` or `--personal`. The installer ends by printing `Mode: shared repo` or `Mode: personal repo`. In a shared repo:

- `/ship` defaults to `manual`: after the checks and review, it only writes the file list, commit plan and PR description to `.solo/tasks/<slug>/ship.md`, and runs no git command that writes. To have Claude do it, you must explicitly run `/ship commit`, `/ship pr` or `/ship direct`, and it still asks you before every commit and push.
- `/phase` only writes each phase's commit (files and message) to `ship.md` when that phase ends, and asks you to commit before it starts the next phase.
- `/sweep` does not commit or create branches; it records each group of deletions and a suggested commit message in `.solo/`.
- Format-on-edit keeps only results that land near your change. If the formatter would change lines nobody touched, the file goes back to its pre-format content, so a one-line change never becomes a whole-file diff.
- token-guard never asks for `token-guard-ignore` comments in the code; a value kept on purpose is reported only once per session.
- Mechanical checks that `/learn` escalates live only in `.solo/`; changes to the team's lint config, CI or tests are only suggestions to you.
- `/proto` prototypes go in an excluded folder, and the few lines that wire them into routes are reverted once you pick a direction.

If the repo already tracks `.solo/`, `CLAUDE.local.md` or `.claude/settings.local.json`, the installer stops before writing anything, because writing to those paths would show up in `git status`.

Remember in a shared repo:

- Claude does not commit or push. Before you commit, look at `ship.md` and `git status`.
- All of the kit's files are excluded from git; `git status` only shows the code you asked Claude to change.
- Claude Code's built-in `/verify` and `/run-skill-generator` write files into the repo's `.claude/skills/`; take care before using them in a shared repo.

## 10. Maintenance and troubleshooting

| Situation | Command | Where |
|---|---|---|
| You added ESLint, a Prettier config or a test framework | `node install.mjs "D:\work\team-app" --reconfigure` (re-detects `stacks` and keeps other settings such as tokenGuard and ship; the old file is backed up as `.solo/config.backup.json`) | kit folder |
| Other people start committing to the repo | `node install.mjs "D:\work\team-app" --shared --reconfigure` | kit folder |
| The kit was updated | `node install.mjs --user-only --force`, then for each project `node install.mjs "D:\work\team-app" --force` (`CLAUDE.local.md`, `config.json`, rules, `product.md` and `architecture.md` are never overwritten; `settings.local.json` is merged: older kit hooks are replaced and your own hooks are kept; the `opusplan` setting that older versions wrote is removed, and Claude Code's default model is used instead. An older `CLAUDE.local.md` only gets two import lines, and the new Workflow is saved as `.solo/CLAUDE.local.suggested.md`: ask Claude to "merge the Map, Workflow and Compact instructions sections of the suggested file into CLAUDE.local.md and keep the lines I added") | kit folder |
| Run the fast checks by hand | `node .solo/engine/check.mjs --stage stop --changed` | project folder |
| Check by hand whether tests got weaker | `node .solo/engine/test-guard.mjs --base auto` | project folder |
| List the patches a branch adds (suppressions, empty catches, workaround comments, broken architecture rules) | `node .solo/engine/patch-guard.mjs --base auto` | project folder |
| Check that a structural phase changed no assertion | `node .solo/engine/test-guard.mjs --structural` | project folder |
| See trends per mistake category, and mistakes that repeat | `node .solo/engine/ledger.mjs list --since 30d` | project folder |
| One Stop hook step is slow on every turn (the PASS message shows the seconds, for example over 20 seconds every turn) | In `.solo/config.json`, move that step from `stop` to `full`, so it runs only during `/check` and `/ship` | project folder |
| Audit the whole project for hard-coded design values | `node .solo/engine/token-guard.mjs <files>` | project folder |
| Output shows `ENV:` or `Cannot find module '...node_modules...'` | `npm ci` (`dotnet restore` for .NET); the dependencies are broken, not the code | project folder |
| Output shows `CHANGED FILES:` (a check modified files) | `git restore <those files>`, then fix that command in `.solo/config.json` | project folder |
| A check can't run for now (for example `SUITE DID NOT RUN`: the tests don't even compile) | Add `"disabledSteps": ["angular/test"]` to `.solo/config.json`, and remove it once fixed | project folder |

## 11. Moving to a new computer

The kit is not in any team repo, so you bring it to a new computer yourself:

1. First confirm that your company allows Claude Code on company code, and whether you should sign in with a company or a personal account.
2. Install Node.js 18 or later, git and VS Code, and install the Claude Code extension in VS Code. Run `git config --global user.email <the email you use on this team>`; the installer uses it to tell whether anyone else commits to a repo.
3. Following §1, clone the kit into a folder outside any repo and run `selftest.mjs` and `install.mjs --user-only`.
4. Clone the project the way your team normally does and install it following §2 (`--dry-run` first). You should end up with `Mode: shared repo` and `git status: unchanged`.
5. Open the project root in VS Code and type `/spec <request>` in the Claude Code panel.

Notes:

- **Continuing the same project**: the project layer's private files (`CLAUDE.local.md` and `.solo/`) do not move with you. Copy both from the old computer to the same place in the new clone first, then run the installer; `--force` updates the engine without overwriting your settings, rules and notes.
- **WSL**: when VS Code is connected to WSL (the bottom-left corner shows WSL), Claude Code runs inside WSL, so install the personal layer inside WSL with the Linux build of Node, and clone the project into the WSL file system too.
- **Extension and CLI**: both share the same settings, skills and hooks. The extension bundles Claude Code; you only need to install the CLI separately to type `claude` in VS Code's terminal. The status line appears in the terminal interface; the extension's graphical panel may not show it.
- **Opened in a subfolder**: opening VS Code on a subfolder (for example `frontend/`) works too: the hooks walk up to find the kit, and Claude is reminded to run kit commands from the root. Opening the root is still the simplest.
- **Company-managed settings**: if your company uses managed settings to allow only its own hooks (`allowManagedHooksOnly`), the automatic checks do not run; you can still run `/check` by hand.

## 12. Configuration reference: `.solo/config.json`

| Field | Purpose |
|---|---|
| `shared` | `true` means a shared repo (see §9); detected at install time |
| `stacks[]` | One entry per project area: `name`, `root` (relative to the repo root), `files` (globs, relative to root) |
| `stacks[].format` | The formatter command run on the edited file after each edit; `{file}` is replaced with the file path; `null` turns it off |
| `stacks[].stop[]` | Fast checks the Stop hook runs: `{ name, run, only?, timeoutSec?, baseline? }`; `{files}` is replaced with the files changed in that turn |
| `stacks[].full[]` | The full checks that `/check` and `/ship` run |
| `limits` | `outputLines` (max error lines handed to Claude, default 30), `stopRetries` (max rounds the Stop hook blocks, default 3), and the timeouts |
| `review` | `minLines` (review required at this many changed lines or more, default 300), `splitLines` (at this many or more, splitting the PR is suggested, default 400), `alwaysPaths` (paths that always require review), `ignore` (files not counted, such as lockfiles) |
| `disabledSteps` | Check steps turned off for now, for example `["angular/test"]`; `--reconfigure` does not clear it |
| `testGuard` | `enabled` (default `true`), `files` (which files count as tests; by default `*.spec.ts`, `*.test.*`, `*Tests.cs`, `test_*.py` and more) |
| `patchGuard` | `enabled` (default `true`); `allow` (paths where suppressions are by design, such as an adapter around an untyped library; it replaces the default list of generated code, so keep those entries); `patterns` (the architecture's rules that one changed line can break: `{ rule, name, in, re, allow }`, proposed by `/architecture` and `/learn`). Test files are left to `testGuard` |
| `ui` | `enabled`, `root`, `baseUrl`, `serve`, `routes`, `viewports`, used by `snap.mjs` for screenshots |
| `tokenGuard` | `enabled`, `files`, `allow`, `rules` (`hexColor`, `colorFunction`, `inlineStyle`, `styleBinding`, `arbitraryValue`) |
| `ship` | `mode`: `manual` (prepare only, no git; the default in shared repos), `commit` (commit locally only), `pr`, `direct`; `base` (the comparison base; empty means auto-detect) |
| `proto` | `dir`: the folder where `/proto` puts prototypes (relative to the repo root; excluded from git at install time) |
| `ignore` | Paths that are neither tracked nor checked |

For a project type that is not detected, add a stack by hand, for example:

```json
{ "name": "legacy-asp", "root": ".", "files": ["**/*.asp"], "format": null,
  "stop": [], "full": [{ "name": "smoke", "run": "node tools/smoke.cjs" }] }
```

## 13. Uninstall

**Project layer**: delete the repo's `.solo/`, `CLAUDE.local.md`, `.worktreeinclude` (only if it starts with the `solo-ai-team` marker, which means the kit created it), and the `proto.dir` folder (if you used `/proto`). If `.claude/settings.local.json` still holds permission settings of your own, delete only the three hooks that point to `.solo/engine/`; if the kit wrote the whole file, delete it. Finally, delete the `# solo-ai-team` block from `.git/info/exclude`. None of this affects the team's repo.

**Personal layer**: delete the 15 skill folders in `~/.claude/skills/`, the 4 files in `~/.claude/agents/` and `~/.claude/solo-statusline.mjs`, then remove `statusLine` from `~/.claude/settings.json`.
