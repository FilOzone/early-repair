import { createConfig } from 'ponder'
import { FilecoinWarmStorageServiceAbi, PDPVerifierAbi, ServiceProviderRegistryAbi } from './src/abis.ts'
import { CALIBNET } from './src/networks.ts'
import { rpcTransport } from './src/rpc.ts'

export default createConfig({
  database: {
    kind: 'postgres',
    connectionString: process.env.DATABASE_URL ?? 'postgres://ponder:ponder@localhost:17825/ponder',
  },
  chains: {
    calibnet: {
      id: CALIBNET.CHAIN_ID,
      rpc: rpcTransport(process.env.RPC_URL ?? 'http://localhost:1235/rpc/v1'),
      pollingInterval: 30_000,
    },
  },
  contracts: {
    FWSS: {
      abi: FilecoinWarmStorageServiceAbi,
      chain: 'calibnet',
      address: CALIBNET.FWSS,
      startBlock: CALIBNET.START_BLOCK,
    },
    PDPVerifier: {
      abi: PDPVerifierAbi,
      chain: 'calibnet',
      address: CALIBNET.PDP_VERIFIER,
      startBlock: CALIBNET.START_BLOCK,
    },
    SPRegistry: {
      abi: ServiceProviderRegistryAbi,
      chain: 'calibnet',
      address: CALIBNET.SP_REGISTRY,
      startBlock: CALIBNET.START_BLOCK,
    },
  },
})
