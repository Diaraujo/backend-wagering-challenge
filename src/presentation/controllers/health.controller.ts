import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

@Controller('health')
export class HealthController {
  private readonly sqs = new SQSClient({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.SQS_ENDPOINT || 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });

  constructor(private readonly em: EntityManager) {}

  @Get('live')
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  async ready() {
    try {
      await this.em.getConnection().execute('SELECT 1');
      const queueUrl =
        process.env.WAGER_QUEUE_URL || 'http://localhost:4566/000000000000/wager-transactions.fifo';
      await this.sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }));
      return { status: 'ready', dependencies: { postgres: 'up', sqs: 'up' } };
    } catch (err) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        error: (err as Error).message,
      });
    }
  }
}
