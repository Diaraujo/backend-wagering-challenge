# Distributed Wagering Processor — Jungle Gaming Challenge

Serviço financeiro distribuído para processamento de transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) desenvolvido com **TypeScript (strict)**, **Bun 1.x**, **NestJS**, **MikroORM**, **PostgreSQL** e **AWS SQS (LocalStack)**.

## Stack & Pré-requisitos
- **Bun**: `>= 1.1`
- **Docker & Docker Compose**: para PostgreSQL 16 e LocalStack (SQS FIFO)

## Setup e Execução Local

1. **Subir infraestrutura (PostgreSQL + LocalStack SQS):**
```bash
docker compose up -d
```

2. **Instalar dependências:**
```bash
bun install
```

3. **Executar migrations:**
```bash
bun run migration:up
```

4. **Iniciar a aplicação:**
```bash
bun run start:dev
```

## Endpoints Principais
- `POST /wallets` — Criação de carteira com transação `OPENING` atômica quando `initialBalance > 0`.
- `GET /wallets/:walletId` — Consulta de saldo atual e versão.
- `GET /wallets/:walletId/ledger?cursor=...&limit=50` — Extrato imutável paginado por cursor opaco.
- `POST /wagering/transactions` — Submissão idempotente de transações (requer header `Idempotency-Key`).
- `GET /wagering/transactions/:transactionId` — Consulta por ID interno.
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId` — Consulta por ID do provedor.
- `POST /wallets/:walletId/reconciliation` — Auditoria entre saldo materializado e soma do ledger.
- `GET /health/live` & `GET /health/ready` — Probes de liveness e readiness (sem autenticação).

## Testes
```bash
bun run test:unit
bun run test:integration
bun run test:concurrency
```
