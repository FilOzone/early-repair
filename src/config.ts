import { resolve } from 'node:path'

export const networks = ['mainnet', 'calibration'] as const

export type Network = (typeof networks)[number]

export type NetworkDefaults = {
  network: Network
  subgraphUrl: string
  rpcUrl: string
}

export const defaultDbPath = '.early-repair/inventory.sqlite'

const networkDefaults = {
  mainnet: {
    network: 'mainnet',
    subgraphUrl:
      'https://api.goldsky.com/api/public/project_cmdfaaxeuz6us01u359yjdctw/subgraphs/pdp-explorer/mainnet311c/gn',
    rpcUrl: 'https://api.node.glif.io/rpc/v1',
  },
  calibration: {
    network: 'calibration',
    subgraphUrl:
      'https://api.goldsky.com/api/public/project_cmdfaaxeuz6us01u359yjdctw/subgraphs/pdp-explorer/calibration311c/gn',
    rpcUrl: 'https://api.calibration.node.glif.io/rpc/v1',
  },
} satisfies Record<Network, NetworkDefaults>

export function isNetwork(value: string): value is Network {
  return networks.includes(value as Network)
}

export function resolveNetworkDefaults(network: Network): NetworkDefaults {
  return networkDefaults[network]
}

export function resolveDbPath(dbPath: string | undefined): string {
  return resolve(dbPath ?? defaultDbPath)
}
