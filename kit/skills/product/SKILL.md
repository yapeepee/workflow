---
name: product
description: 建立或更新 .solo/product.md：用訪談整理產品層的背景（誰在用、核心流程、產品規則與限制、不做的事、待決問題），之後每個任務都拿它當判斷依據
argument-hint: "[要更新的部分，例如：角色權限]（留空：第一次建立，或整份一起檢查）"
disable-model-invocation: true
model: opus
effort: high
allowed-tools:
  - Bash(git ls-files)
  - Bash(git ls-files *)
metadata:
  kit: solo-ai-team
---

If `.solo/engine/` does not exist in this repo, stop and tell me to run the solo-ai-team installer for this repo.

Focus: "$ARGUMENTS" (empty → build `.solo/product.md` if it is still the stub, otherwise review the whole file with me).

`.solo/product.md` is imported by `CLAUDE.local.md`, so every session and every custom subagent loads it, and the built-in `/code-review` sees it too. It holds what the code cannot tell you: who the product is for and the rules it must keep. `/spec` checks every request against it.

1. Read `.solo/product.md`, `.solo/decisions.md`, the README and the main entry points (screens and routes, endpoints, the data model) yourself, so you do not ask me anything the code already answers.
2. Interview me with AskUserQuestion, one topic per round, at most 4 questions per round and 4 rounds: users and roles · core flows from start to finish · rules and constraints (permissions, privacy, limits, costs, legal) · what the product deliberately does not do · open questions. When an answer conflicts with what the code does, say so.
3. Draft the file in my language, at most ~120 lines:

   ```
   # Product — <name>
   <one or two sentences: what it is, for whom, the outcome it promises>

   ## Users and roles
   - <role>: <what they need> · may: <…> · may not: <…>
   ## Core flows
   1. <flow>: <start → steps → outcome>
   ## Rules
   - P1 <rule the product must keep> (why: <reason>)
   ## Not doing
   - <deliberate non-goal> (why)
   ## Open questions
   - <question> · affects: <flows or rules>
   ```

   Rules get IDs (P1, P2 …) so specs, reviews and decisions can point to them. Write rules and facts, not a feature list: features live in task specs.
4. Show me the draft (or the diff when updating) and write it only after I approve.
5. When a rule changed, append it to `.solo/decisions.md` (date · decision · why · rejected alternatives · revisit when) and list the open specs in `.solo/tasks/*/spec.md` that the change affects.

Shared repo (`"shared": true` in `.solo/config.json`): the product belongs to the team. Build this file only when I ask, from the team's documents and my answers, and mark anything the team has not decided as an open question.
