-- =====================================================================
-- 0001 Identitas, sesi, RBAC, consent.  Blueprint §3 (peran & hak akses), §12.1, §13.1
-- Prinsip: default deny, permission granular terpisah dari role, tidak ada password mentah.
-- =====================================================================

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  email_normalized text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  password_hash   text NOT NULL,
  password_algo   text NOT NULL DEFAULT 'scrypt',
  full_name       text NOT NULL,
  phone           text,
  kind            text NOT NULL DEFAULT 'customer' CHECK (kind IN ('customer','staff')),
  is_active       boolean NOT NULL DEFAULT true,
  email_verified_at timestamptz,
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until    timestamptz,
  mfa_secret_enc  text,
  mfa_enabled_at  timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_normalized_key ON users (email_normalized);

CREATE TABLE roles (
  code        text PRIMARY KEY CHECK (code ~ '^[a-z][a-z_]{1,40}$'),
  label       text NOT NULL,
  description text,
  is_privileged boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  code      text PRIMARY KEY CHECK (code ~ '^[a-z][a-z_.]{2,60}$'),
  label     text NOT NULL,
  risk      text NOT NULL DEFAULT 'normal' CHECK (risk IN ('normal','sensitive','financial','privileged'))
);

CREATE TABLE user_roles (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_code)
);

CREATE TABLE role_permissions (
  role_code  text NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id   text NOT NULL UNIQUE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  ip_hash     text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions (user_id, expires_at DESC);

-- Customer profile dipisah dari identitas & transaksi (Blueprint §13.3 minimasi data).
CREATE TABLE customer_profiles (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  marketing_consent boolean NOT NULL DEFAULT false,
  consent_updated_at timestamptz,
  locale         text NOT NULL DEFAULT 'id-ID',
  timezone       text NOT NULL DEFAULT 'Asia/Jakarta',
  support_flag   text CHECK (support_flag IN ('vip','complaint_history','fraud_watch','none')),
  notes_internal text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE addresses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       text NOT NULL DEFAULT 'lainnya' CHECK (label IN ('rumah','kantor','lainnya')),
  full_name   text NOT NULL,
  phone       text NOT NULL,
  province    text NOT NULL,
  city        text NOT NULL,
  district    text NOT NULL,
  postal_code text NOT NULL CHECK (postal_code ~ '^[0-9]{5}$'),
  street      text NOT NULL,
  landmark    text,
  is_default  boolean NOT NULL DEFAULT false,
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX addresses_user_idx ON addresses (user_id) WHERE is_deleted = false;
-- Satu alamat default per pengguna.
CREATE UNIQUE INDEX addresses_one_default_idx ON addresses (user_id) WHERE is_default = true AND is_deleted = false;

CREATE TABLE consent_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  email        text,
  purpose      text NOT NULL CHECK (purpose IN ('terms','privacy','marketing','return_policy','payment')),
  policy_key   text NOT NULL,
  policy_version text NOT NULL,
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  source       text NOT NULL DEFAULT 'checkout',
  request_id   text
);
CREATE INDEX consent_records_user_idx ON consent_records (user_id, accepted_at DESC);

CREATE TABLE privacy_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference   text NOT NULL UNIQUE,
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  email       text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('access','correction','deletion','portability','objection')),
  status      text NOT NULL DEFAULT 'received' CHECK (status IN ('received','verifying','in_progress','completed','rejected')),
  detail      text,
  identity_verified_at timestamptz,
  completed_at timestamptz,
  handled_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_attempts (
  bucket       text PRIMARY KEY,
  attempts     integer NOT NULL DEFAULT 1 CHECK (attempts >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now()
);
