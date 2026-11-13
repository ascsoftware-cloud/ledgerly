-- 0027_inventory: products and services, stock movements, suppliers and purchase orders.
-- Down script: supabase/migrations/down/0027_inventory.sql
--
-- Rules the database enforces:
--  * Stock is the sum of `stock_movements`. `products.stock_qty` is a cache kept by a trigger;
--    nobody can write it, and movements are only created by the functions and triggers below.
--  * Sending an invoice takes stock for its product lines; voiding a sent invoice returns it.
--    Each invoice line moves stock at most once per direction.
--  * Selling is never blocked by stock. Concurrent sales serialise on the product row, so the
--    cache stays exact; stock below zero is flagged (`stock_warnings`).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  email text check (email is null or (char_length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone text check (char_length(phone) <= 30),
  notes text check (char_length(notes) <= 1000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id)
);
create index suppliers_ws_idx on public.suppliers (workspace_id, name) where deleted_at is null;
create index suppliers_created_by_idx on public.suppliers (created_by);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  sku text check (char_length(btrim(sku)) between 1 and 40),
  kind text not null default 'product' check (kind in ('product', 'service')),
  cost_cents bigint not null default 0 check (cost_cents between 0 and 10000000000),
  price_cents bigint not null default 0 check (price_cents between 0 and 10000000000),
  vat_rate smallint not null default 0 check (vat_rate in (0, 15)),
  track_stock boolean not null default false,
  reorder_level numeric(12, 4) not null default 0 check (reorder_level >= 0 and reorder_level <= 1000000),
  -- Cache of sum(stock_movements.qty_change). Maintained by a trigger only.
  stock_qty numeric(12, 4) not null default 0,
  supplier_id uuid,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  check (kind = 'product' or track_stock = false),
  foreign key (workspace_id, supplier_id) references public.suppliers (workspace_id, id) on delete set null (supplier_id)
);
create unique index products_sku_idx on public.products (workspace_id, lower(sku)) where sku is not null and deleted_at is null;
create index products_ws_idx on public.products (workspace_id, name) where deleted_at is null;
create index products_supplier_idx on public.products (workspace_id, supplier_id);
create index products_created_by_idx on public.products (created_by);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id uuid not null,
  qty_change numeric(12, 4) not null check (qty_change <> 0),
  reason text not null check (reason in ('initial', 'adjustment', 'purchase', 'sale', 'void')),
  note text check (char_length(note) <= 200),
  -- The invoice or purchase order, and the line within it, that caused the movement.
  ref_id uuid,
  line_id uuid,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, product_id) references public.products (workspace_id, id) on delete cascade
);
create index stock_movements_product_idx on public.stock_movements (workspace_id, product_id, created_at desc);
create index stock_movements_created_by_idx on public.stock_movements (created_by);
-- An invoice or order line moves stock once per direction: replays and double sends are no-ops.
create unique index stock_movements_line_idx on public.stock_movements (line_id, reason)
  where line_id is not null and reason in ('sale', 'void', 'purchase');

-- Keep the cache exact. The update locks the product row, so concurrent movements queue up.
create or replace function app.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.products set stock_qty = stock_qty + new.qty_change
  where id = new.product_id and workspace_id = new.workspace_id;
  return new;
end;
$$;
revoke all on function app.apply_stock_movement() from public, anon, authenticated;
create trigger apply_stock_movement after insert on public.stock_movements
  for each row execute function app.apply_stock_movement();

create trigger touch_suppliers before update on public.suppliers for each row execute function app.touch_updated_at();
create trigger touch_products before update on public.products for each row execute function app.touch_updated_at();
create trigger fixed_ws_suppliers before update on public.suppliers for each row execute function app.forbid_workspace_change();
create trigger fixed_ws_products before update on public.products for each row execute function app.forbid_workspace_change();

