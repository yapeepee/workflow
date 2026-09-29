---
name: architecture
description: 架構健檢：主 session 自己讀完整個專案，寫出 .solo/architecture.md（規則、每種改動的標準做法與參考檔案、已知例外），列出問題和可以改成機械檢查的規則。加上 check 只比對目前的改動有沒有偏離
argument-hint: "[check [base]]（留空：完整健檢；check：比對改動與規則）"
disable-model-invocation: true
model: opus
effort: high
allowed-tools:
  - Bash(git ls-files)
  - Bash(git ls-files *)
  - Bash(git diff)
  - Bash(git diff *)
  - Bash(git log *)
  - Bash(node .solo/engine/check.mjs *)
metadata:
  kit: solo-ai-team
---

If `.solo/engine/` does not exist in this repo, stop and tell me to run the solo-ai-team installer for this repo.

Mode: "$ARGUMENTS" (empty → full review; `check [base]` → drift check only).

`.solo/architecture.md` is imported by `CLAUDE.local.md`, so every session and every custom subagent loads it, and the built-in `/code-review` sees it too. Keep it to rules and pointers, not a tour: studies of repository context files found that overviews do not help coding agents, while concrete instructions are followed. Leave out anything the code already makes obvious.

## Full review

1. Read the code yourself, in this session. Do not hand the reading to subagents: the point is one view of the whole, and summaries lose the places where parts meet. List the tracked files (`git ls-files`), skip generated, vendored and lock files, then read the entry points and composition roots (startup, dependency injection, routing), each module's public surface, the data layer, the cross-cutting code (auth, errors, validation, logging, config), the main files of every feature, and the tests of one feature per stack. If the code clearly does not fit in one context, say so and review one stack per session.
2. Draft `.solo/architecture.md`, at most ~200 lines:

   ```
   # Architecture — <project>
   ## Shape
   <modules and the allowed dependency direction, at most 10 lines>
   ## Rules
   - A1 MUST | MUST NOT <rule> · scope: <paths> · enforced by: <test | lint | review>
   ## Recipes
   ### <kind of change: API endpoint · screen · migration · background job …>
   Follow: `<reference file(s)>`
   Steps: <files to add or touch, in order, the test included>
   ## Known deviations
   - `<path>` breaks A<n>: do not copy it; fix it only when a task is about it
   ## Open questions
   - <what is inconsistent today and needs a decision>
   ```

   Pick the best current example as the reference, not the oldest. Every rule needs evidence: the code where it already holds, or an entry in `.solo/decisions.md`. If the file already has content, start from it: keep the rules and recipes I approved unless the code now contradicts them, and show your changes as a diff.
3. Write the assessment to `.solo/architecture-review-<yyyy-mm-dd>.md`, at most 60 lines: what is solid · what is risky (features built in inconsistent ways, missing boundaries, authorization gaps, code that is hard to test) · the 5 most valuable improvements, each with a size (S/M/L) and the rule it would establish. Add each improvement as one line to `.solo/inbox.md`.
4. Mechanical checks: for each rule that a tool can check, propose the check concretely. .NET: an architecture test (NetArchTest or ArchUnitNET) in the existing test project. TypeScript: `eslint-plugin-boundaries` or `dependency-cruiser` rules. Ask before adding any dependency. Shared repo (`"shared": true` in `.solo/config.json`): do not change the team's tests or lint config; offer a private check under `.solo/checks/`, run by a `full` step, or a suggestion to take to the team.
5. Show me the rules and recipes. Write the file only after I approve: this is an architecture change. Record each rule that settles an open choice in `.solo/decisions.md`.
6. If `CLAUDE.local.md` still has TODO lines (What this is, Map, Conventions) and `git ls-files CLAUDE.local.md` prints nothing, propose them as a diff and apply it after I approve. Keep them short: rules belong in `.solo/architecture.md`, not there.
7. End with: "This review filled the context. Run /clear before the next task."

## check

1. Base: the argument after `check`, or else the branch point that `node .solo/engine/check.mjs --review-gate` prints when run without `--base` (after `vs`). Read `git diff <base>`, which includes uncommitted changes, and the untracked files (`git ls-files --others --exclude-standard`).
2. For each changed area, ask: does it follow the recipe for its kind of change and every rule in scope? Is it a new kind of change with no recipe? Does it copy a known deviation?
3. Report: violations (`path:line` · rule · fix) · new patterns that need a decision · recipes or rules that are now out of date. Propose the edits to `.solo/architecture.md` and write them only after I approve. Fix violations in the code only when I agree they belong to this task.
