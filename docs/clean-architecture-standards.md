# Global Backend Coding Standards

## Core Principles
- Clean Architecture by default.
- Single Responsibility Principle (one reason to change per object/module).
- Dependency Inversion Principle (high-level policies depend on ports/contracts).
- English-only naming for folders and code identifiers.

## Standard Folder Structure
```text
src/
  bootstrap/
  platform/
  shared/
    domain/
    application/
    infrastructure/
    presentation/
  modules/
    <feature>/
      domain/
      application/
      infrastructure/
      presentation/
```

## Dependency Rules
- `domain` cannot import `application`, `infrastructure`, `presentation`, or `bootstrap`.
- `application` cannot import `infrastructure`, `presentation`, or `bootstrap`.
- `presentation` cannot import `infrastructure`.
- Wiring of concrete implementations must happen in `bootstrap`.

## Contract Rules
- Define port contracts in `application/ports` as `.d.ts` interfaces.
- Infrastructure modules implement ports.
- Controllers call use cases only.

## Migration Policy
- Keep public API path and response shape backward compatible during refactoring.
- Use Strangler pattern: move one feature at a time into `src/modules`.
- Leave compatibility entry points (`app.js`, `server.js`) as wrappers.

## Required CI Checks
- `npm run architecture:check`
- `npm test`

