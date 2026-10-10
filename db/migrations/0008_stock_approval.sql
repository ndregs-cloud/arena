-- =====================================================================
-- 0008 Persetujuan adjustment stok (Blueprint §7.1 adjustment + §3.1 maker-checker)
-- Adjustment besar tidak langsung diterapkan: diajukan -> disetujui -> diterapkan.
-- =====================================================================

CREATE TABLE stock_adjustment_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_code text NOT NULL REFERENCES inventory_locations(code) ON DELETE RESTRICT,
  sku           text NOT NULL REFERENCES product_variants(sku) ON DELETE RESTRICT,
  delta         integer NOT NULL CHECK (delta <> 0),
  reason_code   text NOT NULL,
  note          text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','applied','cancelled')),
  requires_approval boolean NOT NULL DEFAULT false,
  requested_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  review_note   text,
  applied_at    timestamptz,
  idempotency_key text UNIQUE,
  -- penyetuju tidak boleh pengaju
  CHECK (reviewed_by IS NULL OR reviewed_by <> requested_by OR requested_by IS NULL)
);
CREATE INDEX stock_adjustment_pending_idx ON stock_adjustment_requests (status, requested_at DESC);
