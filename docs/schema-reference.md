# Referensi Skema ndre.gstore

Dibangkitkan dari DB dev (semua migrasi diterapkan) oleh `scripts/schema-dump.mjs`.
Sumber kebenaran tetap `db/migrations/*.sql` — file ini untuk pembacaan cepat.

## `addresses`

| kolom         | tipe                     | null     | default           |
| ------------- | ------------------------ | -------- | ----------------- |
| `id`          | uuid                     | not null | gen_random_uuid() |
| `user_id`     | uuid                     | not null |                   |
| `label`       | text                     | not null | 'lainnya'::text   |
| `full_name`   | text                     | not null |                   |
| `phone`       | text                     | not null |                   |
| `province`    | text                     | not null |                   |
| `city`        | text                     | not null |                   |
| `district`    | text                     | not null |                   |
| `postal_code` | text                     | not null |                   |
| `street`      | text                     | not null |                   |
| `landmark`    | text                     |          |                   |
| `is_default`  | boolean                  | not null | false             |
| `is_deleted`  | boolean                  | not null | false             |
| `created_at`  | timestamp with time zone | not null | now()             |
| `updated_at`  | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE INDEX addresses_user_idx ON public.addresses USING btree (user_id) WHERE (is_deleted = false)`
- `CREATE UNIQUE INDEX addresses_one_default_idx ON public.addresses USING btree (user_id) WHERE ((is_default = true) AND (is_deleted = false))`
- `CREATE UNIQUE INDEX addresses_pkey ON public.addresses USING btree (id)`

## `analytics_events`

| kolom         | tipe                     | null     | default     |
| ------------- | ------------------------ | -------- | ----------- |
| `id`          | bigint                   | not null |             |
| `event_name`  | text                     | not null |             |
| `session_ref` | text                     |          |             |
| `properties`  | jsonb                    | not null | '{}'::jsonb |
| `occurred_at` | timestamp with time zone | not null | now()       |

Indeks/konstrain unik:

- `CREATE INDEX analytics_events_name_idx ON public.analytics_events USING btree (event_name, occurred_at DESC)`
- `CREATE UNIQUE INDEX analytics_events_pkey ON public.analytics_events USING btree (id)`

## `attribute_definitions`

| kolom            | tipe    | null     | default        |
| ---------------- | ------- | -------- | -------------- |
| `code`           | text    | not null |                |
| `label`          | text    | not null |                |
| `presentation`   | text    | not null | 'choice'::text |
| `is_required`    | boolean | not null | false          |
| `position`       | integer | not null | 0              |
| `allowed_values` | jsonb   | not null | '[]'::jsonb    |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX attribute_definitions_pkey ON public.attribute_definitions USING btree (code)`

## `audit_logs`

| kolom         | tipe                     | null     | default       |
| ------------- | ------------------------ | -------- | ------------- |
| `id`          | bigint                   | not null |               |
| `actor_id`    | uuid                     |          |               |
| `actor_email` | text                     |          |               |
| `actor_kind`  | text                     | not null | 'staff'::text |
| `action`      | text                     | not null |               |
| `target_type` | text                     | not null |               |
| `target_id`   | text                     |          |               |
| `before_data` | jsonb                    |          |               |
| `after_data`  | jsonb                    |          |               |
| `reason`      | text                     |          |               |
| `request_id`  | text                     |          |               |
| `ip_hash`     | text                     |          |               |
| `created_at`  | timestamp with time zone | not null | now()         |

Indeks/konstrain unik:

- `CREATE INDEX audit_logs_actor_idx ON public.audit_logs USING btree (actor_id, created_at DESC)`
- `CREATE UNIQUE INDEX audit_logs_pkey ON public.audit_logs USING btree (id)`
- `CREATE INDEX audit_logs_target_idx ON public.audit_logs USING btree (target_type, target_id, created_at DESC)`

## `auth_attempts`

| kolom               | tipe                     | null     | default |
| ------------------- | ------------------------ | -------- | ------- |
| `bucket`            | text                     | not null |         |
| `attempts`          | integer                  | not null | 1       |
| `window_started_at` | timestamp with time zone | not null | now()   |
| `last_attempt_at`   | timestamp with time zone | not null | now()   |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX auth_attempts_pkey ON public.auth_attempts USING btree (bucket)`

## `auth_tokens`

| kolom         | tipe                     | null     | default           |
| ------------- | ------------------------ | -------- | ----------------- |
| `id`          | uuid                     | not null | gen_random_uuid() |
| `user_id`     | uuid                     | not null |                   |
| `purpose`     | text                     | not null |                   |
| `token_hash`  | text                     | not null |                   |
| `expires_at`  | timestamp with time zone | not null |                   |
| `consumed_at` | timestamp with time zone |          |                   |
| `created_at`  | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX auth_tokens_pkey ON public.auth_tokens USING btree (id)`
- `CREATE UNIQUE INDEX auth_tokens_one_active_idx ON public.auth_tokens USING btree (user_id, purpose) WHERE (consumed_at IS NULL)`
- `CREATE INDEX auth_tokens_user_idx ON public.auth_tokens USING btree (user_id, purpose, created_at DESC)`
- `CREATE UNIQUE INDEX auth_tokens_token_hash_key ON public.auth_tokens USING btree (token_hash)`

## `campaign_banners`

| kolom        | tipe                     | null     | default           |
| ------------ | ------------------------ | -------- | ----------------- |
| `id`         | uuid                     | not null | gen_random_uuid() |
| `position`   | text                     | not null |                   |
| `title`      | text                     | not null |                   |
| `subtitle`   | text                     |          |                   |
| `image_url`  | text                     |          |                   |
| `image_alt`  | text                     |          |                   |
| `href`       | text                     |          |                   |
| `starts_at`  | timestamp with time zone |          |                   |
| `ends_at`    | timestamp with time zone |          |                   |
| `is_active`  | boolean                  | not null | true              |
| `sort_order` | integer                  | not null | 0                 |
| `created_at` | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX campaign_banners_pkey ON public.campaign_banners USING btree (id)`

## `cart_items`

| kolom             | tipe                     | null     | default           |
| ----------------- | ------------------------ | -------- | ----------------- |
| `id`              | uuid                     | not null | gen_random_uuid() |
| `cart_id`         | uuid                     | not null |                   |
| `variant_id`      | uuid                     | not null |                   |
| `quantity`        | integer                  | not null |                   |
| `saved_for_later` | boolean                  | not null | false             |
| `added_at`        | timestamp with time zone | not null | now()             |
| `updated_at`      | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX cart_items_pkey ON public.cart_items USING btree (id)`
- `CREATE UNIQUE INDEX cart_items_cart_id_variant_id_key ON public.cart_items USING btree (cart_id, variant_id)`

