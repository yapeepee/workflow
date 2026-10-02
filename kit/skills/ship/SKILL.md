---
name: ship
description: 任務收尾（每個任務一次）：完整檢查 → test guard → 還沒 review 的改動 → 針對專案的安全審查（/secure）→ 比對架構決策與 architecture.md → 驗收對照 → 交付。共用 repo 預設只準備 commit 計畫與 PR 說明，不動 git
argument-hint: "[manual|commit|pr|direct]"
disable-model-invocation: true
effort: medium
allowed-tools:
  - Bash(node .solo/engine/check.mjs *)
  - Bash(node .solo/engine/test-guard.mjs *)
  - Bash(node .solo/engine/patch-guard.mjs *)
  - Bash(node .solo/engine/snap.mjs *)
metadata:
  kit: solo-ai-team
---

If `.solo/engine/` does not exist in this repo, stop and tell me to run the solo-ai-team installer for this repo.

Ship the active task. Mode: "$ARGUMENTS" (empty → `ship.mode` in `.solo/config.json`, or `manual` if that is not set). Phases done with `/phase` are already tested, reviewed and committed; this step covers what is left and the task as a whole.

1. Full check: `node .solo/engine/check.mjs --stage full`. If anything fails, fix it (at most 3 rounds) or stop and report. Never ship red.
2. Test guard over the whole branch: `node .solo/engine/test-guard.mjs --base auto`. For every WEAKENED line, either restore the test or write one sentence on why it had to change (for example, the feature it covered was removed).
3. Work no phase has reviewed (anything uncommitted, such as an S task): `node .solo/engine/check.mjs --review-gate --base HEAD`.
   - REVIEW REQUIRED → the built-in `/code-review medium only the uncommitted work: git diff HEAD plus untracked files`. Keep that target: without one, the review also covers every commit not yet pushed, and the phases already reviewed theirs. It runs in the background: wait for its findings before going on. Fix every finding that affects correctness or the spec's acceptance lines; list the rest as optional. Then repeat step 1.
   - SPLIT SUGGESTED → propose how to cut the change into smaller commits that each pass the checks on their own, and ask me before continuing.
4. Security: run `/secure`. It reviews the whole branch against `.solo/security.md`; do not skip it because the diff looks harmless.
5. Decisions and architecture: compare the whole branch — `git diff <base>`, where `<base>` is the branch point that `node .solo/engine/check.mjs --review-gate` prints when run without `--base` — with `.solo/decisions.md` (and the team's ADRs, if any) and with `.solo/architecture.md`. Each changed area should follow the recipe for its kind of change and every rule in scope. For each contradiction, fix it or propose the decision or rule change that explains it; a rule change is an architecture change, so ask me first. If this task introduced a kind of change that will recur and has no recipe yet, propose one with this task's files as the reference.
   Then the patches: `node .solo/engine/patch-guard.mjs --base auto` lists what the branch adds from the kit's own list (suppressions, empty catches, workaround comments) and from the architecture's patterns; add the special cases and flag parameters you know of. Each one is removed or has its line under Known deviations. A concept that now has 3 or more is a structural task: add it to `.solo/inbox.md`.
6. Evidence: UI change with `ui.enabled` → `node .solo/engine/snap.mjs`; keep the screenshot paths. If the project has end-to-end or device tests that run by hand, ask me to run them now and record the result.
7. Write `.solo/tasks/<slug>/ship.md` (private, excluded from git):
   - Commits: the ones the phases made, then a plan for anything still uncommitted, in order — structural first (renames, moves, extractions, formatting; no behavior change), then behavioral. Each commit: its files (from `git status --short`) and a message `<type>(<scope>): <what>` plus one body line with the "why" from the spec. Never list `.env*` or the kit's own files (`.solo/`, `CLAUDE.local.md`, `.claude/settings.local.json`, the `proto.dir` folder).
   - Acceptance: each AC id → the test, command or manual check that proves it. Unproven lines are listed as such, never as done.
   - Test changes: the test guard result from step 2 with your explanations.
   - Patches: the patch guard result from step 5 and the Known deviations lines this task added or removed.
   - PR description: Why (from the spec) · What changed (including the spec's Change log) · How verified (check lines, screenshots, device tests) · Test changes · Review and security findings fixed · Risk and rollback.
   - Metrics, one line: `Started <the spec's Started> · shipped <now> · <n> phases · <n> review findings fixed · <n> security findings confirmed · <n> deviations added · <n> removed`.
8. Deliver by mode:
   - `manual` (the default in shared repos): run no git command that writes — no add, commit, branch, push or PR. Print the commit plan, point to ship.md, and stop. I commit and push myself.
   - `commit`: commit whatever is still uncommitted, following the plan and staging exactly each commit's files (`git add -- <files>`). Do not push.
   - `pr`: as `commit`, then `git push -u origin HEAD` and `gh pr create` with the PR description (no `gh` → print the compare URL).
   - `direct`: as `commit`, then push the current branch.
9. End with one summary line and: "Next: /learn".
