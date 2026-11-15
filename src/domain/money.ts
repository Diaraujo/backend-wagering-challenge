import Decimal from 'decimal.js';

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {
    this.value = value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  static from(props: MoneyProps, allowNegative = false): Money {
    if (!props || typeof props.amount !== 'string' || typeof props.currency !== 'string') {
      throw new Error('Invalid MoneyProps format');
    }
    const trimmed = props.amount.trim();
    if (!trimmed || /[eE]/.test(trimmed) || !/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
      throw new Error(`Invalid decimal string: "${props.amount}"`);
    }
    const dec = new Decimal(trimmed);
    if (!dec.isFinite()) {
      throw new Error(`Non-finite amount: "${props.amount}"`);
    }
    if (!allowNegative && dec.isNegative()) {
      throw new Error(`Negative amount not allowed in input: "${props.amount}"`);
    }
    const currency = props.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error(`Invalid ISO-4217 currency: "${props.currency}"`);
    }
    return new Money(dec, currency);
  }

  static zero(currency: string): Money {
    return new Money(new Decimal('0.00'), currency.trim().toUpperCase());
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    if (!other) return false;
    return this.currency === other.currency && this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.value.toFixed(2),
      currency: this.currency,
    };
  }

  toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}
