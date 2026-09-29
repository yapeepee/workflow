---
name: phase
description: 做 plan.md 的下一個 phase：只為這個 phase 寫測試 → 實作 → 檢查 → 需要時 code review → commit 點 → 標記完成
argument-hint: "[phase 編號]（留空：第一個還沒完成的 phase）"
disable-model-invocation: true
effort: medium
allowed-tools:
  - Bash(node .solo/engine/check.mjs *)
metadata:
  kit: solo-ai-team
---

If `.solo/engine/` does not exist in this repo, stop and tell me to run the solo-ai-team installer for this repo.

Phase: "$ARGUMENTS" (empty → the first phase in `.solo/tasks/<slug>/plan.md` whose heading does not say `status: done`; the slug is in `.solo/ACTIVE`). Work on this phase only; the next phase starts with the next `/phase`, so its tests and code wait.

0. If `git status` still shows the previous phase's files uncommitted, ask me to commit them first; otherwise this phase's review would include them.
1. Read the phase in plan.md and the acceptance lines in spec.md that it covers.
2. Tests first when the phase adds behavior: spawn the `test-author` subagent for this phase only (goal, files, the acceptance lines it covers) and check its test names against those lines. Skip this for refactors, configuration and wiring.
3. Implement until the phase's `Verify` command and `node .solo/engine/check.mjs --stage stop --changed` pass.
4. Review this phase on its own: `node .solo/engine/check.mjs --review-gate --base HEAD`.
   - REVIEW REQUIRED → the built-in `/code-review medium`; fix what affects correctness or the acceptance lines, and list the rest.
   - SPLIT SUGGESTED → the phase is too big: stop and propose how to split it.
   - Security is reviewed once, for the whole task, by `/secure` during `/ship`. If this phase adds or changes an entry point or a permission check, say so: I can run `/secure` now for an early look.
5. Commit point. Shared repo (`ship.mode` is `manual`): add this phase's commit (files from `git status --short`, message `<type>(<scope>): <what>`) under "Commits" in `.solo/tasks/<slug>/ship.md`, then stop and ask me to commit it. Otherwise: commit exactly this phase's files (`git add -- <files>`; I confirm the commit).
6. In plan.md, set the phase heading to `status: done <short sha>` (`status: done, commit pending` in a shared repo). Reply in three lines: what changed · how it was verified · the next phase.
