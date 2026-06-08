# Early Repair CLI

[![NPM](https://nodei.co/npm/@filoz/repair-cli.svg?style=flat&data=n,v&color=blue)](https://nodei.co/npm/@filoz/repair-cli/)

> Early repair for faulty service providers and datasets

The `repair` CLI helps prepare and run repair jobs that move pieces away from a faulty Filecoin service provider and into a target PDP provider. It uses:

- an indexer Postgres database as the read-only source of providers, datasets, and pieces
- a local SQLite database to track repair jobs and per-piece operations
- a configured Filecoin wallet to create datasets and submit on-chain add-piece transactions

## Installation

```bash
pnpm add -g @filoz/repair-cli
```

The package exposes the `repair` binary.

```bash
repair --help
```

## Setup

Run setup before using any command that talks to the indexer, local database, or wallet.

```bash
repair setup
```

Setup prompts for:

- private key for the repair wallet
- mainnet indexer Postgres URL
- calibration indexer Postgres URL
- chain, either Filecoin Mainnet `314` or Filecoin Calibration `314159`
- local SQLite database path

The command stores these values in the CLI config and runs the local SQLite schema migration. It returns the configured wallet address.

Most commands also accept:

```bash
--debug
```

Use `--debug` when you want extra error output from wallet operations.

## Command Reference

### `repair setup`

Interactive configuration and local database setup.

```bash
repair setup
```

Use this whenever you need to initialize the CLI, change the active chain, update indexer URLs, or move the local SQLite database.

### `repair wallet fund`

Funds the configured wallet from the Filecoin Calibration faucet.

```bash
repair wallet fund
```

This command only works on Calibration. It claims faucet tokens, waits for the transaction to be mined, and returns the wallet address and FIL balance.

### `repair wallet balance`

Shows wallet and payment account balances.

```bash
repair wallet balance
```

The output includes the wallet address, FIL balance, USDFC balance, and Filecoin Pay account summary fields such as funds, available funds, debt, lockup rates, lockup totals, runway, and current epoch.

### `repair wallet deposit <amount>`

Deposits USDFC from the configured wallet into the wallet's Filecoin Pay account.

```bash
repair wallet deposit 100
```

`amount` is a positive USDFC amount. The command submits the deposit and approval transaction, then waits for it to be mined.

### `repair wallet withdraw <amount>`

Withdraws USDFC from the wallet's Filecoin Pay account.

```bash
repair wallet withdraw 25
```

`amount` is a positive USDFC amount. The command submits the withdraw transaction and waits for it to be mined.

### `repair providers list`

Lists PDP providers from the configured indexer.

```bash
repair providers list
```

By default, the command returns active PDP providers that are approved or endorsed. Each provider includes:

- `id`
- `name`
- `serviceUrl`
- `approved`
- `endorsed`
- `pieceCount`, the number of active indexed pieces for that provider
- `totalSize`, the sum of active piece raw sizes formatted in decimal GB

Use `--all` to include every active PDP provider, even if it is not approved or endorsed.

```bash
repair providers list --all
```

### `repair datasets list`

Lists datasets owned by the configured repair wallet.

```bash
repair datasets list
```

Each dataset includes its ID, CDN/IPFS indexing flags, source, provider URL, PDP end epoch, and piece count.

Filter by provider ID:

```bash
repair datasets list --provider-id 123
```

### `repair repair create`

Creates a local repair plan for a source provider and a target provider.

```bash
repair repair create --provider-id 101 --target-provider-id 202
```

`--provider-id` is the faulty provider whose pieces should be repaired.

`--target-provider-id` is the provider that should receive the repaired pieces. It must be different from `--provider-id`.

The command snapshots the current chain block number, creates a local repair row, scans active pieces for the source provider, deduplicates them by CID, and creates local `add_piece` operations. Pieces with no alternate provider are marked `skipped`. The command returns a `repairId`.

### `repair repair list`

Lists local repair jobs.

```bash
repair repair list
```

Each repair includes:

- repair ID and status
- source provider ID
- target provider ID and target provider URL
- target dataset ID, when one has been created or found
- block number used when the repair was created
- total operations and counts by `pending`, `failed`, `completed`, and `skipped`

### `repair repair run <repairId>`

Runs a pending repair.

```bash
repair repair run 1
```

The command first ensures the target repair dataset exists for the configured wallet and target provider. If no matching dataset exists, it creates one with IPFS indexing enabled and CDN disabled. Then it processes pending `add_piece` operations by pulling pieces from alternate providers into the target provider and committing them on-chain.

Options:

- `--concurrency <number>` controls how many pull batches run at once. Defaults to `4`.
- `--batch-size <number>` controls the maximum number of `add_piece` operations per batch. Defaults to `40`.
- `--reset` retries failed `add_piece` operations as well as pending operations.

Example:

```bash
repair repair run 1 --concurrency 8 --batch-size 100 --reset
```

### `repair repair delete <repairId>`

Deletes a local repair and its operations.

```bash
repair repair delete 1
```

This only deletes local SQLite state. It does not delete on-chain datasets or remove pieces from a provider.

## Typical Workflow

1. Configure the CLI.

```bash
repair setup
```

1. On Calibration, fund the wallet if needed.

```bash
repair wallet fund
```

1. Check balances and deposit USDFC into the payment account.

```bash
repair wallet balance
repair wallet deposit 100
```

1. Pick source and target providers.

```bash
repair providers list
```

1. Create, inspect, and run the repair.

```bash
repair repair create --provider-id 101 --target-provider-id 202
repair repair list
repair repair run 1
```

## Contributing

Read contributing [guidelines](../../.github/CONTRIBUTING.md).

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/FilOzone/early-repair)

## License

Dual-licensed: [MIT](../../LICENSE.md), [Apache Software License v2](../../LICENSE.md) by way of the
[Permissive License Stack](https://protocol.ai/blog/announcing-the-permissive-license-stack/).
