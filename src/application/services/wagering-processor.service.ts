import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import { Money, MoneyProps } from '../../domain/money';
import { Wallet } from '../../domain/wallet';
import {
  LedgerDirection,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wager-transaction';
import { WalletLedgerEntry } from '../../domain/wallet-ledger-entry';
import { InboxMessage } from '../../domain/inbox-message';
import { OutboxMessage } from '../../domain/outbox-message';
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from '../../domain/events/integration-events';
import { DomainError, FailureCode, IdempotencyConflictError } from '../../domain/errors';
import { WalletEntity } from '../../infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionEntity } from '../../infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { InboxMessageEntity } from '../../infrastructure/persistence/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../infrastructure/persistence/entities/outbox-message.entity';
import { computePayloadHash } from '../utils/canonical-hash';
import { MetricsService } from '../../infrastructure/observability/metrics.service';

export interface SubmitWagerCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  correlationId?: string;
  inboxContext?: {
    messageId: string;
    consumerName: string;
  };
}

export interface SubmitWagerResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance?: MoneyProps;
  failureCode?: FailureCode;
  idempotentReplay: boolean;
}

@Injectable()
export class WageringProcessorService {
  private readonly logger = new Logger(WageringProcessorService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly metrics: MetricsService,
  ) {}