## `carts`

| kolom          | tipe                     | null     | default           |
| -------------- | ------------------------ | -------- | ----------------- |
| `id`           | uuid                     | not null | gen_random_uuid() |
| `token_hash`   | text                     |          |                   |
| `user_id`      | uuid                     |          |                   |
| `status`       | text                     | not null | 'active'::text    |
| `merged_into`  | uuid                     |          |                   |
| `draft`        | jsonb                    | not null | '{}'::jsonb       |
| `promotion_id` | uuid                     |          |                   |
| `created_at`   | timestamp with time zone | not null | now()             |
| `updated_at`   | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX carts_pkey ON public.carts USING btree (id)`
- `CREATE INDEX carts_user_active_idx ON public.carts USING btree (user_id) WHERE (status = 'active'::text)`
- `CREATE UNIQUE INDEX carts_token_hash_key ON public.carts USING btree (token_hash)`

## `categories`

| kolom              | tipe                     | null     | default           |
| ------------------ | ------------------------ | -------- | ----------------- |
| `id`               | uuid                     | not null | gen_random_uuid() |
| `slug`             | text                     | not null |                   |
| `name`             | text                     | not null |                   |
| `description`      | text                     |          |                   |
| `parent_id`        | uuid                     |          |                   |
| `position`         | integer                  | not null | 0                 |
| `image_url`        | text                     |          |                   |
| `image_alt`        | text                     |          |                   |
| `meta_title`       | text                     |          |                   |
| `meta_description` | text                     |          |                   |
| `is_active`        | boolean                  | not null | true              |
| `path_slugs`       | ARRAY                    | not null | '{}'::text[]      |
| `depth`            | integer                  | not null | 0                 |
| `created_at`       | timestamp with time zone | not null | now()             |
| `updated_at`       | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX categories_pkey ON public.categories USING btree (id)`
- `CREATE UNIQUE INDEX categories_slug_key ON public.categories USING btree (slug)`
- `CREATE INDEX categories_parent_idx ON public.categories USING btree (parent_id)`
- `CREATE INDEX categories_active_idx ON public.categories USING btree (is_active, position)`

## `category_attributes`

| kolom            | tipe    | null     | default |
| ---------------- | ------- | -------- | ------- |
| `category_id`    | uuid    | not null |         |
| `attribute_code` | text    | not null |         |
| `is_filterable`  | boolean | not null | true    |
| `position`       | integer | not null | 0       |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX category_attributes_pkey ON public.category_attributes USING btree (category_id, attribute_code)`

## `cms_pages`

| kolom              | tipe                     | null     | default           |
| ------------------ | ------------------------ | -------- | ----------------- |
| `id`               | uuid                     | not null | gen_random_uuid() |
| `slug`             | text                     | not null |                   |
| `title`            | text                     | not null |                   |
| `body`             | jsonb                    | not null | '[]'::jsonb       |
| `status`           | text                     | not null | 'draft'::text     |
| `published_at`     | timestamp with time zone |          |                   |
| `meta_title`       | text                     |          |                   |
| `meta_description` | text                     |          |                   |
| `updated_at`       | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX cms_pages_slug_key ON public.cms_pages USING btree (slug)`
- `CREATE UNIQUE INDEX cms_pages_pkey ON public.cms_pages USING btree (id)`

## `consent_records`

| kolom            | tipe                     | null     | default           |
| ---------------- | ------------------------ | -------- | ----------------- |
| `id`             | uuid                     | not null | gen_random_uuid() |
| `user_id`        | uuid                     |          |                   |
| `email`          | text                     |          |                   |
| `purpose`        | text                     | not null |                   |
| `policy_key`     | text                     | not null |                   |
| `policy_version` | text                     | not null |                   |
| `accepted_at`    | timestamp with time zone | not null | now()             |
| `source`         | text                     | not null | 'checkout'::text  |
| `request_id`     | text                     |          |                   |

Indeks/konstrain unik:

- `CREATE INDEX consent_records_user_idx ON public.consent_records USING btree (user_id, accepted_at DESC)`
- `CREATE UNIQUE INDEX consent_records_pkey ON public.consent_records USING btree (id)`

## `coupon_redemptions`

| kolom          | tipe                     | null     | default |
| -------------- | ------------------------ | -------- | ------- |
| `promotion_id` | uuid                     | not null |         |
| `order_id`     | uuid                     | not null |         |
| `customer_id`  | uuid                     |          |         |
| `amount`       | bigint                   | not null | 0       |
| `created_at`   | timestamp with time zone | not null | now()   |

Indeks/konstrain unik:

- `CREATE INDEX coupon_redemptions_customer_idx ON public.coupon_redemptions USING btree (customer_id, created_at DESC)`
- `CREATE UNIQUE INDEX coupon_redemptions_pkey ON public.coupon_redemptions USING btree (promotion_id, order_id)`

## `customer_profiles`

| kolom                | tipe                     | null     | default              |
| -------------------- | ------------------------ | -------- | -------------------- |
| `user_id`            | uuid                     | not null |                      |
| `marketing_consent`  | boolean                  | not null | false                |
| `consent_updated_at` | timestamp with time zone |          |                      |
| `locale`             | text                     | not null | 'id-ID'::text        |
| `timezone`           | text                     | not null | 'Asia/Jakarta'::text |
| `support_flag`       | text                     |          |                      |
| `notes_internal`     | text                     |          |                      |
| `created_at`         | timestamp with time zone | not null | now()                |
| `updated_at`         | timestamp with time zone | not null | now()                |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX customer_profiles_pkey ON public.customer_profiles USING btree (user_id)`

## `integration_outbox`

| kolom             | tipe                     | null     | default         |
| ----------------- | ------------------------ | -------- | --------------- |
| `id`              | bigint                   | not null |                 |
| `kind`            | text                     | not null |                 |
| `destination`     | text                     | not null |                 |
| `payload`         | jsonb                    | not null | '{}'::jsonb     |
| `idempotency_key` | text                     | not null |                 |
| `status`          | text                     | not null | 'pending'::text |
| `attempts`        | integer                  | not null | 0               |
| `max_attempts`    | integer                  | not null | 8               |
| `next_run_at`     | timestamp with time zone | not null | now()           |
| `last_error`      | text                     |          |                 |
| `correlation_id`  | text                     |          |                 |
| `created_at`      | timestamp with time zone | not null | now()           |
| `finished_at`     | timestamp with time zone |          |                 |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX integration_outbox_pkey ON public.integration_outbox USING btree (id)`
- `CREATE INDEX integration_outbox_due_idx ON public.integration_outbox USING btree (next_run_at) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]))`
- `CREATE UNIQUE INDEX integration_outbox_idempotency_key_key ON public.integration_outbox USING btree (idempotency_key)`

