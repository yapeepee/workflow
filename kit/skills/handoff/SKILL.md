---
name: handoff
description: 交接：把目前進度寫進 progress.md，之後 /clear 也不會失憶（比 /compact 省額度）。context 超過一半或要休息超過一小時時使用
disable-model-invocation: true
effort: low
metadata:
  kit: solo-ai-team
---

Write `.solo/tasks/<slug>/progress.md` (slug from `.solo/ACTIVE`; if there is no active task, create a slug for the current work and write it to `.solo/ACTIVE`). Overwrite the file. At most 40 lines:

```
# Progress — <slug> (<yyyy-mm-dd>)
Status: in progress | blocked | ready to ship
Done:
- <what, with file paths>
Next (in order):
1. <concrete next action>
Open questions for the user:
- ...
Gotchas found:
- <things that cost time and would cost time again>
Verify with: node .solo/engine/check.mjs --stage stop --changed
```

Move follow-ups that are not part of this task to `.solo/inbox.md` (one line each) instead of listing them under Next.

Then tell me in one line: 可以 /clear 了，SessionStart hook 會自動載入任務卡和這份進度。
