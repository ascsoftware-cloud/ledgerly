# Ledgerly

All-in-one business manager for South African small businesses. Working name.

- Spec: [docs/spec.md](docs/spec.md)
- Plan: [docs/plan.md](docs/plan.md)
- Research: [docs/research.md](docs/research.md)

## Develop

```bash
npm install
npm run dev
```

| Script | What it does |
|---|---|
| `npm run check` | Lint, typecheck and unit tests. Must pass before any commit. |
| `npm run e2e` | Builds the app and runs Playwright tests against it. |
| `npm run build` | Production build. |

## Environment

Copy `.env.example` to `.env.local`. Nothing is required until Phase 2 (Supabase).
