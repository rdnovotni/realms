-- Infrastructure only: gameplay rewards remain in existing authoritative transactions.
CREATE TABLE job_execution_receipts (
  job_id uuid PRIMARY KEY REFERENCES durable_jobs(id),
  payload_checksum text NOT NULL CHECK(length(payload_checksum)=64),
  outcome jsonb NOT NULL CHECK(jsonb_typeof(outcome)='object'),
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE job_execution_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES durable_jobs(id),
  lease_token uuid NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('SUCCEEDED','RETRY','FAILED','LEASE_LOST')),
  error_code text CHECK(error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX job_execution_log_job ON job_execution_log(job_id,created_at);
