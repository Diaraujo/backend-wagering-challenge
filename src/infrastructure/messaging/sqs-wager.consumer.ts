import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } from '@aws-sdk/client-sqs';
import { WageringProcessorService } from '../../application/services/wagering-processor.service';
import { IdempotencyConflictError } from '../../domain/errors';
import { MetricsService } from '../observability/metrics.service';

@Injectable()
export class SqsWagerConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsWagerConsumer.name);
  private stopped = false;
  private inFlight = 0;
  private readonly consumerName = 'wagering-sqs-consumer';
  private readonly sqs = new SQSClient({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.SQS_ENDPOINT || 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  private readonly queueUrl =
    process.env.WAGER_QUEUE_URL || 'http://localhost:4566/000000000000/wager-transactions.fifo';

  constructor(
    private readonly processor: WageringProcessorService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_WORKERS === 'true') return;
    void this.pollLoop();
  }

  async onModuleDestroy() {
    this.stopped = true;
    while (this.inFlight > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private async pollLoop() {
    while (!this.stopped) {
      try {
        const res = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 2,
          }),
        );

        for (const message of res.Messages || []) {
          if (this.stopped) {
            if (message.ReceiptHandle) {
              await this.sqs.send(
                new ChangeMessageVisibilityCommand({
                  QueueUrl: this.queueUrl,
                  ReceiptHandle: message.ReceiptHandle,
                  VisibilityTimeout: 0,
                }),
              );
            }
            continue;
          }

          this.inFlight++;
          try {
            const envelope = JSON.parse(message.Body || '{}');
            if (envelope.type !== 'WagerTransactionRequested') {
              if (message.ReceiptHandle) {
                await this.sqs.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle }));
              }
              continue;
            }

            await this.processor.processTransaction({
              ...envelope.data,
              idempotencyKey: envelope.data.idempotencyKey || `${envelope.data.providerId}:${envelope.data.externalTransactionId}`,
              correlationId: envelope.messageId,
              inboxContext: {
                messageId: envelope.messageId,
                consumerName: this.consumerName,
              },
            });

            // Ack only after DB commit
            if (message.ReceiptHandle) {
              await this.sqs.send(
                new DeleteMessageCommand({
                  QueueUrl: this.queueUrl,
                  ReceiptHandle: message.ReceiptHandle,
                }),
              );
            }
          } catch (err) {
            if (err instanceof IdempotencyConflictError) {
              // Terminal business/contract error -> ack to avoid infinite retry
              if (message.ReceiptHandle) {
                await this.sqs.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle }));
              }
            } else {
              this.metrics.inc('sqs_consumer_retries_total');
              this.logger.error(`Transient error processing SQS message ${message.MessageId}: ${(err as Error).message}`);
            }
          } finally {
            this.inFlight--;
          }
        }
      } catch (err) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
}