## `inventory_balances`

| kolom             | tipe                     | null     | default           |
| ----------------- | ------------------------ | -------- | ----------------- |
| `id`              | uuid                     | not null | gen_random_uuid() |
| `location_code`   | text                     | not null |                   |
| `sku`             | text                     | not null |                   |
| `on_hand`         | integer                  | not null | 0                 |
| `reserved`        | integer                  | not null | 0                 |
| `damaged`         | integer                  | not null | 0                 |
| `safety_stock`    | integer                  | not null | 0                 |
| `available`       | integer                  |          |                   |
| `last_counted_at` | timestamp with time zone |          |                   |
| `updated_at`      | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX inventory_balances_sku_location_idx ON public.inventory_balances USING btree (location_code, sku)`
- `CREATE UNIQUE INDEX inventory_balances_pkey ON public.inventory_balances USING btree (id)`
- `CREATE INDEX inventory_balances_low_idx ON public.inventory_balances USING btree (available) WHERE (available <= 5)`

## `inventory_locations`

| kolom        | tipe                     | null     | default              |
| ------------ | ------------------------ | -------- | -------------------- |
| `code`       | text                     | not null |                      |
| `name`       | text                     | not null |                      |
| `kind`       | text                     | not null | 'warehouse'::text    |
| `timezone`   | text                     | not null | 'Asia/Jakarta'::text |
| `address`    | text                     |          |                      |
| `is_active`  | boolean                  | not null | true                 |
| `created_at` | timestamp with time zone | not null | now()                |
| `updated_at` | timestamp with time zone | not null | now()                |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX inventory_locations_pkey ON public.inventory_locations USING btree (code)`

## `inventory_movements`

| kolom            | tipe                     | null     | default |
| ---------------- | ------------------------ | -------- | ------- |
| `id`             | bigint                   | not null |         |
| `location_code`  | text                     | not null |         |
| `sku`            | text                     | not null |         |
| `kind`           | text                     | not null |         |
| `quantity`       | integer                  | not null |         |
| `balance_before` | integer                  | not null |         |
| `balance_after`  | integer                  | not null |         |
| `reason_code`    | text                     |          |         |
| `note`           | text                     |          |         |
| `ref_type`       | text                     |          |         |
| `ref_id`         | text                     |          |         |
| `actor_id`       | uuid                     |          |         |
| `request_id`     | text                     |          |         |
| `created_at`     | timestamp with time zone | not null | now()   |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX inventory_movements_pkey ON public.inventory_movements USING btree (id)`
- `CREATE INDEX inventory_movements_sku_idx ON public.inventory_movements USING btree (sku, created_at DESC)`
- `CREATE INDEX inventory_movements_ref_idx ON public.inventory_movements USING btree (ref_type, ref_id)`

## `newsletter_subscriptions`

| kolom              | tipe                     | null     | default           |
| ------------------ | ------------------------ | -------- | ----------------- |
| `id`               | uuid                     | not null | gen_random_uuid() |
| `email_normalized` | text                     | not null |                   |
| `status`           | text                     | not null | 'pending'::text   |
| `confirm_token`    | text                     |          |                   |
| `consent_at`       | timestamp with time zone |          |                   |
| `created_at`       | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX newsletter_subscriptions_pkey ON public.newsletter_subscriptions USING btree (id)`
- `CREATE UNIQUE INDEX newsletter_subscriptions_email_normalized_key ON public.newsletter_subscriptions USING btree (email_normalized)`

## `notification_outbox`

| kolom              | tipe                     | null     | default        |
| ------------------ | ------------------------ | -------- | -------------- |
| `id`               | bigint                   | not null |                |
| `kind`             | text                     | not null |                |
| `channel`          | text                     | not null | 'email'::text  |
| `to_address`       | text                     | not null |                |
| `subject`          | text                     |          |                |
| `body`             | text                     | not null |                |
| `template`         | text                     | not null |                |
| `template_version` | integer                  | not null | 1              |
| `order_id`         | uuid                     |          |                |
| `return_id`        | uuid                     |          |                |
| `payload`          | jsonb                    | not null | '{}'::jsonb    |
| `status`           | text                     | not null | 'queued'::text |
| `attempts`         | integer                  | not null | 0              |
| `next_run_at`      | timestamp with time zone | not null | now()          |
| `last_error`       | text                     |          |                |
| `requires_consent` | boolean                  | not null | false          |
| `created_at`       | timestamp with time zone | not null | now()          |
| `sent_at`          | timestamp with time zone |          |                |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX notification_outbox_pkey ON public.notification_outbox USING btree (id)`
- `CREATE INDEX notification_outbox_due_idx ON public.notification_outbox USING btree (next_run_at) WHERE (status = ANY (ARRAY['queued'::text, 'failed'::text]))`

## `order_events`

| kolom         | tipe                     | null     | default          |
| ------------- | ------------------------ | -------- | ---------------- |
| `id`          | bigint                   | not null |                  |
| `order_id`    | uuid                     | not null |                  |
| `event_type`  | text                     | not null |                  |
| `from_status` | text                     |          |                  |
| `to_status`   | text                     |          |                  |
| `actor_id`    | uuid                     |          |                  |
| `actor_kind`  | text                     | not null | 'system'::text   |
| `visibility`  | text                     | not null | 'customer'::text |
| `note`        | text                     |          |                  |
| `data`        | jsonb                    | not null | '{}'::jsonb      |
| `request_id`  | text                     |          |                  |
| `created_at`  | timestamp with time zone | not null | now()            |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX order_events_pkey ON public.order_events USING btree (id)`
- `CREATE INDEX order_events_order_idx ON public.order_events USING btree (order_id, created_at)`

## `order_items`

