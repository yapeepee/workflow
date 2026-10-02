---
name: retro
description: 每週回顧：從 git 紀錄、ledger 與上週回顧找出本週最大的單一瓶頸，只挑一個改善實驗
disable-model-invocation: true
effort: medium
allowed-tools:
  - Bash(git log *)
  - Bash(node .solo/engine/ledger.mjs *)
metadata:
  kit: solo-ai-team
---

If `.solo/engine/` does not exist in this repo, stop and tell me to run the solo-ai-team installer for this repo.

Collect (read-only):
- `git log --since="7 days ago" --date=short --pretty=format:"%h %ad %s"`
- `node .solo/engine/ledger.mjs list --since 7d` (category trends, plus mistakes that repeat)
- the Metrics line of every task shipped this week (`.solo/tasks/*/ship.md`), and the ledger entries with source `escaped` (bugs found after shipping)
- the latest file in `.solo/retro/`, if any — did last week's experiment work?
- `.solo/inbox.md`: how many open items, and how old the oldest one is

Then:
1. Summarize the week in numbers: tasks shipped, time from start to ship per task, review and security findings fixed before shipping, escaped bugs, fix/revert commits (rework signal), repeated mistakes, Known deviations added and removed (the patches kept: a count that only grows means structure is eroding), open inbox items. Compare with earlier weeks when there are any. Do not count lines of code.
2. Ask me at most two questions: where did I wait or feel friction, and what did I avoid starting.
3. Name ONE bottleneck. Choose from: unclear specs · waiting on checks · my review load · context resets · usage limits · flaky tests or environment · too much work in progress · other (say what).
4. Propose ONE experiment for next week that is concrete, cheap and measurable (e.g. "only one parallel session", "add related tests to the stop stage", "split L tasks before planning").
5. Write `.solo/retro/<yyyy>-W<ww>.md`, at most 30 lines: numbers · bottleneck · experiment · result of last week's experiment.
Once a month, suggest I also run `/insights` for a cross-session friction report.
