import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  DataSetCreated,
  PDPPaymentTerminated,
  PieceAdded,
  ServiceTerminated,
} from "../generated/FilecoinWarmStorageService/FilecoinWarmStorageService";
import { DataSet, Piece, PieceReplica } from "../generated/schema";
import { rawSizeFromPieceCid } from "../utils/cid";

function dataSetEntityId(dataSetId: BigInt): string {
  return dataSetId.toString();
}

function replicaEntityId(dataSetId: BigInt, pieceId: BigInt): string {
  return dataSetId.toString() + "-" + pieceId.toString();
}

function metadataValue(keys: string[], values: string[], key: string): string {
  for (let i = 0; i < keys.length && i < values.length; i++) {
    if (keys[i] == key) {
      return values[i];
    }
  }

  return "";
}

function metadataHasKey(keys: string[], key: string): boolean {
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] == key) {
      return true;
    }
  }

  return false;
}

function ensureDataSet(dataSetId: BigInt): DataSet {
  let id = dataSetEntityId(dataSetId);
  let dataSet = DataSet.load(id);
  if (dataSet != null) {
    return dataSet;
  }

  dataSet = new DataSet(id);
  dataSet.dataSetId = dataSetId;
  dataSet.providerId = BigInt.zero();
  dataSet.payer = Address.zero();
  dataSet.payee = Address.zero();
  dataSet.serviceProvider = Address.zero();
  dataSet.pdpRailId = BigInt.zero();
  dataSet.cacheMissRailId = BigInt.zero();
  dataSet.cdnRailId = BigInt.zero();
  dataSet.metadataKeys = [];
  dataSet.metadataValues = [];
  dataSet.source = "";
  dataSet.withCDN = false;
  dataSet.withIPFSIndexing = false;
  dataSet.initialized = false;
  dataSet.isActive = false;
  dataSet.isDeleted = false;
  dataSet.pdpPaymentTerminated = false;
  dataSet.pdpEndEpoch = BigInt.zero();
  dataSet.totalPieces = BigInt.zero();
  dataSet.activePieces = BigInt.zero();
  dataSet.isEmpty = false;
  dataSet.createdAt = BigInt.zero();
  dataSet.updatedAt = BigInt.zero();
  dataSet.createdAtBlock = BigInt.zero();
  dataSet.updatedAtBlock = BigInt.zero();
  return dataSet;
}

export function handleDataSetCreated(event: DataSetCreated): void {
  let dataSet = ensureDataSet(event.params.dataSetId);

  dataSet.providerId = event.params.providerId;
  dataSet.pdpRailId = event.params.pdpRailId;
  dataSet.cacheMissRailId = event.params.cacheMissRailId;
  dataSet.cdnRailId = event.params.cdnRailId;
  dataSet.payer = event.params.payer;
  dataSet.payee = event.params.payee;
  dataSet.serviceProvider = event.params.serviceProvider;
  dataSet.metadataKeys = event.params.metadataKeys;
  dataSet.metadataValues = event.params.metadataValues;
  dataSet.source = metadataValue(event.params.metadataKeys, event.params.metadataValues, "source");
  dataSet.withCDN = metadataHasKey(event.params.metadataKeys, "withCDN");
  dataSet.withIPFSIndexing = metadataHasKey(event.params.metadataKeys, "withIPFSIndexing");
  dataSet.initialized = true;
  dataSet.isActive = true;
  dataSet.isDeleted = false;
  dataSet.createdAt = event.block.timestamp;
  dataSet.updatedAt = event.block.timestamp;
  dataSet.createdAtBlock = event.block.number;
  dataSet.updatedAtBlock = event.block.number;
  dataSet.save();
}

export function handlePieceAdded(event: PieceAdded): void {
  let dataSet = ensureDataSet(event.params.dataSetId);
  let cid = event.params.pieceCid.data;
  let cidHex = cid.toHexString();
  let rawSize = rawSizeFromPieceCid(cid);

  let piece = Piece.load(cidHex);
  if (piece == null) {
    piece = new Piece(cidHex);
    piece.cid = cid;
    piece.rawSize = rawSize;
    piece.replicaCount = BigInt.zero();
    piece.activeReplicaCount = BigInt.zero();
    piece.firstSeenAt = event.block.timestamp;
    piece.firstSeenAtBlock = event.block.number;
  }

  piece.replicaCount = piece.replicaCount.plus(BigInt.fromI32(1));
  piece.activeReplicaCount = piece.activeReplicaCount.plus(BigInt.fromI32(1));
  piece.lastSeenAt = event.block.timestamp;
  piece.lastSeenAtBlock = event.block.number;
  piece.save();

  let replica = new PieceReplica(replicaEntityId(event.params.dataSetId, event.params.pieceId));
  replica.piece = piece.id;
  replica.dataSet = dataSet.id;
  replica.dataSetId = event.params.dataSetId;
  replica.providerId = dataSet.providerId;
  replica.pieceId = event.params.pieceId;
  replica.cid = cid;
  replica.rawSize = rawSize;
  replica.metadataKeys = event.params.keys;
  replica.metadataValues = event.params.values;
  replica.addedAt = event.block.timestamp;
  replica.addedAtBlock = event.block.number;
  replica.transactionHash = event.transaction.hash;
  replica.logIndex = event.logIndex;
  replica.removed = false;
  replica.save();

  dataSet.totalPieces = dataSet.totalPieces.plus(BigInt.fromI32(1));
  dataSet.activePieces = dataSet.activePieces.plus(BigInt.fromI32(1));
  dataSet.isEmpty = false;
  dataSet.updatedAt = event.block.timestamp;
  dataSet.updatedAtBlock = event.block.number;
  dataSet.save();
}

export function handlePDPPaymentTerminated(event: PDPPaymentTerminated): void {
  let dataSet = ensureDataSet(event.params.dataSetId);
  dataSet.pdpPaymentTerminated = true;
  dataSet.pdpEndEpoch = event.params.endEpoch;
  dataSet.updatedAt = event.block.timestamp;
  dataSet.updatedAtBlock = event.block.number;
  dataSet.save();
}

export function handleServiceTerminated(event: ServiceTerminated): void {
  let dataSet = ensureDataSet(event.params.dataSetId);
  dataSet.isActive = false;
  dataSet.pdpPaymentTerminated = true;
  dataSet.updatedAt = event.block.timestamp;
  dataSet.updatedAtBlock = event.block.number;
  dataSet.save();
}