| kolom                       | tipe    | null     | default           |
| --------------------------- | ------- | -------- | ----------------- |
| `id`                        | uuid    | not null | gen_random_uuid() |
| `order_id`                  | uuid    | not null |                   |
| `product_id`                | uuid    | not null |                   |
| `variant_id`                | uuid    | not null |                   |
| `sku`                       | text    | not null |                   |
| `name_snapshot`             | text    | not null |                   |
| `variant_label_snapshot`    | text    | not null |                   |
| `unit_price_amount`         | bigint  | not null |                   |
| `quantity`                  | integer | not null |                   |
| `discount_allocated_amount` | bigint  | not null | 0                 |
| `line_total_amount`         | bigint  |          |                   |
| `image_url`                 | text    |          |                   |
| `is_returnable`             | boolean | not null | true              |
| `returned_quantity`         | integer | not null | 0                 |

Indeks/konstrain unik:

- `CREATE INDEX order_items_order_idx ON public.order_items USING btree (order_id)`
- `CREATE UNIQUE INDEX order_items_pkey ON public.order_items USING btree (id)`
- `CREATE UNIQUE INDEX order_items_order_id_variant_id_key ON public.order_items USING btree (order_id, variant_id)`
- `CREATE INDEX order_items_variant_idx ON public.order_items USING btree (variant_id)`

## `orders`

| kolom                | tipe                     | null     | default                  |
| -------------------- | ------------------------ | -------- | ------------------------ |
| `id`                 | uuid                     | not null | gen_random_uuid()        |
| `order_number`       | text                     | not null |                          |
| `tracking_token`     | text                     | not null |                          |
| `customer_id`        | uuid                     |          |                          |
| `email`              | text                     | not null |                          |
| `phone`              | text                     | not null |                          |
| `status`             | text                     | not null | 'pending_payment'::text  |
| `payment_status`     | text                     | not null | 'awaiting_payment'::text |
| `fulfillment_status` | text                     | not null | 'unfulfilled'::text      |
| `currency`           | character                | not null | 'IDR'::bpchar            |
| `subtotal_amount`    | bigint                   | not null |                          |
| `discount_amount`    | bigint                   | not null |                          |
| `shipping_amount`    | bigint                   | not null |                          |
| `fee_amount`         | bigint                   | not null | 0                        |
| `total_amount`       | bigint                   | not null |                          |
| `refunded_amount`    | bigint                   | not null | 0                        |
| `total_computed`     | bigint                   |          |                          |
| `promotion_id`       | uuid                     |          |                          |
| `shipping_address`   | jsonb                    | not null |                          |
| `shipping_selection` | jsonb                    | not null |                          |
| `policy_version`     | text                     | not null |                          |
| `marketing_consent`  | boolean                  | not null | false                    |
| `campaign_source`    | text                     |          |                          |
| `customer_note`      | text                     |          |                          |
| `cart_id`            | uuid                     |          |                          |
| `created_at`         | timestamp with time zone | not null | now()                    |
| `updated_at`         | timestamp with time zone | not null | now()                    |
| `paid_at`            | timestamp with time zone |          |                          |
| `shipped_at`         | timestamp with time zone |          |                          |
| `delivered_at`       | timestamp with time zone |          |                          |
| `completed_at`       | timestamp with time zone |          |                          |
| `cancelled_at`       | timestamp with time zone |          |                          |
| `cancel_reason`      | text                     |          |                          |
| `expires_at`         | timestamp with time zone |          |                          |
| `idempotency_key`    | text                     |          |                          |

Indeks/konstrain unik:

- `CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id, created_at DESC)`
- `CREATE INDEX orders_payment_status_idx ON public.orders USING btree (payment_status, created_at DESC) WHERE (payment_status = ANY (ARRAY['awaiting_payment'::text, 'pending'::text]))`
- `CREATE INDEX orders_status_idx ON public.orders USING btree (status, created_at DESC)`
- `CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)`
- `CREATE UNIQUE INDEX orders_order_number_key ON public.orders USING btree (order_number)`
- `CREATE UNIQUE INDEX orders_tracking_token_key ON public.orders USING btree (tracking_token)`
- `CREATE UNIQUE INDEX orders_idempotency_key_key ON public.orders USING btree (idempotency_key)`

## `payment_attempts`

| kolom             | tipe                     | null     | default           |
| ----------------- | ------------------------ | -------- | ----------------- |
| `id`              | uuid                     | not null | gen_random_uuid() |
| `order_id`        | uuid                     | not null |                   |
| `provider_code`   | text                     | not null |                   |
| `provider_ref`    | text                     |          |                   |
| `method_code`     | text                     | not null |                   |
| `method_name`     | text                     | not null |                   |
| `amount`          | bigint                   | not null |                   |
| `currency`        | character                | not null | 'IDR'::bpchar     |
| `status`          | text                     | not null | 'created'::text   |
| `idempotency_key` | text                     | not null |                   |
| `instructions`    | text                     |          |                   |
| `redirect_url`    | text                     |          |                   |
| `is_simulated`    | boolean                  | not null | true              |
| `failure_reason`  | text                     |          |                   |
| `created_at`      | timestamp with time zone | not null | now()             |
| `updated_at`      | timestamp with time zone | not null | now()             |
| `succeeded_at`    | timestamp with time zone |          |                   |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX payment_attempts_provider_ref_idx ON public.payment_attempts USING btree (provider_code, provider_ref) WHERE (provider_ref IS NOT NULL)`
- `CREATE INDEX payment_attempts_order_idx ON public.payment_attempts USING btree (order_id, created_at DESC)`
- `CREATE UNIQUE INDEX payment_attempts_pkey ON public.payment_attempts USING btree (id)`
- `CREATE UNIQUE INDEX payment_attempts_idempotency_key_key ON public.payment_attempts USING btree (idempotency_key)`

## `payment_webhook_events`

| kolom             | tipe                     | null     | default          |
| ----------------- | ------------------------ | -------- | ---------------- |
| `id`              | bigint                   | not null |                  |
| `provider_code`   | text                     | not null |                  |
| `event_id`        | text                     | not null |                  |
| `event_type`      | text                     | not null |                  |
| `attempt_ref`     | text                     |          |                  |
| `order_id`        | uuid                     |          |                  |
| `amount`          | bigint                   |          |                  |
| `currency`        | character                |          |                  |
| `signature_valid` | boolean                  | not null | false            |
| `status`          | text                     | not null | 'received'::text |
| `payload`         | jsonb                    | not null | '{}'::jsonb      |
| `error_code`      | text                     |          |                  |
| `received_at`     | timestamp with time zone | not null | now()            |
| `processed_at`    | timestamp with time zone |          |                  |

Indeks/konstrain unik:

- `CREATE INDEX payment_webhook_pending_idx ON public.payment_webhook_events USING btree (received_at) WHERE (status = 'received'::text)`
- `CREATE UNIQUE INDEX payment_webhook_events_provider_code_event_id_key ON public.payment_webhook_events USING btree (provider_code, event_id)`
- `CREATE UNIQUE INDEX payment_webhook_events_pkey ON public.payment_webhook_events USING btree (id)`

## `permissions`

| kolom   | tipe | null     | default        |
| ------- | ---- | -------- | -------------- |
| `code`  | text | not null |                |
| `label` | text | not null |                |
| `risk`  | text | not null | 'normal'::text |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX permissions_pkey ON public.permissions USING btree (code)`

