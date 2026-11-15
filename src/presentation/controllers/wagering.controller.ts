import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WageringProcessorService } from '../../application/services/wagering-processor.service';
import { WagerTransactionKind, WagerTransactionStatus } from '../../domain/wager-transaction';
import { MoneyProps } from '../../domain/money';
import { WalletEntity } from '../../infrastructure/persistence/entities/wallet.entity';
import { WalletLedgerEntryEntity } from '../../infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WagerTransactionEntity } from '../../infrastructure/persistence/entities/wager-transaction.entity';

@Controller()
export class WageringController {
  constructor(
    private readonly processor: WageringProcessorService,
    private readonly em: EntityManager,
  ) {}

  @Post('wallets')
  async createWallet(@Body() body: { playerId: string; initialBalance: MoneyProps }) {
    return this.processor.createWallet(body.playerId, body.initialBalance);
  }

  @Get('wallets/:walletId')
  async getWallet(@Param('walletId') walletId: string) {
    const wallet = await this.em.findOne(WalletEntity, { id: walletId });
    if (!wallet) throw new NotFoundException(`Wallet ${walletId} not found`);
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: { amount: wallet.balance, currency: wallet.currency },
      version: wallet.version,
    };
  }

  @Get('wallets/:walletId/ledger')
  async getLedger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitRaw = '50',
  ) {
    const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 100);
    const where: Record<string, any> = { walletId };

    if (cursor) {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      where.$or = [
        { createdAt: { $lt: new Date(decoded.createdAt) } },
        { createdAt: new Date(decoded.createdAt), id: { $lt: decoded.id } },
      ];
    }

    const entries = await this.em.find(WalletLedgerEntryEntity, where, {
      orderBy: { createdAt: 'DESC', id: 'DESC' },
      limit: limit + 1,
    });

    const hasNext = entries.length > limit;
    const items = entries.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor =
      hasNext && last
        ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url')
        : null;

    return {
      items: items.map((e) => ({
        id: e.id,
        transactionId: e.transactionId,
        direction: e.direction,
        money: { amount: e.amount, currency: e.currency },
        balanceBefore: { amount: e.balanceBefore, currency: e.currency },
        balanceAfter: { amount: e.balanceAfter, currency: e.currency },
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  @Post('wagering/transactions')
  @HttpCode(HttpStatus.OK)
  async submitTransaction(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body()
    body: {
      providerId: string;
      externalTransactionId: string;
      playerId: string;
      walletId: string;
      roundId: string;
      gameId: string;
      kind: WagerTransactionKind;
      money: MoneyProps;
      referenceExternalTransactionId?: string;
    },
  ) {
    if (!idempotencyKey || !idempotencyKey.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const result = await this.processor.processTransaction({
      ...body,
      idempotencyKey: idempotencyKey.trim(),
    });

    if (result.status === WagerTransactionStatus.PendingReference) {
      return { statusCode: HttpStatus.ACCEPTED, ...result };
    }
    return result;
  }

  @Get('wagering/transactions/:transactionId')
  async getTransaction(@Param('transactionId') transactionId: string) {
    const tx = await this.em.findOne(WagerTransactionEntity, { id: transactionId });
    if (!tx) throw new NotFoundException(`Transaction ${transactionId} not found`);
    return tx;
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  async getProviderTransaction(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    const tx = await this.em.findOne(WagerTransactionEntity, { providerId, externalTransactionId });
    if (!tx) throw new NotFoundException(`Transaction ${providerId}:${externalTransactionId} not found`);
    return tx;
  }

  @Post('wallets/:walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  async reconcile(@Param('walletId') walletId: string) {
    return this.processor.reconcileWallet(walletId);
  }
}
