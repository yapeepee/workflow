---
name: proto
description: 原型：用 2–3 個丟棄式原型比較不同方向，挑一個再走 /spec 正式流程（對應 Anthropic 的「原型多、上線少」）
argument-hint: "<想法> [2|3] [--branch]"
disable-model-invocation: true
effort: low
metadata:
  kit: solo-ai-team
---

Idea: $ARGUMENTS

1. Propose N distinct directions (default 2, max 3). They differ in approach — layout, interaction model, data flow, architecture — not in colors or copy. One-line hypothesis each: "If we do X, the user gets Y."
2. Choose the mode:
   - Default, same tree: each prototype lives only in `<proto.dir>/<slug>/v<i>/` (`proto.dir` from `.solo/config.json`; the installer excludes that folder from git, so it never shows up in `git status`). When they are done, you wire them up so I can view them side by side (for example temporary routes). That wiring is the only change to tracked files: keep it minimal, mark each spot with a plain `// proto wiring` comment, and list it.
   - `--branch`, for architectural spikes that must touch shared code: give each prototyper worktree isolation. Those branches stay local; never push them.
3. Spawn one `prototyper` subagent per direction, in parallel. Give each: the idea, its direction and hypothesis, its folder or branch, and "hardcoded data is fine, no tests".
4. If `ui.enabled`, capture evidence: `node .solo/engine/snap.mjs --routes <the prototype routes>`.
5. Reply with a comparison table: direction · what it proves · strengths · weaknesses · effort to build for real. Recommend one and say why.
6. After I choose: remove all wiring from tracked files (check with `git status` and `git diff` that no proto change is left), delete the losing prototypes (folders, or `git worktree remove` plus the local branch). The chosen prototype stays in `proto.dir` as reference material only; the real implementation goes through `/spec`.
