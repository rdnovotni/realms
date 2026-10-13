CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE characters (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE runs (
  id uuid PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  turns integer NOT NULL CHECK (turns >= 0),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED')),
  rules_version text NOT NULL DEFAULT 'prototype-0.1'
);
CREATE UNIQUE INDEX one_active_run ON runs(character_id) WHERE status = 'ACTIVE';
CREATE TABLE action_receipts (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, request_id)
);
CREATE TABLE turn_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  delta integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, request_id)
);
