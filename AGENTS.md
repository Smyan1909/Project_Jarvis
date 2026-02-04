# AGENTS

## Purpose
Defines development protocols and repository structure for Project Jarvis.

## Repository Structure
- `apps/backend`: TypeScript backend.
- `apps/mobile`: React Native app (Expo).
- `packages/shared-types`: Shared TypeScript types.
- `docs`: Architecture and protocols.

## Development Protocols
- Use workspace scripts from the repo root (pnpm).
- Keep domain logic in hexagonal layers (ports/adapters).
- Add tool usage to audit logging and trace spans.
- Prefer small PRs with clear scope and test coverage.

## Testing & Quality
- `pnpm lint` and `pnpm typecheck` on every PR.
- Add unit tests for domain services and adapters.

## Security & Secrets
- Never commit secrets; use env files and secret managers.
- Enforce user-scoped data access in storage adapters.
