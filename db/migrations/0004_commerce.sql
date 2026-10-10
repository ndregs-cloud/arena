-- =====================================================================
-- 0004 Commerce core: cart, promo, order snapshot, pembayaran, pengiriman, retur.
-- Blueprint §6, §7.3, §12.1
-- Semua angka uang = bigint integer Rupiah. Tidak ada float. Currency disimpan eksplisit.
-- =====================================================================

CREATE TABLE carts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- token cart tamu di-hash (Blueprint §12.1 "cart token hashed")
  token_hash   text UNIQUE,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','merged','converted','abandoned')),
  merged_into  uuid REFERENCES carts(id) ON DELETE SET NULL,
  -- draft checkout (alamat/kiriman/metode) dipertahankan saat pengguna kembali ke langkah sebelumnya
  draft        jsonb NOT NULL DEFAULT '{}'::jsonb,
  promotion_id uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NOT NULL) OR (token_hash IS NOT NULL))
);
CREATE INDEX carts_user_active_idx ON carts (user_id) WHERE status = 'active';

CREATE TABLE cart_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id      uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id   uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity     integer NOT NULL CHECK (quantity > 0 AND quantity <= 999),
  saved_for_later boolean NOT NULL DEFAULT false,
  added_at     timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Satu baris per varian: update kuantitas, bukan duplikasi (desain §10.1)
  UNIQUE (cart_id, variant_id)
);

CREATE TABLE promotions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE CHECK (code = upper(btrim(code)) AND char_length(code) BETWEEN 3 AND 32),
  label         text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('percent','fixed','free_shipping')),
  value         integer NOT NULL CHECK (value >= 0),
  min_spend_amount bigint NOT NULL DEFAULT 0 CHECK (min_spend_amount >= 0),
  discount_cap_amount bigint CHECK (discount_cap_amount IS NULL OR discount_cap_amount >= 0),
  scope         jsonb,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  usage_limit   integer CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count    integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  per_customer_limit integer CHECK (per_customer_limit IS NULL OR per_customer_limit > 0),
  stackable     boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  requires_approval boolean NOT NULL DEFAULT false,
  approved_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Batas akhir wajib setelah awal; definisi inklusif/eksklusif didokumentasikan di docs/pricing-rules.md
  CHECK (ends_at > starts_at),
  CHECK (kind <> 'percent' OR (value >= 1 AND value <= 10000))
);
CREATE INDEX promotions_window_idx ON promotions (starts_at, ends_at) WHERE is_active = true;

