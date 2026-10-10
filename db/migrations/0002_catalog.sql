-- =====================================================================
-- 0002 Catalog: kategori, produk, varian/SKU, media, atribut, harga.  Blueprint §5.1, §12.1
-- Aturan publikasi: draft/archived tidak tampil publik (AT-01) - ditegakkan di service + index partial.
-- =====================================================================

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name        text NOT NULL,
  description text,
  parent_id   uuid REFERENCES categories(id) ON DELETE RESTRICT,
  position    integer NOT NULL DEFAULT 0,
  image_url   text,
  image_alt   text,
  meta_title  text,
  meta_description text,
  is_active   boolean NOT NULL DEFAULT true,
  -- path materialized untuk breadcrumb & subtree tanpa rekursi mahal: ['fashion','sepatu']
  path_slugs  text[] NOT NULL DEFAULT '{}',
  depth       integer NOT NULL DEFAULT 0 CHECK (depth >= 0 AND depth <= 3),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX categories_parent_idx ON categories (parent_id);
CREATE INDEX categories_active_idx ON categories (is_active, position);

CREATE TABLE products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SKU level produk (stabil, unik) - CAT-01
  sku          text NOT NULL UNIQUE CHECK (char_length(sku) BETWEEN 3 AND 64),
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 160),
  summary      text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  brand        text,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  category_id  uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  care_instructions text,
  warranty     text,
  package_contents jsonb NOT NULL DEFAULT '[]'::jsonb,
  meta_title   text,
  meta_description text,
  canonical_slug text,
  -- redirect aman saat slug berubah (Blueprint §4.1)
  retired_slugs text[] NOT NULL DEFAULT '{}',
  popularity   integer NOT NULL DEFAULT 0 CHECK (popularity >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  archived_at  timestamptz,
  -- Search FTS (Blueprint §10.2: PostgreSQL full-text awal)
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(brand, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(sku, '')), 'A')
  ) STORED
);
CREATE INDEX products_search_idx ON products USING gin (search_vector);
CREATE INDEX products_published_idx ON products (status, category_id, published_at DESC);
CREATE INDEX products_popularity_idx ON products (popularity DESC) WHERE status = 'published';

CREATE TABLE product_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id  uuid,
  url         text NOT NULL,
  alt_text    text NOT NULL CHECK (char_length(alt_text) >= 3),  -- CAT-03: alt text wajib
  position    integer NOT NULL DEFAULT 0,
  width       integer NOT NULL DEFAULT 1200 CHECK (width > 0),
  height      integer NOT NULL DEFAULT 1500 CHECK (height > 0),
  format      text NOT NULL DEFAULT 'image',
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_media_product_idx ON product_media (product_id, position);
CREATE UNIQUE INDEX product_media_one_primary_idx ON product_media (product_id) WHERE is_primary = true;

CREATE TABLE attribute_definitions (
  code         text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  label        text NOT NULL,
  presentation text NOT NULL DEFAULT 'choice' CHECK (presentation IN ('swatch','choice','numeric')),
  is_required  boolean NOT NULL DEFAULT false,
  position     integer NOT NULL DEFAULT 0,
  allowed_values jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE category_attributes (
  category_id  uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  attribute_code text NOT NULL REFERENCES attribute_definitions(code) ON DELETE CASCADE,
  is_filterable boolean NOT NULL DEFAULT true,
  position     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (category_id, attribute_code)
);

CREATE TABLE product_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- Satu SKU per varian, unik global (CAT-02)
  sku           text NOT NULL UNIQUE CHECK (char_length(sku) BETWEEN 3 AND 64),
  label         text NOT NULL,
  options       jsonb NOT NULL DEFAULT '{}'::jsonb,
  option_values text[] NOT NULL DEFAULT '{}',
  price_amount  bigint NOT NULL CHECK (price_amount >= 0),
  compare_at_amount bigint CHECK (compare_at_amount IS NULL OR compare_at_amount > price_amount),
  currency      char(3) NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
  -- stok: null = tidak dilacak (pre-order). available dihitung dari balance, bukan di sini.
  track_inventory boolean NOT NULL DEFAULT true,
  low_stock_threshold integer NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  safety_stock  integer NOT NULL DEFAULT 0 CHECK (safety_stock >= 0),
  min_qty_per_order integer NOT NULL DEFAULT 1 CHECK (min_qty_per_order >= 1),
  max_qty_per_order integer CHECK (max_qty_per_order IS NULL OR max_qty_per_order >= 1),
  is_active     boolean NOT NULL DEFAULT true,
  is_deleted    boolean NOT NULL DEFAULT false,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_variants_product_idx ON product_variants (product_id) WHERE is_deleted = false;
ALTER TABLE product_media
  ADD CONSTRAINT product_media_variant_fk FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;

-- Histori harga: perubahan tidak menulis ulang order lama (CAT-04).
CREATE TABLE price_history (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id   uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  old_amount   bigint NOT NULL CHECK (old_amount >= 0),
  new_amount   bigint NOT NULL CHECK (new_amount >= 0),
  currency     char(3) NOT NULL DEFAULT 'IDR',
  changed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  reason       text,
  effective_at timestamptz NOT NULL DEFAULT now(),
  request_id   text
);
CREATE INDEX price_history_variant_idx ON price_history (variant_id, effective_at DESC);

CREATE TABLE product_review_stats (
  product_id   uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  average      numeric(3,2) NOT NULL DEFAULT 0 CHECK (average >= 0 AND average <= 5),
  review_count integer NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