-- ---------------------------------------------------------------------------
-- Invoice lines can point at a product.
-- ---------------------------------------------------------------------------
alter table public.sales_document_lines add column product_id uuid;
alter table public.sales_document_lines add constraint sales_document_lines_product_fkey
  foreign key (workspace_id, product_id) references public.products (workspace_id, id) on delete set null (product_id);
create index sales_document_lines_product_idx on public.sales_document_lines (workspace_id, product_id) where product_id is not null;
grant insert (product_id) on public.sales_document_lines to authenticated;
grant update (product_id) on public.sales_document_lines to authenticated;

create or replace function public.save_document_draft(p_workspace uuid, p_id uuid, p_doc jsonb, p_lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  doc_id uuid := p_id;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200 then
    raise exception 'Lines must be a list of at most 200' using errcode = 'check_violation';
  end if;

  if doc_id is null then
    insert into public.sales_documents (workspace_id, kind, contact_id, issue_date, due_date, notes, terms,
                                        deposit_type, deposit_value, source_id)
    values (p_workspace, p_doc ->> 'kind', (p_doc ->> 'contact_id')::uuid,
            coalesce((p_doc ->> 'issue_date')::date, (now() at time zone 'Africa/Johannesburg')::date),
            (p_doc ->> 'due_date')::date, p_doc ->> 'notes', p_doc ->> 'terms',
            p_doc ->> 'deposit_type', (p_doc ->> 'deposit_value')::numeric, (p_doc ->> 'source_id')::uuid)
    returning id into doc_id;
  else
    update public.sales_documents
    set contact_id = (p_doc ->> 'contact_id')::uuid,
        issue_date = coalesce((p_doc ->> 'issue_date')::date, issue_date),
        due_date = (p_doc ->> 'due_date')::date,
        notes = p_doc ->> 'notes',
        terms = p_doc ->> 'terms',
        deposit_type = p_doc ->> 'deposit_type',
        deposit_value = (p_doc ->> 'deposit_value')::numeric
    where id = doc_id and workspace_id = p_workspace;
    if not found then
      raise exception 'Draft not found' using errcode = 'no_data_found';
    end if;
    delete from public.sales_document_lines where document_id = doc_id and workspace_id = p_workspace;
  end if;

  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity,
                                           unit_cents, discount_pct, vat_rate, product_id)
  select p_workspace, doc_id, l.ord::smallint, l.v ->> 'description', (l.v ->> 'quantity')::numeric,
         (l.v ->> 'unit_cents')::bigint, coalesce((l.v ->> 'discount_pct')::numeric, 0),
         coalesce((l.v ->> 'vat_rate')::smallint, 0), nullif(l.v ->> 'product_id', '')::uuid
  from jsonb_array_elements(p_lines) with ordinality as l (v, ord);

  return doc_id;
end;
$$;

