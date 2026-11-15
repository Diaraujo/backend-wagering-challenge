export enum FailureCode {
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  NEGATIVE_BALANCE_ON_REVERSAL = 'NEGATIVE_BALANCE_ON_REVERSAL',
  CURRENCY_MISMATCH = 'CURRENCY_MISMATCH',
  REFERENCE_NOT_FOUND = 'REFERENCE_NOT_FOUND',
  REFERENCE_EXPIRED = 'REFERENCE_EXPIRED',
  INVALID_REFERENCE_KIND = 'INVALID_REFERENCE_KIND',
  REFERENCE_CONTEXT_MISMATCH = 'REFERENCE_CONTEXT_MISMATCH',
  REFERENCE_AMOUNT_MISMATCH = 'REFERENCE_AMOUNT_MISMATCH',
  ALREADY_REVERSED = 'ALREADY_REVERSED',
  WALLET_NOT_FOUND = 'WALLET_NOT_FOUND',
  IDEMPOTENCY_PAYLOAD_CONFLICT = 'IDEMPOTENCY_PAYLOAD_CONFLICT',
}

export class DomainError extends Error {
  constructor(
    public readonly code: FailureCode | string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class InvalidTransactionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransactionStateError';
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor(key: string) {
    super(FailureCode.IDEMPOTENCY_PAYLOAD_CONFLICT, `Idempotency key '${key}' already used with a different payload.`);
  }
}
