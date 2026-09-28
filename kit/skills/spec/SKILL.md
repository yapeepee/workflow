---
name: spec
description: 把需求變成任務卡（含機器可檢查的驗收條件）。大功能或需求模糊時先訪談；寫程式之前先跑，建議在 /clear 後的新 session 執行
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
1. Gather only the facts you need. Anything that needs more than ~3 file reads goes to the `scout` subagent; work from its summary.
2. Ask questions, then decide implementation details yourself:
   - Clear request that fits S or M → ask only about product decisions that change the outcome (behavior, scope, UX, data). At most 3 questions, in one message.
   - L, or a vague request → interview me with AskUserQuestion, one topic at a time: behavior, edge cases, UX, data, failure modes, trade-offs. Skip anything obvious or answerable from the code, and dig into what I probably haven't considered. Stop when another answer would not change the spec.
3. Read `.solo/decisions.md` (and the team's own docs such as ADRs, if the repo has them) and note decisions this task must respect or would change.
4. Pick a short kebab-case slug and write `.solo/tasks/<slug>/spec.md`. The spec must stand on its own: a fresh session that never saw this conversation has to be able to implement it.

   ```
   # <title>
   Size: S | M | L   (S: one area, under ~1h · M: a few files or modules · L: cross-cutting or over a day → split)
   Why: <one sentence — who benefits and how>
   Scope:
   - ...
   Out of scope:
   - ...
   Files and interfaces: <files, components, endpoints or types this touches>
   Blast radius: ~<n> files
   Acceptance (each line checkable by a test, a command, or an observable UI state):
   - [ ] ...
   End-to-end check: <one command or UI walkthrough that proves the whole feature works>
   Risk: none | auth · payments · data migration · public API · security · performance
   Decisions: none | <.solo/decisions.md entries this touches>
   ```

5. Write the slug to `.solo/ACTIVE` (the slug only, one line). If the task came from `.solo/inbox.md`, delete that line there.
6. Reply with the card and the next step:
   - S → implement now, `/check` before calling it done.
   - M → run `/clear` first (the new session loads this card automatically), then plan mode (Shift+Tab). After I approve the plan, save it to `.solo/tasks/<slug>/plan.md` as phases: the files each phase touches and the command that verifies it. Then `/test-first` if the behavior is non-trivial.
   - L → propose a split into M tasks. Do not start.