CREATE TABLE orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number   text NOT NULL UNIQUE CHECK (order_number ~ '^NS-[0-9]{8}-[A-Z0-9]{6}$'),
  -- token acak untuk akses tamu (AT-07: nomor order bukan satu-satunya rahasia)
  tracking_token text NOT NULL UNIQUE CHECK (char_length(tracking_token) >= 20),
  customer_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  email          text NOT NULL,
  phone          text NOT NULL,
  status         text NOT NULL DEFAULT 'pending_payment' CHECK (status IN
                   ('pending_payment','paid','processing','on_hold','shipped','delivered','completed',
                    'cancelled','return_requested','return_approved','returned','refunded')),
  payment_status text NOT NULL DEFAULT 'awaiting_payment' CHECK (payment_status IN
                   ('unconfirmed','awaiting_payment','pending','succeeded','failed','expired',
                    'partially_refunded','refunded')),
  fulfillment_status text NOT NULL DEFAULT 'unfulfilled' CHECK (fulfillment_status IN
                   ('unfulfilled','picking','packed','shipped','delivered','partially_returned','returned','cancelled')),
  currency       char(3) NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
  subtotal_amount bigint NOT NULL CHECK (subtotal_amount >= 0),
  discount_amount bigint NOT NULL CHECK (discount_amount >= 0),
  shipping_amount bigint NOT NULL CHECK (shipping_amount >= 0),
  fee_amount     bigint NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  total_amount   bigint NOT NULL CHECK (total_amount >= 0),
  refunded_amount bigint NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  -- Invariant: total final = subtotal - diskon + ongkir + fee (dihitung ulang oleh DB juga)
  total_computed bigint GENERATED ALWAYS AS (subtotal_amount - discount_amount + shipping_amount + fee_amount) STORED,
  promotion_id   uuid REFERENCES promotions(id) ON DELETE SET NULL,
  shipping_address jsonb NOT NULL,
  shipping_selection jsonb NOT NULL,
  policy_version text NOT NULL,
  marketing_consent boolean NOT NULL DEFAULT false,
  campaign_source text,
  customer_note  text,
  cart_id        uuid REFERENCES carts(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz,
  shipped_at     timestamptz,
  delivered_at   timestamptz,
  completed_at   timestamptz,
  cancelled_at   timestamptz,
  cancel_reason  text,
  expires_at     timestamptz,
  idempotency_key text UNIQUE,
  CHECK (refunded_amount <= total_amount),
  CHECK (discount_amount <= subtotal_amount)
);
-- Query nyata (Blueprint §12.3): order_number, customer+created, status+created
CREATE INDEX orders_customer_idx ON orders (customer_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders (status, created_at DESC);
CREATE INDEX orders_payment_status_idx ON orders (payment_status, created_at DESC) WHERE payment_status IN ('awaiting_payment','pending');

CREATE TABLE order_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id    uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  sku           text NOT NULL,
  -- snapshot: perubahan katalog tidak menulis ulang transaksi lama (CAT-05)
  name_snapshot text NOT NULL,
  variant_label_snapshot text NOT NULL,
  unit_price_amount bigint NOT NULL CHECK (unit_price_amount >= 0),
  quantity      integer NOT NULL CHECK (quantity > 0),
  discount_allocated_amount bigint NOT NULL DEFAULT 0 CHECK (discount_allocated_amount >= 0),
  line_total_amount bigint GENERATED ALWAYS AS (unit_price_amount * quantity - discount_allocated_amount) STORED,
  image_url     text,
  is_returnable boolean NOT NULL DEFAULT true,
  returned_quantity integer NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  CHECK (discount_allocated_amount <= unit_price_amount * quantity),
  CHECK (returned_quantity <= quantity),
  UNIQUE (order_id, variant_id)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_variant_idx ON order_items (variant_id);

-- Timeline order: append-only, dipisah customer-visible vs internal (Blueprint §6.4)
CREATE TABLE order_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type   text NOT NULL,
  from_status  text,
  to_status    text,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_kind   text NOT NULL DEFAULT 'system' CHECK (actor_kind IN ('customer','guest','staff','system','provider','job')),
  visibility   text NOT NULL DEFAULT 'customer' CHECK (visibility IN ('customer','internal')),
  note         text,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, created_at);
CREATE TRIGGER order_events_append_only BEFORE UPDATE OR DELETE ON order_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation_on_ledger();

CREATE TABLE stock_reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_code text NOT NULL REFERENCES inventory_locations(code) ON DELETE RESTRICT,
  sku           text NOT NULL REFERENCES product_variants(sku) ON DELETE RESTRICT,
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity      integer NOT NULL CHECK (quantity > 0),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','consumed','released','expired')),
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);
CREATE UNIQUE INDEX stock_reservations_active_item_idx ON stock_reservations (order_item_id) WHERE status = 'active';
CREATE INDEX stock_reservations_expiry_idx ON stock_reservations (expires_at) WHERE status = 'active';

CREATE TABLE payment_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider_code  text NOT NULL CHECK (provider_code IN ('mock','midtrans','xendit')),
  provider_ref   text,
  method_code    text NOT NULL,
  method_name    text NOT NULL,
  amount         bigint NOT NULL CHECK (amount > 0),
  currency       char(3) NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
  status         text NOT NULL DEFAULT 'created' CHECK (status IN
                   ('created','pending','requires_action','succeeded','failed','expired','cancelled','refunded','partially_refunded')),
  idempotency_key text NOT NULL UNIQUE,
  instructions   text,
  redirect_url   text,
  is_simulated   boolean NOT NULL DEFAULT true,
  failure_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  succeeded_at   timestamptz
);
CREATE UNIQUE INDEX payment_attempts_provider_ref_idx ON payment_attempts (provider_code, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX payment_attempts_order_idx ON payment_attempts (order_id, created_at DESC);

-- Dedup webhook: unique provider+event_id (Blueprint §6.3, AT-04)
CREATE TABLE payment_webhook_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_code text NOT NULL,
  event_id      text NOT NULL,
  event_type    text NOT NULL,
  attempt_ref   text,
  order_id      uuid REFERENCES orders(id) ON DELETE SET NULL,
  amount        bigint,
  currency      char(3),
  signature_valid boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored_duplicate','rejected','needs_review','failed')),
  -- payload minimal & diredaksi; JANGAN simpan secret/data kartu
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code    text,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  UNIQUE (provider_code, event_id)
);
CREATE INDEX payment_webhook_pending_idx ON payment_webhook_events (received_at) WHERE status = 'received';

