-- 0025_bookings: services, weekly opening hours and a public booking page (/book/<slug>).
-- Two bookings can never overlap: an exclusion constraint guards it, whatever the timing.
-- Confirmation and 24-hour reminder emails go through the outbox.
-- Down script: supabase/migrations/down/0025_bookings.sql

create extension if not exists btree_gist with schema extensions;

alter table public.workspace_settings add column booking_enabled boolean not null default false;
grant update (booking_enabled) on public.workspace_settings to authenticated;

alter table public.outbox drop constraint outbox_template_check;
alter table public.outbox add constraint outbox_template_check
  check (template in ('document', 'reminder', 'booking_confirmed', 'booking_reminder'));

create table public.services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (char_length(description) <= 300),
  duration_min smallint not null check (duration_min between 5 and 480),
  buffer_min smallint not null default 0 check (buffer_min between 0 and 240),
  price_cents bigint not null default 0 check (price_cents >= 0 and price_cents <= 100000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index services_ws_idx on public.services (workspace_id) where active;

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- ISO weekday: 1 = Monday … 7 = Sunday. Times are SAST.
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index availability_rules_ws_idx on public.availability_rules (workspace_id, weekday);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  service_id uuid not null,
  contact_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- End of the service plus its buffer: nothing else may start before this.
  blocked_until timestamptz not null,
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 120),
  customer_email text not null check (customer_email = lower(customer_email) and customer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  customer_phone text check (customer_phone ~ '^\+[1-9][0-9]{7,14}$'),
  notes text check (char_length(notes) <= 500),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{32}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and blocked_until >= ends_at),
  foreign key (workspace_id, service_id) references public.services (workspace_id, id),
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete set null (contact_id),
  constraint bookings_no_overlap exclude using gist (
    workspace_id with =,
    tstzrange(starts_at, blocked_until) with &&
  ) where (status = 'confirmed')
);
create index bookings_ws_starts_idx on public.bookings (workspace_id, starts_at);
create index bookings_service_idx on public.bookings (workspace_id, service_id);
create index bookings_contact_idx on public.bookings (workspace_id, contact_id);

create trigger touch_services before update on public.services for each row execute function app.touch_updated_at();
create trigger touch_bookings before update on public.bookings for each row execute function app.touch_updated_at();
create trigger fixed_ws_services before update on public.services for each row execute function app.forbid_workspace_change();
create trigger fixed_ws_bookings before update on public.bookings for each row execute function app.forbid_workspace_change();

-- Switching the booking page on ticks the setup quest.
create or replace function app.quest_on_booking_enabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.booking_enabled and not old.booking_enabled then
    perform app.complete_quest_step(new.workspace_id, 'booking_page');
  end if;
  return new;
end;
$$;
create trigger quest_on_booking_enabled after update of booking_enabled on public.workspace_settings
  for each row execute function app.quest_on_booking_enabled();
revoke all on function app.quest_on_booking_enabled() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public functions (the booking page). They take the workspace slug and return only
-- what the page shows.
-- ---------------------------------------------------------------------------
create or replace function app.booking_workspace(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id from public.workspaces w join public.workspace_settings s on s.workspace_id = w.id
  where w.slug = p_slug and w.deleted_at is null and s.booking_enabled;
$$;
revoke all on function app.booking_workspace(text) from public, anon, authenticated;

create or replace function public.get_booking_page(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ws uuid := app.booking_workspace(p_slug);
begin
  if ws is null then
    return null;
  end if;
  return jsonb_build_object(
    'name', (select coalesce(nullif(s.business_name, ''), w.name) from public.workspaces w left join public.workspace_settings s on s.workspace_id = w.id where w.id = ws),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description, 'duration_min', duration_min, 'price_cents', price_cents) order by name)
      from public.services where workspace_id = ws and active
    ), '[]'::jsonb)
  );
end;
$$;

