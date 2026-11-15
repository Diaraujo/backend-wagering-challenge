export interface ProviderIdentity {
  providerId: string;
  authenticated: boolean;
}

export const PROVIDER_IDENTITY_PORT = Symbol('PROVIDER_IDENTITY_PORT');

export interface ProviderIdentityPort {
  verifyToken(authorizationHeader?: string): Promise<ProviderIdentity>;
}

export class NoOpProviderIdentityPort implements ProviderIdentityPort {
  async verifyToken(authorizationHeader?: string): Promise<ProviderIdentity> {
    // Ponto de extensão explícito para integração futura com IdP externo (Keycloak/Zitadel via OIDC/JWKS).
    const token = authorizationHeader?.replace(/^Bearer\s+/i, '').trim();
    return {
      providerId: token || 'anonymous-provider',
      authenticated: true,
    };
  }
}
