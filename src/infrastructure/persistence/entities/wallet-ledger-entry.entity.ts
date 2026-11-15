import { Entity, PrimaryKey, Property, Unique, Index } from '@mikro-orm/core';

@Entity({ tableName: 'wallet_ledger_entries' })
@Unique({ properties: ['walletId', 'transactionId'] })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Index()
  @Property({ type: 'uuid', fieldName: 'wallet_id' })
  walletId!: string;

  @Property({ type: 'uuid', fieldName: 'transaction_id' })
  transactionId!: string;

  @Property({ type: 'varchar', length: 12 })
  direction!: string;

  @Property({ type: 'numeric', precision: 19, scale: 2 })
  amount!: string;

  @Property({ type: 'varchar', length: 3 })
  currency!: string;

  @Property({ type: 'numeric', precision: 19, scale: 2, fieldName: 'balance_before' })
  balanceBefore!: string;

  @Property({ type: 'numeric', precision: 19, scale: 2, fieldName: 'balance_after' })
  balanceAfter!: string;

  @Property({ type: 'timestamptz', fieldName: 'created_at' })
  createdAt!: Date;
}
