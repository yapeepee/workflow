---
name: ship
description: 出貨閘門：完整檢查 → 改動大或碰到高風險路徑才跑 code review → 交付。共用 repo 預設只準備好 commit 計畫與 PR 說明，不動 git
argument-hint: "[manual|commit|pr|direct]"
disable-model-invocation: true
effort: medium
allowed-tools:
  - Bash(node .solo/engine/check.mjs *)
  - Bash(node .solo/engine/test-guard.mjs *)
  - Bash(node .solo/engine/snap.mjs *)
metadata:
  kit: solo-ai-team
---

If `.solo/engine/` does not exist in this repo, stop and tell me to run the solo-ai-team installer for this repo.

Ship the active task. Mode: "$ARGUMENTS" (empty → `ship.mode` in `.solo/config.json`, or `manual` if that is not set).

1. Full check: `node .solo/engine/check.mjs --stage full`. If anything fails, fix it (at most 3 rounds) or stop and report. Never ship red.
2. Test guard: `node .solo/engine/test-guard.mjs --base auto`. For every WEAKENED line, either restore the test or write one sentence on why it had to change (for example, the feature it covered was removed).
3. Review gate: `node .solo/engine/check.mjs --review-gate`.
   - REVIEW REQUIRED → run the built-in code review at medium effort on the current diff (`/code-review medium`) and wait for the findings. If the risky paths include auth, security, payments or migrations, also run `/security-review` (if you cannot start it yourself, stop and ask me to run it). Fix every finding that affects correctness or the spec's acceptance lines; list the rest as optional. Then repeat step 1. Remember the finding categories for `/learn`.
   - REVIEW OPTIONAL → skip the review. Deterministic checks already passed.
   - SPLIT SUGGESTED → propose how to cut the change into smaller PRs that each pass the checks on their own, and ask me before continuing.
4. UI change with `ui.enabled` → `node .solo/engine/snap.mjs`; keep the screenshot paths.
5. Write the delivery to `.solo/tasks/<slug>/ship.md` (private, excluded from git):
   - Commit plan, in order. First a structural commit (renames, moves, extractions, formatting — no behavior change), then the behavioral commit. Skip a group that is empty; if one file mixes both, put it under behavior and say so. Each commit: its files (from `git status --short`) and a message `<type>(<scope>): <what>` plus one body line with the "why" from the spec. Never list `.env*` or the kit's own files (`.solo/`, `CLAUDE.local.md`, `.claude/settings.local.json`, the `proto.dir` folder).
   - Test changes: the test guard result from step 2 with your explanations.
   - PR description: Why (from spec) · What changed · How verified (check result lines, screenshot paths) · Test changes · Review findings fixed · Risk and rollback.
6. Deliver by mode:
   - `manual` (the default in shared repos): run no git command that writes — no add, commit, branch, push or PR. Print the commit plan, point to ship.md, and stop. I commit and push myself.
   - `commit`: create the commits in the plan, staging exactly their files (`git add -- <files>`). Do not push.
   - `pr`: as `commit`, then `git push -u origin HEAD` and `gh pr create` with the PR description (no `gh` → print the compare URL).
   - `direct`: as `commit`, then push the current branch.
7. End with one summary line and: "Next: /learn".
