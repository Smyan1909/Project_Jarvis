# Project Setup

## Prerequisites
- Node.js 20+
- pnpm 9+
- Expo CLI (for mobile)

## Install
- `pnpm install`

## Backend (TypeScript)
- `pnpm dev:backend` runs a basic HTTP server on port 3000.
- `pnpm -C apps/backend build` compiles to `apps/backend/dist`.

## Mobile (React Native with Expo)
- `pnpm dev:mobile` starts Expo.
- Use Expo Go or a simulator to launch the app.

## Next Steps
- Add API handlers in `apps/backend/src/api`.
- Add agent services in `apps/backend/src/application`.
- Build RN feature modules in `apps/mobile/src/features`.
