export class NoAlternateProviderError extends Error {
  constructor() {
    super('No alternate provider found')
    this.name = 'NoAlternateProviderError'
  }
}

export class RepairCreationError extends Error {
  constructor(message = 'Failed to create repair row') {
    super(message)
    this.name = 'RepairCreationError'
  }
}
