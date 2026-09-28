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
- `.solo/decisions.md` — architectural decisions; read before changing architecture.
- `.solo/inbox.md` — noticed-but-not-done work; add to it, don't act on it mid-task.

## Workflow
- Non-trivial work starts with `/spec`. M/L tasks go through plan mode before any code; after the plan is approved, save it to `.solo/tasks/<slug>/plan.md`.
- For codebase questions that need more than ~3 file reads, use the `scout` subagent instead of reading files here.
- Done means: every acceptance line is met and the checks pass. Never call unverified work done; say what you could not verify.
- Keep diffs focused on the task. When you notice an unrelated problem, or follow-up work longer than ~2 minutes, append one line to `.solo/inbox.md` instead of doing it.
- Keep structural changes (rename, move, extract, formatting) apart from behavior changes; when both are needed, do the structural one first so it can be committed separately.
- Ask before adding a dependency, changing a public API or the database schema, or removing user-facing behavior.
- Never commit or push unless I explicitly ask (running `/ship commit`, `/ship pr` or `/ship direct` counts as asking). Never stage `.solo/`, `CLAUDE.local.md` or `.claude/settings.local.json`.
- This is a shared repo: follow the team's existing conventions and formatting, and never add kit-specific comments or markers (such as token-guard-ignore) to the code.

## Conventions
TODO: only the non-obvious ones (naming, error handling, folder rules). Anything a linter can enforce belongs in the linter.

## Gotchas
<!-- /learn adds one-line lessons here. Merge or delete when this list passes ~15 lines. -->

## Compact instructions
When compacting, keep: active task slug, acceptance criteria, files changed, failing checks and their causes, decisions made. Drop exploration output.
