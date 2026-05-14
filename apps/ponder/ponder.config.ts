import { createConfig } from 'ponder'
import { FilecoinWarmStorageServiceAbi, PDPVerifierAbi, ServiceProviderRegistryAbi } from './src/abis.ts'
import { NETWORKS, type NetworkName } from './src/networks.ts'
import { rpcTransport } from './src/rpc.ts'

const DEFAULT_DATABASE_URL = 'postgres://ponder:ponder@localhost:17825/ponder'
const DEFAULT_RPC_URL = 'http://localhost:1234/rpc/v1'

function parseNetwork(value: string | undefined): NetworkName {
  if (value === undefined || value === '') return 'mainnet'
  if (value === 'mainnet' || value === 'calibnet') return value
  throw new Error(`Unsupported PONDER_NETWORK "${value}". Expected "mainnet" or "calibnet".`)
}

function parseStrictEnv(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

function env(name: string, fallback: string, strict: boolean): string {
  const value = process.env[name]
  if (value !== undefined && value !== '') return value
  if (strict) throw new Error(`${name} is required when PONDER_STRICT_ENV=true`)
  return fallback
}

const networkName = parseNetwork(process.env.PONDER_NETWORK)
const network = NETWORKS[networkName]
const strictEnv = parseStrictEnv(process.env.PONDER_STRICT_ENV)

export default createConfig({
  database: {
    kind: 'postgres',
    connectionString: env('DATABASE_URL', DEFAULT_DATABASE_URL, strictEnv),
  },
  chains: {
    [networkName]: {
      id: network.CHAIN_ID,
      rpc: rpcTransport(env('RPC_URL', DEFAULT_RPC_URL, strictEnv)),
      pollingInterval: 30_000,
    },
  },
  contracts: {
    FWSS: {
      abi: FilecoinWarmStorageServiceAbi,
      chain: networkName,
      address: network.FWSS,
      startBlock: network.START_BLOCK,
    },
    PDPVerifier: {
      abi: PDPVerifierAbi,
      chain: networkName,
      address: network.PDP_VERIFIER,
      startBlock: network.START_BLOCK,
    },
    SPRegistry: {
      abi: ServiceProviderRegistryAbi,
      chain: networkName,
      address: network.SP_REGISTRY,
      startBlock: network.START_BLOCK,
    },
  },
})