## `policies`

| kolom          | tipe                     | null     | default |
| -------------- | ------------------------ | -------- | ------- |
| `key`          | text                     | not null |         |
| `version`      | integer                  | not null |         |
| `title`        | text                     | not null |         |
| `body`         | text                     | not null |         |
| `effective_at` | timestamp with time zone | not null | now()   |
| `is_current`   | boolean                  | not null | false   |
| `created_by`   | uuid                     |          |         |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX policies_pkey ON public.policies USING btree (key, version)`
- `CREATE UNIQUE INDEX policies_one_current_idx ON public.policies USING btree (key) WHERE (is_current = true)`

## `price_history`

| kolom          | tipe                     | null     | default       |
| -------------- | ------------------------ | -------- | ------------- |
| `id`           | bigint                   | not null |               |
| `variant_id`   | uuid                     | not null |               |
| `old_amount`   | bigint                   | not null |               |
| `new_amount`   | bigint                   | not null |               |
| `currency`     | character                | not null | 'IDR'::bpchar |
| `changed_by`   | uuid                     |          |               |
| `reason`       | text                     |          |               |
| `effective_at` | timestamp with time zone | not null | now()         |
| `request_id`   | text                     |          |               |

Indeks/konstrain unik:

- `CREATE INDEX price_history_variant_idx ON public.price_history USING btree (variant_id, effective_at DESC)`
- `CREATE UNIQUE INDEX price_history_pkey ON public.price_history USING btree (id)`

## `privacy_requests`

| kolom                  | tipe                     | null     | default           |
| ---------------------- | ------------------------ | -------- | ----------------- |
| `id`                   | uuid                     | not null | gen_random_uuid() |
| `reference`            | text                     | not null |                   |
| `user_id`              | uuid                     |          |                   |
| `email`                | text                     | not null |                   |
| `kind`                 | text                     | not null |                   |
| `status`               | text                     | not null | 'received'::text  |
| `detail`               | text                     |          |                   |
| `identity_verified_at` | timestamp with time zone |          |                   |
| `completed_at`         | timestamp with time zone |          |                   |
| `handled_by`           | uuid                     |          |                   |
| `created_at`           | timestamp with time zone | not null | now()             |
| `updated_at`           | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX privacy_requests_pkey ON public.privacy_requests USING btree (id)`
- `CREATE UNIQUE INDEX privacy_requests_reference_key ON public.privacy_requests USING btree (reference)`

## `product_media`

| kolom        | tipe                     | null     | default           |
| ------------ | ------------------------ | -------- | ----------------- |
| `id`         | uuid                     | not null | gen_random_uuid() |
| `product_id` | uuid                     | not null |                   |
| `variant_id` | uuid                     |          |                   |
| `url`        | text                     | not null |                   |
| `alt_text`   | text                     | not null |                   |
| `position`   | integer                  | not null | 0                 |
| `width`      | integer                  | not null | 1200              |
| `height`     | integer                  | not null | 1500              |
| `format`     | text                     | not null | 'image'::text     |
| `is_primary` | boolean                  | not null | false             |
| `created_at` | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX product_media_one_primary_idx ON public.product_media USING btree (product_id) WHERE (is_primary = true)`
- `CREATE UNIQUE INDEX product_media_pkey ON public.product_media USING btree (id)`
- `CREATE INDEX product_media_product_idx ON public.product_media USING btree (product_id, position)`

## `product_review_stats`

| kolom          | tipe                     | null     | default |
| -------------- | ------------------------ | -------- | ------- |
| `product_id`   | uuid                     | not null |         |
| `average`      | numeric                  | not null | 0       |
| `review_count` | integer                  | not null | 0       |
| `updated_at`   | timestamp with time zone | not null | now()   |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX product_review_stats_pkey ON public.product_review_stats USING btree (product_id)`

## `product_variants`

