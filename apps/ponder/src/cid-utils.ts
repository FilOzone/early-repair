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
  let offset = 1 // skip CIDv1 version byte (0x01)

  // Skip codec varint (fil-commitment-unsealed = 0xf101)
  while ((bytes[offset] as number) & 0x80) offset++
  offset++

  // Skip multihash code varint (sha2-256-trunc254-padded-binary-tree = 0x1011)
  while ((bytes[offset] as number) & 0x80) offset++
  offset++

  // Skip digest length varint
  while ((bytes[offset] as number) & 0x80) offset++
  offset++

  // Decode padding varint
  let padding = 0
  let shift = 0
  while ((bytes[offset] as number) & 0x80) {
    padding |= ((bytes[offset] as number) & 0x7f) << shift
    shift += 7
    offset++
  }
  padding |= (bytes[offset] as number) << shift
  offset++

  // Height is 1 byte
  const height = bytes[offset] as number
  if (height < 2) return 0n
  return (1n << BigInt(height - 2)) * 127n - BigInt(padding)
}
