import { BigInt, Bytes } from "@graphprotocol/graph-ts";

class UvarintResult {
  constructor(
    public isValid: boolean,
    public value: BigInt = BigInt.zero(),
    public offset: BigInt = BigInt.zero(),
  ) {}
}

class CommPv2ValidationResult {
  constructor(
    public isValid: boolean,
    public padding: BigInt = BigInt.zero(),
    public height: u8 = 0,
  ) {}
}

function readUvarint(data: Bytes, offset: BigInt): UvarintResult {
  let offsetU32 = offset.toU32();
  if (offsetU32 >= u32(data.length)) {
    return new UvarintResult(false);
  }

  let i: u32 = 0;
  let value: u64 = u64(data[offsetU32] & 0x7f);

  while (data[offsetU32 + i] >= 0x80) {
    i++;
    if (offsetU32 + i >= u32(data.length) || i >= 10) {
      return new UvarintResult(false);
    }

    let nextByte = u64(data[offsetU32 + i] & 0x7f);
    value = value | (nextByte << (i * 7));
  }

  i++;
  return new UvarintResult(true, BigInt.fromU64(value), BigInt.fromU32(offsetU32 + i));
}

function skipUvarint(data: Bytes, offset: BigInt): UvarintResult {
  let result = readUvarint(data, offset);
  if (!result.isValid) {
    return new UvarintResult(false);
  }

  return new UvarintResult(true, BigInt.zero(), result.offset);
}

function validateCommPv2(cidData: Bytes): CommPv2ValidationResult {
  if (cidData.length < 5 || cidData[0] != 0x01) {
    return new CommPv2ValidationResult(false);
  }

  let offset = BigInt.fromU32(1);

  // CIDv1 bytes encode these as varints:
  // codec, multihash code, digest length, then the PieceCIDv2 digest.
  let codecResult = skipUvarint(cidData, offset);
  if (!codecResult.isValid) {
    return new CommPv2ValidationResult(false);
  }
  offset = codecResult.offset;

  let multihashCodeResult = skipUvarint(cidData, offset);
  if (!multihashCodeResult.isValid) {
    return new CommPv2ValidationResult(false);
  }
  offset = multihashCodeResult.offset;

  let digestLengthResult = skipUvarint(cidData, offset);
  if (!digestLengthResult.isValid) {
    return new CommPv2ValidationResult(false);
  }
  offset = digestLengthResult.offset;

  let paddingResult = readUvarint(cidData, offset);
  if (!paddingResult.isValid) {
    return new CommPv2ValidationResult(false);
  }

  offset = paddingResult.offset;
  if (offset.toU32() >= u32(cidData.length)) {
    return new CommPv2ValidationResult(false);
  }

  let height = cidData[offset.toU32()];
  return new CommPv2ValidationResult(true, paddingResult.value, height);
}

export function rawSizeFromPieceCid(cidData: Bytes): BigInt {
  let result = validateCommPv2(cidData);
  if (!result.isValid || result.height > 58 || result.height < 2) {
    return BigInt.zero();
  }

  let baseSize = BigInt.fromU32(127).leftShift(result.height - 2);
  if (result.padding.gt(baseSize)) {
    return BigInt.zero();
  }

  return baseSize.minus(result.padding);
}