| kolom                 | tipe                     | null     | default           |
| --------------------- | ------------------------ | -------- | ----------------- |
| `id`                  | uuid                     | not null | gen_random_uuid() |
| `product_id`          | uuid                     | not null |                   |
| `sku`                 | text                     | not null |                   |
| `label`               | text                     | not null |                   |
| `options`             | jsonb                    | not null | '{}'::jsonb       |
| `option_values`       | ARRAY                    | not null | '{}'::text[]      |
| `price_amount`        | bigint                   | not null |                   |
| `compare_at_amount`   | bigint                   |          |                   |
| `currency`            | character                | not null | 'IDR'::bpchar     |
| `track_inventory`     | boolean                  | not null | true              |
| `low_stock_threshold` | integer                  | not null | 5                 |
| `safety_stock`        | integer                  | not null | 0                 |
| `min_qty_per_order`   | integer                  | not null | 1                 |
| `max_qty_per_order`   | integer                  |          |                   |
| `is_active`           | boolean                  | not null | true              |
| `is_deleted`          | boolean                  | not null | false             |
| `position`            | integer                  | not null | 0                 |
| `created_at`          | timestamp with time zone | not null | now()             |
| `updated_at`          | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE INDEX product_variants_product_idx ON public.product_variants USING btree (product_id) WHERE (is_deleted = false)`
- `CREATE UNIQUE INDEX product_variants_pkey ON public.product_variants USING btree (id)`
- `CREATE UNIQUE INDEX product_variants_sku_key ON public.product_variants USING btree (sku)`

## `products`

| kolom               | tipe                     | null     | default           |
| ------------------- | ------------------------ | -------- | ----------------- |
| `id`                | uuid                     | not null | gen_random_uuid() |
| `sku`               | text                     | not null |                   |
| `slug`              | text                     | not null |                   |
| `name`              | text                     | not null |                   |
| `summary`           | text                     | not null | ''::text          |
| `description`       | text                     | not null | ''::text          |
| `brand`             | text                     |          |                   |
| `status`            | text                     | not null | 'draft'::text     |
| `category_id`       | uuid                     | not null |                   |
| `attributes`        | jsonb                    | not null | '{}'::jsonb       |
| `care_instructions` | text                     |          |                   |
| `warranty`          | text                     |          |                   |
| `package_contents`  | jsonb                    | not null | '[]'::jsonb       |
| `meta_title`        | text                     |          |                   |
| `meta_description`  | text                     |          |                   |
| `canonical_slug`    | text                     |          |                   |
| `retired_slugs`     | ARRAY                    | not null | '{}'::text[]      |
| `popularity`        | integer                  | not null | 0                 |
| `created_at`        | timestamp with time zone | not null | now()             |
| `updated_at`        | timestamp with time zone | not null | now()             |
| `published_at`      | timestamp with time zone |          |                   |
| `archived_at`       | timestamp with time zone |          |                   |
| `search_vector`     | tsvector                 |          |                   |

Indeks/konstrain unik:

- `CREATE INDEX products_search_idx ON public.products USING gin (search_vector)`
- `CREATE INDEX products_published_idx ON public.products USING btree (status, category_id, published_at DESC)`
- `CREATE INDEX products_popularity_idx ON public.products USING btree (popularity DESC) WHERE (status = 'published'::text)`
- `CREATE UNIQUE INDEX products_pkey ON public.products USING btree (id)`
- `CREATE UNIQUE INDEX products_sku_key ON public.products USING btree (sku)`
- `CREATE UNIQUE INDEX products_slug_key ON public.products USING btree (slug)`

## `promotions`

| kolom                 | tipe                     | null     | default           |
| --------------------- | ------------------------ | -------- | ----------------- |
| `id`                  | uuid                     | not null | gen_random_uuid() |
| `code`                | text                     | not null |                   |
| `label`               | text                     | not null |                   |
| `kind`                | text                     | not null |                   |
| `value`               | integer                  | not null |                   |
| `min_spend_amount`    | bigint                   | not null | 0                 |
| `discount_cap_amount` | bigint                   |          |                   |
| `scope`               | jsonb                    |          |                   |
| `starts_at`           | timestamp with time zone | not null |                   |
| `ends_at`             | timestamp with time zone | not null |                   |
| `usage_limit`         | integer                  |          |                   |
| `used_count`          | integer                  | not null | 0                 |
| `per_customer_limit`  | integer                  |          |                   |
| `stackable`           | boolean                  | not null | false             |
| `is_active`           | boolean                  | not null | true              |
| `requires_approval`   | boolean                  | not null | false             |
| `approved_by`         | uuid                     |          |                   |
| `approved_at`         | timestamp with time zone |          |                   |
| `created_at`          | timestamp with time zone | not null | now()             |
| `updated_at`          | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX promotions_pkey ON public.promotions USING btree (id)`
- `CREATE UNIQUE INDEX promotions_code_key ON public.promotions USING btree (code)`
- `CREATE INDEX promotions_window_idx ON public.promotions USING btree (starts_at, ends_at) WHERE (is_active = true)`

## `refund_items`

| kolom           | tipe    | null     | default |
| --------------- | ------- | -------- | ------- |
| `refund_id`     | uuid    | not null |         |
| `order_item_id` | uuid    | not null |         |
| `quantity`      | integer | not null |         |
| `amount`        | bigint  | not null |         |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX refund_items_pkey ON public.refund_items USING btree (refund_id, order_item_id)`

## `refunds`

| kolom                | tipe                     | null     | default           |
| -------------------- | ------------------------ | -------- | ----------------- |
| `id`                 | uuid                     | not null | gen_random_uuid() |
| `reference`          | text                     | not null |                   |
| `order_id`           | uuid                     | not null |                   |
| `payment_attempt_id` | uuid                     |          |                   |
| `return_id`          | uuid                     |          |                   |
| `amount`             | bigint                   | not null |                   |
| `currency`           | character                | not null | 'IDR'::bpchar     |
| `status`             | text                     | not null | 'requested'::text |
| `reason`             | text                     | not null |                   |
| `include_shipping`   | boolean                  | not null | false             |
| `requested_by`       | uuid                     |          |                   |
| `approved_by`        | uuid                     |          |                   |
| `approved_at`        | timestamp with time zone |          |                   |
| `provider_ref`       | text                     |          |                   |
| `idempotency_key`    | text                     |          |                   |
| `created_at`         | timestamp with time zone | not null | now()             |
| `updated_at`         | timestamp with time zone | not null | now()             |
| `succeeded_at`       | timestamp with time zone |          |                   |

Indeks/konstrain unik:

- `CREATE INDEX refunds_status_idx ON public.refunds USING btree (status, created_at)`
- `CREATE UNIQUE INDEX refunds_idempotency_key_key ON public.refunds USING btree (idempotency_key)`
- `CREATE UNIQUE INDEX refunds_pkey ON public.refunds USING btree (id)`
- `CREATE UNIQUE INDEX refunds_reference_key ON public.refunds USING btree (reference)`

## `return_events`

| kolom         | tipe                     | null     | default          |
| ------------- | ------------------------ | -------- | ---------------- |
| `id`          | bigint                   | not null |                  |
| `return_id`   | uuid                     | not null |                  |
| `event_type`  | text                     | not null |                  |
| `from_status` | text                     |          |                  |
| `to_status`   | text                     |          |                  |
| `actor_id`    | uuid                     |          |                  |
| `note`        | text                     |          |                  |
| `visibility`  | text                     | not null | 'customer'::text |
| `created_at`  | timestamp with time zone | not null | now()            |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX return_events_pkey ON public.return_events USING btree (id)`

## `return_items`

