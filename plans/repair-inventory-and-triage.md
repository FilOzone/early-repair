# Repair Inventory and Triage CLI

## Summary

Build a CLI-first repair inventory for issue #3: sync PDP Explorer subgraph data into local SQLite, enrich provider identity from Synapse SDK/chain reads, and expose provider-risk triage as human tables plus `--json`.

Use:

- Drizzle ORM + `better-sqlite3` for local SQLite.
- GraphQL Code Generator client preset + custom `fetch` wrapper for typed subgraph operations.
- Top-level `id_gt` pagination with `first: 1000`, avoiding large `skip`.

## Key Changes

- Add dependencies:
  - runtime: `drizzle-orm`, `better-sqlite3`, `viem`
  - dev: `@types/better-sqlite3`, `@graphql-codegen/cli`, `@graphql-codegen/client-preset`
- Add GraphQL schema snapshot and generated typed operations under `src/subgraph/`.
- Add network defaults for `mainnet` and `calibration`; every default remains overridable with flags.
  - `mainnet` subgraph: `https://api.goldsky.com/api/public/project_cmdfaaxeuz6us01u359yjdctw/subgraphs/pdp-explorer/mainnet311c/gn`
  - `calibration` subgraph: `https://api.goldsky.com/api/public/project_cmdfaaxeuz6us01u359yjdctw/subgraphs/pdp-explorer/calibration311c/gn`
  - `mainnet` RPC: `https://api.node.glif.io/rpc/v1`
  - `calibration` RPC: `https://api.calibration.node.glif.io/rpc/v1`
- Resolve configuration in this order: CLI flag, environment variable, network default.
- Raise the package Node engine to `>=24.14.0` to match current project practice and reduce native dependency/runtime variance.
- Add CLI commands:
  - `inventory sync --network <mainnet|calibration> [--subgraph-url <url>] [--rpc-url <url>] [--db <path>]`
  - `inventory status [--db <path>] [--json]`
  - `triage provider <provider-id-or-address> [--dataset <set-id>] [--skip-recoverable] [--db <path>] [--rpc-url <url>] [--json]`
  - `triage dataset <set-id> [--skip-recoverable] [--db <path>] [--json]`
- Default DB path: `.early-repair/inventory.sqlite`.

## GraphQL Codegen

- Use GraphQL Code Generator's `client` preset for typed GraphQL documents and operation result/variable types.
- Keep subgraph operations in source files and generate into `src/subgraph/generated/`.
- Commit generated files so normal build/check runs do not require network access or the neighboring `../pdp-explorer` checkout.
- Add `pnpm run codegen` for manual regeneration from the local schema snapshot, but do not run codegen automatically in `pnpm run check`.

## Sync Strategy

- Treat subgraph ingestion as a scraper-style snapshot, not an incremental indexer.
- Build each sync into a temporary SQLite database file using the current schema, validate required metadata and table counts, then atomically replace the previous inventory DB.
- Keep the previous DB untouched if fetch/import/validation fails, avoiding partially refreshed inventory.
- Record sync metadata: network, subgraph URL, RPC URL, `_meta.block.number`, `_meta.block.hash`, started/completed timestamps, schema version, and imported row counts.
- Do not add a migration framework in v1. The inventory DB is derived data, so rebuilding from the subgraph is the schema upgrade path.
- If a command opens an unsupported DB schema version, fail with an explicit message to run `inventory sync` and rebuild.
- Do not store repair/session state, manual notes, or operator decisions in this DB unless migrations are added later.

## Inventory Model

- Store normalized tables for providers, data sets, roots, sync metadata, and provider registry enrichment.
- Key subgraph providers by normalized service-provider address, and store registry enrichment separately with numeric provider ID, service-provider address, PDP service URL, name, active status, checked timestamp, and last error.
- During sync, fetch active registry providers from Synapse SDK and join them to subgraph providers by service-provider address.
- During triage, use only the stored provider ID/address mapping from the local inventory; do not perform live chain or registry lookups.
- Treat affected pieces for a risky provider as active, non-removed roots in active data sets owned by that provider.
- Treat surviving repair sources as active, non-removed roots with the same `cid` on a different provider.
- Use `root.cid` as the piece identity; it is sufficient because the CID embeds the size.
- Do not use fault state to decide affected pieces in v1. Fault detection is handled by a separate job/tool; this inventory supports repair planning for a whole provider or a specified dataset.
- Mark a dataset:
  - `recoverable` when every affected piece has at least one surviving source.
  - `partial` when only some affected pieces have surviving sources.
  - `unrecoverable_from_inventory` when no affected pieces have surviving sources.
- Preserve subgraph IDs/CIDs exactly as returned; do not invent CID decoding in v1.

## Operator Output

- `triage provider` resolves numeric provider IDs through the stored local registry mapping, then matches subgraph `Provider.address`.
- `triage provider --dataset <set-id>` limits output to one dataset owned by that provider.
- `triage dataset <set-id>` reports repair inventory for a single dataset, independent of provider-wide risk.
- `--skip-recoverable` summarizes fully recoverable datasets into aggregate statistics and prints details only for partial or unrecoverable datasets.
- `inventory status` reports whether the DB exists, schema version, configured network, last synced subgraph block/hash/time, source URL, row counts per inventory table, and whether the local inventory is empty or stale.
- Default output shows:
  - provider summary
  - affected dataset count
  - affected piece count
  - recoverable / partial / unrecoverable dataset counts
  - per-dataset rows with missing source count
  - explicit gaps and stale-sync metadata
- `--json` returns the same data as structured JSON for scripts.

## Documentation

- Add `README.md` usage for sync/status/triage.
- Document known limits:
  - inventory is only as fresh as the last subgraph sync
  - source-copy detection is inferred from same CID on another active provider
  - missing provider registry enrichment does not block address-based triage

## Test Plan

- Add Node's built-in test runner and wire it into `pnpm run check`.
- Add unit tests for network default resolution, DB initialization/status reporting, GraphQL pagination loop behavior, inventory import upserts, and triage classification.
- Add mocked GraphQL sync tests that feed paginated provider/data set/root responses into a temp SQLite DB, then assert both `id_gt` pagination requests and exact DB placement: rows land in the expected tables, foreign keys/addresses connect correctly, and sync metadata row counts match.
- Add fixture-based triage tests for recoverable, partial, unrecoverable, removed-root, inactive-dataset, provider ID/address resolution, dataset filtering, and `--skip-recoverable` scenarios.
- Verify `pnpm dev -- --help` shows commands.
- Verify generated GraphQL types compile.
- Smoke-test `inventory status` on a new DB and after fixture import.
- Run `pnpm run check`.

## Assumptions

- First operator interface is CLI tables plus JSON, not a web UI.
- SQLite should not use experimental `node:sqlite`.
- Typed GraphQL should use Codegen + custom fetcher.
- Large syncs page by `id_gt` and join locally rather than relying on nested subgraph pagination.
- Fault records are out of scope for v1 inventory and are not imported.
