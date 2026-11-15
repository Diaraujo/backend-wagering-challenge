# ARCHITECTURE.md — Decisões Técnicas e Trade-offs

## 1. Precisão Monetária (`Money` + `Decimal.js` + `NUMERIC(19,2)`)
- **Domínio**: `Money` encapsula `Decimal` (`decimal.js`) com escala fixa de 2 casas decimais e arredondamento `ROUND_HALF_UP`. Zero uso de `number` ou `float`.
- **Persistência**: Colunas `NUMERIC(19, 2)` acompanhadas de `VARCHAR(3)` (ISO-4217) e `CHECK (balance >= 0)` no PostgreSQL.

## 2. Estratégia de Concorrência (`Pessimistic Lock` por `walletId`)
- **Escolha**: `SELECT ... FOR UPDATE` (`LockMode.PESSIMISTIC_WRITE`) na linha da `Wallet` dentro da transação SQL, aliado à coluna `version` como defesa em profundidade.
- **Justificativa**: Em cenários de *hot wallet* (ex.: 50 requisições simultâneas na mesma carteira), *optimistic locking* puro gera alta taxa de abortos e retries sob contenção. O lock pessimista granular por `walletId` serializa apenas operações daquela carteira específica sem bloquear outras carteiras, garantindo saldo estritamente não-negativo e determinismo.

## 3. Idempotência e Consistência Transacional
- **Hash Canônico**: SHA-256 sobre JSON com chaves ordenadas contendo apenas os atributos de negócio (`providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money`, `referenceExternalTransactionId`).
- **Unicidade no Banco**: Constraints `UNIQUE (idempotency_key)` e `UNIQUE (provider_id, external_transaction_id)` impedem duplicação mesmo sob condições de corrida entre HTTP e SQS.
- **Atomicidade**: `InboxMessage`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry` e `OutboxMessage` são persistidos na mesma transação `EntityManager.transactional()`.

## 4. Referências Fora de Ordem (`PENDING_REFERENCE`)
- Quando `REFUND` ou `ROLLBACK` chega antes da transação referenciada, a operação é persistida com status `PENDING_REFERENCE` e evento `WagerTransactionPendingReference` na outbox.
- Um worker agendado reprocessa transações pendentes com backoff exponencial até o TTL/limite configurado (10 tentativas / 15 minutos). Esgotado o limite, a transação é transicionada para `REJECTED` com `FailureCode.REFERENCE_EXPIRED`.

## 5. Transactional Outbox e Mensageria SQS
- Nenhum evento é publicado antes do commit do PostgreSQL.
- O publisher lê registros pendentes usando `FOR UPDATE SKIP LOCKED`, permitindo múltiplas instâncias publicando em paralelo sem disputa.
- O consumidor SQS registra o `messageId` na tabela `inbox_messages` antes de confirmar o ack na fila.

## 6. Autenticação (`ProviderIdentityPort`)
- Optou-se por manter o ponto de extensão explícito via `ProviderIdentityPort` + `ProviderAuthGuard` (implementação `NoOpProviderIdentityPort`), evitando acoplar o domínio financeiro a um IdP específico e concentrando o esforço nas garantias de correção financeira e concorrência. Em produção, basta injetar um adaptador OIDC/JWKS (Keycloak ou Zitadel) no módulo de infraestrutura.
