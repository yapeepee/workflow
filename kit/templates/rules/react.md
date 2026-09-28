---
paths:
  - "{{ROOT}}src/**/*.{ts,tsx,js,jsx}"
---

# React

- Function components and hooks only. Rendering is pure: the same props and state give the same output.
- Derive values during render. Do not copy props or derived data into state, and do not use `useEffect` for derived state or event handling.
- `useEffect` only synchronizes with external systems, and returns a cleanup when it subscribes to something.
- List keys are stable ids, never the array index for lists that change.
- Server data goes through the project's data layer (for example TanStack Query) if one exists; no hand-rolled fetch-in-effect caches.
- Props have explicit types. No `any`.
- Interactive elements are real `button`/`a` elements; inputs have labels.
- Tests use Testing Library queries by role or label and assert behavior, not implementation.
