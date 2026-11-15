import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import mikroOrmConfig from '../mikro-orm.config';
import { WageringProcessorService } from './application/services/wagering-processor.service';
import { WageringController } from './presentation/controllers/wagering.controller';
import { HealthController } from './presentation/controllers/health.controller';
import { OutboxPublisherWorker } from './infrastructure/messaging/outbox-publisher.worker';
import { SqsWagerConsumer } from './infrastructure/messaging/sqs-wager.consumer';
import { MetricsService } from './infrastructure/observability/metrics.service';
import { NoOpProviderIdentityPort, PROVIDER_IDENTITY_PORT } from './infrastructure/auth/provider-identity.port';
import { ProviderAuthGuard } from './infrastructure/auth/provider-auth.guard';

@Module({
  imports: [MikroOrmModule.forRoot(mikroOrmConfig)],
  controllers: [WageringController, HealthController],
  providers: [
    WageringProcessorService,
    OutboxPublisherWorker,
    SqsWagerConsumer,
    MetricsService,
    {
      provide: PROVIDER_IDENTITY_PORT,
      useClass: NoOpProviderIdentityPort,
    },
    {
      provide: APP_GUARD,
      useClass: ProviderAuthGuard,
    },
  ],
})
export class AppModule {}
