# Project Jarvis

Monorepo for a multi-agent personal assistant system.

## Structure
- `apps/backend`: TypeScript backend.
- `apps/mobile`: React Native (Expo) app.
- `packages/shared-types`: Shared TypeScript types.
- `packages/agent-sdk`: Agent client SDK.
- `docs`: Architecture and protocols.

## Getting Started
1) Install dependencies:
   - `pnpm install`
2) Start backend:
   - `pnpm dev:backend`
3) Start mobile:
   - `pnpm dev:mobile`

## Docs
- `docs/ARCHITECTURE.md`
- `docs/AGENTS.md`
- `docs/SETUP.md`
