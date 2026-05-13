import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const dbPath = process.env.DATABASE_URL ?? join(process.cwd(), "data", "store.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function columnExists(table: string, column: string) {
  return db.prepare(`pragma table_info(${table})`).all().some((row: any) => row.name === column);
}

function addColumnIfMissing(table: string, column: string, definition: string) {
  if (!columnExists(table, column)) {
    db.exec(`alter table ${table} add column ${column} ${definition}`);
  }
}

export function migrate() {
  db.exec(`
    create table if not exists tenants (
      id text primary key,
      name text not null,
      slug text not null unique,
      primary_domain text not null unique,
      status text not null default 'active',
      theme_json text not null,
      created_at text not null default current_timestamp
    );

    create table if not exists tenant_domains (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      domain text not null unique,
      is_primary integer not null default 0,
      verification_status text not null default 'pending',
      verification_token text not null default ''
    );

    create table if not exists products (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      category_id text not null default '',
      name text not null,
      slug text not null,
      short_description text not null default '',
      description text not null default '',
      price integer not null,
      currency text not null default 'LYD',
      inventory integer not null default 0,
      image_url text not null default '',
      images_json text not null default '[]',
      specs_json text not null default '[]',
      is_active integer not null default 1,
      created_at text not null default current_timestamp,
      unique(tenant_id, slug)
    );

    create table if not exists categories (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      parent_id text references categories(id) on delete cascade,
      name text not null,
      slug text not null,
      description text not null default '',
      image_url text not null default '',
      sort_order integer not null default 0,
      is_active integer not null default 1,
      created_at text not null default current_timestamp,
      unique(tenant_id, slug)
    );

    create table if not exists product_variants (
      id text primary key,
      product_id text not null references products(id) on delete cascade,
      option_name text not null,
      option_value text not null,
      sku text not null default '',
      price_delta integer not null default 0,
      inventory integer not null default 0,
      is_active integer not null default 1,
      created_at text not null default current_timestamp
    );

    create table if not exists orders (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      customer_id text not null default '',
      customer_name text not null,
      customer_phone text not null,
      customer_city text not null default '',
      customer_address text not null default '',
      notes text not null default '',
      payment_method text not null default '',
      payment_status text not null default 'pending',
      paid_amount integer not null default 0,
      payment_reference text not null default '',
      shipping_zone_id text not null default '',
      shipping_zone_name text not null default '',
      shipping_fee integer not null default 0,
      discount_code_id text not null default '',
      discount_code text not null default '',
      discount_amount integer not null default 0,
      inventory_restocked integer not null default 0,
      discount_released integer not null default 0,
      status text not null default 'new',
      total integer not null default 0,
      created_at text not null default current_timestamp
    );

    create table if not exists customers (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      name text not null,
      phone text not null,
      city text not null default '',
      address text not null default '',
      notes text not null default '',
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp,
      unique(tenant_id, phone)
    );

    create table if not exists order_items (
      id text primary key,
      order_id text not null references orders(id) on delete cascade,
      product_id text not null references products(id),
      variant_id text not null default '',
      product_name text not null,
      variant_name text not null default '',
      sku text not null default '',
      unit_price integer not null,
      quantity integer not null,
      line_total integer not null
    );

    create table if not exists order_events (
      id text primary key,
      order_id text not null references orders(id) on delete cascade,
      type text not null,
      title text not null,
      message text not null default '',
      created_at text not null default current_timestamp
    );

    create table if not exists order_event_reads (
      event_id text not null references order_events(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      read_at text not null default current_timestamp,
      primary key (event_id, user_id)
    );

    create table if not exists integration_settings (
      tenant_id text primary key references tenants(id) on delete cascade,
      enabled integer not null default 0,
      api_base_url text not null default '',
      api_key_cipher text not null default '',
      sync_products integer not null default 0,
      sync_inventory integer not null default 0,
      push_orders integer not null default 0,
      updated_at text not null default current_timestamp
    );

    create table if not exists store_settings (
      tenant_id text primary key references tenants(id) on delete cascade,
      store_name text not null default '',
      public_email text not null default '',
      public_phone text not null default '',
      whatsapp_phone text not null default '',
      currency text not null default 'LYD',
      default_city text not null default '',
      shipping_policy text not null default '',
      payment_methods_json text not null default '[]',
      updated_at text not null default current_timestamp
    );

    create table if not exists shipping_zones (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      name text not null,
      city text not null default '',
      fee integer not null default 0,
      estimated_days text not null default '',
      is_active integer not null default 1,
      created_at text not null default current_timestamp
    );

    create table if not exists discount_codes (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      code text not null,
      name text not null,
      type text not null,
      value integer not null,
      min_subtotal integer not null default 0,
      max_redemptions integer not null default 0,
      redemption_count integer not null default 0,
      starts_at text not null default '',
      ends_at text not null default '',
      is_active integer not null default 1,
      created_at text not null default current_timestamp,
      unique(tenant_id, code)
    );

    create table if not exists image_assets (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      filename text not null unique,
      url text not null,
      width integer not null,
      height integer not null,
      original_size integer not null,
      compressed_size integer not null,
      format text not null default 'webp',
      created_at text not null default current_timestamp
    );

    create table if not exists users (
      id text primary key,
      tenant_id text references tenants(id) on delete cascade,
      name text not null,
      email text not null unique,
      password_hash text not null,
      role text not null,
      status text not null default 'active',
      created_at text not null default current_timestamp
    );

    create table if not exists auth_sessions (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      token_hash text not null unique,
      expires_at text not null,
      created_at text not null default current_timestamp
    );
  `);

  addColumnIfMissing("tenant_domains", "verification_status", "text not null default 'pending'");
  addColumnIfMissing("tenant_domains", "verification_token", "text not null default ''");
  addColumnIfMissing("products", "category_id", "text not null default ''");
  addColumnIfMissing("products", "short_description", "text not null default ''");
  addColumnIfMissing("products", "images_json", "text not null default '[]'");
  addColumnIfMissing("products", "specs_json", "text not null default '[]'");
  addColumnIfMissing("orders", "customer_city", "text not null default ''");
  addColumnIfMissing("orders", "customer_id", "text not null default ''");
  addColumnIfMissing("orders", "customer_address", "text not null default ''");
  addColumnIfMissing("orders", "notes", "text not null default ''");
  addColumnIfMissing("orders", "payment_method", "text not null default ''");
  addColumnIfMissing("orders", "payment_status", "text not null default 'pending'");
  addColumnIfMissing("orders", "paid_amount", "integer not null default 0");
  addColumnIfMissing("orders", "payment_reference", "text not null default ''");
  addColumnIfMissing("orders", "shipping_zone_id", "text not null default ''");
  addColumnIfMissing("orders", "shipping_zone_name", "text not null default ''");
  addColumnIfMissing("orders", "shipping_fee", "integer not null default 0");
  addColumnIfMissing("orders", "discount_code_id", "text not null default ''");
  addColumnIfMissing("orders", "discount_code", "text not null default ''");
  addColumnIfMissing("orders", "discount_amount", "integer not null default 0");
  addColumnIfMissing("orders", "inventory_restocked", "integer not null default 0");
  addColumnIfMissing("orders", "discount_released", "integer not null default 0");
  addColumnIfMissing("order_items", "variant_id", "text not null default ''");
  addColumnIfMissing("order_items", "variant_name", "text not null default ''");
  addColumnIfMissing("order_items", "sku", "text not null default ''");

  // Performance indexes
  db.exec(`
    create index if not exists idx_products_tenant on products(tenant_id);
    create index if not exists idx_products_tenant_status on products(tenant_id, is_active);
    create index if not exists idx_orders_tenant on orders(tenant_id, created_at);
    create index if not exists idx_orders_tenant_status on orders(tenant_id, status);
    create index if not exists idx_order_items_order on order_items(order_id);
    create index if not exists idx_product_variants_product on product_variants(product_id);
    create index if not exists idx_order_events_order on order_events(order_id);
    create index if not exists idx_customers_tenant on customers(tenant_id);
    create index if not exists idx_auth_sessions_user on auth_sessions(user_id);
    create index if not exists idx_categories_tenant on categories(tenant_id);
  `);

  // Audit log table
  db.exec(`
    create table if not exists audit_log (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      user_id text references users(id) on delete set null,
      action text not null,
      entity text not null,
      entity_id text not null,
      changes text not null default '{}',
      created_at text not null default (datetime('now'))
    );
    create index if not exists idx_audit_log_tenant on audit_log(tenant_id, created_at);
    create index if not exists idx_audit_log_entity on audit_log(tenant_id, entity, entity_id);
  `);

  // FTS5 full-text search for products — drop and recreate to ensure clean state
  db.exec(`
    drop trigger if exists products_ai;
    drop trigger if exists products_au;
    drop trigger if exists products_ad;
    drop table if exists products_fts;
    create virtual table products_fts using fts5(
      name,
      description,
      content='products',
      content_rowid='rowid',
      tokenize='unicode61'
    );
    create trigger products_ai after insert on products begin
      insert into products_fts(rowid, name, description) values (new.rowid, new.name, coalesce(new.description,''));
    end;
    create trigger products_au after update on products begin
      insert into products_fts(products_fts, rowid, name, description) values ('delete', old.rowid, old.name, coalesce(old.description,''));
      insert into products_fts(rowid, name, description) values (new.rowid, new.name, coalesce(new.description,''));
    end;
    create trigger products_ad after delete on products begin
      insert into products_fts(products_fts, rowid, name, description) values ('delete', old.rowid, old.name, coalesce(old.description,''));
    end;
    insert into products_fts(rowid, name, description) select rowid, name, coalesce(description,'') from products;
  `);

  db.prepare(`
    insert or ignore into customers (
      id,
      tenant_id,
      name,
      phone,
      city,
      address,
      notes,
      created_at,
      updated_at
    )
    select
      'backfill-' || tenant_id || '-' || customer_phone,
      tenant_id,
      customer_name,
      customer_phone,
      customer_city,
      customer_address,
      notes,
      min(created_at),
      max(created_at)
    from orders
    where customer_phone <> ''
    group by tenant_id, customer_phone
  `).run();

  db.prepare(`
    update tenant_domains
    set
      verification_status = 'verified',
      verification_token = case
        when verification_token = '' then 'moken-verify-demo'
        else verification_token
      end
    where domain = 'demo.localhost'
  `).run();
}
