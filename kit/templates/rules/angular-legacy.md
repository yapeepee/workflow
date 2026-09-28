---
paths:
  - "{{ROOT}}src/**/*.{ts,html,scss,css}"
---

# Angular (legacy, below v17)

- Match the existing module and component structure. Do not migrate to standalone, signals or the new control flow unless the task asks for it.
- Check `package.json` before using an API: it must exist in this Angular version.
- RxJS: unsubscribe with `takeUntil(this.destroy$)` or the async pipe. No nested subscribes; compose with operators.
- New components use OnPush when their inputs are immutable.
- Component tests go through the DOM, never through private members.
- After template edits, read the editor's diagnostics before waiting for the Stop hook: in VS Code, `getDiagnostics` returns the Problems panel, which includes template errors when the Angular Language Service extension is installed.
