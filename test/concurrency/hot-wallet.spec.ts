import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../mikro-orm.config';
import { WageringProcessorService } from '../../src/application/services/wagering-processor.service';
import { MetricsService } from '../../src/infrastructure/observability/metrics.service';
import { WagerTransactionKind, WagerTransactionStatus } from '../../src/domain/wager-transaction';
import { randomUUID } from 'crypto';

describe('Concurrency & Race Conditions (PostgreSQL Real)', () => {
  let orm: MikroORM;

  beforeEach(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
  });

  afterEach(async () => {
    await orm.close();
  });

  it('processes 50 parallel duplicate bets as exactly 1 debit and 49 idempotent replays', async () => {
    const service = new WageringProcessorService(orm.em.fork(), new MetricsService());

    const playerId = randomUUID();
    // Criação síncrona da carteira garantindo o commit do registro pai (wallets)
    const wallet = await service.createWallet(playerId, { amount: '100.00', currency: 'BRL' });
    const extId = `bet-${randomUUID()}`;

    const results = await Promise.all(
      Array.from({ length: 50 }).map(() =>
        new WageringProcessorService(orm.em.fork(), new MetricsService()).processTransaction({
          providerId: 'provider-a',
          externalTransactionId: extId,
          idempotencyKey: `provider-a:${extId}`,
          playerId,
          walletId: wallet.id,
          roundId: 'round-1',
          gameId: 'fortune-chimp',
          kind: WagerTransactionKind.Bet,
          money: { amount: '80.00', currency: 'BRL' },
        }),
      ),
    );

    const processed = results.filter((r) => r.status === WagerTransactionStatus.Processed);
    expect(processed.length).toBe(50);
    const reconciliation = await service.reconcileWallet(wallet.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.amount).toBe('20.00');
  });

  it('allows only one of two simultaneous 80.00 BRL bets on a 100.00 BRL wallet', async () => {
    const service = new WageringProcessorService(orm.em.fork(), new MetricsService());

    const playerId = randomUUID();
    const wallet = await service.createWallet(playerId, { amount: '100.00', currency: 'BRL' });

    const [r1, r2] = await Promise.all(
      ['bet-a', 'bet-b'].map((suffix) => {
        const extId = `${suffix}-${randomUUID()}`;
        return new WageringProcessorService(orm.em.fork(), new MetricsService()).processTransaction({
          providerId: 'provider-a',
          externalTransactionId: extId,
          idempotencyKey: `provider-a:${extId}`,
          playerId,
          walletId: wallet.id,
          roundId: 'round-race',
          gameId: 'fortune-chimp',
          kind: WagerTransactionKind.Bet,
          money: { amount: '80.00', currency: 'BRL' },
        });
      }),
    );

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([WagerTransactionStatus.Processed, WagerTransactionStatus.Rejected]);

    const reconciliation = await service.reconcileWallet(wallet.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.amount).toBe('20.00');
  });
});