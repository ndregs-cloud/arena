-- =====================================================================
-- 0005 Wishlist, ulasan, notifikasi/outbox, CMS/kebijakan, audit, pengaturan.
-- Blueprint §5.5, §8, §11.3, §16
-- =====================================================================

CREATE TABLE wishlists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT 'Wishlist saya',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE wishlist_items (
  wishlist_id uuid NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- 0000..0 = "tanpa varian tertentu" (sentinel agar unik constraint berlaku untuk NULL)
  variant_id  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid
              REFERENCES product_variants(id) ON DELETE CASCADE,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wishlist_id, product_id, variant_id)
);

CREATE TABLE reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  author_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  order_id     uuid REFERENCES orders(id) ON DELETE SET NULL,
  order_item_id uuid REFERENCES order_items(id) ON DELETE SET NULL,
  rating       integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title        text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  body         text NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  variant_label text,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected','hidden')),
  moderation_note text,
  is_verified_purchase boolean NOT NULL DEFAULT false,
  moderation_reason text,
  moderated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  moderated_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_product_idx ON reviews (product_id, status, created_at DESC);
-- Satu ulasan per baris pesanan agar rating tidak dimanipulasi lewat duplikasi.
CREATE UNIQUE INDEX reviews_one_per_order_line_idx ON reviews (order_item_id) WHERE order_item_id IS NOT NULL;

CREATE TABLE site_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  description text,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policies (
  key        text NOT NULL,
  version    integer NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (key, version)
);
CREATE UNIQUE INDEX policies_one_current_idx ON policies (key) WHERE is_current = true;

CREATE TABLE cms_pages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE,
  title      text NOT NULL,
  body       jsonb NOT NULL DEFAULT '[]'::jsonb,
  status     text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at timestamptz,
  meta_title text,
  meta_description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign_banners (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position   text NOT NULL CHECK (position IN ('home_hero','home_collection','category_header','cart_upsell')),
  title      text NOT NULL,
  subtitle   text,
  image_url  text,
  image_alt  text,
  href       text,
  starts_at  timestamptz,
  ends_at    timestamptz,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

-- Outbox notifikasi: status/retry/consent (Blueprint §11.4, §12.1)
CREATE TABLE notification_outbox (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text NOT NULL,
  channel      text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','whatsapp','sms','in_app')),
  to_address   text NOT NULL,
  subject      text,
  body         text NOT NULL,
  template     text NOT NULL,
  template_version integer NOT NULL DEFAULT 1,
  order_id     uuid REFERENCES orders(id) ON DELETE SET NULL,
  return_id    uuid REFERENCES returns(id) ON DELETE SET NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','skipped_no_consent','cancelled')),
  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_run_at  timestamptz NOT NULL DEFAULT now(),
  last_error   text,
  requires_consent boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);
CREATE INDEX notification_outbox_due_idx ON notification_outbox (next_run_at) WHERE status IN ('queued','failed');

-- Outbox integrasi/job: efek async yang harus tahan-retry + idempoten (Blueprint §11.3)
CREATE TABLE integration_outbox (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text NOT NULL,
  destination  text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','dead_letter')),
  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  next_run_at  timestamptz NOT NULL DEFAULT now(),
  last_error   text,
  correlation_id text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX integration_outbox_due_idx ON integration_outbox (next_run_at) WHERE status IN ('pending','failed');

-- Audit trail append-only (Blueprint §3.1, §12.1). Tidak boleh dihapus/diubah operator.
CREATE TABLE audit_logs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email  text,
  actor_kind   text NOT NULL DEFAULT 'staff' CHECK (actor_kind IN ('customer','guest','staff','system','job')),
  action       text NOT NULL,
  target_type  text NOT NULL,
  target_id    text,
  before_data  jsonb,
  after_data   jsonb,
  reason       text,
  request_id   text,
  ip_hash      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation_on_ledger();

CREATE TABLE newsletter_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized text NOT NULL UNIQUE,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','unsubscribed')),
  confirm_token text,
  consent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Event analitik produk (Blueprint §16.1). Disimpan minim: tanpa PII, tanpa data kartu.
CREATE TABLE analytics_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_name   text NOT NULL,
  session_ref  text,
  properties   jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_name_idx ON analytics_events (event_name, occurred_at DESC);
