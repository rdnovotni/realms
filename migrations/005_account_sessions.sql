ALTER TABLE accounts ADD COLUMN access_status text NOT NULL DEFAULT 'ACTIVE' CHECK(access_status IN('ACTIVE','SUSPENDED'));
ALTER TABLE accounts ADD COLUMN security_epoch bigint NOT NULL DEFAULT 0 CHECK(security_epoch>=0);
CREATE TABLE auth_credentials (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  handle text NOT NULL UNIQUE CHECK(handle ~ '^[a-z][a-z0-9_]{2,39}$'),
  scheme text NOT NULL DEFAULT 'scrypt-n17-r8-p1-v1' CHECK(scheme='scrypt-n17-r8-p1-v1'),
  salt bytea NOT NULL CHECK(octet_length(salt)=16),
  verifier bytea NOT NULL CHECK(octet_length(verifier)=32),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id),
  token_digest text NOT NULL UNIQUE CHECK(token_digest ~ '^[0-9a-f]{64}$'),
  security_epoch bigint NOT NULL CHECK(security_epoch>=0),
  scopes text[] NOT NULL CHECK(cardinality(scopes) BETWEEN 1 AND 3 AND array_position(scopes,NULL) IS NULL
    AND scopes <@ ARRAY['GAME_READ','GAME_WRITE','ACCOUNT_MANAGE']::text[]),
  device_label text NOT NULL CHECK(length(btrim(device_label)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '12 hours'),
  CHECK(last_seen_at>=created_at AND last_seen_at<=expires_at),
  CHECK(revoked_at IS NULL OR revoked_at>=created_at), UNIQUE(id,account_id)
);
CREATE INDEX auth_sessions_account ON auth_sessions(account_id,created_at);
CREATE TABLE auth_recovery_codes (
  token_digest text PRIMARY KEY CHECK(token_digest ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES accounts(id), credential_revision bigint NOT NULL CHECK(credential_revision>0),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  used_at timestamptz, CHECK(expires_at>created_at), CHECK(used_at IS NULL OR used_at>=created_at)
);
CREATE INDEX auth_recovery_account ON auth_recovery_codes(account_id);
CREATE TABLE auth_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id uuid REFERENCES accounts(id), session_id uuid,
  event_type text NOT NULL CHECK(event_type IN('PASSWORD_ENROLLED','LOGIN_SUCCEEDED','LOGIN_FAILED','SESSION_REVOKED',
    'SESSIONS_REVOKED','PASSWORD_CHANGED','RECOVERY_USED','ACCOUNT_SUSPENDED','ACCOUNT_REACTIVATED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(session_id IS NULL OR account_id IS NOT NULL),
  FOREIGN KEY(session_id,account_id) REFERENCES auth_sessions(id,account_id)
);
CREATE INDEX auth_events_account ON auth_events(account_id,created_at);
CREATE INDEX auth_events_session ON auth_events(session_id,account_id);
CREATE TRIGGER immutable_auth_event BEFORE UPDATE OR DELETE ON auth_events FOR EACH ROW EXECUTE FUNCTION reject_record_change();
CREATE TABLE auth_throttle (
  bucket_key text PRIMARY KEY CHECK(bucket_key ~ '^[0-9a-f]{64}$'), attempts integer NOT NULL CHECK(attempts BETWEEN 1 AND 100),
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_throttle_expiry ON auth_throttle(expires_at);

CREATE FUNCTION guard_account_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id THEN RAISE EXCEPTION 'Account identity is immutable'; END IF;
  IF NEW.access_status<>OLD.access_status THEN NEW.security_epoch:=OLD.security_epoch+1; END IF;
  IF NEW.security_epoch<OLD.security_epoch OR NEW.security_epoch>OLD.security_epoch+1 THEN RAISE EXCEPTION 'Invalid account security epoch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_access BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION guard_account_access();
CREATE FUNCTION audit_account_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.access_status<>OLD.access_status THEN
    INSERT INTO auth_events(account_id,event_type) VALUES(NEW.id,CASE WHEN NEW.access_status='SUSPENDED' THEN 'ACCOUNT_SUSPENDED' ELSE 'ACCOUNT_REACTIVATED' END);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_access_audit AFTER UPDATE OF access_status ON accounts FOR EACH ROW EXECUTE FUNCTION audit_account_access();
CREATE FUNCTION guard_password_credential() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Credentials require explicit account recovery'; END IF;
  IF NEW.account_id<>OLD.account_id OR NEW.handle<>OLD.handle OR NEW.scheme<>OLD.scheme OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Credential identity is immutable';
  END IF;
  IF NEW.salt<>OLD.salt OR NEW.verifier<>OLD.verifier THEN
    NEW.revision:=OLD.revision+1; NEW.updated_at:=clock_timestamp();
    UPDATE accounts SET security_epoch=security_epoch+1 WHERE id=NEW.account_id;
  ELSIF NEW.revision<>OLD.revision OR NEW.updated_at<>OLD.updated_at THEN RAISE EXCEPTION 'Credential revision requires a password change'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER password_credential BEFORE UPDATE OR DELETE ON auth_credentials FOR EACH ROW EXECUTE FUNCTION guard_password_credential();
CREATE FUNCTION guard_auth_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Sessions retain their revocation history'; END IF;
  IF (to_jsonb(NEW)-ARRAY['last_seen_at','revoked_at'])<>(to_jsonb(OLD)-ARRAY['last_seen_at','revoked_at']) THEN
    RAISE EXCEPTION 'Session identity, authority and expiry are immutable';
  END IF;
  IF NEW.last_seen_at<OLD.last_seen_at OR (OLD.revoked_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Session cannot be rewound or reopened';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER auth_session_identity BEFORE UPDATE OR DELETE ON auth_sessions FOR EACH ROW EXECUTE FUNCTION guard_auth_session();
CREATE FUNCTION audit_session_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    INSERT INTO auth_events(account_id,session_id,event_type) VALUES(NEW.account_id,NEW.id,'SESSION_REVOKED');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER auth_session_revocation AFTER UPDATE OF revoked_at ON auth_sessions FOR EACH ROW EXECUTE FUNCTION audit_session_revocation();
CREATE FUNCTION guard_recovery_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recovery codes retain their use history'; END IF;
  IF (to_jsonb(NEW)-'used_at')<>(to_jsonb(OLD)-'used_at') OR (OLD.used_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Recovery identity is immutable and use is terminal';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recovery_identity BEFORE UPDATE OR DELETE ON auth_recovery_codes FOR EACH ROW EXECUTE FUNCTION guard_recovery_identity();
