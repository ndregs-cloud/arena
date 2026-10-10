-- =====================================================================
-- 0003 Inventaris: saldo + ledger gerakan + reservasi.  Blueprint §7.1
-- Stok adalah ledger yang dapat ditelusuri, bukan angka yang diedit tanpa alasan.
-- Invariant anti-oversell (AT-02) ditegakkan oleh CHECK + conditional UPDATE dalam transaksi.
-- =====================================================================

CREATE TABLE inventory_locations (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_-]{2,16}$'),
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'warehouse' CHECK (kind IN ('warehouse','store','quarantine')),
  timezone    text NOT NULL DEFAULT 'Asia/Jakarta',
  address     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_balances (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_code text NOT NULL REFERENCES inventory_locations(code) ON DELETE RESTRICT,
  sku          text NOT NULL REFERENCES product_variants(sku) ON DELETE RESTRICT,
  on_hand      integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved     integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  damaged      integer NOT NULL DEFAULT 0 CHECK (damaged >= 0),
  safety_stock integer NOT NULL DEFAULT 0 CHECK (safety_stock >= 0),
  -- available dihitung SATU kali di database agar UI/laporan/domain tidak punya definisi berbeda.
  available    integer GENERATED ALWAYS AS (GREATEST(on_hand - reserved - safety_stock, 0)) STORED,
  last_counted_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (reserved <= on_hand)
);
CREATE UNIQUE INDEX inventory_balances_sku_location_idx ON inventory_balances (location_code, sku);
CREATE INDEX inventory_balances_low_idx ON inventory_balances (available) WHERE available <= 5;

CREATE TABLE inventory_movements (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_code text NOT NULL REFERENCES inventory_locations(code) ON DELETE RESTRICT,
  sku          text NOT NULL REFERENCES product_variants(sku) ON DELETE RESTRICT,
  kind         text NOT NULL CHECK (kind IN
                 ('receipt','reserve','release','pick','ship','return_to_stock','damage','undamage',
                  'transfer_in','transfer_out','correction','cycle_count')),
  quantity     integer NOT NULL CHECK (quantity <> 0),
  balance_before integer NOT NULL,
  balance_after  integer NOT NULL,
  reason_code  text,
  note         text,
  ref_type     text CHECK (ref_type IS NULL OR ref_type IN ('order','order_item','return','shipment','purchase','count','adjustment','import')),
  ref_id       text,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  request_id   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_movements_sku_idx ON inventory_movements (sku, created_at DESC);
CREATE INDEX inventory_movements_ref_idx ON inventory_movements (ref_type, ref_id);
-- Append-only: koreksi dibuat lewat entri baru, bukan dengan menghapus jejak (Blueprint §12.3).
CREATE OR REPLACE FUNCTION forbid_mutation_on_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabel ledger bersifat append-only: %', TG_TABLE_NAME;
END $$;
CREATE TRIGGER inventory_movements_append_only BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation_on_ledger();

-- Konfigurasi ambang persetujuan adjustment (maker-checker) disimpan di site_settings (0005),
-- bukan sebagai angka yang tersebar di kode.
