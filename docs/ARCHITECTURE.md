# Architecture and design rationale

**English** | [繁體中文](ARCHITECTURE.zh-TW.md)

This document explains why Solo AI Team is designed the way it is. It takes the way Anthropic has publicly described building with Claude Code and scales it down to what one person on a Max 5x plan can afford. For installation and daily use, see [USAGE.md](USAGE.md).

Every Anthropic figure quoted here comes from the public sources listed at the end (read in 2026-09), and most of them are self-reported. Three of them were checked against the original text before publication: Code Review's 84% / 31%, auto mode's 93%, and the 16 agents of the C compiler project.

## 0. The core division of labor

**The model does the work, tools decide whether it is right, and you decide the direction and accept the result.**

The split follows from what each party costs. Producing code is cheap for the model, but its judgment of its own work is unreliable. Lint, type checks and tests judge reliably and cost no tokens. Your judgment is the most valuable, but your attention is the scarcest. So the architecture lets the model produce a lot, lets tools gate it automatically, and leaves only a few high-value decisions to you.

## 1. Ten principles

Each principle has three parts: what Anthropic does, why it works, and what the kit does.

### 1.1 Verification is the biggest lever

- **At Anthropic:** Boris Cherny says that giving Claude a way to verify its own work (running tests, running commands, opening a browser) improves quality 2 to 3 times. Thariq Shihipar, going through hundreds of internal skills, noted that product-verification skills are the easiest to measure. Nicholas Carlini had 16 Claudes write a C compiler in parallel, and the lesson was that the verifier must be nearly perfect, otherwise Claude solves the wrong problem.
- **Why it works:** Every step the model takes is a guess. Without feedback, errors pile up until the end; with automatic feedback, an error is caught at the next step, when it is cheapest to fix. The feedback comes from tools, not from the model grading itself, so it can be trusted.
- **Here:** Before Claude ends each turn, the Stop hook runs lint, typecheck and related tests on the files it changed. On failure it blocks and hands Claude only the error lines. `/check` runs full verification, and `/test-first` has a separate subagent write the acceptance tests first.

### 1.2 Plan first, then build it in one pass

- **At Anthropic:** About 80% of Boris's sessions start in plan mode. When the plan is right, Claude can usually finish in one go.
- **Why it works:** A wrong direction is the most expensive mistake. At planning time a correction costs a few lines of text; after implementation it means rewriting, retesting and reviewing again.
- **Here:** `/spec` produces a task card first. Tasks of size M and up go through plan mode, and `opusplan` makes the planning phase use Opus. Claude starts changing code only after you approve the plan.

### 1.3 Small memory that keeps being updated

- **At Anthropic:** The Claude Code team shares one CLAUDE.md of about 2,000 to 2,500 tokens and updates it several times a week. When Boris reviews a PR, he tags `@.claude` to write what was learned back into it. The official docs recommend keeping each CLAUDE.md under 200 lines.
- **Why it works:** CLAUDE.md is loaded in every session, so every line in it keeps costing tokens, and in a long file the important rules get diluted. Memory that works is short and grows out of mistakes that actually happened; it is not written as a legal code on day one.
- **Here:** Your instructions for a project live in `CLAUDE.local.md` (the template is about 45 lines; the ceiling is 150). Framework rules live in `.solo/rules/` and are imported from it. Workflow knowledge lives in skills, which take no context until they are called. None of these files are version-controlled (see §7.2).

### 1.4 When the same mistake happens three times, make it a mechanical check

- **At Anthropic:** At Meta, Boris's habit was to turn a review comment into a lint rule once it had come up three or four times. Anthropic later automated code review itself.
- **Why it works:** A prose rule depends on the model "remembering to follow it" every time, and every time it can fail. A mechanical check runs every time and costs no tokens. But building a check has a cost too, so it only pays off for problems that repeat.
- **Here:** The `ledger` counts how often each category of mistake happens. On the third occurrence in a category, `/learn` prints ESCALATE and proposes a concrete lint rule, test or check step. Once the mechanical check is in place, the prose rule it replaces is deleted.

This principle also corrects the direction of the predecessor harness: "keep quality with mechanisms, not with model self-discipline" was right, but mechanisms should be triggered by how often a mistake happens, not all built up front (see §11).

### 1.5 Prototype a lot, ship little

- **At Anthropic:** The Claude Code team can build about 20 prototypes in a few hours and ship one. The terminal spinner went through 50 to 100 versions, and about 80% of them never shipped. At the company level, Labs (incubation) and Product (scaling) are separate.
- **Why it works:** Once writing code is cheap, comparing things that were actually built is faster and more accurate than comparing ideas on paper. A prototype exists to eliminate directions, so it has to be cheap and easy to throw away.
- **Here:** `/proto` has Sonnet subagents build 2 to 3 directions in parallel, each with a turn limit. After you choose, the other prototypes are deleted; even the chosen one is reference material only, and the real implementation goes through `/spec` again. Usage is limited, so the number is 2 to 3, not 20.

### 1.6 Roles follow the work

- **At Anthropic:** Everyone's official title is Member of Technical Staff. According to interviews summarized by a third party, the Claude Code team has five roles (Prototyper, Builder, Sweeper, Grower, Maintainer), and people rotate between them weekly as needed. Cat Wu has also described PMs writing prototypes and designers shipping code.
- **Why it works:** Fixed roles create handoff costs and waiting time. One person already holds every role, so the real question is not "who does it" but "which mode of work should I switch to now".
- **Here:** Each role is a command, not a resident agent: Prototyper is `/proto`, Builder is `/spec` → implementation → `/ship`, Sweeper is `/sweep`, Maintainer is `/bugfix`, and Grower is `/retro` and `/refresh`. Most of these commands can only be invoked by you, so when you don't call them, not even their descriptions take up context.

### 1.7 Find the bottleneck, fix the bottleneck

