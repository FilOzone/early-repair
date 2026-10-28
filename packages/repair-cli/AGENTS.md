# Early repair CLI (`@filoz/repair-cli`)

CLI for preparing and running early repair jobs that move pieces away from a faulty Filecoin service provider and into a target PDP provider.

The package is built with [incur](https://www.npmjs.com/package/incur), Drizzle ORM, and `@filoz/synapse-core`. It uses the Filecoin API (`@filecoin-project/api-client`, from [filecoin-project/agents](https://github.com/filecoin-project/agents/tree/main/apps/filecoin-api)) as a read-only catalog of providers, datasets, and pieces, plus a local SQLite database for repair jobs and per-piece operation state.

## Conventions

- Prefer existing command, middleware, and DB helper patterns over new abstractions.
- Keep filecoin-api request wrappers in `src/api.ts`; extract reusable indexer lookups and local database mutations under `src/db/`.
- filecoin-api pages hold at most 200 items and the API allows 120 requests per minute per IP; prefer one paginated walk (e.g. `/pieces?provider_id=`) over per-item requests.
- Keep command files focused on CLI arguments, context wiring, and response shaping.
- Add JSDoc on exported functions/types; use inline comments only for non-obvious logic such as dedupe, pagination, or on-chain state sync.
- Repairs use one IPFS-enabled target dataset with CDN disabled. Do not add per-operation dataset grouping.
- Use `contextMiddleware` for commands that need config, wallet client, Filecoin API, or local DB access.
- Do not document or preserve compatibility with unshipped in-progress behavior; update docs to match the current implementation.

## Build And Lint

```bash
pnpm --filter @filoz/repair-cli build
pnpm --filter @filoz/repair-cli lint
```
