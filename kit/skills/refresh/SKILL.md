---
name: refresh
description: 新模型或 Claude Code 大改版之後：刪掉已經不需要的規則與補丁，讓整套設定維持精簡
disable-model-invocation: true
model: opus
effort: high
allowed-tools:
  - Bash(git ls-files *)
metadata:
  kit: solo-ai-team
---

A new model can make old instructions useless or even harmful. Prune.

If `.solo/engine/` does not exist in this repo, stop and tell me to run the solo-ai-team installer for this repo.
If `git ls-files CLAUDE.local.md` prints anything, the team repo now tracks that file: do not edit it; tell me, and put changes in `.solo/rules/` instead.

1. Inventory with line counts: `CLAUDE.local.md`, `.solo/rules/*.md`, `.solo/product.md`, `.solo/architecture.md`, `.solo/config.json`, and `node .solo/engine/ledger.mjs list`. Also read `~/.claude/CLAUDE.md`, the kit skills in `~/.claude/skills/` and agents in `~/.claude/agents/`, but do not edit files outside this repo; suggest changes instead. If the repo has its own team `CLAUDE.md`, read it too and never edit it.
2. Classify every instruction:
   - A. Project fact (commands, structure, domain) → keep; fix it if stale.
   - B. Convention or taste → keep if still true; merge duplicates.
   - C. Workaround for a model weakness ("always remember to…", "never forget…", repeated emphasis) → candidate for deletion.
   - D. Already enforced by a check, lint rule or hook (see ledger `enforced`) → delete the prose.
3. Propose deletions and merges as a diff. Targets: `CLAUDE.local.md` ≤ 150 lines, each rules file ≤ 40 lines, `product.md` ≤ 120 lines, `architecture.md` ≤ 200 lines, each skill ≤ 80 lines. In `architecture.md`, a rule that a check enforces stays as one line (its id and the check), because specs and reviews point to it; delete the explanation around it. Recipes whose reference file no longer exists or no longer shows the best example get a new reference.
4. Pick one past failure from the ledger or `.solo/retro/` and suggest re-running it with the new model, to test whether a C-type workaround is still needed.
5. Apply only after I approve. Remind me to review auto memory with `/memory`.
