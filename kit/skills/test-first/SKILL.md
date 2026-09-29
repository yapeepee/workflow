---
name: test-first
description: 由獨立子代理為一個 phase 先寫「會失敗的驗收測試」（出題的人不寫答案）。/phase 會自動做這一步；單獨使用時留空＝目前的 phase
argument-hint: "[phase 編號]"
disable-model-invocation: true
context: fork
agent: test-author
background: false
metadata:
  kit: solo-ai-team
---

Write failing acceptance tests for one phase of the active task.

1. Read `.solo/ACTIVE` for the slug, then `.solo/tasks/<slug>/spec.md` and `plan.md` if it exists.
2. Phase: "$ARGUMENTS" (empty → the first phase in plan.md whose heading does not say `status: done`; no plan → the whole spec).
3. Follow your agent instructions and reply in the report format they define.
