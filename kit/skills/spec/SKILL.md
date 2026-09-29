---
name: spec
description: 把需求變成任務卡（有編號、可以機械檢查的驗收條件），對照 product.md 的產品規則和 architecture.md 的標準做法。大功能或需求模糊時先訪談；M/L 任務要你核准任務卡，需要新的架構做法時也會先問你
argument-hint: "<要做的功能或要修的問題>（留空：從 .solo/inbox.md 挑）"
disable-model-invocation: true
model: opus
effort: high
metadata:
  kit: solo-ai-team
---

# Task card

Request: $ARGUMENTS

Turn the request into a task card whose acceptance criteria a machine can check. Do not write code in this step.

0. Empty request → read `.solo/inbox.md`, propose the 3 items most worth doing next (one line each: why now, size), and stop until I pick one.
1. Read the code this request touches yourself. This session holds the big picture, and the plan will be built on what you read. Use the `scout` subagent only for exhaustive searches (every usage, every occurrence); read the lines it points to before you rely on them, and confirm counts or "nothing else uses it" with your own grep.
2. `.solo/product.md` and `.solo/architecture.md` are already loaded: note the product rules (P…) and architecture rules (A…) this task touches. Read `.solo/decisions.md` (and the team's own docs such as ADRs, if the repo has them) for decisions this task must respect or would change. If `.solo/product.md` is still the stub, the task is M or L, and the repo is not shared, suggest running `/product` first; continue without it only if I say so.
3. Ask questions, then decide implementation details yourself:
   - Clear request that fits S or M → ask only about product decisions that change the outcome (behavior, scope, UX, data). At most 3 questions, in one message.
   - L, or a vague request → interview me with AskUserQuestion, one topic at a time: behavior, edge cases, UX, data, failure modes, trade-offs. Skip anything obvious or answerable from the code, and dig into what I probably haven't considered. Stop when another answer would not change the spec.
4. Architecture impact: for each kind of change this task makes, name the recipe in `.solo/architecture.md` and its reference file. If the task needs something no recipe or rule covers — a new kind of change, a new dependency, a new dependency direction, an exception to a rule — list it under "New patterns" and ask me before planning. Record what I approve in `.solo/decisions.md`, and in `.solo/architecture.md` when it becomes the way to do that kind of change. If `.solo/architecture.md` is still the stub, read the closest existing feature end to end, propose it as the reference for this kind of change, and add that recipe after I approve.
5. Pick a short kebab-case slug and write `.solo/tasks/<slug>/spec.md`. The spec must stand on its own: a fresh session that never saw this conversation has to be able to implement it.

   ```
   # <title>
   Size: S | M | L   (S: one area, under ~1h · M: a few files or modules · L: cross-cutting or over a day → split)
   Started: <yyyy-mm-dd hh:mm — check the clock; /ship measures from here>
   Why: <one sentence — who benefits and how>
   Scope:
   - ...
   Out of scope:
   - ...
   Product rules: none | P<n> …
   Pattern: <recipe> — follow `<reference file>` (one line per kind of change)
   New patterns: none | <what, and the decision that approved it>
   Files and interfaces: <files, components, endpoints or types this touches>
   Blast radius: ~<n> files
   Acceptance (each line checkable by a test, a command, or an observable UI state):
   - [ ] AC1 ...
   End-to-end check: <one command or UI walkthrough that proves the whole feature works>
   Risk: none | auth · payments · data migration · public API · security · performance
   Decisions: none | <.solo/decisions.md entries this touches>

   ## Change log
   ```

   Changes after approval go under "Change log", one line each: `<yyyy-mm-dd> · <change> · <AC ids affected>`.
6. M or L: ask me to approve the card with AskUserQuestion (approve · change something), and revise it until I approve. S: show the card and continue unless a question is still open.
7. Write the slug to `.solo/ACTIVE` (the slug only, one line). If the task came from `.solo/inbox.md`, delete that line there.
8. Reply with the card and the next step:
   - S → implement now; `/check` before calling it done, then `/ship`.
   - M → run `/clear` first (the new session loads this card automatically), then plan mode (Shift+Tab). The plan is a short list of phases, at most ~150 lines in total:
     ```
     ## Phase <n> — <goal> · status: todo
     Files: <files it changes>
     Covers: <AC ids>
     Pattern: <recipe> — follow `<reference file>`
     Verify: <the command that proves this phase works>
     ```
     Each phase must be small enough to review on its own (well under `review.splitLines` changed lines in `.solo/config.json`). After I approve, save the plan to `.solo/tasks/<slug>/plan.md`, run `/phase` once per phase, and `/ship` after the last one.
   - L → propose a split into M tasks. Do not start.
