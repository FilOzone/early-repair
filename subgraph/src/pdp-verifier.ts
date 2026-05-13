import { BigInt } from "@graphprotocol/graph-ts";
import { DataSetDeleted, PiecesRemoved } from "../generated/PDPVerifier/PDPVerifier";
import { DataSet, Piece, PieceReplica } from "../generated/schema";

function dataSetEntityId(dataSetId: BigInt): string {
  return dataSetId.toString();
}

function replicaEntityId(dataSetId: BigInt, pieceId: BigInt): string {
  return dataSetId.toString() + "-" + pieceId.toString();
}

function decrement(value: BigInt): BigInt {
  if (value.gt(BigInt.zero())) {
    return value.minus(BigInt.fromI32(1));
  }

  return BigInt.zero();
}

export function handlePiecesRemoved(event: PiecesRemoved): void {
  let dataSet = DataSet.load(dataSetEntityId(event.params.setId));
  if (dataSet == null) {
    return;
  }

  for (let i = 0; i < event.params.pieceIds.length; i++) {
    let replica = PieceReplica.load(replicaEntityId(event.params.setId, event.params.pieceIds[i]));
    if (replica == null || replica.removed) {
      continue;
    }

    replica.removed = true;
    replica.removedAt = event.block.timestamp;
    replica.removedAtBlock = event.block.number;
    replica.removedTransactionHash = event.transaction.hash;
    replica.save();

    let piece = Piece.load(replica.piece);
    if (piece != null) {
      piece.activeReplicaCount = decrement(piece.activeReplicaCount);
      piece.lastSeenAt = event.block.timestamp;
      piece.lastSeenAtBlock = event.block.number;
      piece.save();
    }

    dataSet.activePieces = decrement(dataSet.activePieces);
  }

  dataSet.isEmpty = dataSet.activePieces.equals(BigInt.zero());
  dataSet.updatedAt = event.block.timestamp;
  dataSet.updatedAtBlock = event.block.number;
  dataSet.save();
}

export function handleDataSetDeleted(event: DataSetDeleted): void {
  let dataSet = DataSet.load(dataSetEntityId(event.params.setId));
  if (dataSet == null) {
    return;
  }

  dataSet.isDeleted = true;
  dataSet.isActive = false;
  dataSet.updatedAt = event.block.timestamp;
  dataSet.updatedAtBlock = event.block.number;
  dataSet.save();
}
