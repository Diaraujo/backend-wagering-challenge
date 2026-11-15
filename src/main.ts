import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './presentation/filters/domain-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port);
}
void bootstrap();
