
# Repair Ponder Indexer

Indexes FWSS repair inventory state for datasets, pieces, and storage providers.

The shared Drizzle schema used by downstream consumers lives in `packages/repair-db`.
Ponder owns the on-chain write schema in `apps/ponder/ponder.schema.ts`, with table names imported from
`@filoz/repair-db`.

## Tables

- `providers`: current ServiceProviderRegistry state, including provider name from block-scoped `eth_call`s and the
  PDP product `serviceURL`.
- `data_sets`: current FWSS dataset state. `pdp_end_epoch != 0` means PDP payment termination has started.
- `pieces`: current piece inventory keyed by `(data_set_id, piece_id)`, with a secondary CID index for finding alternate
  providers.

## Commands

```sh
pnpm --filter @filoz/repair-ponder codegen:mainnet
pnpm --filter @filoz/repair-ponder codegen:calibnet
pnpm --filter @filoz/repair-ponder typecheck
pnpm --filter @filoz/repair-ponder dev:mainnet
pnpm --filter @filoz/repair-ponder dev:calibnet
```

Set `DATABASE_URL` and `RPC_URL` to override the local defaults.

## Networks

| Network | Goldsky slug | FWSS address | PDPVerifier address | Start block |
| --- | --- | --- | --- | --- |
| Filecoin mainnet | `filecoin` | `0x8408502033C418E1bbC97cE9ac48E5528F371A9f` | `0xBADd0B92C1c71d02E7d520f64c0876538fa2557F` | `5459607` |
| Filecoin calibration | `filecoin-testnet` | `0x02925630df557F957f70E112bA06e50965417CA0` | `0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C` | `3141266` |

Start blocks are 10 blocks before FWSS proxy creation. Mainnet FWSS was created at block `5459617`; calibration FWSS was created at block `3141276`.