-- A quote's products carry over to the invoice made from it.
create or replace function public.convert_quote_to_invoice(p_quote uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.sales_documents%rowtype;
  inv uuid;
begin
  select * into q from public.sales_documents where id = p_quote and kind = 'quote' for update;
  if not found or not app.has_role(q.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Quote not found' using errcode = 'no_data_found';
  end if;
  if q.status in ('draft', 'declined', 'void') then
    raise exception 'Send the quote before turning it into an invoice' using errcode = 'LDG03';
  end if;
  select id into inv from public.sales_documents
  where workspace_id = q.workspace_id and kind = 'invoice' and source_id = q.id and status <> 'void'
  limit 1;
  if inv is not null then
    return inv;
  end if;

  insert into public.sales_documents (workspace_id, kind, contact_id, notes, terms, deposit_type, deposit_value, source_id)
  values (q.workspace_id, 'invoice', q.contact_id, q.notes, q.terms, q.deposit_type, q.deposit_value, q.id)
  returning id into inv;
  insert into public.sales_document_lines (workspace_id, document_id, position, description, quantity,
                                           unit_cents, discount_pct, vat_rate, product_id)
  select workspace_id, inv, position, description, quantity, unit_cents, discount_pct, vat_rate, product_id
  from public.sales_document_lines where document_id = q.id;
  perform app.recalc_document(inv);
  return inv;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invoices move stock.
-- ---------------------------------------------------------------------------
create or replace function app.sales_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'invoice' then
    return new;
  end if;

  if old.status = 'draft' and new.status <> 'draft' and new.status <> 'void' then
    insert into public.stock_movements (workspace_id, product_id, qty_change, reason, ref_id, line_id, created_by)
    select l.workspace_id, l.product_id, -l.quantity, 'sale', l.document_id, l.id, (select auth.uid())
    from public.sales_document_lines l
    join public.products p on p.id = l.product_id and p.workspace_id = l.workspace_id and p.track_stock
    where l.document_id = new.id and l.product_id is not null
    order by l.product_id, l.id
    on conflict (line_id, reason) where line_id is not null and reason in ('sale', 'void', 'purchase') do nothing;
  elsif new.status = 'void' and old.status not in ('draft', 'void') then
    insert into public.stock_movements (workspace_id, product_id, qty_change, reason, ref_id, line_id, created_by)
    select sm.workspace_id, sm.product_id, -sm.qty_change, 'void', sm.ref_id, sm.line_id, (select auth.uid())
    from public.stock_movements sm
    where sm.ref_id = new.id and sm.workspace_id = new.workspace_id and sm.reason = 'sale'
    order by sm.product_id, sm.id
    on conflict (line_id, reason) where line_id is not null and reason in ('sale', 'void', 'purchase') do nothing;
  end if;
  return new;
end;
$$;
revoke all on function app.sales_stock() from public, anon, authenticated;
create trigger sales_stock after update of status on public.sales_documents
  for each row when (old.status is distinct from new.status) execute function app.sales_stock();

-- Products on this invoice that are now below zero (so the person sending can be told).
create or replace function public.stock_warnings(p_doc uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  select workspace_id into ws from public.sales_documents where id = p_doc;
  if ws is null or not app.is_member(ws) then
    raise exception 'Document not found' using errcode = 'no_data_found';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('name', x.name, 'stock_qty', x.stock_qty) order by x.name)
    from (
      select distinct p.name, p.stock_qty
      from public.sales_document_lines l
      join public.products p on p.id = l.product_id and p.workspace_id = l.workspace_id
      where l.document_id = p_doc and p.track_stock and p.stock_qty < 0
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Manual stock changes: the opening count (once) and later adjustments.
-- ---------------------------------------------------------------------------
create or replace function public.adjust_stock(p_product uuid, p_qty numeric, p_reason text, p_note text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  new_qty numeric;
begin
  select * into p from public.products where id = p_product and deleted_at is null for update;
  if not found or not app.has_role(p.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Product not found' using errcode = 'no_data_found';
  end if;
  if p_reason not in ('initial', 'adjustment') then
    raise exception 'Unknown reason' using errcode = 'LDG03';
  end if;
  if not p.track_stock then
    raise exception 'Turn on stock tracking for this product first' using errcode = 'LDG03';
  end if;
  if p_qty is null or p_qty = 0 or abs(p_qty) > 1000000 then
    raise exception 'Enter how many to add or remove' using errcode = 'LDG03';
  end if;
  if p_reason = 'initial' and exists (select 1 from public.stock_movements where product_id = p.id) then
    raise exception 'Opening stock is already set. Use an adjustment.' using errcode = 'LDG03';
  end if;
  insert into public.stock_movements (workspace_id, product_id, qty_change, reason, note)
  values (p.workspace_id, p.id, p_qty, p_reason, nullif(btrim(p_note), ''));
  select stock_qty into new_qty from public.products where id = p.id;
  return new_qty;
end;
$$;

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------
alter table public.document_sequences drop constraint document_sequences_kind_check;
alter table public.document_sequences add constraint document_sequences_kind_check
  check (kind in ('invoice', 'quote', 'credit_note', 'purchase_order'));

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  supplier_id uuid not null,
  number text not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'received', 'cancelled')),
  expected_on date,
  notes text check (char_length(notes) <= 1000),
  sent_at timestamptz,
  received_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, number),
  foreign key (workspace_id, supplier_id) references public.suppliers (workspace_id, id) on delete no action
);
create index purchase_orders_ws_idx on public.purchase_orders (workspace_id, created_at desc);
create index purchase_orders_supplier_idx on public.purchase_orders (workspace_id, supplier_id);
create index purchase_orders_created_by_idx on public.purchase_orders (created_by);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  po_id uuid not null,
  product_id uuid not null,
  quantity numeric(12, 4) not null check (quantity > 0 and quantity <= 1000000),
  unit_cost_cents bigint not null default 0 check (unit_cost_cents between 0 and 10000000000),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, po_id) references public.purchase_orders (workspace_id, id) on delete cascade,
  foreign key (workspace_id, product_id) references public.products (workspace_id, id) on delete no action
);
create index purchase_order_lines_po_idx on public.purchase_order_lines (workspace_id, po_id);
create index purchase_order_lines_product_idx on public.purchase_order_lines (workspace_id, product_id);

