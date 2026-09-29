---
name: phase
description: 做 plan.md 的下一個 phase：只為這個 phase 寫測試 → 照 architecture.md 的標準做法實作 → 檢查 → 對照參考檔案 → 需要時 code review → commit 點 → 標記完成
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
1. Read the phase in plan.md, the acceptance lines in spec.md that it covers, and the spec's Change log. If a change logged after the plan affects this phase, update the phase in plan.md first and tell me in one line.
2. Tests first when the phase adds behavior: spawn the `test-author` subagent for this phase only (phase number, goal, files, the acceptance lines it covers, and the reference file from its `Pattern`) and check its test names against those lines. Skip this for refactors, configuration and wiring.
3. Implement, following the phase's `Pattern`: open the reference file and mirror its structure, naming, error handling and tests. If the work needs something that recipe and `.solo/architecture.md` do not cover (a new pattern, a new dependency, an exception to a rule), stop and ask me first. A requirement that changes during the phase goes through the triage in `CLAUDE.local.md`. Keep going until the phase's `Verify` command and `node .solo/engine/check.mjs --stage stop --changed` pass.
4. Conformance: compare this phase's diff with the reference file and the architecture rules in scope, and fix any drift before the review.
5. Review this phase on its own: `node .solo/engine/check.mjs --review-gate --base HEAD`.
   - REVIEW REQUIRED → the built-in `/code-review medium only the uncommitted work: git diff HEAD plus untracked files`. Keep that target: without one, the review also covers every commit not yet pushed, so it would re-review the earlier phases. It follows CLAUDE.md, so `product.md` and `architecture.md` are in its context too. It runs in the background: wait for its findings before the commit point. Fix what affects correctness, the acceptance lines or a rule in this phase's files, and list the rest.
   - SPLIT SUGGESTED → the phase is too big: stop and propose how to split it.
   - Security is reviewed once, for the whole task, by `/secure` during `/ship`. If this phase adds or changes an entry point or a permission check, say so: I can run `/secure` now for an early look.
6. Commit point. Shared repo (`ship.mode` is `manual`): add this phase's commit (files from `git status --short`, message `<type>(<scope>): <what>`) under "Commits" in `.solo/tasks/<slug>/ship.md`, then stop and ask me to commit it. Otherwise: commit exactly this phase's files (`git add -- <files>`; I confirm the commit).
7. In plan.md, set the phase heading to `status: done <short sha>` (`status: done, commit pending` in a shared repo). Reply in three lines: what changed · how it was verified · the next phase.
