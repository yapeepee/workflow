---
name: sweep
description: 每週清理：找死碼、沒用的依賴、過期的 TODO 與 feature flag，小步刪除並逐步驗證
disable-model-invocation: true
effort: medium
metadata:
  kit: solo-ai-team
---

If `.solo/engine/` does not exist in this repo, stop and tell me to run the solo-ai-team installer for this repo.

Deleting code is first-class work. Remove what no longer earns its keep, in small verified steps.

1. Start from a clean tree. In a shared repo (`"shared": true` in `.solo/config.json`) stay on my current branch and touch no git state; otherwise use a new branch `sweep/<yyyy-mm-dd>` (or ask me to open a worktree with `claude -w sweep`).
2. Start with the cleanup items already waiting in `.solo/inbox.md`. Then collect more candidates with tools, not by reading everything. Delegate exhaustive usage searches ("is X used anywhere") to `scout`, and read each candidate yourself before deleting it.
   - JS/TS: `npx --no-install knip` if knip is installed (unused files, exports, dependencies). If not, suggest adding it and continue with grep.
   - .NET: compiler warnings for unused code, unused package references.
   - Everywhere: `git grep -nE "TODO|FIXME|HACK|XXX"`, feature flags that are always on or off, commented-out blocks, duplicate helpers.
3. Show at most 20 candidates in three groups: safe to delete · needs my confirmation · keep (with reason).
4. Delete group by group. After each group run `node .solo/engine/check.mjs --stage full`. When tests go away together with the dead code they covered, the test guard will flag them; name the code they covered in one sentence.
   - Shared repo: do not commit. Record each verified group in `.solo/sweep-<yyyy-mm-dd>.md` with its files and a suggested commit message `chore(sweep): …`; I commit the groups myself.
   - Otherwise: commit each verified group as `chore(sweep): …`.
5. Report files, lines and dependencies removed. If the same kind of junk keeps showing up, run `/learn` on it.
