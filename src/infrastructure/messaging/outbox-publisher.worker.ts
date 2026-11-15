import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { OutboxMessageEntity } from '../persistence/entities/outbox-message.entity';
import { OutboxMessage } from '../../domain/outbox-message';
import { MetricsService } from '../observability/metrics.service';

@Injectable()
export class OutboxPublisherWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly sqs = new SQSClient({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.SQS_ENDPOINT || 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  private readonly topicQueueUrl =
    process.env.OUTBOX_QUEUE_URL || 'http://localhost:4566/000000000000/wager-transactions.fifo';

  constructor(
    private readonly em: EntityManager,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_WORKERS === 'true') return;
    this.timer = setInterval(() => void this.publishBatch(), 500);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async publishBatch(limit = 50): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.em.fork().transactional(async (txEm) => {
        const now = new Date();
        const rows = await txEm.getConnection().execute<any[]>(
          `SELECT * FROM outbox_messages
           WHERE published_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           ORDER BY occurred_at ASC
           LIMIT ?
           FOR UPDATE SKIP LOCKED`,
          [now, limit],
        );

        let publishedCount = 0;
        for (const row of rows) {
          const msg = OutboxMessage.rehydrate({
            id: row.id,
            aggregateId: row.aggregate_id,
            eventType: row.event_type,
            payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
            occurredAt: new Date(row.occurred_at),
            attempts: row.attempts,
            nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at) : undefined,
            publishedAt: row.published_at ? new Date(row.published_at) : undefined,
          });

          try {
            await this.sqs.send(
              new SendMessageCommand({
                QueueUrl: this.topicQueueUrl,
                MessageBody: JSON.stringify(msg.payload),
                MessageGroupId: msg.aggregateId,
                MessageDeduplicationId: msg.id,
              }),
            );
            msg.markPublished(new Date());
            await txEm.nativeUpdate(
              OutboxMessageEntity,
              { id: msg.id },
              { publishedAt: msg.publishedAt },
            );
            publishedCount++;
            this.metrics.inc('outbox_published_total');
          } catch (err) {
            msg.scheduleRetry(new Date());
            await txEm.nativeUpdate(
              OutboxMessageEntity,
              { id: msg.id },
              { attempts: msg.attempts, nextAttemptAt: msg.nextAttemptAt },
            );
            this.metrics.inc('outbox_retries_total');
            this.logger.warn(`Outbox publish retry for ${msg.id}: ${(err as Error).message}`);
          }
        }
        return publishedCount;
      });
    } finally {
      this.running = false;
    }
  }
}
