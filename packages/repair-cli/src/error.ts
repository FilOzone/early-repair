export class NoAlternateProviderError extends Error {
  readonly providerId?: bigint

  /**
   * @param providerId - When set, the explicit target provider was not found or inactive.
   */
  constructor(providerId?: bigint) {
    super(providerId == null ? 'No alternate provider found' : `Target provider ${providerId} not found or inactive`)
    this.name = 'NoAlternateProviderError'
    this.providerId = providerId
  }
}

export class RepairCreationError extends Error {
  constructor(message = 'Failed to create repair row') {
    super(message)
    this.name = 'RepairCreationError'
  }
}

export class RepairNotFoundError extends Error {
  constructor(repairId: number) {
    super(`Repair ${repairId} not found`)
    this.name = 'RepairNotFoundError'
  }
}

export class MissingRepairDataSetError extends Error {
  constructor() {
    super('Missing repair dataset ID')
    this.name = 'MissingRepairDataSetError'
  }
}
