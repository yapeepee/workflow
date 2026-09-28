---
paths:
  - "{{ROOT}}**/*.{cs,cshtml,razor}"
---

# .NET / ASP.NET Core

- Nullable reference types stay on. Use the null-forgiving `!` only with a comment that explains why it is safe.
- Async all the way: no `.Result` or `.Wait()`. Pass `CancellationToken` from the endpoint down to every I/O call.
- Constructor injection only; no service locator. Choose lifetimes deliberately (`DbContext` is scoped).
- SQL is always parameterized (EF Core, or Dapper parameters). Never build SQL by string concatenation.
- Generate EF migrations freely, but never apply them to a non-local database without my approval.
- Validate input at the API boundary and return `ProblemDetails` for errors. Do not leak exception messages or stack traces.
- Logging is structured (`ILogger` message templates) and never contains secrets or personal data.
- Tests follow the existing framework (xUnit or NUnit) and test behavior through public APIs; use `WebApplicationFactory` for endpoint tests if the project already does.
