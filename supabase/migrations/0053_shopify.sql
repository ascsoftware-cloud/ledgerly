-- 0053_shopify: a read-only copy of a connected Shopify store's products, stock and orders,
-- for the Shop dashboard. Shopify stays the source of truth; Ledgerly never writes back.
-- Down script: supabase/migrations/down/0053_shopify.sql
--
-- POPIA: orders keep headers only (number, dates, totals, statuses). No customer names,
-- emails, phone numbers or addresses are stored; the dashboard links to Shopify for those.

create table public.shopify_products (
  workspace_id uuid not null,
  connection_id uuid not null,
  id text not null check (id like 'gid://shopify/Product/%'),
  title text not null check (char_length(title) <= 300),
  status text check (char_length(status) <= 20),
  vendor text check (char_length(vendor) <= 200),
  product_type text check (char_length(product_type) <= 200),
  total_inventory integer,
  image_url text check (char_length(image_url) <= 1000),
  shop_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (connection_id, id),
  foreign key (workspace_id, connection_id) references public.integration_connections (workspace_id, id) on delete cascade
);
create index shopify_products_ws_idx on public.shopify_products (workspace_id, title);

create table public.shopify_variants (
  workspace_id uuid not null,
  connection_id uuid not null,
  id text not null check (id like 'gid://shopify/ProductVariant/%'),
  product_id text not null,
  title text check (char_length(title) <= 300),
  sku text check (char_length(sku) <= 200),
  price numeric(14, 2),
  inventory_quantity integer,
  inventory_item_id text check (char_length(inventory_item_id) <= 100),
  tracked boolean,
  synced_at timestamptz not null default now(),
  primary key (connection_id, id),
  foreign key (connection_id, product_id) references public.shopify_products (connection_id, id) on delete cascade,
  foreign key (workspace_id, connection_id) references public.integration_connections (workspace_id, id) on delete cascade
);
create index shopify_variants_ws_idx on public.shopify_variants (workspace_id, product_id);
create index shopify_variants_item_idx on public.shopify_variants (connection_id, inventory_item_id);

create table public.shopify_inventory_levels (
  workspace_id uuid not null,
  connection_id uuid not null,
  inventory_item_id text not null check (inventory_item_id like 'gid://shopify/InventoryItem/%'),
  location_id text not null check (location_id like 'gid://shopify/Location/%'),
  location_name text check (char_length(location_name) <= 200),
  available integer not null,
  synced_at timestamptz not null default now(),
  primary key (connection_id, inventory_item_id, location_id),
  foreign key (workspace_id, connection_id) references public.integration_connections (workspace_id, id) on delete cascade
);
create index shopify_inventory_levels_ws_idx on public.shopify_inventory_levels (workspace_id, location_id);

create table public.shopify_orders (
  workspace_id uuid not null,
  connection_id uuid not null,
  id text not null check (id like 'gid://shopify/Order/%'),
  name text not null check (char_length(name) <= 60),
  shop_created_at timestamptz not null,
  shop_updated_at timestamptz,
  cancelled_at timestamptz,
  financial_status text check (char_length(financial_status) <= 40),
  fulfillment_status text check (char_length(fulfillment_status) <= 40),
  total numeric(14, 2) not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  item_count integer,
  synced_at timestamptz not null default now(),
  primary key (connection_id, id),
  foreign key (workspace_id, connection_id) references public.integration_connections (workspace_id, id) on delete cascade
);
create index shopify_orders_ws_idx on public.shopify_orders (workspace_id, shop_created_at desc);

-- Where the sync got to, so a long first sync resumes after a timeout instead of starting over.
create table public.shopify_sync_state (
  connection_id uuid primary key,
  workspace_id uuid not null,
  phase text not null default 'products' check (phase in ('products', 'inventory', 'orders', 'done')),
  cursor text check (char_length(cursor) <= 500),
  run_started_at timestamptz,
  orders_since timestamptz,
  products_seen integer not null default 0,
  orders_seen integer not null default 0,
  finished_at timestamptz,
  foreign key (workspace_id, connection_id) references public.integration_connections (workspace_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Server only: removes what a full product sync did not see (deleted in Shopify).
-- ---------------------------------------------------------------------------
create or replace function public.shopify_prune_products(p_connection uuid, p_before timestamptz)
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (
    delete from public.shopify_products where connection_id = p_connection and synced_at < p_before returning 1
  )
  select count(*)::int from d;
$$;

/** Server only: forgets everything cached for a store (uninstall, shop/redact). */
create or replace function public.shopify_forget(p_connection uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.shopify_inventory_levels where connection_id = p_connection;
  delete from public.shopify_orders where connection_id = p_connection;
  delete from public.shopify_products where connection_id = p_connection;
  delete from public.shopify_sync_state where connection_id = p_connection;
$$;

revoke all on function public.shopify_prune_products(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.shopify_forget(uuid) from public, anon, authenticated;
grant execute on function public.shopify_prune_products(uuid, timestamptz) to service_role;
grant execute on function public.shopify_forget(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Row-level security: members read; only the service role writes.
-- ---------------------------------------------------------------------------
alter table public.shopify_products enable row level security;
alter table public.shopify_variants enable row level security;
alter table public.shopify_inventory_levels enable row level security;
alter table public.shopify_orders enable row level security;
alter table public.shopify_sync_state enable row level security;
revoke all on public.shopify_products, public.shopify_variants, public.shopify_inventory_levels, public.shopify_orders,
  public.shopify_sync_state from anon, authenticated;
grant select on public.shopify_products, public.shopify_variants, public.shopify_inventory_levels, public.shopify_orders,
  public.shopify_sync_state to authenticated;

create policy shopify_products_select on public.shopify_products for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy shopify_variants_select on public.shopify_variants for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy shopify_inventory_levels_select on public.shopify_inventory_levels for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy shopify_orders_select on public.shopify_orders for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy shopify_sync_state_select on public.shopify_sync_state for select to authenticated
  using ((select app.is_member(workspace_id)));