| kolom                | tipe    | null     | default |
| -------------------- | ------- | -------- | ------- |
| `return_id`          | uuid    | not null |         |
| `order_item_id`      | uuid    | not null |         |
| `quantity_requested` | integer | not null |         |
| `quantity_received`  | integer | not null | 0       |
| `quantity_restocked` | integer | not null | 0       |
| `quantity_damaged`   | integer | not null | 0       |
| `amount`             | bigint  | not null | 0       |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX return_items_pkey ON public.return_items USING btree (return_id, order_item_id)`

## `returns`

| kolom              | tipe                     | null     | default           |
| ------------------ | ------------------------ | -------- | ----------------- |
| `id`               | uuid                     | not null | gen_random_uuid() |
| `reference`        | text                     | not null |                   |
| `order_id`         | uuid                     | not null |                   |
| `customer_id`      | uuid                     |          |                   |
| `status`           | text                     | not null | 'requested'::text |
| `reason_code`      | text                     | not null |                   |
| `description`      | text                     | not null |                   |
| `resolution`       | text                     | not null | 'refund'::text    |
| `policy_version`   | text                     | not null |                   |
| `requested_amount` | bigint                   | not null | 0                 |
| `approved_amount`  | bigint                   |          |                   |
| `refund_id`        | uuid                     |          |                   |
| `evidence`         | jsonb                    | not null | '[]'::jsonb       |
| `inspection`       | jsonb                    | not null | '{}'::jsonb       |
| `decision_note`    | text                     |          |                   |
| `decided_by`       | uuid                     |          |                   |
| `decided_at`       | timestamp with time zone |          |                   |
| `restock_allowed`  | boolean                  | not null | false             |
| `deadline_at`      | timestamp with time zone |          |                   |
| `created_at`       | timestamp with time zone | not null | now()             |
| `updated_at`       | timestamp with time zone | not null | now()             |
| `closed_at`        | timestamp with time zone |          |                   |

Indeks/konstrain unik:

- `CREATE INDEX returns_status_idx ON public.returns USING btree (status, created_at DESC)`
- `CREATE UNIQUE INDEX returns_pkey ON public.returns USING btree (id)`
- `CREATE UNIQUE INDEX returns_reference_key ON public.returns USING btree (reference)`

## `reviews`

| kolom                  | tipe                     | null     | default           |
| ---------------------- | ------------------------ | -------- | ----------------- |
| `id`                   | uuid                     | not null | gen_random_uuid() |
| `product_id`           | uuid                     | not null |                   |
| `author_id`            | uuid                     |          |                   |
| `order_id`             | uuid                     |          |                   |
| `order_item_id`        | uuid                     |          |                   |
| `rating`               | integer                  | not null |                   |
| `title`                | text                     | not null |                   |
| `body`                 | text                     | not null | ''::text          |
| `variant_label`        | text                     |          |                   |
| `status`               | text                     | not null | 'pending'::text   |
| `moderation_note`      | text                     |          |                   |
| `is_verified_purchase` | boolean                  | not null | false             |
| `moderation_reason`    | text                     |          |                   |
| `moderated_by`         | uuid                     |          |                   |
| `moderated_at`         | timestamp with time zone |          |                   |
| `created_at`           | timestamp with time zone | not null | now()             |
| `updated_at`           | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE INDEX reviews_product_idx ON public.reviews USING btree (product_id, status, created_at DESC)`
- `CREATE UNIQUE INDEX reviews_pkey ON public.reviews USING btree (id)`
- `CREATE UNIQUE INDEX reviews_one_per_order_line_idx ON public.reviews USING btree (order_item_id) WHERE (order_item_id IS NOT NULL)`

## `role_permissions`

| kolom             | tipe | null     | default |
| ----------------- | ---- | -------- | ------- |
| `role_code`       | text | not null |         |
| `permission_code` | text | not null |         |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX role_permissions_pkey ON public.role_permissions USING btree (role_code, permission_code)`

## `roles`

| kolom           | tipe                     | null     | default |
| --------------- | ------------------------ | -------- | ------- |
| `code`          | text                     | not null |         |
| `label`         | text                     | not null |         |
| `description`   | text                     |          |         |
| `is_privileged` | boolean                  | not null | false   |
| `created_at`    | timestamp with time zone | not null | now()   |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX roles_pkey ON public.roles USING btree (code)`

## `schema_migrations`

| kolom        | tipe                     | null     | default |
| ------------ | ------------------------ | -------- | ------- |
| `version`    | text                     | not null |         |
| `applied_at` | timestamp with time zone | not null | now()   |
| `checksum`   | text                     | not null |         |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX schema_migrations_pkey ON public.schema_migrations USING btree (version)`

## `sessions`

| kolom          | tipe                     | null     | default           |
| -------------- | ------------------------ | -------- | ----------------- |
| `id`           | uuid                     | not null | gen_random_uuid() |
| `public_id`    | text                     | not null |                   |
| `user_id`      | uuid                     | not null |                   |
| `expires_at`   | timestamp with time zone | not null |                   |
| `revoked_at`   | timestamp with time zone |          |                   |
| `ip_hash`      | text                     |          |                   |
| `user_agent`   | text                     |          |                   |
| `created_at`   | timestamp with time zone | not null | now()             |
| `last_seen_at` | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE INDEX sessions_user_idx ON public.sessions USING btree (user_id, expires_at DESC)`
- `CREATE UNIQUE INDEX sessions_pkey ON public.sessions USING btree (id)`
- `CREATE UNIQUE INDEX sessions_public_id_key ON public.sessions USING btree (public_id)`

## `shipment_items`

| kolom           | tipe    | null     | default |
| --------------- | ------- | -------- | ------- |
| `shipment_id`   | uuid    | not null |         |
| `order_item_id` | uuid    | not null |         |
| `quantity`      | integer | not null |         |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX shipment_items_pkey ON public.shipment_items USING btree (shipment_id, order_item_id)`

## `shipments`

| kolom                | tipe                     | null     | default           |
| -------------------- | ------------------------ | -------- | ----------------- |
| `id`                 | uuid                     | not null | gen_random_uuid() |
| `order_id`           | uuid                     | not null |                   |
| `carrier_code`       | text                     | not null |                   |
| `service_code`       | text                     | not null |                   |
| `tracking_number`    | text                     |          |                   |
| `status`             | text                     | not null | 'created'::text   |
| `package_count`      | integer                  | not null | 1                 |
| `label_ref`          | text                     |          |                   |
| `note`               | text                     |          |                   |
| `is_tracking_manual` | boolean                  | not null | true              |
| `created_by`         | uuid                     |          |                   |
| `created_at`         | timestamp with time zone | not null | now()             |
| `updated_at`         | timestamp with time zone | not null | now()             |
| `shipped_at`         | timestamp with time zone |          |                   |
| `delivered_at`       | timestamp with time zone |          |                   |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX shipments_pkey ON public.shipments USING btree (id)`
- `CREATE UNIQUE INDEX shipments_tracking_idx ON public.shipments USING btree (carrier_code, tracking_number) WHERE (tracking_number IS NOT NULL)`
- `CREATE INDEX shipments_order_idx ON public.shipments USING btree (order_id)`

## `site_settings`

