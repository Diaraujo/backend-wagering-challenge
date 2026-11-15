import { FailureCode, InvalidTransactionStateError } from './errors';
import { Money } from './money';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

export enum LedgerDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
}

export interface WagerTransactionState extends CreateWagerTransactionProps {
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
  observedBalance?: Money;
  retryCount?: number;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
    private _observedBalance?: Money,
    private _retryCount: number = 0,
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (props.kind === WagerTransactionKind.Opening) {
      throw new Error('OPENING transactions cannot be created externally');
    }
    if ((props.kind === WagerTransactionKind.Refund || props.kind === WagerTransactionKind.Rollback) && !props.referenceExternalTransactionId) {
      throw new Error(`${props.kind} requires referenceExternalTransactionId`);
    }
    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  static createOpening(props: {
    id: string;
    walletId: string;
    playerId: string;
    money: Money;
    at: Date;
  }): WagerTransaction {
    return new WagerTransaction(
      props.id,
      'SYSTEM',
      `opening:${props.walletId}`,
      `opening:${props.walletId}`,
      'SYSTEM_OPENING',
      props.walletId,
      props.playerId,
      'OPENING',
      'SYSTEM',
      WagerTransactionKind.Opening,
      props.money,
      undefined,
      props.at,
      WagerTransactionStatus.Processed,
      undefined,
      undefined,
      props.at,
      props.money,
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
      state.observedBalance,
      state.retryCount ?? 0,
    );
  }

  get status(): WagerTransactionStatus { return this._status; }
  get referenceTransactionId(): string | undefined { return this._referenceTransactionId; }
  get failureCode(): FailureCode | undefined { return this._failureCode; }
  get processedAt(): Date | undefined { return this._processedAt; }
  get observedBalance(): Money | undefined { return this._observedBalance; }
  get retryCount(): number { return this._retryCount; }

  markProcessed(referenceTransactionId: string | undefined, observedBalance: Money, at: Date): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(`Transaction ${this.id} is already in terminal state ${this._status}`);
    }
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._observedBalance = observedBalance;
    this._processedAt = at;
  }

  markPendingReference(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(`Transaction ${this.id} is already in terminal state ${this._status}`);
    }
    this._status = WagerTransactionStatus.PendingReference;
    this._retryCount += 1;
  }

  reject(code: FailureCode, observedBalance?: Money): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(`Transaction ${this.id} is already in terminal state ${this._status}`);
    }
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._observedBalance = observedBalance;
    this._processedAt = new Date();
  }

  fail(code: FailureCode): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(`Transaction ${this.id} is already in terminal state ${this._status}`);
    }
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Rollback:
        if (!reference) throw new Error('Rollback requires referenced transaction to determine direction');
        if (reference.kind === WagerTransactionKind.Bet) return LedgerDirection.Credit;
        if (reference.kind === WagerTransactionKind.Win || reference.kind === WagerTransactionKind.Refund) {
          return LedgerDirection.Debit;
        }
        throw new Error(`Unsupported rollback target kind: ${reference.kind}`);
      case WagerTransactionKind.Loss:
        throw new Error('LOSS does not produce a ledger entry');
    }
  }
}
