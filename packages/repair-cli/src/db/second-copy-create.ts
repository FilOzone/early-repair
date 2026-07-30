import { readFile } from 'node:fs/promises'
import { taskLog } from '@clack/prompts'
import { getBlockNumber } from 'viem/actions'
import { NoAlternateProviderError, RepairCreationError } from '../error.ts'
import type { OperationInsert } from '../local-schema.ts'
import type { Context } from '../types.ts'
import { getRepairProvider } from './get-repair-provider.ts'

const OPERATIONS_INSERT_BATCH_SIZE = 500

export interface SecondCopyCreateOptions extends Context {
  piecesFile: string
  sourceProviderUrl: string
  targetProviderId: bigint
}

type PiecesFile = {
  aggregates: Array<{ piece_cid?: unknown }>
}

/**
 * Normalize a provider service URL for storage and equality checks.
 */
export function normalizeProviderUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new RepairCreationError(`Invalid source provider URL: ${url}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RepairCreationError(`Source provider URL must be http(s): ${url}`)
  }

  // Drop trailing slash so endpoint comparisons are stable.
  return parsed.toString().replace(/\/$/, '')
}

/**
 * Parse a second-copy pieces file and return unique aggregate piece CIDs.
 */
export async function parsePieceCidsFromFile(piecesFile: string): Promise<string[]> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(piecesFile, 'utf8'))
  } catch (error) {
    throw new RepairCreationError(
      error instanceof Error ? `Failed to read pieces file: ${error.message}` : 'Failed to read pieces file'
    )
  }

  if (raw == null || typeof raw !== 'object' || !Array.isArray((raw as PiecesFile).aggregates)) {
    throw new RepairCreationError('Pieces file must contain an "aggregates" array')
  }

  const cids = new Set<string>()
  for (const aggregate of (raw as PiecesFile).aggregates) {
    if (typeof aggregate?.piece_cid !== 'string' || aggregate.piece_cid.length === 0) {
      throw new RepairCreationError('Each aggregate must include a non-empty "piece_cid" string')
    }
    cids.add(aggregate.piece_cid)
  }

  if (cids.size === 0) {
    throw new RepairCreationError('Pieces file contains no piece CIDs')
  }

  return [...cids]
}

/**
 * Prepare a second-copy job from a pieces file and an explicit source provider URL.
 *
 * @param options - The options for creating a second-copy job.
 * @returns The ID of the created local job.
 */
export async function secondCopyCreate(options: SecondCopyCreateOptions): Promise<number> {
  const { indexerDb, localDb, piecesFile, sourceProviderUrl, targetProviderId, client } = options
  const localSchema = localDb._.fullSchema
  const now = Date.now()
  const blockNumber = await getBlockNumber(client)
  const normalizedSourceUrl = normalizeProviderUrl(sourceProviderUrl)

  const log = taskLog({
    title: 'Creating second-copy',
    limit: 10,
    retainLog: true,
  })

  const targetProvider = await getRepairProvider({
    indexerDb,
    providerId: targetProviderId,
  })

  if (!targetProvider) {
    throw new NoAlternateProviderError(targetProviderId)
  }

  const normalizedTargetUrl = normalizeProviderUrl(targetProvider.serviceUrl)
  if (normalizedSourceUrl === normalizedTargetUrl) {
    throw new RepairCreationError('Source provider URL must differ from the target provider URL')
  }

  const pieceCids = await parsePieceCidsFromFile(piecesFile)
  log.message(`Loaded ${pieceCids.length} unique piece CIDs from ${piecesFile}`)

  const [repair] = await localDb
    .insert(localSchema.repairs)
    .values({
      kind: 'second_copy',
      repairProviderId: 0n,
      repairDataSetId: null,
      sourceProviderUrl: normalizedSourceUrl,
      targetProviderId: targetProvider.providerId,
      targetProviderUrl: targetProvider.serviceUrl,
      targetDataSetId: null,
      blockNumber,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: localSchema.repairs.id })

  if (!repair) throw new RepairCreationError('Failed to create second-copy row')

  let totalOperations = 0
  for (let offset = 0; offset < pieceCids.length; offset += OPERATIONS_INSERT_BATCH_SIZE) {
    const batchCids = pieceCids.slice(offset, offset + OPERATIONS_INSERT_BATCH_SIZE)
    const operations: OperationInsert[] = batchCids.map((cid) => ({
      repairId: repair.id,
      type: 'add_piece',
      status: 'pending',
      cid,
      metadata: {},
      alternateProvider: normalizedSourceUrl,
      createdAt: now,
      updatedAt: now,
    }))

    await localDb.insert(localSchema.operations).values(operations)
    totalOperations += operations.length
    log.message(`Inserted ${operations.length} operations (${totalOperations}/${pieceCids.length})`)
  }

  log.success(`Created second-copy ${repair.id} with ${totalOperations} operations`, { showLog: true })
  return repair.id
}
