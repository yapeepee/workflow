---
name: learn
description: 任務收尾：把這次的錯誤與修正記進 ledger，決定要寫進記憶、改 skill，還是升級成機械檢查
disable-model-invocation: true
effort: medium
allowed-tools:
  - Bash(node .solo/engine/ledger.mjs *)
  - Bash(git ls-files *)
metadata:
  kit: solo-ai-team
---

If `.solo/engine/` does not exist in this repo, stop and tell me to run the solo-ai-team installer for this repo.
If `git ls-files CLAUDE.local.md` prints anything, the team repo now tracks that file: do not edit it; tell me, and put changes in `.solo/rules/` instead.

Look back over this session: my corrections, failed checks, review findings, retries, wrong assumptions, time sinks.

1. List at most 5 lessons worth keeping. Skip one-off typos. Each lesson is one sentence that would have prevented the problem.
2. Log each one: `node .solo/engine/ledger.mjs add <category> "<lesson>" --pattern <slug> --task <slug> --source <review|check|user|self|escaped>`.
   - The pattern names this one mistake in a few words (`unawaited-fireEvent`, `scout-undercount`). Run `node .solo/engine/ledger.mjs list` first and reuse a pattern only when it is the same mistake: escalation counts patterns, because lessons that merely share a category cannot be caught by one check.
   - The category is broad and only shows trends. Reuse one before inventing a new one: type-safety, null-handling, async-error, error-handling, test-gap, weak-test, arch-boundary, api-contract, naming, perf, security, a11y, design-token, env-config, dependency, migration, slop (over-abstraction, dead code, needless comments), scope-creep, spec-misread, tooling.
   - Source `escaped` means the bug was found after its task shipped.
3. Put each lesson in the cheapest place that actually works:
   - nowhere — a one-off that is unlikely to repeat
   - `CLAUDE.local.md` → Gotchas, one line — applies across the repo
   - `.solo/rules/<topic>.md` (imported by `CLAUDE.local.md`) — framework or area rules
   - `.solo/architecture.md` — a rule (A…) or a recipe for one kind of change, with its reference file; an architecture change, so show it to me first
   - a skill's instructions — applies to one workflow (spec, ship, …)
   - a mechanical check — the ledger printed ESCALATE, or a linter/test/check step can catch the pattern.
     Write the concrete change (lint rule config, a test, a `stop`/`full` step in `.solo/config.json`, a `patchGuard.patterns` entry when the mistake shows on one line (format in `/architecture`), or a hook). Once it is in place, run `node .solo/engine/ledger.mjs enforce <pattern> "<how>"` and delete the prose rule it replaces.
     Shared repo (`"shared": true` in `.solo/config.json`): enforcement stays private — a `stop`/`full` step, a `patchGuard.patterns` entry or a small script under `.solo/checks/`. A change to the team's lint config, CI or tests is only a suggestion I can take to the team; do not write it.
   Process lessons (spec-misread, scope-creep) usually belong in a skill or `CLAUDE.local.md`, not in a linter.
4. If an architectural decision was made or changed, append to `.solo/decisions.md`: date · decision · why · rejected alternatives · revisit when. If it changes how a kind of change is built, also propose the edit to `.solo/architecture.md`.
5. Show every proposed file change as a diff and apply only after I approve. Keep `CLAUDE.local.md` under ~150 lines: when you add a line, merge or remove another. Everything under `.solo/` and `CLAUDE.local.md` is private (excluded from git); never add it to a commit.
6. If the task is shipped, delete `.solo/ACTIVE` so new sessions start clean.
7. Finish with three lines: lessons logged · memory changes · enforcement changes.
