{{IMPORTS}}# {{PROJECT}} — personal instructions

<!-- Private: excluded from git through .git/info/exclude, so teammates never see it and it can't be committed.
     Loaded every session together with the team's CLAUDE.md (if the repo has one). Keep it under ~150 lines.
     /learn proposes additions, /refresh prunes. -->

## What this is
TODO: one or two sentences — what the product does and for whom.

## Commands
{{COMMANDS}}
- Fast checks on changed files: `node .solo/engine/check.mjs --stage stop --changed`
- Everything (lint, types, tests, build): `node .solo/engine/check.mjs --stage full`

## Map
{{MAP}}
- `.solo/product.md` — who it is for, core flows, product rules (P…); `/product` maintains it. Imported above.
- `.solo/architecture.md` — rules (A…), the recipe and reference file for each kind of change, known deviations; `/architecture` maintains it. Imported above.
- `.solo/decisions.md` — architectural decisions; read before changing architecture.
- `.solo/inbox.md` — noticed-but-not-done work; add to it, don't act on it mid-task.
- `.solo/security.md` — the threat model `/secure` reviews against (created on its first run).

## Workflow
- Non-trivial work starts with `/spec`. M tasks go through plan mode before any code; the approved plan is saved to `.solo/tasks/<slug>/plan.md` as short phases, and each phase runs with `/phase` (its own tests, checks, review and commit).
- Read the code you need yourself: this session holds the big picture. Delegate only exhaustive searches (every usage, every occurrence) to the `scout` subagent; it returns locations and the searches it ran, not conclusions. Read the key lines yourself before deciding, and confirm counts or "nothing else uses X" with your own grep. For a side task that needs what this conversation already knows, use a fork (the `fork` subagent type, which inherits this conversation) instead of a fresh subagent; if forking is not available, ask me to run `/subtask <task>`.
- Follow `.solo/architecture.md`: use the recipe and reference file for the kind of change you are making. A new pattern, a new dependency or dependency direction, or an exception to a rule needs my approval first; record it in `.solo/decisions.md`, and in `.solo/architecture.md` when it becomes the way to do that kind of change.
- Requirement changes during the work: classify before acting.
  1. Inside the current phase and no acceptance line changes → do it, and add one line to the spec's Change log marked `in scope`.
  2. Changes the scope or an acceptance line → add a line to the spec's Change log, update those acceptance lines and their tests first, and re-plan only the phases not started. Finish and commit the current phase first, unless the change makes it moot.
  3. A new feature → one line in `.solo/inbox.md`; do not start it.
  Never change an acceptance line on your own: propose it and wait. A change to a product rule also updates `.solo/product.md` and `.solo/decisions.md`.
- Done means: every acceptance line is met and the checks pass. Never call unverified work done; say what you could not verify.
- Keep diffs focused on the task. When you notice an unrelated problem, or follow-up work longer than ~2 minutes, append one line to `.solo/inbox.md` instead of doing it.
- Keep structural changes (rename, move, extract, formatting) apart from behavior changes; when both are needed, do the structural one first so it can be committed separately.
- Ask before adding a dependency, changing a public API or the database schema, or removing user-facing behavior.
- Never commit or push unless I explicitly ask (running `/phase`, `/ship commit`, `/ship pr` or `/ship direct` counts as asking). Never stage `.solo/`, `CLAUDE.local.md` or `.claude/settings.local.json`.
- This is a shared repo: follow the team's existing conventions and formatting, and never add kit-specific comments or markers (such as token-guard-ignore) to the code.

## Conventions
TODO: only the non-obvious ones (naming, error handling, folder rules). Anything a linter can enforce belongs in the linter.

## Gotchas
<!-- /learn adds one-line lessons here. Merge or delete when this list passes ~15 lines. -->

## Compact instructions
When compacting, keep: active task slug, acceptance criteria with their ids, the spec's Change log, the current phase and its Pattern, files changed, failing checks and their causes, decisions made. Drop exploration output.
