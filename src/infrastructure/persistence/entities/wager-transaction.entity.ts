import { Entity, PrimaryKey, Property, Unique, Index } from '@mikro-orm/core';

@Entity({ tableName: 'wager_transactions' })
@Unique({ properties: ['idempotencyKey'] })
@Unique({ properties: ['providerId', 'externalTransactionId'] })
export class WagerTransactionEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'varchar', length: 64, fieldName: 'provider_id' })
  providerId!: string;

  @Property({ type: 'varchar', length: 128, fieldName: 'external_transaction_id' })
  externalTransactionId!: string;

  @Property({ type: 'varchar', length: 256, fieldName: 'idempotency_key' })
  idempotencyKey!: string;

  @Property({ type: 'varchar', length: 64, fieldName: 'payload_hash' })
  payloadHash!: string;

  @Index()
  @Property({ type: 'uuid', fieldName: 'wallet_id' })
  walletId!: string;

  @Property({ type: 'uuid', fieldName: 'player_id' })
  playerId!: string;

  @Index()
  @Property({ type: 'varchar', length: 128, fieldName: 'round_id' })
  roundId!: string;

  @Property({ type: 'varchar', length: 128, fieldName: 'game_id' })
  gameId!: string;

  @Property({ type: 'varchar', length: 24 })
  kind!: string;

  @Property({ type: 'numeric', precision: 19, scale: 2 })
  amount!: string;

  @Property({ type: 'varchar', length: 3 })
  currency!: string;

  @Property({ type: 'varchar', length: 128, nullable: true, fieldName: 'reference_external_transaction_id' })
  referenceExternalTransactionId?: string;

  @Property({ type: 'uuid', nullable: true, fieldName: 'reference_transaction_id' })
  referenceTransactionId?: string;

  @Index()
  @Property({ type: 'varchar', length: 32 })
  status!: string;

  @Property({ type: 'varchar', length: 64, nullable: true, fieldName: 'failure_code' })
  failureCode?: string;

  @Property({ type: 'numeric', precision: 19, scale: 2, nullable: true, fieldName: 'observed_balance' })
  observedBalance?: string;

  @Property({ type: 'int', default: 0, fieldName: 'retry_count' })
  retryCount!: number;

  @Property({ type: 'timestamptz', fieldName: 'created_at' })
  createdAt!: Date;

  @Property({ type: 'timestamptz', nullable: true, fieldName: 'processed_at' })
  processedAt?: Date;
}
