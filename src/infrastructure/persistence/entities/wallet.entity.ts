import { Entity, PrimaryKey, Property, Unique, Check } from '@mikro-orm/core';

@Entity({ tableName: 'wallets' })
@Unique({ properties: ['playerId', 'currency'] })
@Check({ expression: 'balance >= 0' })
export class WalletEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid', fieldName: 'player_id' })
  playerId!: string;

  @Property({ type: 'varchar', length: 3 })
  currency!: string;

  @Property({ type: 'numeric', precision: 19, scale: 2 })
  balance!: string;

  @Property({ type: 'int', default: 1 })
  version!: number;

  @Property({ type: 'timestamptz', fieldName: 'created_at' })
  createdAt!: Date;

  @Property({ type: 'timestamptz', fieldName: 'updated_at' })
  updatedAt!: Date;
}
