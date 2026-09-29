---
name: secure
description: Careful, project-specific security review of the whole branch — one reviewer in a fresh context traces attacker paths with the project's threat model (.solo/security.md); every finding needs a concrete attack, and the report lists what was verified. Run by /ship, or when the user asks for a security review (資安、安全檢查、security review). Only in repos that have a .solo/engine/ folder.
argument-hint: "[extra focus, e.g. 'the new upload flow']"
effort: high
allowed-tools:
  - Bash(node .solo/engine/check.mjs *)
  - Bash(node .solo/engine/ledger.mjs *)
metadata:
  kit: solo-ai-team
---

If `.solo/engine/` does not exist in this repo, stop and tell me to run the solo-ai-team installer for this repo.

Extra focus (may be empty): $ARGUMENTS

The review always covers the whole branch — everything since the branch point (the base that `node .solo/engine/check.mjs --review-gate` prints) plus uncommitted work — because the serious issues sit where parts meet, not inside one file.

0. Threat model. If `.solo/security.md` is missing, build it from the code first (take roles and product rules from `.solo/product.md` when it is written), show it to me, and write it only after I approve. At most ~120 lines:
   ```
   # Threat model — <project>
   Assets: <what must not leak or be changed: accounts, tokens, personal data, files, money>
   Roles: <anonymous, each user role, admins, other services>
   Trust boundaries: <client ↔ API, API ↔ storage, webhooks, third-party sign-in, …>
   Entry points: <screens and routes, endpoints, uploads, webhooks, jobs — and where each kind is defined>
   Rules that must hold:
   - <rule> · enforced in `<path>` · mechanically checked: <check> | no
   Pitfalls:
   - <yyyy-mm-dd> · <mistake made here before> · `<path>`
   ```
1. Spawn one `security-reviewer` subagent. Give it the threat model, the git command for the whole branch, the list of changed files, and the extra focus if any.
2. Verify every finding yourself before accepting it: read the lines and try to disprove the attack. Drop it if the path does not hold, with one line on why.
3. For a high-impact item under "Could not verify", run one more `security-reviewer` on that single question. Do not split the review by default: splitting loses the attacks that only exist where parts meet.
4. Fix confirmed findings (ask me first when the fix changes what users see), then have a reviewer re-check exactly those paths.
5. Record:
   - Append to `.solo/tasks/<slug>/ship.md`: `Security: <n> confirmed (<n> fixed) · <n> dropped · <n> open · <n> rules verified`.
   - Update `.solo/security.md` with the entry points, rules and pitfalls it was missing (show me the diff first).
   - Log each confirmed finding: `node .solo/engine/ledger.mjs add security "<lesson>" --pattern <kind-of-mistake> --source review`. When the ledger says ESCALATE for a rule, propose a mechanical check for it, so the next review can spend its attention on the big picture.
6. Reply: what was reviewed · findings (confirmed / dropped / open) · what was fixed · rules verified.
