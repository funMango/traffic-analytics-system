# project-template-clean-arch

This folder is a local seed for the global Clean Architecture template repository.

## Intended global repository
- Name: `project-template-clean-arch`
- Purpose: baseline scaffold for all backend projects.

## Required baseline
- `src` with `bootstrap/platform/shared/modules` layout.
- Port interfaces in `.d.ts`.
- Architecture boundary check script.
- CI that runs architecture check + tests.

## Suggested copy checklist
1. Copy `src` structure and empty feature module templates.
2. Copy `scripts/check-architecture.js`.
3. Copy `docs/clean-architecture-standards.md`.
4. Add project-specific feature modules only under `src/modules`.