- **At Anthropic:** An official article notes that once code output went up, human code review became the new bottleneck (it cites Amdahl's law). Boris describes the order: once the writing bottleneck is solved, it moves to review, then to maintainability and security. Code Review's data shows that 84% of PRs over 1,000 lines get findings, against only 31% of PRs under 50 lines.
- **Why it works:** Overall speed is set by the slowest stage. For a one-person team, the slowest stage is almost always your attention: reading plans, reading diffs, judging whether a result is right.
- **Here:** What you have to look at is narrowed down to the high-value parts: the task card (what and why), the plan (how), the test names (behavior), and the check results and screenshots (evidence). `/code-review` runs only when a change is large or touches a high-risk path, because reviewing small changes has a low return. The weekly `/retro` picks just one bottleneck to work on.

### 1.8 Keep it simple, and prune as models improve

- **At Anthropic:** Cat Wu explains that the team deliberately keeps its implementation simple so components are easy to swap out as models get stronger, and that after every new model release the team goes back over features that have already shipped.
- **Why it works:** Many rules patch weaknesses of "the model at the time". Once models get stronger, those patches become noise and can even make a new model perform worse.
- **Here:** After a new model or a major Claude Code release, `/refresh` sorts every rule into four kinds: project facts, conventions, patches, and rules that are already mechanized. The last two are candidates for deletion.

### 1.9 Deleting is real work

- **At Anthropic:** The Claude Code team removes some features every few weeks, and about 80% of its code is less than two months old. Sweeper is a formal role on the team.
- **Why it works:** AI makes adding code nearly free, but every line has to be maintained and may be read into context. Without deleting, the cost of reading the codebase gradually eats up your speed.
- **Here:** Every week, `/sweep` uses knip, compiler warnings and grep to find dead code and unused dependencies, and deletes them in small steps, verifying each one.

### 1.10 Safety comes from mechanisms, not discipline

- **At Anthropic:** Users approve about 93% of permission prompts, which is approval fatigue. So Anthropic built auto mode (a classifier reviews every action), sandboxing and containers. Internally, about 30,000 agents run at the same time, and every action they take passes online monitoring before it runs.
- **Why it works:** If everything asks for permission, people get used to clicking yes, which is the same as not asking. The right approach is to ask only where it is truly dangerous and leave the rest to rules and the classifier.
- **Here:** Max plans use auto mode by default. The kit adds deny rules (reading `.env`, force push) and ask rules (commit, push, dropping tables, cloud deletes), and puts common safe commands in allow, which also saves classifier calls. Details in §8.

## 2. The one-person org chart

```
                         You (Director)
  what and why · approve plan and tests · check evidence · ship
                                │
   ┌────────────────┬───────────┴─────────┬────────────────────────┐
   Planning         Execution             Recon                    Mechanical (0 tokens)
   Opus             Sonnet                Haiku                    hooks + scripts
   plan mode        main session builds   scout subagent           Stop checks, formatting
   /spec  /refresh  test-author subagent  reads files, finds code  token-guard, ledger
   /code-review     prototyper subagent   and gathers facts        statusline (usage)
   ───────────────────────────────────────────────────────────────────────────────────────
   Memory: ~/.claude/CLAUDE.md · CLAUDE.local.md · .solo/rules · skills (loaded on demand)
          · .solo/tasks (task state) · .solo/ledger.json (mistake counts) · .solo/decisions.md
```

"Strong model at compile time, weak model at run time" is a principle of the predecessor harness (see §11), and here it becomes the backbone of how models are assigned: Opus does the small amount of work that sets direction (task cards, plans, pruning rules), Sonnet does the bulk of the implementation, Haiku does cheap reconnaissance, and the most frequent judgments go to scripts that cost no tokens.

| What Anthropic does | The one-person version |
|---|---|
| Labs incubate, Product scales | `/proto` (throwaway prototypes) and `/spec` → `/ship` (real implementation) |
| One job title, roles rotate weekly | You hold every role; roles are commands, not resident agents |
| A shared CLAUDE.md, updated weekly | `CLAUDE.local.md` kept under 150 lines; `/learn` proposes updates |
| The same comment repeated three or four times becomes a lint rule | The ledger prints ESCALATE on the third occurrence |
| Code Review (multi-agent, about $15 to $25 per review) | The built-in `/code-review medium`, only for large changes or high-risk paths |
| Auto mode, classifiers, containers | Auto mode by default on Max, plus deny and ask rules |
| 30,000 agents plus monitoring | At most 2 to 3 sessions at once; the statusline shows usage |
| Internal metrics such as the R&D Automation Index | `/retro`'s weekly metrics (lines of code are not counted) |
| Skills start in a sandbox and reach the marketplace only once people use them | A new skill is tried in one project first and moves to `~/.claude/skills` once it proves useful |
| Revisit shipped features after each new model release | `/refresh` |

## 3. A task from start to finish

| Step | Who and which model | What you do | Cost control |
|---|---|---|---|
| 1. `/spec` (in a fresh session) | Opus | Answer product questions (at most 3 for S/M; an interview, one topic at a time, for L or vague requests) and confirm the acceptance criteria | The context is tiny, so switching models here costs almost nothing |
| 2. Plan mode (M and up) | Opus (`opusplan`) | Read the plan, approve or correct it | Wide exploration goes to scout (Haiku) |
| 3. `/test-first` (when behavior is non-trivial) | test-author (Sonnet, separate context) | Read the test names and assertions: this is the highest-leverage review | Whoever writes the exam doesn't write the answers |
| 4. Implementation | Sonnet | Normally no need to watch | Formatting after each edit (in shared repos only formatting near the edit is kept); the Stop hook verifies automatically |
| 5. `/check` | Sonnet plus the runner | Read the result line of each step | The runner returns only error lines and log paths |
| 6. `/ship` | Sonnet, plus the built-in `/code-review` when needed | Read `ship.md` (file list, commit plan, PR description and evidence) and the diff of high-risk paths; in shared repos you commit yourself | A script decides whether a review is needed |
| 7. `/learn` | Sonnet | Approve changes to memory and rules | At most 5 per run |

When context usage passes 50–60%, or you are leaving for more than an hour, run `/handoff` and then `/clear`. When the new session starts, the SessionStart hook loads the task card and progress automatically.

### Example: a date-range filter for the order list (Angular + ASP.NET Core)

1. Run `claude -w order-filter` in a terminal. Claude Code creates a separate worktree and branch.
2. `/spec add a date-range filter to the order list`. Claude asks just one product question: "When the range is empty, show everything or the last 30 days?" After you answer, it writes a task card with four acceptance criteria.
3. Press Shift+Tab to enter plan mode. Opus proposes a plan: from and to parameters on the API, the EF Core query, and an Angular date component with signal state. Once you approve, the plan is saved as `plan.md`.
4. `/test-first`. test-author writes .NET endpoint tests and Angular component tests, all failing for now. You spend three minutes on the test names to confirm they describe the behavior you want.
5. Sonnet implements. Before each turn ends, the Stop hook runs `dotnet build` on changed `.cs` files and eslint plus `ngc --noEmit` (type-checking the templates too) on changed Angular files; on failure, Claude fixes it itself.
6. `/check`. `ng test`, `ng build` and `dotnet test` all pass; `snap.mjs` captures desktop and mobile screenshots.
7. `/ship`. The review gate counts 180 changed lines and no high-risk paths, so the review is skipped. This is a team repo, so Claude leaves git alone: it writes the file list, the commit plan, and a PR description with the check results and screenshot paths to `.solo/tasks/order-filter/ship.md`, and you commit, push and open the PR yourself. In a personal repo you can use `/ship pr`, and Claude asks you once before the commit and once before the push.
8. `/learn`. Claude records a lesson, "Normalize EF date comparisons to UTC first", files it under `api-contract`, and proposes adding one line to `.solo/rules/dotnet.md`.

## 4. Layers of memory and knowledge

The principle: the more often a layer is loaded, the shorter it must be; the more specific a piece of knowledge, the later the layer it belongs in.

| Layer | Location | Loaded when | What goes in | What stays out |
|---|---|---|---|---|
| Personal | `~/.claude/CLAUDE.md` | Every session | Language, communication style, general principles | Any project detail |
| The team's project layer | `CLAUDE.md` in the repo (if the team has one) | Every session | The team's conventions | The kit never edits it |
| Your project layer | `CLAUDE.local.md` | Every session | Commands, a directory map, workflow, Gotchas | Rules a linter can check |
| Framework rules | `.solo/rules/*.md` (imported by `CLAUDE.local.md`) | Every session | Framework and language rules | Rules for the whole project |
| Workflows | `~/.claude/skills/*/SKILL.md` | When called; for user-invoked-only skills, not even the description is loaded | Steps for doing things | Project facts |
| Task state | `.solo/tasks/<slug>/` | SessionStart injects the task card and progress | spec, plan, progress, evidence | Long-term knowledge |
| Mistake counts | `.solo/ledger.json` | Queried through the CLI | Count and latest lesson per mistake category | The rules themselves |
| Architecture decisions | `.solo/decisions.md` | Read by `/spec` before planning | Decision, reason, rejected options | Implementation details |
| Auto memory | `~/.claude/projects/<project>/memory/` | First 200 lines of MEMORY.md, every session | Notes Claude keeps for itself | Rules that need your review |

Auto memory is a built-in Claude Code feature. The split with `/learn` is this: auto memory holds the notes Claude jots down for itself, while `/learn` produces formal rules you have approved. `/refresh` reminds you to check the size of auto memory with `/memory`.

What the kit keeps resident in context (the `CLAUDE.local.md` template, the imported framework rules, the descriptions of the two auto-invocable skills and of the three subagents) totals about 1,300 tokens or less. For comparison, the Claude Code team's own CLAUDE.md is about 2,500 tokens.

## 5. Verification and quality

### 5.1 Layered checks

| Layer | Trigger | What it runs | Time | Token impact |
|---|---|---|---|---|
| PostToolUse hook | Every file edit | Formats that file; optional token-guard | Usually 1 to 2 seconds | 0 when there is no violation |
| Stop hook | End of each turn that edited files | Lint, typecheck and related tests on the changed files; test guard checks whether tests got weaker | Seconds to tens of seconds | Error lines, only on failure |
| `/check` | Before calling anything done | Full lint, tests, build; UI screenshots | Minutes | Summary only |
| `/ship` | Before shipping | Full check, test guard, plus conditional `/code-review` and `/security-review`; suggests splitting the PR when the change is too large | Minutes | Reviews run only when needed |
| `/sweep` | Weekly | Dead code, dependencies, TODOs | Depends on the project | At most 20 candidates |

### 5.2 Seven mechanisms that keep checks trustworthy and cheap

1. **Summarized output.** The check runner hands Claude only the error lines (with one line of context) and the log path; everything else goes to `.solo/logs/`. When Claude needs more, it reads the log itself.
2. **Retry cap.** The Stop hook blocks at most three rounds in a row. If it still fails after the third round, it lets Claude stop and pauses checking until the next edit, so an error that cannot be fixed doesn't keep burning usage.
3. **Baseline.** Legacy projects often start with many lint and type errors. After `--update-baseline`, the Stop hook blocks only new errors. The baseline is keyed by the text of the error message, without line numbers, so when code moves up or down, old errors are not mistaken for new ones.
4. **Subagent edits are not tracked.** Tests written by test-author are supposed to be red, and prototypes from prototyper are throwaway by design, so the Stop hook never asks the main session to fix them.
5. **token-guard looks only at changed lines.** It uses `git diff HEAD` to find the lines that differ from HEAD and reports violations only on those lines. Hard-coded colors already in an old file are not charged to this edit, so Claude doesn't wander off fixing a pile of things unrelated to the task. To audit a whole project, run `node .solo/engine/token-guard.mjs <files>` by hand.
6. **Telling "the environment is broken" apart from "the code is wrong".** When `node_modules` is missing or half-installed, every check fails with `Cannot find module '...node_modules...'`. Editing code can't fix that, and if Claude were blocked as usual, it might edit code anyway, or run `npm install` and rewrite the team's lockfile. So the runner labels these failures `ENV` and attaches the correct restore command (`npm ci`, `pnpm install --frozen-lockfile`, `dotnet restore`). When the only failures are environmental, the Stop hook doesn't block Claude and tells you which command to run instead, and `--update-baseline` never records environment failures as known issues. The installer already checks that the entry file of each direct dependency exists, to catch the problem early, and every command that adds or removes a dependency is in the ask rules.
7. **Checks may not change files.** Team lint scripts often carry `--fix` (this was actually encountered in a team repo), and running one as-is rewrites the team's files. So when the installer finds a script that changes files (`--fix`, `--write`, `-u`), it never runs it as-is: a single eslint or ng lint call is run with `--fix` removed, and anything else falls back to plain `eslint .`. The runner also compares the diff of tracked files against HEAD before and after each step; if any file differs afterwards, that step fails and lists the changed files (`CHANGED FILES`), and the Stop hook hands it to you instead of blocking Claude. A guard of the same kind: when the test runner can't even load the tests (for example Karma's `Found 1 load error`), not a single test ran, and that result must not go into the baseline, or the step would turn green with zero tests. The report marks it `SUITE DID NOT RUN`, and you can disable the step for now with `disabledSteps`.

### 5.3 The rule escalation ladder

| Rung | Form | Cost each time | Reliability |
|---|---|---|---|
| 1 | Said once in conversation | Only in the moment | Works only in the moment |
| 2 | One line in `CLAUDE.local.md` | Tokens in every session | Depends on the model remembering |
| 3 | `.solo/rules` or a skill's Gotchas | Rules cost tokens every session; a skill only when called | Depends on the model remembering |
| 4 | Lint rule, test, check step, hook | 0 tokens | Runs every time |

A rule starts on a low rung and moves up only when the ledger shows it recurring. Once it reaches rung 4, the prose on rungs 2 and 3 is deleted.

## 6. Compute budget (Max 5x)

### 6.1 Facts (per the official docs, 2026-09)

- The official cost docs state that Sonnet handles most coding work at a lower cost than Opus, and that Opus is for complex architectural decisions and multi-step reasoning. The default model on Max plans is Opus 5.5. The kit sets the project's default model to `opusplan`: Opus in plan mode, and Sonnet automatically the rest of the time.
- Subscription usage is measured in two windows: 5 hours and weekly. The statusline shows context usage, the usage percentage of both windows, and when the 5-hour window resets.
- On subscription plans, the prompt cache lives about one hour. After more than an hour without interaction, the first message has to process the whole context again. `/compact` is itself one large request; `/clear` uses no usage.
- Switching models invalidates the prompt cache (advisor is the exception). So a cheaper model only makes sense in a fresh context, such as a subagent or a new session. If you switch the main model to Haiku in the middle of a long conversation, it has to reread the whole uncached context, which can cost more than continuing with the already cached Sonnet.
- On some plans, Fable counts against usage credits (extra cost). ultracode, `/batch` and agent teams all consume a lot of tokens; the official docs say that with teammates working in plan mode, agent teams use about 7 times as much as a normal session.

### 6.2 Daily discipline

1. **Model split:** `opusplan` by default, scout always on Haiku, `/spec` and `/refresh` on Opus in a fresh session. Only after getting stuck on the same problem twice, turn on `/advisor opus` (Sonnet keeps working, Opus only advises at decision points) or `/model opus`.
2. **Context:** At 50% to 60% usage, run `/handoff` and then `/clear`. After more than an hour away, `/clear` first when you come back. Ask small questions unrelated to the task with `/btw`, so they stay out of the conversation history.
3. **Parallelism:** At most 2 implementation sessions at once, each in its own worktree, plus optionally 1 light session for specs or reviews.
4. **Window rhythm:** Put planning that needs Opus early in the 5-hour window. When the 5-hour window passes 80%, switch to reviewing, writing code by hand, or learning mode. When the weekly window is already past 70% by midweek, work on one thread only and skip `/proto`.
5. **Avoid by default:** ultracode, `/batch`, agent teams, Fable, a review on every push, advisor turned on by default.
6. **Measure:** Use the attribution in `/usage` to see which skill or subagent uses the most. Run `/insights` once a month to see friction across sessions, keeping in mind that it uses usage too.

## 7. Parallelism, worktrees and the private install

### 7.1 Worktrees

`claude -w <name>` creates a worktree in `.claude/worktrees/<name>/` on a branch named `worktree-<name>`. A worktree is a fresh checkout and can't see uncommitted files, so the installer creates `.worktreeinclude`, which lists the kit's private files (engine, config, rules, ledger, `CLAUDE.local.md`, `.claude/settings.local.json`); Claude Code copies them over when it creates a worktree. `.worktreeinclude` itself is excluded from git too. If the team already has its own `.worktreeinclude`, the installer leaves it alone, and you should work in the main checkout.

Each hook command is a small launcher: it walks up from `CLAUDE_PROJECT_DIR` (the folder the session started in) looking for `.solo/engine/`, runs the matching hook if it finds one, and does nothing otherwise. So hooks also work when VS Code is opened on a subfolder (for example `frontend/`). According to the official docs, Claude Code started in a subfolder still reads `.claude/settings.local.json` at the repo root, and SessionStart reminds Claude to run the kit's commands from the root. Hooks read the `cwd` in their input, so inside a worktree they check the worktree's files.

Each worktree needs its own dependencies installed (for example `node_modules`), which costs time and disk space; pnpm's shared package store lowers that cost. The tasks worth running in parallel are independent ones, for example a feature plus a bug fix; splitting one feature across several sessions usually costs more in coordination than it saves. Boris runs 5 local sessions plus 5 to 10 web sessions at once, but on Max 5x the sensible ceiling is 2 implementation sessions plus 1 light session.

### 7.2 Private install: the kit stays out of version control

The goal is that you can use the kit in a repo your whole team pulls, without anyone seeing it. It works in three parts.

1. **Where files live.** Skills and subagents live in `~/.claude/`, entirely outside the repo. Inside the repo there are only `.solo/` (engine, config, rules, ledger, decision log, task state), `CLAUDE.local.md`, `.claude/settings.local.json` and `.worktreeinclude`, plus a prototype folder once you have used `/proto`. `CLAUDE.local.md` and `settings.local.json` are personal files defined by Claude Code itself, which teams by convention don't commit. If a repo does track `.solo/`, `CLAUDE.local.md` or `.claude/settings.local.json`, the installer stops before writing anything.
2. **How they are hidden.** These paths are written to `.git/info/exclude`. It works like `.gitignore`, except that it exists only in your clone and is itself never committed or pushed. So `git status` doesn't show these files, and `git add -A` doesn't add them. The installer modifies no tracked file (including `.gitignore`); it runs `git status` before and after installing and prints the comparison.
3. **Staying out of the team's way.** If the team later commits its own `CLAUDE.md`, `.claude/settings.json` or `.claude/skills/`, you pull as usual without conflicts, and the instructions and hooks from both sides apply together. When the repo has no Prettier config file, the installer turns format-on-edit off by default, so that changing one line never reformats a whole file and fills your teammates' PR diffs with formatting noise.

The cost is that the private files have no version history. `/learn` still shows you a diff before changing a rule, but afterwards git has no history of it. If you want history, you can `git init` a repo of your own inside `.solo/`; it lives in an excluded folder and doesn't affect the team's repo.

### 7.3 Shared-repo mode

The private install keeps the kit's files out of version control, but the kit's behavior can still reach things the team sees: `/ship` commits and pushes, `/sweep` commits, a formatter can reformat a whole file, and token-guard suggests adding comments to the code. So the installer looks at the last 200 commits: if any author is not you (judged by `git config user.email`), it writes `"shared": true` to `.solo/config.json`. A project where only one colleague writes code counts too. On a new computer without `user.email` set, every author counts as someone else, which errs on the safe side. You can also set the mode directly with `--shared` or `--personal`. In a shared repo:

- `/ship` defaults to `manual`: checks and review run as usual, but it only writes the file list, commit plan and PR description to `.solo/tasks/<slug>/ship.md`, and runs no git command that writes. `/ship commit`, `/ship pr` and `/ship direct` are explicit requests, and commit and push still ask you first.
- `/sweep` doesn't commit or switch branches; it records each group of deletions and a suggested commit message in `.solo/`.
- The PostToolUse hook computes "which lines of this file differ from HEAD" before and after formatting (both times in HEAD's line numbers, so the two can be compared directly). If the formatter changed lines that nobody had touched, more than 3 lines away from this edit, the file is restored to its pre-format content. Files whose formatting was already consistent get formatted as usual; an old file with inconsistent formatting doesn't turn into a whole-file diff because of a one-line change. Both cases were verified with real Prettier 3.
- token-guard never asks for `token-guard-ignore` comments; a raw value kept on purpose is reported only once per session.
- Mechanical checks produced by `/learn` are written only to `.solo/`; changes to the team's lint config, CI or tests only become suggestions for you.
- The `/proto` prototype folder is excluded from git, and the few lines that wire prototypes into routes are reverted once a direction is chosen.
- `CLAUDE.local.md` gets one extra rule: follow the team's existing conventions, and never add kit-specific comments to the code. "Never commit or push unless you explicitly ask" is there in every repo.

All of this is covered by `selftest.mjs`. It creates a simulated remote repo and two clones, and confirms that after installing, `git status` is empty, `.gitignore` is unchanged, `git add -A` adds no kit file, the prototype folder is invisible, and your pull still succeeds after a teammate commits their own Claude settings. It also tests that someone else's commits switch shared mode on automatically (including a project that only one colleague writes), that only your own commits mean personal mode, that `--shared --reconfigure` switches modes, that the installer writes nothing when the repo tracks a personal path, and the formatter revert and token-guard behavior in shared mode. The selftest runs git with an empty config of its own, so the global git settings on your computer can't affect these results.

### 7.4 A pull can overwrite excluded files

git treats ignored files as expendable. If a teammate ever commits a file named `CLAUDE.local.md` or `.claude/settings.local.json`, your `git pull` replaces your private version with the team's without warning (tested on git 2.43). So the SessionStart hook backs up both files to `.solo/backup/` every time, and as soon as they become tracked files, it tells Claude to mention it in the first sentence of its reply. `/learn` and `/refresh` check this too, and never edit a `CLAUDE.local.md` that the team already tracks.

## 8. Security and permissions

Max plans default to auto mode, where a classifier reviews every action. The kit's settings add three layers of rules on top. They are written to `.claude/settings.local.json` and apply only to you.

- **deny:** Reading `.env`, `.env.local`, `.env.*.local`, `.env.production`, `*.pem`, `*.pfx`, `*.p12` and the `secrets/` directory is forbidden, as are all forms of `git push --force` and `git push -f`. `--force-with-lease` is not forbidden, but every push asks you first.
- **ask:** Commit, push, `git reset --hard`, `git clean`, `git rebase`, deleting branches, merging PRs, publishing packages, `dotnet ef database`, `DROP TABLE`, `DROP DATABASE`, `TRUNCATE TABLE`, AWS delete and terminate commands, and adding or removing dependencies (`npm install`, `pnpm add`, `dotnet add` and so on) all ask you first. The official docs state that ask rules still apply in auto mode.
- **allow:** The kit's own scripts, plus `git add`, `git switch` and `git worktree list`. According to the official docs, auto mode checks the allow, ask and deny rules first and decides matching actions directly without sending them to the classifier, which also saves classifier calls. Auto mode automatically disables allow rules that are too broad (such as `Bash(*)`); a disabled rule falls back to the classifier, and nothing stops working.

`.claude/` is a protected path in Claude Code, so when Claude modifies `.claude/settings.local.json`, the change goes to the classifier or to you. The rules and config in `.solo/` are not on a protected path, so `/learn` and `/refresh` are both required to show you a diff and wait for your approval before writing. This replaces the predecessor harness's formal amendment process.

All of the kit's own git commands are read-only and run with `GIT_OPTIONAL_LOCKS=0`: `git status` doesn't refresh the index, so a statusline refresh never competes for `.git/index.lock` with git that you (or VS Code) are running. VS Code's background git uses the same setting.

A limitation to know: the official docs state plainly that Bash rules match command text and are not a security boundary; the same program invoked a different way can get around them. Auto mode's classifier is the second line of defense. After a week of use, you can run the built-in `/fewer-permission-prompts` to build a safe allowlist from your history.

## 9. The learning and maintenance loop

| How often | Action | Purpose |
|---|---|---|
| End of each task | `/learn` | Record lessons, decide which layer they belong in, escalate to a mechanical check when needed |
| Every Monday | `/retro` | Find one bottleneck from the git log and the ledger, pick one experiment |
| Every Friday | `/sweep` | Delete dead code and unused dependencies |
| New model or major release | `/refresh` | Delete patch rules that are no longer needed |
| A new skill proves useful in one project | Move it to `~/.claude/skills` | Make it available to every project |

`/retro` measures tasks shipped, fix or revert commits (a rework signal), and the most frequent mistake categories in the ledger. The metrics deliberately leave out lines of code: Anthropic itself notes that the 8× merges per engineer are counted in lines and "almost certainly overstate" the real productivity gain.

## 10. Human skills

Anthropic's internal survey from December 2025 recorded several costs: people worried that when output gets too easy, it becomes harder to really learn things; about 80% to 90% of the questions people used to ask colleagues now go to Claude, and senior engineers noticed juniors coming to them less often; more than half said only 0% to 20% of their work could be fully handed to Claude.

The one-person version has four countermeasures:

1. **Learning mode.** The personal CLAUDE.md template defines a trigger: when you say "教我" or "learning mode", Claude doesn't write the answer; it guides you with questions while you write the code, then reviews it.
2. **Keep writing by hand.** If you still need to pass technical interviews, or want to keep the skill, write the core logic of at least one task a week yourself, such as state management, an async flow or a data structure.
3. **Understand before you approve.** Approve plans and tests only when you understand them; where you don't, ask Claude to explain the mechanism instead of accepting it as is.
4. **Keep the final responsibility.** Boris explains why Anthropic still hires engineers: someone has to prompt these Claudes, talk to customers, coordinate with other teams, and decide what comes next. On a one-person team, all of that is your job.

## 11. Lineage: agent-harnesses

Solo AI Team is the successor to [`claude-quality-harness-v3`](https://github.com/yapeepee/agent-harnesses/tree/main/claude-quality-harness-v3) in [agent-harnesses](https://github.com/yapeepee/agent-harnesses). v3 keeps long autonomous sessions on quality with 4 review agents (arch-guardian, decision-keeper, token-auditor, slop-critic), 3 hooks, a constitutional layer (SPIRIT / TASTE / SUNSET), 12 golden fixtures and a verdict ledger. The kit keeps v3's core principle but changes where mechanisms come from: a mechanism is built when the ledger shows a mistake recurring, instead of everything being resident from the start.

| v3 component | What happened to it | Where it lives here | Why |
|---|---|---|---|
| "Strong model at compile time, weak model at run time" | Kept and promoted | Model split: `opusplan`, scout (Haiku), zero-token scripts | Same direction as Anthropic's opusplan and advisor |
| Token enforcement (the token-lint hook, including detection of Angular styling workarounds) | Reshaped | `token-guard.mjs`, optional | Rewritten as a zero-dependency Node script; supports Tailwind v4 arbitrary values; treats custom properties as token definitions; checks `<style>` in HTML as CSS; looks only at changed lines when editing; excludes `assets/` by default; ignore comments survive Prettier moving them |
| Verdict ledger | Reshaped | `.solo/ledger.json` plus ESCALATE | Its purpose changed from "record verdicts" to "decide when to mechanize" |
| Golden fixtures | Kept as an escalation option | One of `/learn`'s mechanical-check options | For features with stable output, a golden or snapshot test is the cheapest check |
| decision-keeper agent | Reshaped | `.solo/decisions.md`, read by `/spec` | A decision log doesn't need a resident agent |
| arch-guardian agent | Reshaped | Mechanical checks triggered by the ledger (for example dependency-cruiser, eslint-plugin-boundaries, NetArchTest) | An agent's judgment costs tokens every time and isn't stable |
| slop-critic agent | Reshaped | The built-in `/code-review` (medium and up includes cleanup suggestions), plus the ledger's `slop` category | The built-in feature gets stronger as Claude Code improves |
| token-auditor agent | Merged | `token-guard.mjs` | The same job is more reliable as a script |
| SPIRIT.md, TASTE.md | Condensed | 8 lines of principles in the personal CLAUDE.md; design taste goes into a UI project's rules or a design skill | A long charter is loaded in every session, and models follow concrete checks better than abstract values |
| Formal amendment process (precedents, amendments) | Dropped | `/learn` shows a diff first and writes only after you approve | The process cost more than it returned; if private files need history, start a personal repo inside `.solo/` |
| Python analyzer tools | Rewritten | Node scripts | Same language as the main stack, and no separate Python setup on Windows |

Existing skills can coexist. A design-reference skill can suggest UI directions during `/proto`. A skill that rewrites CLAUDE.md overlaps with `/learn` and `/refresh`; keep only one of them, so that two sources never rewrite memory at the same time.

## 12. Applying it to different projects

| Project type | What the installer detects | What you add |
|---|---|---|
| Angular 17 and up (tested on 22) | stop: eslint (only if installed), `ngc -p tsconfig.app.json --noEmit` (TypeScript plus template type checking); full: lint, `ng test` (only when `angular.json` has a test target), `ng build`; `rules/angular.md` | The installer warns when ESLint or a test framework is missing; UI projects can turn on token-guard; with Playwright installed, snap can take screenshots |
| Angular below 17 | The legacy rules file; ChromeHeadless added for Karma | Run `--update-baseline` first |
| React (Vite) | The stop stage uses `vitest related` to run only related tests | Add `ui.routes` for your project |
| ASP.NET Core | stop: `dotnet build` only when a `.cs` file changed; full: `dotnet test` | If you use CSharpier, add it to `format` |
| Python | ruff and pytest are added only when detected | Adjust per project |
| Legacy systems without tests (for example Classic ASP) | An empty stack; hooks only track edits | Add a smoke command to `full`; write characterization tests first; spec, handoff and learn work as usual |
| Several frontends and backends in one repo | Each folder becomes its own stack; each file belongs only to the innermost stack | Check `root` in `.solo/config.json` |

## 13. Known limitations and trade-offs

- **The Stop hook adds seconds to tens of seconds to each turn.** In exchange you skip a round of "find the error by hand, then ask Claude to fix it".
- **Angular tests run only in the full stage.** `ng test` has no "run related tests only" mode, so the Stop stage runs only lint and typecheck. The typecheck uses `ngc` rather than `tsc` because only `ngc` checks templates; the cost is speed (see §15). If it's too slow, switch back to `tsc --noEmit -p tsconfig.app.json` in `.solo/config.json`, but then template errors surface only at `ng build`.
- **Baseline matching is heuristic.** It is keyed by the text of the error message, so a new error in the same file with exactly the same message is treated as an old one.
- **Bash permission rules are text matching, not a security boundary** (see §8).
- **Line endings must be LF.** The installer parses templates with `\n`-anchored regexes. For git clones, `.gitattributes` guarantees LF; a file copied some other way and converted to CRLF keeps the rules templates' front matter from being stripped.
- **Paths must be spelled the way git spells them.** The hooks map the file paths Claude Code passes onto the repo root that git reports. If a project is opened through an 8.3 short name, a symlink or a junction, the two spellings can differ and the hooks skip those files silently. The selftest canonicalizes its own temp paths (CI's Windows runner has a temp path like `C:\Users\RUNNER~1\…`); the engine itself does not.
- **Scope of verification.** The selftest's 67 checks passed on Linux when the kit was built and natively on Windows 11 on 2026-09-28; since then, CI runs them on every push on Ubuntu and Windows × Node 18/22. The full workflow was also run on a real TypeScript project (eslint, tsc, vitest, Prettier) and on an Angular 22 project (§15). macOS has never been run.
- **How much usage it saves is not yet quantified.** Measure it yourself with the attribution in `/usage` and the statusline.
- **Claude Code changes fast.** Most features the kit relies on arrived after v2.1.2xx; run `claude update` before installing.
- **Anthropic's published figures** (80% of merged code, 8× merges per person, 200% output growth) are mostly self-reported and counted in lines. This architecture doesn't chase them and doesn't use lines of code as a metric.

## 14. A four-week rollout

1. **Week 1, core only:** Install the kit, use a single session, and use `/spec`, plan mode, the Stop hook, `/check`, `/handoff` and `/learn`. Watch how usage moves on the statusline.
2. **Week 2, add shipping:** Start using `/ship` and the review gate, run two tasks at once in worktrees, and run `/fewer-permission-prompts` once.
3. **Week 3, add the advanced tools:** Start using `/test-first`, `/proto` and `/bugfix`; turn on token-guard for UI projects and set up snap screenshots.
4. **Week 4, start the maintenance loop:** Run your first `/retro`, `/sweep` and `/refresh`, delete what you haven't used, and move skills that have proven useful to the personal layer.

## 15. Field test: a real Angular 22 project

The test ran in a Linux VM on a local clone of a team repo: Angular 22, with the frontend in a subfolder of the repo and `node_modules` linked to the original folder. Nothing in that repo was modified, and nothing was committed or pushed.

| Item | Result |
|---|---|
| Project detection | Correctly detected as an Angular 22 stack with the frontend subfolder as its root; the stop stage is `ngc --noEmit`, the full stage `ng build`; `rules/angular.md` applied |
| Tool warnings | The installer reported that the project has no ESLint, no test framework and no Prettier |
| Stop check on a clean tree | PASS, about 41 seconds |
| Deliberately calling a nonexistent `title()` in `app.component.html` | The Stop hook blocked; the message handed to Claude was about 700 characters: `error TS2339: Property 'title' does not exist on type 'AppComponent'`, with the template line number and the source component |
| After the fix | The Stop hook showed PASS; on the next turn without edits it didn't run at all |
| For comparison: `tsc --noEmit` only | About 23 seconds, but it missed the template error above |
| Whole-project token-guard audit (218 files) | 132 hits before fixing false positives; 102 after fixing the `<style>` and `assets/` false positives; 61 of those were `[style.*]` bindings in a page-builder renderer, which are legitimate in a page builder; 37 left with `styleBinding` turned off, concentrated in three places: global styles, an import tool and a gallery |
| Adding one hard-coded color to a `styles.css` that already had 9 old violations | Only the new line was reported |
| Review gate, SessionStart, statusline | All worked |

The field test also improved the kit itself: Angular switched to `ngc` for template-aware typechecking; `ng test` is no longer added when there is no test target; token-guard lost two kinds of false positives and now looks only at changed lines; and every git read got `GIT_OPTIONAL_LOCKS=0`, because during the test a `git status` inside the VM left an undeletable `index.lock` in that repo's `.git` (since cleaned up).

Reading the timings: 41 and 23 seconds were measured in a VM reading `node_modules` over a mounted disk, and native Windows is usually faster. Go by your own result from `node .solo/engine/check.mjs --stage stop --changed`.

Recommendations for projects like this:

1. Turn on token-guard, but for a page builder turn `styleBinding` off: `"tokenGuard": { "enabled": true, "rules": { "styleBinding": false } }`. Since only changed lines are checked, old violations don't get in the way of daily work.
2. Add ESLint (`ng add angular-eslint`), then rerun the installer with `--reconfigure` so that the Stop stage gains lint.
3. Add a test framework. Without tests, the checks can only prove that the code compiles, and `/test-first` can't be used.

## 16. Five additions after comparing other workflows

In September 2026, the kit was compared against Anthropic's official best practices and the published workflows of a dozen or so practitioners (Mitchell Hashimoto, OpenAI, HumanLayer, Harper Reed, Kent Beck, Simon Willison, Armin Ronacher, Peter Steinberger, Addy Osmani, Superpowers, Beads, Ralph), together with research from METR and DORA and Birgitta Böckeler's assessment of spec-driven development. The kit already had most of these practices; the five below are new.

1. **Test guard** (`kit/engine/test-guard.mjs`). Kent Beck lists three signs that an agent should be stopped, and one of them is cheating: disabling or deleting tests to make them pass. The kit used to only ask Claude not to do this, in the text of the Stop hook's message; now it is a mechanical comparison. Changed test files are compared with HEAD, and fewer tests (including commented-out ones), new skip / only / focus markers, fewer assertions, or a deleted test file all count as "weakened". It understands the Jasmine, Jest, Vitest, xUnit, NUnit, MSTest and pytest styles, and a file moved with `mv` doesn't count as deleted. The Stop hook blocks only once for the same set of findings and asks Claude to restore the tests or explain why in one sentence; after that it lets the turn end, but the PASS message keeps listing those files so you see them before committing. `/ship` runs it again over the whole branch with `--base auto` and writes the result to `ship.md`. It is pure text comparison: no tokens, and no need to run the tests.
2. **Code intelligence plugins.** `typescript-lsp` and `csharp-lsp` from the official marketplace let Claude see the language server's type errors right after each edit, without waiting for the Stop hook. They are installed in the personal layer, so the installer only checks whether they are present and lists what's missing under Notes. The TypeScript language server doesn't check Angular templates, so the Stop hook keeps `ngc`, and the Angular rules file also reminds Claude to read VS Code's Problems panel with `getDiagnostics`.
3. **An interview mode for `/spec`, and self-contained specs.** Following Anthropic's advice, L tasks and vague requests now get an interview with AskUserQuestion, one topic at a time. The spec template gained "files and interfaces", "estimated number of changed files" and "end-to-end check", so that a new session that never saw the conversation can implement from it. For M tasks, you `/clear` after the spec is written and then enter plan mode; the plan is written as phases, each listing the files it changes and the command that verifies it. This is HumanLayer's approach: the highest-leverage place to review is the plan, not the code.
4. **`.solo/inbox.md`.** Steve Yegge's Beads rule: write down any work longer than about two minutes instead of doing it on the spot. The kit used to say only "write it down, don't fix it in passing", without saying where; now Claude writes the problems it notices into this private file, and `/spec` (without arguments), `/sweep`, `/retro` and `/handoff` all read it. Full Beads creates a folder in the repo, which is too heavy for one person.
5. **Separate structure from behavior, and split changes that are too large.** Kent Beck's Tidy First rule is to commit structural changes (renames, moves, extractions) separately from behavioral changes, structure first. DORA 2025 lists "small batches" and "good version-control practices" as two of the seven capabilities that let AI pay off. So the commit plan in `ship.md` is split into a structural group and a behavioral group, and when a change reaches `review.splitLines` (400 lines by default), the review gate prints `SPLIT SUGGESTED` and `/ship` proposes a split before continuing.

Five practices were deliberately left out, each for reasons of cost or risk: the Ralph loop (Huntley himself says he wouldn't use it on an existing codebase); Superpowers' pattern of one subagent per small task with a review of each (Max 5x can't sustain it); full spec-driven tools such as spec-kit and Kiro (Böckeler got 16 acceptance criteria from Kiro for one small bug fix); running 3 to 8 agents at once (review becomes the bottleneck); and letting the agent commit on its own (it conflicts with the shared-repo rules).

## Sources

- [How AI Is Transforming Work at Anthropic](https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic)
- [When AI builds itself (Anthropic Institute)](https://www.anthropic.com/institute/recursive-self-improvement)
- [Measurements for understanding the pace of AI development inside frontier labs](https://www.anthropic.com/institute/measuring-pace-of-ai-development)
- [Code Review for Claude Code](https://claude.com/blog/code-review)
- [Lessons from building Claude Code: How we use skills](https://claude.dev/blog/lessons-from-building-claude-code-how-we-use-skills/)
- [Product management on the AI exponential (Cat Wu)](https://claude.com/blog/product-management-on-the-ai-exponential)
- [Building a C compiler with a team of parallel Claudes](https://www.anthropic.com/engineering/building-c-compiler)
- [How we contain Claude across products](https://www.anthropic.com/engineering/how-we-contain-claude)
- [How we built Claude Code auto mode](https://www.anthropic.com/engineering/claude-code-auto-mode)
- [Creator of Claude Code reveals his workflow (InfoQ)](https://infoq.com/news/2026/01/claude-code-creator-workflow/)
- [How the Claude Code Team Works (Light Cone summary)](https://engineeredintelligence.substack.com/p/how-the-claude-code-team-works)
- [Building Claude Code with Boris Cherny (Pragmatic Engineer)](https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny)
- [Anthropic's Claude Code team has 5 roles (Aakash Gupta, third-party summary)](https://aakashgupta.medium.com/anthropics-claude-code-team-has-5-roles-and-zero-job-titles-bf4860a389fc)
- §16: [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices), [Code intelligence plugins](https://code.claude.com/docs/en/plugins/code-intelligence), [Kent Beck: Augmented Coding](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes), [HumanLayer: Advanced Context Engineering](https://www.humanlayer.dev/blog/advanced-context-engineering), [Beads Best Practices](https://steve-yegge.medium.com/beads-best-practices-2db636b9760c), [DORA 2025](https://dora.dev/dora-report-2025/), [Mitchell Hashimoto: My AI Adoption Journey](https://mitchellh.com/writing/my-ai-adoption-journey), [OpenAI: Harness engineering](https://openai.com/index/harness-engineering/), [Böckeler: Understanding Spec-Driven Development](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html), [Huntley: Ralph](https://ghuntley.com/ralph/), [obra/superpowers](https://github.com/obra/superpowers), [METR 2026 update](https://metr.org/blog/2026-02-24-uplift-update/)
- Claude Code docs: [hooks](https://code.claude.com/docs/en/hooks), [skills](https://code.claude.com/docs/en/skills), [sub-agents](https://code.claude.com/docs/en/sub-agents), [model-config](https://code.claude.com/docs/en/model-config), [costs](https://code.claude.com/docs/en/costs), [memory](https://code.claude.com/docs/en/memory), [permissions](https://code.claude.com/docs/en/permissions), [permission-modes](https://code.claude.com/docs/en/permission-modes), [settings](https://code.claude.com/docs/en/settings), [worktrees](https://code.claude.com/docs/en/worktrees), [statusline](https://code.claude.com/docs/en/statusline), [advisor](https://code.claude.com/docs/en/advisor), [code-review](https://code.claude.com/docs/en/code-review)
