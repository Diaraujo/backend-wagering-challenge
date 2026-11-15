import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { PROVIDER_IDENTITY_PORT } from './provider-identity.port';
import type { ProviderIdentityPort } from './provider-identity.port';

@Injectable()
export class ProviderAuthGuard implements CanActivate {
  constructor(
    @Inject(PROVIDER_IDENTITY_PORT)
    private readonly identityPort: ProviderIdentityPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (req.url?.startsWith('/health')) {
      return true;
    }
    const authHeader = req.headers?.['authorization'];
    req.providerIdentity = await this.identityPort.verifyToken(authHeader);
    return req.providerIdentity.authenticated;
  }
}