create trigger touch_purchase_orders before update on public.purchase_orders for each row execute function app.touch_updated_at();
create trigger fixed_ws_purchase_orders before update on public.purchase_orders for each row execute function app.forbid_workspace_change();

create or replace function app.number_purchase_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  seq integer;
begin
  insert into public.document_sequences (workspace_id, kind) values (new.workspace_id, 'purchase_order')
  on conflict (workspace_id, kind) do nothing;
  update public.document_sequences set next_number = next_number + 1
  where workspace_id = new.workspace_id and kind = 'purchase_order'
  returning next_number - 1 into seq;
  new.number := 'PO-' || lpad(seq::text, 4, '0');
  return new;
end;
$$;
revoke all on function app.number_purchase_order() from public, anon, authenticated;
create trigger number_purchase_order before insert on public.purchase_orders
  for each row execute function app.number_purchase_order();

-- Lines change only while the order is a draft (functions running as the owner pass through).
create or replace function app.guard_po_lines()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  st text;
begin
  select status into st from public.purchase_orders where id = coalesce(new.po_id, old.po_id);
  if current_user in ('authenticated', 'anon') and st is not null and st <> 'draft' then
    raise exception 'Only a draft order can be changed' using errcode = 'LDG03';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger guard_po_lines before insert or update or delete on public.purchase_order_lines
  for each row execute function app.guard_po_lines();

