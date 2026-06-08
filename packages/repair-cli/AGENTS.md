# Early repair CLI (`@filoz/repair-cli`)

CLI for preparing and running early repair jobs that move pieces away from a faulty Filecoin service provider and into a target PDP provider.

The package is built with [incur](https://www.npmjs.com/package/incur), Drizzle ORM, and `@filoz/synapse-core`. It uses the indexer Postgres database as a read-only catalog of providers, datasets, and pieces, plus a local SQLite database for repair jobs and per-piece operation state.

## Conventions

- Prefer existing command, middleware, and DB helper patterns over new abstractions.
- Extract reusable indexer queries and local database mutations under `src/db/`.
- Keep command files focused on CLI arguments, context wiring, and response shaping.
- Add JSDoc on exported functions/types; use inline comments only for non-obvious logic such as dedupe, pagination, or on-chain state sync.
- Repairs use one IPFS-enabled target dataset with CDN disabled. Do not add per-operation dataset grouping.
- Use `contextMiddleware` for commands that need config, wallet client, indexer DB, or local DB access.
- Do not document or preserve compatibility with unshipped in-progress behavior; update docs to match the current implementation.

## Build And Lint

```bash
pnpm --filter @filoz/repair-cli build
pnpm --filter @filoz/repair-cli lint
```
