-- =====================================================================
-- 0007 Token sekali pakai: reset password & verifikasi email (Blueprint §5.4, §13.1)
-- Token disimpan sebagai hash; hanya pemegang token mentah (via email/link) yang bisa memakainya.
-- =====================================================================

CREATE TABLE auth_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('reset_password','verify_email')),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, purpose, created_at DESC);

-- Satu token aktif per pengguna+purpose: token lama hangus saat diminta lagi.
CREATE UNIQUE INDEX auth_tokens_one_active_idx ON auth_tokens (user_id, purpose) WHERE consumed_at IS NULL;
