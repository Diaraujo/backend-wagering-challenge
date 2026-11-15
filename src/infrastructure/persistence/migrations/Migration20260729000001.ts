import { Migration } from '@mikro-orm/migrations';

export class Migration20260729000001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE wallets (
        id UUID PRIMARY KEY,
        player_id UUID NOT NULL,
        currency VARCHAR(3) NOT NULL,
        balance NUMERIC(19, 2) NOT NULL CHECK (balance >= 0),
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT uq_wallets_player_currency UNIQUE (player_id, currency)
      );

      CREATE TABLE wager_transactions (
        id UUID PRIMARY KEY,
        provider_id VARCHAR(64) NOT NULL,
        external_transaction_id VARCHAR(128) NOT NULL,
        idempotency_key VARCHAR(256) NOT NULL,
        payload_hash VARCHAR(64) NOT NULL,
        wallet_id UUID NOT NULL REFERENCES wallets(id),
        player_id UUID NOT NULL,
        round_id VARCHAR(128) NOT NULL,
        game_id VARCHAR(128) NOT NULL,
        kind VARCHAR(24) NOT NULL,
        amount NUMERIC(19, 2) NOT NULL CHECK (amount >= 0),
        currency VARCHAR(3) NOT NULL,
        reference_external_transaction_id VARCHAR(128),
        reference_transaction_id UUID,
        status VARCHAR(32) NOT NULL,
        failure_code VARCHAR(64),
        observed_balance NUMERIC(19, 2),
        retry_count INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL,
        processed_at TIMESTAMPTZ,
        CONSTRAINT uq_wager_tx_idempotency_key UNIQUE (idempotency_key),
        CONSTRAINT uq_wager_tx_provider_ext UNIQUE (provider_id, external_transaction_id)
      );
      CREATE INDEX idx_wager_tx_wallet_id ON wager_transactions(wallet_id);
      CREATE INDEX idx_wager_tx_status ON wager_transactions(status);

      CREATE TABLE wallet_ledger_entries (
        id UUID PRIMARY KEY,
        wallet_id UUID NOT NULL REFERENCES wallets(id),
        transaction_id UUID NOT NULL REFERENCES wager_transactions(id),
        direction VARCHAR(12) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
        amount NUMERIC(19, 2) NOT NULL CHECK (amount > 0),
        currency VARCHAR(3) NOT NULL,
        balance_before NUMERIC(19, 2) NOT NULL CHECK (balance_before >= 0),
        balance_after NUMERIC(19, 2) NOT NULL CHECK (balance_after >= 0),
        created_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT uq_ledger_wallet_tx UNIQUE (wallet_id, transaction_id)
      );
      CREATE INDEX idx_ledger_wallet_created ON wallet_ledger_entries(wallet_id, created_at DESC, id DESC);

      CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'wallet_ledger_entries is immutable: UPDATE and DELETE are forbidden';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_wallet_ledger_immutable
      BEFORE UPDATE OR DELETE ON wallet_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

      CREATE TABLE inbox_messages (
        message_id VARCHAR(128) NOT NULL,
        consumer_name VARCHAR(64) NOT NULL,
        payload_hash VARCHAR(64) NOT NULL,
        received_at TIMESTAMPTZ NOT NULL,
        processed_at TIMESTAMPTZ,
        PRIMARY KEY (message_id, consumer_name)
      );

      CREATE TABLE outbox_messages (
        id UUID PRIMARY KEY,
        aggregate_id UUID NOT NULL,
        event_type VARCHAR(128) NOT NULL,
        payload JSONB NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ,
        published_at TIMESTAMPTZ
      );
      CREATE INDEX idx_outbox_pending ON outbox_messages(published_at, next_attempt_at) WHERE published_at IS NULL;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP TABLE IF EXISTS outbox_messages;
      DROP TABLE IF EXISTS inbox_messages;
      DROP TRIGGER IF EXISTS trg_wallet_ledger_immutable ON wallet_ledger_entries;
      DROP FUNCTION IF EXISTS prevent_ledger_mutation();
      DROP TABLE IF EXISTS wallet_ledger_entries;
      DROP TABLE IF EXISTS wager_transactions;
      DROP TABLE IF EXISTS wallets;
    `);
  }
}