| kolom         | tipe                     | null     | default |
| ------------- | ------------------------ | -------- | ------- |
| `key`         | text                     | not null |         |
| `value`       | jsonb                    | not null |         |
| `description` | text                     |          |         |
| `updated_by`  | uuid                     |          |         |
| `updated_at`  | timestamp with time zone | not null | now()   |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX site_settings_pkey ON public.site_settings USING btree (key)`

## `stock_adjustment_requests`

| kolom               | tipe                     | null     | default           |
| ------------------- | ------------------------ | -------- | ----------------- |
| `id`                | uuid                     | not null | gen_random_uuid() |
| `location_code`     | text                     | not null |                   |
| `sku`               | text                     | not null |                   |
| `delta`             | integer                  | not null |                   |
| `reason_code`       | text                     | not null |                   |
| `note`              | text                     |          |                   |
| `status`            | text                     | not null | 'pending'::text   |
| `requires_approval` | boolean                  | not null | false             |
| `requested_by`      | uuid                     |          |                   |
| `requested_at`      | timestamp with time zone | not null | now()             |
| `reviewed_by`       | uuid                     |          |                   |
| `reviewed_at`       | timestamp with time zone |          |                   |
| `review_note`       | text                     |          |                   |
| `applied_at`        | timestamp with time zone |          |                   |
| `idempotency_key`   | text                     |          |                   |

Indeks/konstrain unik:

- `CREATE INDEX stock_adjustment_pending_idx ON public.stock_adjustment_requests USING btree (status, requested_at DESC)`
- `CREATE UNIQUE INDEX stock_adjustment_requests_pkey ON public.stock_adjustment_requests USING btree (id)`
- `CREATE UNIQUE INDEX stock_adjustment_requests_idempotency_key_key ON public.stock_adjustment_requests USING btree (idempotency_key)`

## `stock_reservations`

| kolom           | tipe                     | null     | default           |
| --------------- | ------------------------ | -------- | ----------------- |
| `id`            | uuid                     | not null | gen_random_uuid() |
| `location_code` | text                     | not null |                   |
| `sku`           | text                     | not null |                   |
| `order_id`      | uuid                     | not null |                   |
| `order_item_id` | uuid                     | not null |                   |
| `quantity`      | integer                  | not null |                   |
| `status`        | text                     | not null | 'active'::text    |
| `expires_at`    | timestamp with time zone | not null |                   |
| `created_at`    | timestamp with time zone | not null | now()             |
| `resolved_at`   | timestamp with time zone |          |                   |

Indeks/konstrain unik:

- `CREATE INDEX stock_reservations_expiry_idx ON public.stock_reservations USING btree (expires_at) WHERE (status = 'active'::text)`
- `CREATE UNIQUE INDEX stock_reservations_active_item_idx ON public.stock_reservations USING btree (order_item_id) WHERE (status = 'active'::text)`
- `CREATE UNIQUE INDEX stock_reservations_pkey ON public.stock_reservations USING btree (id)`

## `tracking_events`

| kolom               | tipe                     | null     | default        |
| ------------------- | ------------------------ | -------- | -------------- |
| `id`                | bigint                   | not null |                |
| `shipment_id`       | uuid                     | not null |                |
| `provider_event_id` | text                     |          |                |
| `status`            | text                     | not null |                |
| `status_label`      | text                     | not null |                |
| `location`          | text                     |          |                |
| `occurred_at`       | timestamp with time zone | not null |                |
| `source`            | text                     | not null | 'manual'::text |
| `created_at`        | timestamp with time zone | not null | now()          |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX tracking_events_pkey ON public.tracking_events USING btree (id)`
- `CREATE INDEX tracking_events_shipment_idx ON public.tracking_events USING btree (shipment_id, occurred_at DESC)`
- `CREATE UNIQUE INDEX tracking_events_shipment_id_provider_event_id_key ON public.tracking_events USING btree (shipment_id, provider_event_id)`

## `user_roles`

| kolom        | tipe                     | null     | default |
| ------------ | ------------------------ | -------- | ------- |
| `user_id`    | uuid                     | not null |         |
| `role_code`  | text                     | not null |         |
| `granted_by` | uuid                     |          |         |
| `granted_at` | timestamp with time zone | not null | now()   |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX user_roles_pkey ON public.user_roles USING btree (user_id, role_code)`

## `users`

| kolom                | tipe                     | null     | default           |
| -------------------- | ------------------------ | -------- | ----------------- |
| `id`                 | uuid                     | not null | gen_random_uuid() |
| `email`              | text                     | not null |                   |
| `email_normalized`   | text                     |          |                   |
| `password_hash`      | text                     | not null |                   |
| `password_algo`      | text                     | not null | 'scrypt'::text    |
| `full_name`          | text                     | not null |                   |
| `phone`              | text                     |          |                   |
| `kind`               | text                     | not null | 'customer'::text  |
| `is_active`          | boolean                  | not null | true              |
| `email_verified_at`  | timestamp with time zone |          |                   |
| `failed_login_count` | integer                  | not null | 0                 |
| `locked_until`       | timestamp with time zone |          |                   |
| `mfa_secret_enc`     | text                     |          |                   |
| `mfa_enabled_at`     | timestamp with time zone |          |                   |
| `last_login_at`      | timestamp with time zone |          |                   |
| `created_at`         | timestamp with time zone | not null | now()             |
| `updated_at`         | timestamp with time zone | not null | now()             |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX users_email_normalized_key ON public.users USING btree (email_normalized)`
- `CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)`

## `wishlist_items`

| kolom         | tipe                     | null     | default                                      |
| ------------- | ------------------------ | -------- | -------------------------------------------- |
| `wishlist_id` | uuid                     | not null |                                              |
| `product_id`  | uuid                     | not null |                                              |
| `variant_id`  | uuid                     | not null | '00000000-0000-0000-0000-000000000000'::uuid |
| `note`        | text                     |          |                                              |
| `created_at`  | timestamp with time zone | not null | now()                                        |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX wishlist_items_pkey ON public.wishlist_items USING btree (wishlist_id, product_id, variant_id)`

## `wishlists`

| kolom        | tipe                     | null     | default               |
| ------------ | ------------------------ | -------- | --------------------- |
| `id`         | uuid                     | not null | gen_random_uuid()     |
| `user_id`    | uuid                     | not null |                       |
| `name`       | text                     | not null | 'Wishlist saya'::text |
| `created_at` | timestamp with time zone | not null | now()                 |

Indeks/konstrain unik:

- `CREATE UNIQUE INDEX wishlists_pkey ON public.wishlists USING btree (id)`
- `CREATE UNIQUE INDEX wishlists_user_id_name_key ON public.wishlists USING btree (user_id, name)`
