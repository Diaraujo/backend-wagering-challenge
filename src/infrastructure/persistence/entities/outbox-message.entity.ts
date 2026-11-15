import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core';

@Entity({ tableName: 'outbox_messages' })
export class OutboxMessageEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid', fieldName: 'aggregate_id' })
  aggregateId!: string;

  @Property({ type: 'varchar', length: 128, fieldName: 'event_type' })
  eventType!: string;

  @Property({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Property({ type: 'timestamptz', fieldName: 'occurred_at' })
  occurredAt!: Date;

  @Property({ type: 'int', default: 0 })
  attempts!: number;

  @Index()
  @Property({ type: 'timestamptz', nullable: true, fieldName: 'next_attempt_at' })
  nextAttemptAt?: Date;

  @Index()
  @Property({ type: 'timestamptz', nullable: true, fieldName: 'published_at' })
  publishedAt?: Date;
}
