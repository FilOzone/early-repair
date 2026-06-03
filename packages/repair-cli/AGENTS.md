# Early repair CLI (`@filoz/repair-cli`)

CLI to migrate pieces from a faulty Filecoin storage provider to an alternate provider. Built with [incur](https://www.npmjs.com/package/incur), Drizzle ORM, and `@filoz/synapse-core` for on-chain SP calls.

## Architecture

Two databases:

| DB          | Engine                         | Schema                   | Role                                           |
| ----------- | ------------------------------ | ------------------------ | ---------------------------------------------- |
| **Indexer** | Postgres (`indexer-schema.ts`) | `early-repair` pg schema | Read-only catalog: providers, datasets, pieces |
| **Local**   | SQLite (`local-schema.ts`)     | `repairs`, `operations`  | Repair job queue and execution state           |

Commands get both via `contextMiddleware` (`middleware.ts`): wallet client from config, indexer URL by `chainId` (314 = mainnet, else calibration).

## Repair dataset

Repairs now target a single dataset: IPFS indexing enabled and CDN disabled.

All source pieces are deduped globally by CID and repaired into this one target dataset. Target datasets are looked up with target provider + payer + `EARLY_REPAIR_SOURCE` (`utils.ts`) + `withIpfsIndexing = true` + `withCdn = false`.

## Repair pipeline

### 1. `repair create --provider-id <id> --target-provider-id <id>`

`createRepair` (`db/create-repair.ts`):

1. **Target provider** — **`getRepairProvider`** loads the required `--target-provider-id`. Throws if none is found.
2. Insert **`repairs`** row (`repairProviderId`, `targetProviderId`).
3. **`forEachPiecesPage`** — paginated `add_piece` operations (`db/get-pieces.ts`).
4. **`getRepairDataset`** — find the target IPFS-enabled dataset for the repair wallet.
5. If no target dataset exists → insert one **`create_dataset`** operation (`pending`).

### 2. `repair run <repairId>`

1. Run **`create_dataset`** phase (`pipeline/create-datasets.ts`) for the single pending dataset operation — `SP.createDataSet`, then `updateOperation`; stores the single IPFS target dataset ID.
2. Run **`add_piece`** pull phase (`pipeline/pull.ts`) via `p-queue`: pending ops are fetched in ID order with bounded queue backpressure.

`--reset` retries `pending` and `failed` `create_dataset` ops and also includes failed `add_piece` ops; otherwise `add_piece` runs only `pending` operations. `--batch-size` caps pieces per pull job.

### Operation types

- `create_dataset`: `pending` → `committing` → `completed` | `failed`; data has `serviceUrl`, `payee`.
- `add_piece`: `pending` → `pulling` → `committing` → `completed` | `failed`; data has `cid`, `serviceUrl`, `metadata`, `alternateProviders`.

`add_piece` without alternate providers (other replicas) is created as **`skipped`** with error `"No alternate providers found"`.

## Source layout

```text
src/
  cli.ts                 # incur root: setup, wallet, repair, datasets, providers
  commands/
    repair.ts            # create | list | delete | run
    datasets.ts
    providers.ts         # list
    setup.ts
    wallet.ts
  db/
    create-repair.ts     # createRepair orchestration
    get-repair-dataset.ts # target IPFS-enabled dataset
    get-providers-by-cid.ts  # alternate providers per CID
    get-repair-provider.ts             # load explicit target provider by ID
    update-operation.ts      # patch local operation status/result/error
    delete-repair.ts         # delete repair and its operations
    get-pieces.ts            # getPiecesPage, forEachPiecesPage
  pipeline/
    create-datasets.ts   # create_dataset operation queue
    pull.ts              # paginated add_piece pull queue + mock worker
  local-schema.ts        # SQLite repairs/operations
  indexer-schema.ts      # Postgres early-repair schema
  middleware.ts          # DB + wallet context
  types.ts               # Shared DB and context types
  error.ts               # NoAlternateProviderError, RepairCreationError
  utils.ts               # config, client, metadata helpers
```

## Conventions

- Indexer helpers take `IndexerQueryOptions` (`indexerDb`, `indexerSchema`).
- Extract DB helpers under `src/db/` (indexer queries and local operation updates).
- Add JSDoc on exported functions/types; inline comments only for non-obvious logic (dedupe, pagination).
- Repairs use one IPFS-enabled target dataset; do not add per-operation dataset grouping.

## Indexer API (`src/db/`)

- `getRepairDataset` (`get-repair-dataset.ts`): single IPFS-enabled dataset for payer + `EARLY_REPAIR_SOURCE`.
- `getProvidersByCid` (`get-providers-by-cid.ts`): alternate providers per CID; empty array if none.
- `getRepairProvider` (`get-repair-provider.ts`): load explicit target provider by ID.
- `filterPullPiecesNotInDataset` (`filter-pull-pieces-not-in-dataset.ts`): exclude CIDs already indexed in a dataset.
- `updateOperation` (`update-operation.ts`): patch local operation status/result/error.

## Local schema

- **`repairs`**: `repairProviderId`, `targetProviderId`, `targetDataSetId`, `status` (`pending` \| `completed` \| `failed`).
- **`operations`**: `type`, `status`, `data` (JSON), `result`, `error`.

## Commands

| Command | Notes |
| ------- | ----- |
| `repair setup` | Interactive config: private key, indexer URLs, chain, local DB path; migrates SQLite |
| `repair wallet fund` | Fund calibration wallet from faucet |
| `repair wallet balance` | Wallet FIL/USDFC balances and pay account summary |
| `repair wallet deposit <amount>` | Deposit USDFC to pay account |
| `repair wallet withdraw <amount>` | Withdraw USDFC from pay account |
| `repair repair create --provider-id <id> --target-provider-id <id>` | Plan repair; returns `repairId` |
| `repair repair list` | List repairs with operation counts |
| `repair repair delete <repairId>` | Delete a repair and its operations |
| `repair repair run <repairId>` | Execute workers; `--concurrency`, `--batch-size`, `--reset` |
| `repair datasets list` | List payer datasets from indexer with piece counts; optional `--provider-id` |
| `repair providers list` | List active providers from indexer (`providerActive` + `pdpProductActive`) |

## Build & test

```bash
pnpm --filter @filoz/repair-cli build
pnpm --filter @filoz/repair-cli lint
pnpm --filter @filoz/repair-cli test
```

## Not yet implemented

- Real `add_piece` pull/commit (worker only logs batches).
- Repair-level status transitions after run completes.
