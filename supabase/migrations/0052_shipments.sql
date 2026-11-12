-- 0052_shipments: parcels booked with Courier Guy (Ship Logic), usually for an invoice.
-- Down script: supabase/migrations/down/0052_shipments.sql
--
-- Addresses are stored structured on the shipment, because contacts keep one free-text address.
-- Booking is two steps so a retry can never book twice: start_shipment() records the intent
-- (one row per request id), the server books it, finish_shipment_booking() records the result.

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  connection_id uuid not null,
  document_id uuid,
  status text not null default 'booking'
    check (status in ('booking', 'booked', 'in_transit', 'delivered', 'cancelled', 'failed')),
  provider_status text check (char_length(provider_status) <= 60),
  collection_address jsonb not null check (jsonb_typeof(collection_address) = 'object'),
  delivery_address jsonb not null check (jsonb_typeof(delivery_address) = 'object'),
  collection_contact jsonb not null check (jsonb_typeof(collection_contact) = 'object'),
  delivery_contact jsonb not null check (jsonb_typeof(delivery_contact) = 'object'),
  parcels jsonb not null check (jsonb_typeof(parcels) = 'array' and jsonb_array_length(parcels) between 1 and 20),
  service_level_code text not null check (char_length(service_level_code) between 1 and 40),
  service_level_name text check (char_length(service_level_name) <= 100),
  quoted_cents bigint check (quoted_cents >= 0),
  charged_cents bigint check (charged_cents >= 0),
  provider_shipment_id text check (char_length(provider_shipment_id) <= 100),
  tracking_ref text check (char_length(tracking_ref) <= 100),
  last_error text check (char_length(last_error) <= 500),
  request_id uuid not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_tracked_at timestamptz,
  delivered_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, connection_id) references public.integration_connections (workspace_id, id) on delete cascade,
  foreign key (workspace_id, document_id) references public.sales_documents (workspace_id, id) on delete set null (document_id)
);
create index shipments_ws_idx on public.shipments (workspace_id, created_at desc);
create index shipments_doc_idx on public.shipments (workspace_id, document_id) where document_id is not null;
create index shipments_open_idx on public.shipments (connection_id) where status in ('booked', 'in_transit');
create index shipments_created_by_idx on public.shipments (created_by);

create trigger touch_shipments before update on public.shipments
  for each row execute function app.touch_updated_at();

create table public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  shipment_id uuid not null,
  happened_at timestamptz not null,
  status text not null check (char_length(status) <= 60),
  message text check (char_length(message) <= 300),
  location text check (char_length(location) <= 120),
  unique (shipment_id, happened_at, status),
  foreign key (workspace_id, shipment_id) references public.shipments (workspace_id, id) on delete cascade
);
create index shipment_events_ws_idx on public.shipment_events (workspace_id, shipment_id, happened_at desc);