create or replace function public.set_purchase_order_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders%rowtype;
begin
  select * into o from public.purchase_orders where id = p_id for update;
  if not found or not app.has_role(o.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Order not found' using errcode = 'no_data_found';
  end if;
  if p_status = o.status then
    return;
  end if;
  if p_status = 'sent' and o.status = 'draft' then
    if not exists (select 1 from public.purchase_order_lines where po_id = o.id) then
      raise exception 'Add at least one product before sending' using errcode = 'LDG03';
    end if;
    update public.purchase_orders set status = 'sent', sent_at = now() where id = o.id;
  elsif p_status = 'cancelled' and o.status in ('draft', 'sent') then
    update public.purchase_orders set status = 'cancelled' where id = o.id;
  else
    raise exception 'That change is not allowed for an order that is %', o.status using errcode = 'LDG03';
  end if;
end;
$$;

-- Receiving is all or nothing and safe to repeat.
create or replace function public.receive_purchase_order(p_id uuid, p_update_cost boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.purchase_orders%rowtype;
  moved integer;
begin
  select * into o from public.purchase_orders where id = p_id for update;
  if not found or not app.has_role(o.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Order not found' using errcode = 'no_data_found';
  end if;
  if o.status = 'received' then
    return jsonb_build_object('status', 'received', 'already_received', true);
  end if;
  if o.status = 'cancelled' then
    raise exception 'This order was cancelled' using errcode = 'LDG03';
  end if;
  if not exists (select 1 from public.purchase_order_lines where po_id = o.id) then
    raise exception 'Add at least one product before receiving' using errcode = 'LDG03';
  end if;

  insert into public.stock_movements (workspace_id, product_id, qty_change, reason, ref_id, line_id, created_by)
  select l.workspace_id, l.product_id, l.quantity, 'purchase', o.id, l.id, (select auth.uid())
  from public.purchase_order_lines l
  join public.products p on p.id = l.product_id and p.workspace_id = l.workspace_id and p.track_stock
  where l.po_id = o.id
  order by l.product_id, l.id
  on conflict (line_id, reason) where line_id is not null and reason in ('sale', 'void', 'purchase') do nothing;
  get diagnostics moved = row_count;

  if p_update_cost then
    update public.products p set cost_cents = l.unit_cost_cents
    from public.purchase_order_lines l
    where l.po_id = o.id and p.id = l.product_id and p.workspace_id = l.workspace_id;
  end if;

  update public.purchase_orders set status = 'received', received_at = now() where id = o.id;
  return jsonb_build_object('status', 'received', 'already_received', false, 'stock_lines', moved);
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
revoke all on public.suppliers, public.products, public.stock_movements, public.purchase_orders, public.purchase_order_lines
  from anon, authenticated;

grant select on public.suppliers, public.products, public.stock_movements, public.purchase_orders, public.purchase_order_lines to authenticated;
grant insert (workspace_id, name, email, phone, notes) on public.suppliers to authenticated;
grant update (name, email, phone, notes, deleted_at) on public.suppliers to authenticated;
grant insert (workspace_id, name, sku, kind, cost_cents, price_cents, vat_rate, track_stock, reorder_level, supplier_id)
  on public.products to authenticated;
grant update (name, sku, kind, cost_cents, price_cents, vat_rate, track_stock, reorder_level, supplier_id, deleted_at)
  on public.products to authenticated;
grant insert (workspace_id, supplier_id, expected_on, notes) on public.purchase_orders to authenticated;
grant update (supplier_id, expected_on, notes) on public.purchase_orders to authenticated;
grant delete on public.purchase_orders to authenticated;
grant insert (workspace_id, po_id, product_id, quantity, unit_cost_cents) on public.purchase_order_lines to authenticated;
grant update (product_id, quantity, unit_cost_cents) on public.purchase_order_lines to authenticated;
grant delete on public.purchase_order_lines to authenticated;

create policy suppliers_select on public.suppliers for select to authenticated using ((select app.is_member(workspace_id)));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy suppliers_update on public.suppliers for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));

create policy products_select on public.products for select to authenticated using ((select app.is_member(workspace_id)));
create policy products_insert on public.products for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy products_update on public.products for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));

create policy stock_movements_select on public.stock_movements for select to authenticated using ((select app.is_member(workspace_id)));

create policy purchase_orders_select on public.purchase_orders for select to authenticated using ((select app.is_member(workspace_id)));
create policy purchase_orders_insert on public.purchase_orders for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy purchase_orders_update on public.purchase_orders for update to authenticated
  using (status = 'draft' and (select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy purchase_orders_delete on public.purchase_orders for delete to authenticated
  using (status = 'draft' and (select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));

create policy purchase_order_lines_select on public.purchase_order_lines for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy purchase_order_lines_insert on public.purchase_order_lines for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy purchase_order_lines_update on public.purchase_order_lines for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy purchase_order_lines_delete on public.purchase_order_lines for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));

revoke all on function public.stock_warnings(uuid), public.adjust_stock(uuid, numeric, text, text),
  public.set_purchase_order_status(uuid, text), public.receive_purchase_order(uuid, boolean) from public, anon;
grant execute on function public.stock_warnings(uuid), public.adjust_stock(uuid, numeric, text, text),
  public.set_purchase_order_status(uuid, text), public.receive_purchase_order(uuid, boolean) to authenticated;