/** Start times (SAST opening hours, 15-minute steps) when the whole service plus buffer is free. */
create or replace function public.get_available_slots(p_slug text, p_service uuid, p_date date)
returns timestamptz[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ws uuid := app.booking_workspace(p_slug);
  svc public.services%rowtype;
  today date := (now() at time zone 'Africa/Johannesburg')::date;
  result timestamptz[];
begin
  if ws is null or p_date is null or p_date < today or p_date > today + 60 then
    return '{}';
  end if;
  select * into svc from public.services where id = p_service and workspace_id = ws and active;
  if not found then
    return '{}';
  end if;
  select coalesce(array_agg(slot order by slot), '{}') into result
  from (
    select distinct gs as slot
    from public.availability_rules a,
         generate_series(
           (p_date + a.start_time) at time zone 'Africa/Johannesburg',
           ((p_date + a.end_time) at time zone 'Africa/Johannesburg') - make_interval(mins => svc.duration_min),
           interval '15 minutes'
         ) as gs
    where a.workspace_id = ws and a.weekday = extract(isodow from p_date)
      and gs >= now() + interval '1 hour'
      and not exists (
        select 1 from public.bookings b
        where b.workspace_id = ws and b.status = 'confirmed'
          and tstzrange(b.starts_at, b.blocked_until) && tstzrange(gs, gs + make_interval(mins => svc.duration_min + svc.buffer_min))
      )
  ) s;
  return result;
end;
$$;

/**
 * Books a slot. Server only (the app rate-limits by IP first): it emails whatever address it is
 * given, so it must not be callable with the public key. Also caps bookings per business per hour
 * and per email per day. Returns {token, starts_at}.
 */
create or replace function public.create_booking(p_slug text, p_service uuid, p_starts_at timestamptz,
                                                 p_name text, p_email text, p_phone text, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := app.booking_workspace(p_slug);
  svc public.services%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
  contact uuid;
  bid uuid;
  tok text := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');
  owner_email text;
begin
  if ws is null then
    raise exception 'Bookings are not open for this business' using errcode = 'LDG03';
  end if;
  select * into svc from public.services where id = p_service and workspace_id = ws and active;
  if not found then
    raise exception 'Choose a service' using errcode = 'LDG03';
  end if;
  if not (p_starts_at = any (public.get_available_slots(p_slug, p_service, (p_starts_at at time zone 'Africa/Johannesburg')::date))) then
    raise exception 'That time is no longer available. Choose another.' using errcode = 'LDG03';
  end if;
  if (select count(*) from public.bookings where workspace_id = ws and created_at > now() - interval '1 hour') >= 30
     or (select count(*) from public.bookings where workspace_id = ws and customer_email = v_email and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Too many bookings right now. Try again later or contact the business.' using errcode = 'LDG03';
  end if;

  select id into contact from public.contacts where workspace_id = ws and lower(email) = v_email and deleted_at is null order by created_at limit 1;
  if contact is null then
    insert into public.contacts (workspace_id, name, email, phone) values (ws, left(btrim(p_name), 120), v_email, p_phone) returning id into contact;
  end if;

  begin
    insert into public.bookings (workspace_id, service_id, contact_id, starts_at, ends_at, blocked_until,
                                 customer_name, customer_email, customer_phone, notes, token)
    values (ws, svc.id, contact, p_starts_at, p_starts_at + make_interval(mins => svc.duration_min),
            p_starts_at + make_interval(mins => svc.duration_min + svc.buffer_min),
            left(btrim(p_name), 120), v_email, p_phone, nullif(left(btrim(coalesce(p_notes, '')), 500), ''), tok)
    returning id into bid;
  exception when exclusion_violation then
    raise exception 'That time was just taken. Choose another.' using errcode = 'LDG03';
  end;

  select lower(u.email) into owner_email from public.memberships m join auth.users u on u.id = m.user_id
  where m.workspace_id = ws and m.role = 'owner' order by m.created_at limit 1;
  insert into public.outbox (workspace_id, template, to_address, reply_to, payload, idempotency_key)
  values (ws, 'booking_confirmed', v_email, owner_email, jsonb_build_object('booking_id', bid), 'booking:' || bid || ':confirmed');
  if p_starts_at - interval '24 hours' > now() + interval '1 hour' then
    insert into public.outbox (workspace_id, template, to_address, reply_to, payload, idempotency_key, next_attempt_at)
    values (ws, 'booking_reminder', v_email, owner_email, jsonb_build_object('booking_id', bid), 'booking:' || bid || ':reminder',
            p_starts_at - interval '24 hours');
  end if;
  return jsonb_build_object('token', tok, 'starts_at', p_starts_at);
end;
$$;

/** What the calendar (.ics) file needs, by the booking's private token. No customer details. */
create or replace function public.get_booking_ics(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', b.id, 'service', s.name, 'business', coalesce(nullif(ws.business_name, ''), w.name),
                            'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status, 'created_at', b.created_at)
  from public.bookings b
  join public.services s on s.id = b.service_id
  join public.workspaces w on w.id = b.workspace_id
  left join public.workspace_settings ws on ws.workspace_id = w.id
  where p_token ~ '^[A-Za-z0-9_-]{32}$' and b.token = p_token and w.deleted_at is null;
$$;

revoke all on function public.get_booking_page(text) from public;
revoke all on function public.get_available_slots(text, uuid, date) from public;
revoke all on function public.create_booking(text, uuid, timestamptz, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_booking_ics(text) from public;
grant execute on function public.get_booking_page(text) to anon, authenticated;
grant execute on function public.get_available_slots(text, uuid, date) to anon, authenticated;
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text) to service_role;
grant execute on function public.get_booking_ics(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security: owners and admins set up services and hours; the team sees
-- bookings and can cancel them; the public goes through the functions above.
-- ---------------------------------------------------------------------------
alter table public.services enable row level security;
alter table public.availability_rules enable row level security;
alter table public.bookings enable row level security;
revoke all on public.services, public.availability_rules, public.bookings from anon, authenticated;

grant select on public.services, public.availability_rules, public.bookings to authenticated;
grant insert (workspace_id, name, description, duration_min, buffer_min, price_cents, active) on public.services to authenticated;
grant update (name, description, duration_min, buffer_min, price_cents, active) on public.services to authenticated;
grant insert (workspace_id, weekday, start_time, end_time) on public.availability_rules to authenticated;
grant delete on public.availability_rules to authenticated;
grant update (status) on public.bookings to authenticated;

create policy services_select on public.services for select to authenticated using ((select app.is_member(workspace_id)));
create policy services_insert on public.services for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy services_update on public.services for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));

create policy availability_select on public.availability_rules for select to authenticated using ((select app.is_member(workspace_id)));
create policy availability_insert on public.availability_rules for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin'])));
create policy availability_delete on public.availability_rules for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));

create policy bookings_select on public.bookings for select to authenticated using ((select app.is_member(workspace_id)));
create policy bookings_update on public.bookings for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
