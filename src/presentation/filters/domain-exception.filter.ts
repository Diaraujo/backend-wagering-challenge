import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { DomainError, IdempotencyConflictError } from '../../domain/errors';

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const status =
      exception instanceof IdempotencyConflictError
        ? HttpStatus.CONFLICT
        : HttpStatus.UNPROCESSABLE_ENTITY;

    response.status(status).json({
      code: exception.code,
      message: exception.message,
    });
  }
}
