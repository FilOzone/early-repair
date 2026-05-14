import { CID } from 'multiformats/cid'

export interface DecodedPiece {
  cid: string
  rawSize: bigint
}

export function decodePiece(cidData: { data: `0x${string}` }): DecodedPiece {
  const bytes = Uint8Array.from(Buffer.from(cidData.data.slice(2), 'hex'))
  return {
    cid: CID.decode(bytes).toString(),
    rawSize: decodePieceSize(bytes),
  }
}

function decodePieceSize(bytes: Uint8Array): bigint {
  let offset = 1
  const byteAt = (index: number) => bytes[index] ?? 0

  while (byteAt(offset) & 0x80) offset++
  offset++

  while (byteAt(offset) & 0x80) offset++
  offset++

  while (byteAt(offset) & 0x80) offset++
  offset++

  let padding = 0
  let shift = 0
  while (byteAt(offset) & 0x80) {
    padding |= (byteAt(offset) & 0x7f) << shift
    shift += 7
    offset++
  }
  padding |= byteAt(offset) << shift
  offset++

  const height = byteAt(offset)
  if (height < 2) return 0n
  return (1n << BigInt(height - 2)) * 127n - BigInt(padding)
}