-- ---------------------------------------------------------------------------
-- Booking (owner, admin or staff, as themselves)
-- ---------------------------------------------------------------------------
create or replace function public.start_shipment(p_workspace uuid, p_document uuid, p_request uuid,
                                                 p_collection jsonb, p_delivery jsonb,
                                                 p_collection_contact jsonb, p_delivery_contact jsonb,
                                                 p_parcels jsonb, p_service_code text, p_service_name text,
                                                 p_quoted_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conn uuid;
  existing public.shipments%rowtype;
  ship uuid;
begin
  if not app.has_role(p_workspace, array['owner', 'admin', 'staff']) then
    raise exception 'Your role cannot book couriers' using errcode = 'insufficient_privilege';
  end if;
  select * into existing from public.shipments where request_id = p_request;
  if found then
    if existing.workspace_id <> p_workspace then
      raise exception 'Shipment not found' using errcode = 'no_data_found';
    end if;
    return jsonb_build_object('id', existing.id, 'new', false, 'status', existing.status);
  end if;
  select id into conn from public.integration_connections
  where workspace_id = p_workspace and provider = 'courier_guy' and status = 'active';
  if conn is null then
    raise exception 'Connect Courier Guy first' using errcode = 'LDG03';
  end if;
  if p_document is not null and not exists (
    select 1 from public.sales_documents
    where id = p_document and workspace_id = p_workspace and kind = 'invoice' and status <> 'draft' and status <> 'void'
  ) then
    raise exception 'Only sent invoices can be shipped' using errcode = 'LDG03';
  end if;
  if coalesce(p_collection ->> 'code', '') = '' or coalesce(p_delivery ->> 'code', '') = '' then
    raise exception 'Both addresses need a postal code' using errcode = 'LDG03';
  end if;
  if p_collection = p_delivery then
    raise exception 'The collection and delivery addresses are the same' using errcode = 'LDG03';
  end if;
  if coalesce(p_delivery_contact ->> 'email', '') = '' and coalesce(p_delivery_contact ->> 'mobile_number', '') = '' then
    raise exception 'The recipient needs an email address or a mobile number' using errcode = 'LDG03';
  end if;

  insert into public.shipments (workspace_id, connection_id, document_id, collection_address, delivery_address,
                                collection_contact, delivery_contact, parcels, service_level_code, service_level_name,
                                quoted_cents, request_id, created_by)
  values (p_workspace, conn, p_document, p_collection, p_delivery, p_collection_contact, p_delivery_contact, p_parcels,
          btrim(p_service_code), left(p_service_name, 100), p_quoted_cents, p_request, (select auth.uid()))
  returning id into ship;
  return jsonb_build_object('id', ship, 'new', true, 'status', 'booking');
end;
$$;
revoke all on function public.start_shipment(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, bigint) from public, anon;
grant execute on function public.start_shipment(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Server only (service role)
-- ---------------------------------------------------------------------------
create or replace function public.finish_shipment_booking(p_shipment uuid, p_ok boolean, p_provider_id text,
                                                          p_tracking text, p_provider_status text, p_charged_cents bigint,
                                                          p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments%rowtype;
begin
  select * into s from public.shipments where id = p_shipment for update;
  if not found or s.status <> 'booking' then
    return;
  end if;
  update public.shipments
  set status = case when p_ok then 'booked' else 'failed' end,
      provider_shipment_id = left(p_provider_id, 100),
      tracking_ref = left(p_tracking, 100),
      provider_status = left(p_provider_status, 60),
      charged_cents = p_charged_cents,
      last_error = case when p_ok then null else left(p_error, 500) end
  where id = s.id;
end;
$$;

/** Tracking result: the shipment's current status plus any events not seen before. */
create or replace function public.record_shipment_tracking(p_shipment uuid, p_status text, p_provider_status text,
                                                           p_events jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments%rowtype;
begin
  select * into s from public.shipments where id = p_shipment for update;
  if not found then
    return;
  end if;
  update public.shipments
  set status = case when p_status in ('booked', 'in_transit', 'delivered', 'cancelled') then p_status else status end,
      provider_status = coalesce(left(p_provider_status, 60), provider_status),
      last_tracked_at = now(),
      delivered_at = case when p_status = 'delivered' and delivered_at is null then now() else delivered_at end
  where id = s.id;
  insert into public.shipment_events (workspace_id, shipment_id, happened_at, status, message, location)
  select s.workspace_id, s.id, (e ->> 'at')::timestamptz, left(e ->> 'status', 60), left(e ->> 'message', 300),
         left(e ->> 'location', 120)
  from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) e
  where e ->> 'at' is not null and e ->> 'status' is not null
  on conflict (shipment_id, happened_at, status) do nothing;
end;
$$;

revoke all on function public.finish_shipment_booking(uuid, boolean, text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.record_shipment_tracking(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.finish_shipment_booking(uuid, boolean, text, text, text, bigint, text) to service_role;
grant execute on function public.record_shipment_tracking(uuid, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Row-level security: members read; all writes go through the functions above.
-- ---------------------------------------------------------------------------
alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;
revoke all on public.shipments, public.shipment_events from anon, authenticated;
grant select on public.shipments, public.shipment_events to authenticated;
create policy shipments_select on public.shipments for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy shipment_events_select on public.shipment_events for select to authenticated
  using ((select app.is_member(workspace_id)));
