-- =====================================================================
-- 0009 Usage ledger kupon (Blueprint §12.1 promotions/coupon_redemptions)
-- =====================================================================

CREATE TABLE coupon_redemptions (
  promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  amount       bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (promotion_id, order_id)
);
CREATE INDEX coupon_redemptions_customer_idx ON coupon_redemptions (customer_id, created_at DESC);
