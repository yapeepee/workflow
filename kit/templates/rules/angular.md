---
paths:
  - "{{ROOT}}src/**/*.{ts,html,scss,css}"
---

# Angular (v17+)

- New components are standalone with `changeDetection: ChangeDetectionStrategy.OnPush`. No new NgModules.
- State lives in signals (`signal`, `computed`, `linkedSignal`). Component APIs use `input()`, `output()`, `model()`.
- `effect()` only syncs with non-Angular APIs (storage, DOM libraries). Never derive state inside an effect.
- Templates use `@if`, `@for (…; track …)`, `@switch`. No method calls in templates except signal reads.
- Use `inject()` for dependency injection in new code.
- Observables: convert with `toSignal()`; if you must subscribe, use `takeUntilDestroyed()`.
- UI updates flow through signals, never through timers or zone-triggered change detection, so the app stays zoneless-safe.
- Styling uses Tailwind utilities and design tokens. No inline `style=`, `[style.*]`, `[ngStyle]` or raw colors.
- Check Angular CDK and platform APIs before adding a UI dependency.
- Component tests go through the DOM or a component harness, never through private members.
- After template edits, read the editor's diagnostics before waiting for the Stop hook: in VS Code, `getDiagnostics` returns the Problems panel, which includes template errors when the Angular Language Service extension is installed.