  async createWallet(playerId: string, initialBalanceProps: MoneyProps) {
    const initialMoney = Money.from(initialBalanceProps, false);
    const now = new Date();
    const walletId = randomUUID();
    const wallet = Wallet.open({
      id: walletId,
      playerId,
      initialBalance: initialMoney,
    });

    return this.em.transactional(async (txEm) => {
      const existing = await txEm.findOne(WalletEntity, { playerId, currency: initialMoney.currency });
      if (existing) {
        throw new ConflictException(`Wallet already exists for player ${playerId} and currency ${initialMoney.currency}`);
      }

      const walletEntity = txEm.create(WalletEntity, {
        id: wallet.id,
        playerId: wallet.playerId,
        currency: wallet.currency,
        balance: wallet.balance.toJSON().amount,
        version: wallet.version,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
      });
      txEm.persist(walletEntity);
      await txEm.flush();

      if (initialMoney.isPositive()) {
        const openingTx = WagerTransaction.createOpening({
          id: randomUUID(),
          walletId: wallet.id,
          playerId,
          money: initialMoney,
          at: now,
        });

        const txEntity = this.toTransactionEntity(txEm, openingTx);
        txEm.persist(txEntity);
        await txEm.flush();

        const entry = WalletLedgerEntry.create({
          id: randomUUID(),
          walletId: wallet.id,
          transactionId: openingTx.id,
          direction: LedgerDirection.Credit,
          money: initialMoney,
          balanceBefore: Money.zero(initialMoney.currency),
          balanceAfter: initialMoney,
        });

        const entryEntity = this.toLedgerEntity(txEm, entry);
        txEm.persist(entryEntity);

        const event = WalletBalanceChanged.from(wallet, entry, {
          eventId: randomUUID(),
          correlationId: openingTx.id,
          causationId: openingTx.id,
          occurredAt: now,
        });
        txEm.persist(this.toOutboxEntity(txEm, OutboxMessage.enqueue(event)));

        await txEm.flush();
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }

  async processTransaction(cmd: SubmitWagerCommand): Promise<SubmitWagerResult> {
    const start = Date.now();
    const money = Money.from(cmd.money, false);
    const payloadHash = computePayloadHash({
      providerId: cmd.providerId,
      externalTransactionId: cmd.externalTransactionId,
      playerId: cmd.playerId,
      walletId: cmd.walletId,
      roundId: cmd.roundId,
      gameId: cmd.gameId,
      kind: cmd.kind,
      money: money.toJSON(),
      referenceExternalTransactionId: cmd.referenceExternalTransactionId,
    });
    const correlationId = cmd.correlationId || cmd.idempotencyKey;

    try {
      const result = await this.em.transactional(async (txEm) => {
        // 1. Persistent Idempotency Check FIRST (evita fila de lock pessimista em requisições paralelas repetidas)
        const existingTxEntity = await txEm.findOne(WagerTransactionEntity, {
          idempotencyKey: cmd.idempotencyKey,
        });

        if (existingTxEntity) {
          if (existingTxEntity.payloadHash !== payloadHash) {
            this.metrics.inc('idempotency_conflicts_total');
            throw new IdempotencyConflictError(cmd.idempotencyKey);
          }
          this.metrics.inc('idempotent_replays_total');
          if (cmd.inboxContext) {
            await this.upsertInboxProcessed(txEm, cmd.inboxContext.messageId, cmd.inboxContext.consumerName, payloadHash);
          }

          const walletEntityForReplay = await txEm.findOne(WalletEntity, { id: cmd.walletId }, { refresh: true });
          const currentBalance = walletEntityForReplay
            ? { amount: walletEntityForReplay.balance, currency: walletEntityForReplay.currency }
            : (existingTxEntity.observedBalance ? { amount: existingTxEntity.observedBalance, currency: existingTxEntity.currency } : undefined);

          return {
            transactionId: existingTxEntity.id,
            status: existingTxEntity.status as WagerTransactionStatus,
            balance: currentBalance,
            failureCode: existingTxEntity.failureCode as FailureCode | undefined,
            idempotentReplay: true,
          };
        }

        // 2. Pessimistic Lock on Wallet row (apenas para transações novas que precisam alterar saldo)
        const walletEntity = await txEm.findOne(
          WalletEntity,
          { id: cmd.walletId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );

        if (!walletEntity) {
          throw new NotFoundException(`Wallet ${cmd.walletId} not found`);
        }

        if (cmd.inboxContext) {
          const existingInbox = await txEm.findOne(InboxMessageEntity, {
            messageId: cmd.inboxContext.messageId,
            consumerName: cmd.inboxContext.consumerName,
          });
          if (existingInbox?.processedAt) {
            this.metrics.inc('inbox_duplicates_total');
            const existingTx = await txEm.findOne(WagerTransactionEntity, { idempotencyKey: cmd.idempotencyKey });
            if (existingTx) {
              const walletEntityForReplay = await txEm.findOne(WalletEntity, { id: cmd.walletId }, { refresh: true });
              const currentBalance = walletEntityForReplay
                ? { amount: walletEntityForReplay.balance, currency: walletEntityForReplay.currency }
                : undefined;
              return this.buildReplayResponse(existingTx, currentBalance);
            }
          }
        }

        const wallet = Wallet.rehydrate({
          id: walletEntity.id,
          playerId: walletEntity.playerId,
          currency: walletEntity.currency,
          balance: Money.from({ amount: walletEntity.balance, currency: walletEntity.currency }),
          version: walletEntity.version,
          createdAt: walletEntity.createdAt,
          updatedAt: walletEntity.updatedAt,
        });

        const txDomain = WagerTransaction.create({
          id: randomUUID(),
          providerId: cmd.providerId,
          externalTransactionId: cmd.externalTransactionId,
          idempotencyKey: cmd.idempotencyKey,
          payloadHash,
          walletId: cmd.walletId,
          playerId: cmd.playerId,
          roundId: cmd.roundId,
          gameId: cmd.gameId,
          kind: cmd.kind,
          money,
          referenceExternalTransactionId: cmd.referenceExternalTransactionId,
        });

        await this.evaluateAndApply(txEm, wallet, walletEntity, txDomain, correlationId);

        if (cmd.inboxContext) {
          await this.upsertInboxProcessed(txEm, cmd.inboxContext.messageId, cmd.inboxContext.consumerName, payloadHash);
        }

        await txEm.flush();
        this.metrics.inc(`transactions_${txDomain.status.toLowerCase()}_total`);

        this.logger.log(
          JSON.stringify({
            msg: 'Wager transaction evaluated',
            correlationId,
            messageId: cmd.inboxContext?.messageId,
            transactionId: txDomain.id,
            walletId: txDomain.walletId,
            providerId: txDomain.providerId,
            status: txDomain.status,
          }),
        );

        return {
          transactionId: txDomain.id,
          status: txDomain.status,
          balance: txDomain.observedBalance?.toJSON() ?? wallet.balance.toJSON(),
          failureCode: txDomain.failureCode,
          idempotentReplay: false,
        };
      });

      this.metrics.observeLatency(Date.now() - start);
      return result;
    } catch (err: any) {
      if (err?.code === '23505' && String(err?.constraint).includes('idempotency')) {
        const raced = await this.em.findOneOrFail(WagerTransactionEntity, { idempotencyKey: cmd.idempotencyKey });
        if (raced.payloadHash !== payloadHash) {
          throw new IdempotencyConflictError(cmd.idempotencyKey);
        }
        const walletEntityForReplay = await this.em.findOne(WalletEntity, { id: cmd.walletId }, { refresh: true });
        const currentBalance = walletEntityForReplay
          ? { amount: walletEntityForReplay.balance, currency: walletEntityForReplay.currency }
          : undefined;
        return this.buildReplayResponse(raced, currentBalance);
      }
      throw err;
    }
  }

  private async evaluateAndApply(
    txEm: EntityManager,
    wallet: Wallet,
    walletEntity: WalletEntity,
    txDomain: WagerTransaction,
    correlationId: string,
  ): Promise<void> {
    const now = new Date();
    let referencedTx: WagerTransaction | undefined;

    if (wallet.currency !== txDomain.money.currency) {
      txDomain.reject(FailureCode.CURRENCY_MISMATCH, wallet.balance);
      await this.persistRejected(txEm, txDomain, correlationId, now);
      return;
    }

    if (txDomain.requiresReference() || txDomain.referenceExternalTransactionId) {
      const refEntity = await txEm.findOne(WagerTransactionEntity, {
        providerId: txDomain.providerId,
        externalTransactionId: txDomain.referenceExternalTransactionId!,
      });

      if (!refEntity || refEntity.status === WagerTransactionStatus.PendingReference) {
        if (txDomain.requiresReference()) {
          txDomain.markPendingReference();
          txEm.persist(this.toTransactionEntity(txEm, txDomain));
          await txEm.flush();
          const event = WagerTransactionPendingReference.from(txDomain, {
            eventId: randomUUID(),
            correlationId,
            causationId: txDomain.id,
            occurredAt: now,
          });
          txEm.persist(this.toOutboxEntity(txEm, OutboxMessage.enqueue(event)));
          return;
        }
      } else {
        referencedTx = WagerTransaction.rehydrate({
          id: refEntity.id,
          providerId: refEntity.providerId,
          externalTransactionId: refEntity.externalTransactionId,
          idempotencyKey: refEntity.idempotencyKey,
          payloadHash: refEntity.payloadHash,
          walletId: refEntity.walletId,
          playerId: refEntity.playerId,
          roundId: refEntity.roundId,
          gameId: refEntity.gameId,
          kind: refEntity.kind as WagerTransactionKind,
          money: Money.from({ amount: refEntity.amount, currency: refEntity.currency }),
          referenceExternalTransactionId: refEntity.referenceExternalTransactionId,
          createdAt: refEntity.createdAt,
          status: refEntity.status as WagerTransactionStatus,
        });

        const validationError = await this.validateReference(txEm, txDomain, referencedTx);
        if (validationError) {
          txDomain.reject(validationError, wallet.balance);
          await this.persistRejected(txEm, txDomain, correlationId, now);
          return;
        }
      }
    }

    if (!txDomain.affectsBalance()) {
      txDomain.markProcessed(referencedTx?.id, wallet.balance, now);
      txEm.persist(this.toTransactionEntity(txEm, txDomain));
      await txEm.flush();
      const processedEvent = WagerTransactionProcessed.from(txDomain, wallet.balance.toJSON(), {
        eventId: randomUUID(),
        correlationId,
        causationId: txDomain.id,
        occurredAt: now,
      });
      txEm.persist(this.toOutboxEntity(txEm, OutboxMessage.enqueue(processedEvent)));
      return;
    }

    try {
      const direction = txDomain.ledgerDirectionFor(referencedTx);
      const isReversal =
        txDomain.kind === WagerTransactionKind.Refund || txDomain.kind === WagerTransactionKind.Rollback;

      const movement =
        direction === LedgerDirection.Debit
          ? wallet.debit(txDomain.money, isReversal)
          : wallet.credit(txDomain.money);

      const newBalanceAmount = wallet.balance.toJSON().amount;

      await txEm.nativeUpdate(
        WalletEntity,
        { id: walletEntity.id },
        {
          balance: newBalanceAmount,
          version: wallet.version,
          updatedAt: wallet.updatedAt,
        },
      );

      txDomain.markProcessed(referencedTx?.id, wallet.balance, now);

      txEm.persist(this.toTransactionEntity(txEm, txDomain));
      await txEm.flush();

      const ledgerEntry = WalletLedgerEntry.create({
        id: randomUUID(),
        walletId: wallet.id,
        transactionId: txDomain.id,
        direction,
        money: txDomain.money,
        balanceBefore: movement.balanceBefore,
        balanceAfter: movement.balanceAfter,
      });
      txEm.persist(this.toLedgerEntity(txEm, ledgerEntry));
      await txEm.flush();

      const balanceEvent = WalletBalanceChanged.from(wallet, ledgerEntry, {
        eventId: randomUUID(),
        correlationId,
        causationId: txDomain.id,
        occurredAt: now,
      });
      const processedEvent = WagerTransactionProcessed.from(txDomain, wallet.balance.toJSON(), {
        eventId: randomUUID(),
        correlationId,
        causationId: txDomain.id,
        occurredAt: now,
      });

      txEm.persist(this.toOutboxEntity(txEm, OutboxMessage.enqueue(balanceEvent)));
      txEm.persist(this.toOutboxEntity(txEm, OutboxMessage.enqueue(processedEvent)));
    } catch (err) {
      if (err instanceof DomainError) {
        txDomain.reject(err.code as FailureCode, wallet.balance);
        await this.persistRejected(txEm, txDomain, correlationId, now);
        return;
      }
      throw err;
    }
  }

  private async validateReference(
    txEm: EntityManager,
    tx: WagerTransaction,
    ref: WagerTransaction,
  ): Promise<FailureCode | null> {
    if (ref.status !== WagerTransactionStatus.Processed) {
      return FailureCode.INVALID_REFERENCE_KIND;
    }
    if (
      ref.providerId !== tx.providerId ||
      ref.playerId !== tx.playerId ||
      ref.walletId !== tx.walletId ||
      ref.roundId !== tx.roundId ||
      ref.money.currency !== tx.money.currency
    ) {
      return FailureCode.REFERENCE_CONTEXT_MISMATCH;
    }
    if (tx.requiresReference() && !ref.money.equals(tx.money)) {
      return FailureCode.REFERENCE_AMOUNT_MISMATCH;
    }
    if (tx.kind === WagerTransactionKind.Refund && ref.kind !== WagerTransactionKind.Bet) {
      return FailureCode.INVALID_REFERENCE_KIND;
    }
    if (
      tx.kind === WagerTransactionKind.Rollback &&
      ![WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Refund].includes(ref.kind)
    ) {
      return FailureCode.INVALID_REFERENCE_KIND;
    }
    if (tx.requiresReference()) {
      const duplicateReversal = await txEm.findOne(WagerTransactionEntity, {
        referenceTransactionId: ref.id,
        kind: tx.kind,
        status: WagerTransactionStatus.Processed,
      });
      if (duplicateReversal) {
        return FailureCode.ALREADY_REVERSED;
      }
    }
    return null;
  }

  private async persistRejected(
    txEm: EntityManager,
    txDomain: WagerTransaction,
    correlationId: string,
    now: Date,
  ): Promise<void> {
    txEm.persist(this.toTransactionEntity(txEm, txDomain));
    await txEm.flush();
    const rejectedEvent = WagerTransactionRejected.from(txDomain, {
      eventId: randomUUID(),
      correlationId,
      causationId: txDomain.id,
      occurredAt: now,
    });
    txEm.persist(this.toOutboxEntity(txEm, OutboxMessage.enqueue(rejectedEvent)));
  }

  async reconcileWallet(walletId: string) {
    const wallet = await this.em.findOne(WalletEntity, { id: walletId }, { refresh: true });
    if (!wallet) throw new NotFoundException(`Wallet ${walletId} not found`);

    const entries = await this.em.find(WalletLedgerEntryEntity, { walletId }, { refresh: true });
    let calculated = Money.zero(wallet.currency);
    for (const entry of entries) {
      const m = Money.from({ amount: entry.amount, currency: entry.currency });
      calculated = entry.direction === LedgerDirection.Credit ? calculated.add(m) : calculated.subtract(m);
    }

    const stored = Money.from({ amount: wallet.balance, currency: wallet.currency });
    const consistent = stored.equals(calculated);
    const diff = stored.subtract(calculated);

    if (!consistent) {
      this.metrics.inc('reconciliation_divergences_total');
      this.logger.error(
        JSON.stringify({
          msg: 'Wallet reconciliation divergence detected',
          walletId,
          storedBalance: stored.toJSON(),
          calculatedBalance: calculated.toJSON(),
        }),
      );
    }

    return {
      walletId,
      storedBalance: stored.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: diff.toJSON(),
      consistent,
      checkedEntries: entries.length,
    };
  }

  private buildReplayResponse(entity: WagerTransactionEntity, balance?: MoneyProps): SubmitWagerResult {
    return {
      transactionId: entity.id,
      status: entity.status as WagerTransactionStatus,
      balance: balance || (entity.observedBalance ? { amount: entity.observedBalance, currency: entity.currency } : undefined),
      failureCode: entity.failureCode as FailureCode | undefined,
      idempotentReplay: true,
    };
  }

  private async upsertInboxProcessed(txEm: EntityManager, messageId: string, consumerName: string, payloadHash: string) {
    const inbox = InboxMessage.receive({ messageId, consumerName, payloadHash });
    inbox.markProcessed(new Date());
    txEm.upsert(InboxMessageEntity, {
      messageId: inbox.messageId,
      consumerName: inbox.consumerName,
      payloadHash: inbox.payloadHash,
      receivedAt: inbox.receivedAt,
      processedAt: inbox.processedAt,
    });
  }

  private toTransactionEntity(txEm: EntityManager, tx: WagerTransaction): WagerTransactionEntity {
    return txEm.create(WagerTransactionEntity, {
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      idempotencyKey: tx.idempotencyKey,
      payloadHash: tx.payloadHash,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      amount: tx.money.toJSON().amount,
      currency: tx.money.currency,
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
      referenceTransactionId: tx.referenceTransactionId,
      status: tx.status,
      failureCode: tx.failureCode,
      observedBalance: tx.observedBalance?.toJSON().amount,
      retryCount: tx.retryCount,
      createdAt: tx.createdAt,
      processedAt: tx.processedAt,
    });
  }

  private toLedgerEntity(txEm: EntityManager, entry: WalletLedgerEntry): WalletLedgerEntryEntity {
    return txEm.create(WalletLedgerEntryEntity, {
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      amount: entry.money.toJSON().amount,
      currency: entry.money.currency,
      balanceBefore: entry.balanceBefore.toJSON().amount,
      balanceAfter: entry.balanceAfter.toJSON().amount,
      createdAt: entry.createdAt,
    });
  }

  private toOutboxEntity(txEm: EntityManager, outbox: OutboxMessage): OutboxMessageEntity {
    return txEm.create(OutboxMessageEntity, {
      id: outbox.id,
      aggregateId: outbox.aggregateId,
      eventType: outbox.eventType,
      payload: outbox.payload as Record<string, unknown>,
      occurredAt: outbox.occurredAt,
      attempts: outbox.attempts,
      nextAttemptAt: outbox.nextAttemptAt,
      publishedAt: outbox.publishedAt,
    });
  }
}