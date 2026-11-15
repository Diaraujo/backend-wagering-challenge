import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'inbox_messages' })
export class InboxMessageEntity {
  @PrimaryKey({ type: 'varchar', length: 128, fieldName: 'message_id' })
  messageId!: string;

  @PrimaryKey({ type: 'varchar', length: 64, fieldName: 'consumer_name' })
  consumerName!: string;

  @Property({ type: 'varchar', length: 64, fieldName: 'payload_hash' })
  payloadHash!: string;

  @Property({ type: 'timestamptz', fieldName: 'received_at' })
  receivedAt!: Date;

  @Property({ type: 'timestamptz', nullable: true, fieldName: 'processed_at' })
  processedAt?: Date;
}