CREATE TABLE refunds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     text NOT NULL UNIQUE,
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_attempt_id uuid REFERENCES payment_attempts(id) ON DELETE SET NULL,
  return_id     uuid,
  amount        bigint NOT NULL CHECK (amount > 0),
  currency      char(3) NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
  status        text NOT NULL DEFAULT 'requested' CHECK (status IN
                   ('requested','approved','submitted','pending','succeeded','failed','rejected','cancelled')),
  reason        text NOT NULL,
  include_shipping boolean NOT NULL DEFAULT false,
  requested_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at   timestamptz,
  provider_ref  text,
  idempotency_key text UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  succeeded_at  timestamptz,
  -- maker-checker: pemohon dan penyetuju tidak boleh orang yang sama (Blueprint §3.1)
  CHECK (approved_by IS NULL OR approved_by <> requested_by OR requested_by IS NULL)
);
CREATE INDEX refunds_status_idx ON refunds (status, created_at);

CREATE TABLE refund_items (
  refund_id    uuid NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity     integer NOT NULL CHECK (quantity > 0),
  amount       bigint NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (refund_id, order_item_id)
);

CREATE TABLE shipments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  carrier_code  text NOT NULL,
  service_code  text NOT NULL,
  tracking_number text,
  status        text NOT NULL DEFAULT 'created' CHECK (status IN
                   ('created','label_ready','picked_up','in_transit','out_for_delivery','delivered','exception','returned_to_sender','cancelled')),
  package_count integer NOT NULL DEFAULT 1 CHECK (package_count > 0),
  label_ref     text,
  note          text,
  is_tracking_manual boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  shipped_at    timestamptz,
  delivered_at  timestamptz
);
CREATE UNIQUE INDEX shipments_tracking_idx ON shipments (carrier_code, tracking_number) WHERE tracking_number IS NOT NULL;
CREATE INDEX shipments_order_idx ON shipments (order_id);

CREATE TABLE shipment_items (
  shipment_id  uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity     integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (shipment_id, order_item_id)
);

CREATE TABLE tracking_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id  uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  provider_event_id text,
  status       text NOT NULL,
  status_label text NOT NULL,
  location     text,
  occurred_at  timestamptz NOT NULL,
  source       text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','provider','import')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, provider_event_id)
);
CREATE INDEX tracking_events_shipment_idx ON tracking_events (shipment_id, occurred_at DESC);

CREATE TABLE returns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     text NOT NULL UNIQUE CHECK (reference ~ '^RET-[0-9]{8}-[A-Z0-9]{6}$'),
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'requested' CHECK (status IN
                   ('requested','approved','rejected','awaiting_return','item_received','inspected','resolved','cancelled')),
  reason_code   text NOT NULL,
  description   text NOT NULL,
  resolution    text NOT NULL DEFAULT 'refund' CHECK (resolution IN ('refund','exchange','store_credit','none')),
  policy_version text NOT NULL,
  requested_amount bigint NOT NULL DEFAULT 0 CHECK (requested_amount >= 0),
  approved_amount bigint CHECK (approved_amount IS NULL OR approved_amount >= 0),
  refund_id     uuid REFERENCES refunds(id) ON DELETE SET NULL,
  evidence      jsonb NOT NULL DEFAULT '[]'::jsonb,
  inspection    jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_note text,
  decided_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  restock_allowed boolean NOT NULL DEFAULT false,
  deadline_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);
CREATE INDEX returns_status_idx ON returns (status, created_at DESC);

CREATE TABLE return_items (
  return_id    uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity_requested integer NOT NULL CHECK (quantity_requested > 0),
  quantity_received integer NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_restocked integer NOT NULL DEFAULT 0 CHECK (quantity_restocked >= 0),
  quantity_damaged integer NOT NULL DEFAULT 0 CHECK (quantity_damaged >= 0),
  amount       bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  PRIMARY KEY (return_id, order_item_id),
  CHECK (quantity_received <= quantity_requested),
  CHECK (quantity_restocked + quantity_damaged <= quantity_received)
);

CREATE TABLE return_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  return_id    uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  event_type   text NOT NULL,
  from_status  text,
  to_status    text,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  note         text,
  visibility   text NOT NULL DEFAULT 'customer' CHECK (visibility IN ('customer','internal')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER return_events_append_only BEFORE UPDATE OR DELETE ON return_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation_on_ledger();
