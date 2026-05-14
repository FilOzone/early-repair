import { createConfig } from 'ponder'
import { FilecoinWarmStorageServiceAbi, PDPVerifierAbi, ServiceProviderRegistryAbi } from './src/abis.ts'
import { MAINNET } from './src/networks.ts'
import { rpcTransport } from './src/rpc.ts'

export default createConfig({
  database: {
    kind: 'postgres',
    connectionString: process.env.DATABASE_URL ?? 'postgres://ponder:ponder@localhost:17826/ponder',
  },
  chains: {
    mainnet: {
      id: MAINNET.CHAIN_ID,
      rpc: rpcTransport(process.env.RPC_URL ?? 'http://localhost:1234/rpc/v1'),
      pollingInterval: 30_000,
    },
  },
  contracts: {
    FWSS: {
      abi: FilecoinWarmStorageServiceAbi,
      chain: 'mainnet',
      address: MAINNET.FWSS,
      startBlock: MAINNET.START_BLOCK,
    },
    PDPVerifier: {
      abi: PDPVerifierAbi,
      chain: 'mainnet',
      address: MAINNET.PDP_VERIFIER,
      startBlock: MAINNET.START_BLOCK,
    },
    SPRegistry: {
      abi: ServiceProviderRegistryAbi,
      chain: 'mainnet',
      address: MAINNET.SP_REGISTRY,
      startBlock: MAINNET.START_BLOCK,
    },
  },
})
