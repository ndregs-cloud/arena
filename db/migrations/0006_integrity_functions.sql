-- =====================================================================
-- 0006 Fungsi integritas lintas modul: updated_at, validasi total order,
-- pembekuan baris yang direferensikan transaksi, dan helper stok atomik.
-- Blueprint §12.3 (integritas & constraint), §7.1 (atomicity), §6.1 (pricing snapshot)
-- =====================================================================

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fn_orders_total_matches() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.total_amount <> (NEW.subtotal_amount - NEW.discount_amount + NEW.shipping_amount + NEW.fee_amount) THEN
    RAISE EXCEPTION 'TOTAL_MISMATCH: total_amount harus subtotal - discount + shipping + fee'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.payment_status <> 'succeeded' AND NEW.status IN ('processing','shipped','delivered','completed') THEN
    RAISE EXCEPTION 'FULFILMENT_WITHOUT_PAYMENT: order belum terbayar tidak boleh dilepas ke gudang'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_total_and_payment_guard BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_orders_total_matches();

-- Order/order_item tidak boleh dihapus; produk yang direferensikan hanya boleh diarsipkan (CAT-05).
CREATE OR REPLACE FUNCTION fn_block_destructive_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RECORD_REFERENCED_BY_TRANSACTION: tabel % hanya boleh diubah lewat status, bukan dihapus', TG_TABLE_NAME
    USING ERRCODE = 'foreign_key_violation';
END $$;
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders FOR EACH ROW EXECUTE FUNCTION fn_block_destructive_delete();
CREATE TRIGGER order_items_no_delete BEFORE DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION fn_block_destructive_delete();
CREATE TRIGGER products_no_delete BEFORE DELETE ON products FOR EACH ROW EXECUTE FUNCTION fn_block_destructive_delete();
CREATE TRIGGER variants_no_delete BEFORE DELETE ON product_variants FOR EACH ROW EXECUTE FUNCTION fn_block_destructive_delete();

CREATE OR REPLACE FUNCTION set_updated_at_triggers() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS touch_%1$s ON %1$I', r.table_name);
    EXECUTE format('CREATE TRIGGER touch_%1$s BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', r.table_name);
  END LOOP;
END $$;
SELECT set_updated_at_triggers();

-- Helper stok atomik (dipakai service checkout/refund):
-- hanya mengurangi reserved/on_hand bila syarat terpenuhi dalam satu statement.
-- Mengembalikan 1 baris bila reservasi berhasil; kosong (NULL) = stok tidak cukup -> STOCK_INSUFFICIENT.
CREATE OR REPLACE FUNCTION fn_reserve_stock(p_location text, p_sku text, p_qty integer)
RETURNS integer LANGUAGE sql AS $$
  UPDATE inventory_balances
     SET reserved = reserved + p_qty, updated_at = now()
   WHERE location_code = p_location AND sku = p_sku
     AND GREATEST(on_hand - reserved - safety_stock, 0) >= p_qty
     AND p_qty > 0
  RETURNING 1
$$;

CREATE OR REPLACE FUNCTION fn_release_stock(p_location text, p_sku text, p_qty integer)
RETURNS void LANGUAGE sql AS $$
  UPDATE inventory_balances
     SET reserved = GREATEST(reserved - p_qty, 0), updated_at = now()
   WHERE location_code = p_location AND sku = p_sku
$$;

-- ship: kurangi on_hand dan reserved sekaligus (Blueprint §9.2 "kurangi on-hand yang sesuai")
CREATE OR REPLACE FUNCTION fn_consume_stock(p_location text, p_sku text, p_qty integer)
RETURNS void LANGUAGE sql AS $$
  UPDATE inventory_balances
     SET on_hand = GREATEST(on_hand - p_qty, 0),
         reserved = GREATEST(reserved - p_qty, 0),
         updated_at = now()
   WHERE location_code = p_location AND sku = p_sku
$$;

-- Ekspirasi reservasi (Blueprint §7.1 "jangan mengunci stok selamanya")
CREATE OR REPLACE FUNCTION fn_expire_reservations(p_now timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  n integer := 0;
  r record;
BEGIN
  FOR r IN SELECT id, location_code, sku, quantity, order_id FROM stock_reservations
             WHERE status = 'active' AND expires_at <= p_now FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE stock_reservations SET status = 'expired', resolved_at = p_now WHERE id = r.id;
    PERFORM fn_release_stock(r.location_code, r.sku, r.quantity);
    INSERT INTO order_events (order_id, event_type, from_status, to_status, actor_kind, visibility, note, data)
    SELECT r.order_id, 'reservation_expired', o.status, o.status, 'job', 'internal',
           'Reservasi stok kedaluwarsa sebelum pembayaran terkonfirmasi.', jsonb_build_object('sku', r.sku, 'quantity', r.quantity)
      FROM orders o WHERE o.id = r.order_id;
    -- Order yang belum terbayar dan reservasinya habis -> ditutup otomatis.
    UPDATE orders SET status = 'cancelled', cancelled_at = p_now, updated_at = now(),
                      cancel_reason = 'Batas waktu pembayaran habis (sistem).'
     WHERE id = r.order_id AND status = 'pending_payment' AND payment_status NOT IN ('succeeded');
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
