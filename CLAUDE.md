# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## This is a Fork

LibreChat fork with active upstream. Minimize merge conflicts:

- **Do not modify upstream files** unless absolutely necessary
- Put custom code in isolated directories: `client/src/forked-code-custom/`, `client/src/forked-style-custom/`, `api/server/forked-code/`
- Custom backend routes go under `/api/forked/*`
- Prefer extension over modification (wrap components, override CSS via higher specificity)
- Leave inline comments explaining why a change was made

## Commands

```bash
# Development
npm run backend:dev          # Express server with nodemon (port 3080)
npm run frontend:dev         # Vite dev server (port 3090, proxies to 3080)

# Build (order matters — packages first)
npm run build:packages       # builds data-provider → data-schemas → api → client-package
npm run build:client         # builds React app (requires packages built first)
npm run frontend             # builds everything in correct order

# Test
npm run test:api             # jest --ci in api/
npm run test:client          # jest --ci in client/
npm run test:packages:api    # jest --ci in packages/api/
npm run test:packages:data-provider
npm run test:packages:data-schemas
npm run test:all             # runs all the above

# Single test (inside workspace)
cd api && npx jest path/to/test --watch
cd client && npx jest path/to/test --watch

# E2E
npm run e2e                  # Playwright headless
npm run e2e:headed           # with browser

# Lint
npm run lint
npm run lint:fix
```

## Architecture

Monorepo (npm workspaces + Turborepo). Five packages:

```
api/                          Express.js backend (CommonJS, JavaScript)
client/                       React SPA (TypeScript, Vite)
packages/data-provider/       Shared types, Zod schemas, API client, react-query hooks
packages/data-schemas/        Mongoose schemas and models (TypeScript)
packages/api/                 MCP services, stream, cache, middleware (TypeScript)
packages/client/              Shared React component library
```

**Dependency flow:** `client/` → `packages/client/` → `data-provider`. `api/` → `packages/api/` → `data-schemas` → `data-provider`.

### Backend (`api/`)

- Entry: `api/server/index.js` — connects MongoDB, loads `librechat.yaml` config, mounts Express middleware, registers all `/api/*` routes, serves static React build
- Routes: `api/server/routes/` — one file per resource (auth, convos, messages, agents, files, etc.)
- Controllers: `api/server/controllers/`
- Middleware: `api/server/middleware/` — auth (Passport.js + JWT), rate limiting, validation
- LLM clients: `api/app/clients/` — adapters for OpenAI, Anthropic, Google, Bedrock, Ollama, etc.
- Auth strategies: `api/strategies/` — local, LDAP, OAuth (Google, GitHub, Discord, etc.)
- Fork routes: `api/server/forked-code/` — Lago billing proxy, LiteLLM proxy

### Frontend (`client/src/`)

- Root: `App.jsx` — RecoilRoot, QueryClientProvider, ThemeProvider, Router
- Routes: `routes/` — React Router v6, `ChatRoute.tsx` is the main chat UI
- State: Recoil atoms (`store/`), Jotai atoms, TanStack Query v4 (`data-provider/`)
- Components: organized by feature (`Chat/`, `Messages/`, `Agents/`, `Nav/`, `Auth/`, `ui/`)
- Providers: 28+ React contexts in `Providers/`
- i18n: `locales/` with i18next
- Fork code: `forked-code-custom/` (RouteGuard, SubscriptionRequiredPage, etc.), `forked-style-custom/custom-daniel-ai.css`

### Database

MongoDB via Mongoose. Schemas in `packages/data-schemas/src/schema/`, models in `src/models/`. Key models: User, Conversation, Message, Agent, File, Role, Balance, Transaction, Session.

## Conventions

- **Frontend**: TypeScript. **Backend**: JavaScript (intentional, not migrating).
- Path alias `~/` maps to `src/` in client and `api/` root in backend.
- File naming: React components PascalCase (`MyComponent.tsx`), helpers camelCase (`myHelper.ts`).
- Commit format: semantic (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, `style:`).
- Import order (ESLint enforced): npm packages → TypeScript types → local imports (longest line first within each group).
- Node 20.x, npm 11.
- Config: root `.env` file (see `.env.example`), `librechat.yaml` for app features/endpoints.
