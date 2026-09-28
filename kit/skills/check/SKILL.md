---
name: check
description: Run the project's verification (lint, types, tests, build) through the compact runner and fix what fails. Use before saying a task is done, after a large change, or when the user asks to verify / test / 驗證 / 檢查 — only in repos that have a .solo/engine/ folder.
argument-hint: "[stop|full]"
effort: medium
allowed-tools:
  - Bash(node .solo/engine/check.mjs *)
  - Bash(node .solo/engine/snap.mjs *)
metadata:
  kit: solo-ai-team
---

If `.solo/engine/` does not exist in this repo, stop and tell me to run the solo-ai-team installer for this repo.

Requested stage: "$ARGUMENTS" (empty means full).

1. Run `node .solo/engine/check.mjs --stage full`, or `node .solo/engine/check.mjs --stage stop --changed` when the stage is "stop".
2. All PASS → reply with one line per step. Done.
3. FAIL → read only the part of the log file the runner points to, fix the root cause, run again. At most 3 rounds, then stop and report what still fails, your diagnosis, and the next step you recommend.
4. UI change and `"ui": { "enabled": true }` in `.solo/config.json` → run `node .solo/engine/snap.mjs`, look at the screenshots, compare them with the acceptance criteria, and mention any console errors.

Never make a check pass by weakening or skipping tests, adding `any` / `!` / `@ts-ignore` / `#pragma warning disable`, or turning off lint rules, unless I explicitly agree.
If a failure is pre-existing and unrelated to the task, say so. I can accept known failures with `node .solo/engine/check.mjs --update-baseline`.
