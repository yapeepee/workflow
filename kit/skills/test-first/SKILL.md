---
name: test-first
description: 由獨立子代理依任務卡先寫「會失敗的驗收測試」（出題的人不寫答案）。M/L 任務在實作前使用
disable-model-invocation: true
context: fork
agent: test-author
background: false
metadata:
  kit: solo-ai-team
---

Write failing acceptance tests for the active task.

1. Read `.solo/ACTIVE` for the slug, then `.solo/tasks/<slug>/spec.md` and `plan.md` if it exists.
2. Follow your agent instructions and reply in the report format they define.

Extra instructions (may be empty): $ARGUMENTS
