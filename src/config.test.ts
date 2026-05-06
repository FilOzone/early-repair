import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { defaultDbPath, isNetwork, resolveDbPath, resolveNetworkDefaults } from './config.ts'

describe('config', () => {
  it('resolves network defaults', () => {
    assert.deepEqual(resolveNetworkDefaults('mainnet'), {
      network: 'mainnet',
      subgraphUrl:
        'https://api.goldsky.com/api/public/project_cmdfaaxeuz6us01u359yjdctw/subgraphs/pdp-explorer/mainnet311c/gn',
      rpcUrl: 'https://api.node.glif.io/rpc/v1',
    })

    assert.deepEqual(resolveNetworkDefaults('calibration'), {
      network: 'calibration',
      subgraphUrl:
        'https://api.goldsky.com/api/public/project_cmdfaaxeuz6us01u359yjdctw/subgraphs/pdp-explorer/calibration311c/gn',
      rpcUrl: 'https://api.calibration.node.glif.io/rpc/v1',
    })
  })

  it('checks network names', () => {
    assert.equal(isNetwork('mainnet'), true)
    assert.equal(isNetwork('calibration'), true)
    assert.equal(isNetwork('localnet'), false)
  })

  it('resolves the default DB path without creating it', () => {
    assert.equal(resolveDbPath(undefined).endsWith(defaultDbPath), true)
  })
})
