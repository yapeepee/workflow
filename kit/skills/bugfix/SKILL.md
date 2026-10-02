---
name: bugfix
description: Bug runbook — reproduce, find the root cause, add a regression test, fix, verify. Use when the user reports a bug, an error message, a stack trace, a failing test or unexpected behavior (bug、錯誤、壞掉、跑不動、例外).
argument-hint: "<症狀、錯誤訊息或 issue 連結>"
effort: high
metadata:
  kit: solo-ai-team
---

Symptom: $ARGUMENTS

1. Reproduce before fixing. Turn the symptom into a failing test or a deterministic repro command. If you cannot reproduce it, collect evidence (full error, logs, config, recent commits via `git log -p -S "<symbol>"`); use `scout` for wide searches. Do not guess-fix.
2. Localize: write down at most 3 hypotheses and test the cheapest first. If a known-good version exists, run `git bisect` with the repro command.
3. State the root cause in one sentence — the cause, not the symptom. Then grep for the same pattern elsewhere: if it recurs, the concept has no single owner, so decide where the fix goes with the fit check in `CLAUDE.local.md` (when the repo has one) instead of fixing each place on its own.
4. Regression test fails → fix → test passes. Fix the cause: no blanket try/catch, no retries that hide the error.
5. Run `node .solo/engine/check.mjs --stage stop --changed` if `.solo/engine/` exists; otherwise run the project's own tests for the changed area.
6. Report: root cause · fix · regression test · other places with the same pattern (grep) · ledger category and pattern for `/learn`. If a shipped task introduced the bug, name that task: `/learn` logs it with source `escaped`.

If two hypotheses have failed, stop and suggest raising the effort for this investigation (xhigh), or the most capable model through `/model` if that still falls short.
