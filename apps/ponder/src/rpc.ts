import { http } from 'viem'

const RPC_TIMEOUT_MS = Number.parseInt(process.env.PONDER_RPC_TIMEOUT_MS ?? '60000', 10)
const rpcTimeoutMs = Number.isFinite(RPC_TIMEOUT_MS) && RPC_TIMEOUT_MS > 0 ? RPC_TIMEOUT_MS : 60_000

export function rpcTransport(rpcUrl: string) {
  const transport = http(rpcUrl)
  return (opts: Parameters<typeof transport>[0]) => transport({ ...opts, timeout: rpcTimeoutMs })
}
