import { describe, expect, it } from 'bun:test';
import { Money } from '../../src/domain/money';
import { Wallet } from '../../src/domain/wallet';
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from '../../src/domain/wager-transaction';

describe('Domain Invariants', () => {
  it('enforces exact 2-decimal precision and rejects invalid Money inputs', () => {
    const a = Money.from({ amount: '10.10', currency: 'BRL' });
    const b = Money.from({ amount: '20.20', currency: 'BRL' });
    expect(a.add(b).toJSON()).toEqual({ amount: '30.30', currency: 'BRL' });

    expect(() => Money.from({ amount: '10.123', currency: 'BRL' })).toThrow();
    expect(() => Money.from({ amount: '1e5', currency: 'BRL' })).toThrow();
    expect(() => Money.from({ amount: '-5.00', currency: 'BRL' })).toThrow();
    expect(() => a.add(Money.from({ amount: '1.00', currency: 'USD' }))).toThrow();
  });

  it('prevents negative balance and increments version only on balance changes', () => {
    const wallet = Wallet.open({
      id: 'w-1',
      playerId: 'p-1',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    expect(wallet.version).toBe(1);

    wallet.debit(Money.from({ amount: '80.00', currency: 'BRL' }));
    expect(wallet.balance.toJSON().amount).toBe('20.00');
    expect(wallet.version).toBe(2);

    expect(() => wallet.debit(Money.from({ amount: '80.00', currency: 'BRL' }))).toThrow();
    expect(wallet.balance.toJSON().amount).toBe('20.00');
    expect(wallet.version).toBe(2);
  });

  it('forbids transitioning terminal WagerTransactions', () => {
    const tx = WagerTransaction.create({
      id: 'tx-1',
      providerId: 'prov',
      externalTransactionId: 'ext-1',
      idempotencyKey: 'prov:ext-1',
      payloadHash: 'hash',
      walletId: 'w-1',
      playerId: 'p-1',
      roundId: 'r-1',
      gameId: 'g-1',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '10.00', currency: 'BRL' }),
    });
    tx.markProcessed(undefined, Money.from({ amount: '90.00', currency: 'BRL' }), new Date());
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(() => tx.reject('ANY' as any)).toThrow();
  });
});
