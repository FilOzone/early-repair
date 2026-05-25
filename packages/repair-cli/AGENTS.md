# Early repair CLI (`@filoz/repair-cli`)

CLI to migrate pieces from a faulty Filecoin storage provider to an alternate provider. Built with [incur](https://www.npmjs.com/package/incur), Drizzle ORM, and `@filoz/synapse-core` for on-chain SP calls.

## Architecture

Two databases:

| DB          | Engine                         | Schema                   | Role                                           |
| ----------- | ------------------------------ | ------------------------ | ---------------------------------------------- |
| **Indexer** | Postgres (`indexer-schema.ts`) | `early-repair` pg schema | Read-only catalog: providers, datasets, pieces |
| **Local**   | SQLite (`local-schema.ts`)     | `repairs`, `operations`  | Repair job queue and execution state           |

Commands get both via `contextMiddleware` (`middleware.ts`): wallet client from config, indexer URL by `chainId` (314 = mainnet, else calibration).

## Piece groups

Pieces are grouped by dataset flags (`withCdn`, `withIpfsIndexing`). Groups are **mutually exclusive**:

- `both`: `withCdn = true`, `withIpfsIndexing = true`
- `cdn`: `withCdn = true`, `withIpfsIndexing = false`
- `ipfs`: `withCdn = false`, `withIpfsIndexing = true`
- `none`: `withCdn = false`, `withIpfsIndexing = false`

Same CID may appear on multiple datasets in one group; dedupe per group when listing or paginating pieces.

Target datasets are looked up with payer + `EARLY_REPAIR_SOURCE` (`utils.ts`, value `early-repair2`).

## Repair pipeline

### 1. `repair create --provider-id <id>`

`createRepair` (`db/create-repair.ts`):

1. **Target provider** — if `--target-provider-id` is set, **`getRepairProvider`** loads that active provider; otherwise **`selectAlternateRepairProvider`** picks one with tier-matched fallback (endorsed → approved → none). Throws if none found.
2. **`getDataSetsByGroup`** — target provider datasets per group.
3. Insert **`repairs`** row (`repairProviderId`, `targetProviderId`).
4. **`forEachPiecesPage`** — paginated `add_piece` operations (`db/get-pieces.ts`, page size 500).
5. **`getRepairGroups`** — distinct groups from pending `add_piece` ops; saved on the repair row.
6. For each group with pending pieces but no target dataset → insert **`create_dataset`** operation (`pending`).

### 2. `repair run <repairId>`

1. Run **`create_dataset`** phase (`pipeline/create-datasets.ts`) via fastq — `SP.createDataSet`, then `updateOperation`; returns created dataset IDs indexed by group.
2. Run **`add_piece`** pull phase (`pipeline/pull.ts`): pending ops are fetched in same-group pages and fed into fastq as workers free up (`createPullPiecesWorker` — mock logs CIDs per batch).

`--reset` retries `pending` and `failed` `create_dataset` ops only; `add_piece` always runs `pending` (failed pieces are skipped). `--batch-size` (default 50) caps pieces per pull job; each batch is one repair group only.

### Operation types

- `create_dataset`: `pending` → `committing` → `completed` | `failed`; data has `serviceUrl`, `payee`.
- `add_piece`: `pending` → `pulling` → `committing` → `completed` | `failed`; data has `cid`, `serviceUrl`, `metadata`, `alternateProviders`.

`add_piece` without alternate providers (other replicas) is created as **`failed`** with error `"No alternate providers found"`. `getProvidersByCid` excludes the source `providerId`.

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
    get-repair-groups.ts   # source groups that need repair
    get-datasets-by-group.ts # target datasets per group
    get-providers-by-cid.ts  # alternate providers per CID
    select-alternate-repair-provider.ts # automatic target provider selection
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
  types.ts               # Group, PIECE_GROUPS, DB types
  error.ts               # NoAlternateProviderError, RepairCreationError
  utils.ts               # config, client, metadata helpers
```

## Conventions

- Indexer helpers take `IndexerQueryOptions` (`indexerDb`, `indexerSchema`).
- Extract DB helpers under `src/db/` (indexer queries and local operation updates).
- Add JSDoc on exported functions/types; inline comments only for non-obvious logic (dedupe, pagination, tier fallback).
- Use `PIECE_GROUPS` instead of `Object.keys` for group iteration.

## Indexer API (`src/db/`)

| Function                        | Module                              | Purpose                                                 |
| ------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `getRepairGroups`               | `get-repair-groups.ts`              | Repair groups from pending local `add_piece` operations   |
| `getDataSetsByGroup`            | `get-datasets-by-group.ts`          | One dataset per group for payer + `EARLY_REPAIR_SOURCE` |
| `getProvidersByCid`             | `get-providers-by-cid.ts`           | Alternate providers per CID; empty array if none        |
| `selectAlternateRepairProvider` | `select-alternate-repair-provider.ts` | Automatic target provider selection                   |
| `getRepairProvider`             | `get-repair-provider.ts`              | Load explicit target provider by ID                   |
| `updateOperation`               | `update-operation.ts`               | Patch local operation status/result/error               |

## Local schema

- **`repairs`**: `repairProviderId`, `targetProviderId`, `repairGroups`, `status` (`pending` \| `running` \| `completed` \| `failed`).
- **`operations`**: `type`, `group`, `status`, `data` (JSON), `result`, `error`.

## Commands

| Command | Notes |
| ------- | ----- |
| `repair setup` | Interactive config: private key, indexer URLs, chain, local DB path; migrates SQLite |
| `repair wallet fund` | Fund calibration wallet from faucet |
| `repair wallet balance` | Wallet FIL/USDFC balances and pay account summary |
| `repair wallet deposit <amount>` | Deposit USDFC to pay account |
| `repair wallet withdraw <amount>` | Withdraw USDFC from pay account |
| `repair repair create --provider-id <id>` | Plan repair; optional `--target-provider-id`; returns `repairId` |
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
