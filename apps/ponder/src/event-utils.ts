export function eventBlock(event: { block: { number: bigint } }) {
  return {
    updatedAtBlock: event.block.number,
  }
}

export function metadataFromEntries(keys: readonly string[], values: readonly string[]): Record<string, string> | null {
  if (keys.length === 0) return null

  const metadata: Record<string, string> = {}
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    if (key === undefined) continue
    metadata[key] = values?.[i] ?? ''
  }
  return metadata
}

export function metadataHasEmptyFlag(metadata: Record<string, string> | null, key: string): boolean {
  return metadata?.[key] === ''
}
