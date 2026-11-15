import { DomainError, FailureCode } from './errors';
import { Money } from './money';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: { id: string; playerId: string; initialBalance: Money }): Wallet {
    const now = new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now,
    );
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money { return this._balance; }
  get version(): number { return this._version; }
  get updatedAt(): Date { return this._updatedAt; }

  debit(amount: Money, isReversal = false): { balanceBefore: Money; balanceAfter: Money } {
    this.assertSameCurrency(amount);
    if (!amount.isPositive()) {
      throw new Error('Debit amount must be strictly positive');
    }
    if (this._balance.isLessThan(amount)) {
      throw new DomainError(
        isReversal ? FailureCode.NEGATIVE_BALANCE_ON_REVERSAL : FailureCode.INSUFFICIENT_FUNDS,
        `Insufficient balance in wallet ${this.id}`,
      );
    }
    const balanceBefore = this._balance;
    this._balance = this._balance.subtract(amount);
    this._version += 1;
    this._updatedAt = new Date();
    return { balanceBefore, balanceAfter: this._balance };
  }

  credit(amount: Money): { balanceBefore: Money; balanceAfter: Money } {
    this.assertSameCurrency(amount);
    if (!amount.isPositive()) {
      throw new Error('Credit amount must be strictly positive');
    }
    const balanceBefore = this._balance;
    this._balance = this._balance.add(amount);
    this._version += 1;
    this._updatedAt = new Date();
    return { balanceBefore, balanceAfter: this._balance };
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new DomainError(
        FailureCode.CURRENCY_MISMATCH,
        `Wallet currency ${this.currency} does not match ${money.currency}`,
      );
    }
  }
}
