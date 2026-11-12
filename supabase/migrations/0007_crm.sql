-- 0007_crm: clients (contacts and companies), tags, notes and the activity timeline.
-- Down script: supabase/migrations/down/0007_crm.sql
--
-- Pattern used from here on: every child row references its parent by (workspace_id, id),
-- so a row can never point at another workspace's record even if someone guesses a UUID.

-- A row may never move to another workspace.
create or replace function app.forbid_workspace_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id <> old.workspace_id then
    raise exception 'A record cannot be moved to another workspace' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function app.forbid_workspace_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  vat_number text check (char_length(vat_number) <= 20),
  registration_number text check (char_length(registration_number) <= 40),
  address text check (char_length(address) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id)
);
create unique index companies_name_uq on public.companies (workspace_id, lower(name)) where deleted_at is null;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  email text check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  -- Stored in international form (+27…) so WhatsApp links work.
  phone text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  address text check (char_length(address) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, ''))
  ) stored,
  unique (workspace_id, id),
  foreign key (workspace_id, company_id) references public.companies (workspace_id, id) on delete set null (company_id)
);
create index contacts_workspace_idx on public.contacts (workspace_id, lower(name)) where deleted_at is null;
create index contacts_company_idx on public.contacts (workspace_id, company_id);
create index contacts_created_by_idx on public.contacts (created_by);
create index contacts_search_idx on public.contacts using gin (search);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  colour text not null default 'slate' check (colour in ('slate', 'emerald', 'indigo', 'coral', 'amber', 'violet', 'sky')),
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create unique index tags_name_uq on public.tags (workspace_id, lower(name));

create table public.contact_tags (
  workspace_id uuid not null,
  contact_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id),
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete cascade,
  foreign key (workspace_id, tag_id) references public.tags (workspace_id, id) on delete cascade
);
create index contact_tags_ws_tag_idx on public.contact_tags (workspace_id, tag_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  contact_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  author_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete cascade
);
create index notes_contact_idx on public.notes (workspace_id, contact_id, created_at desc);
create index notes_author_idx on public.notes (author_id);

-- Append-only timeline. Written by triggers (and later by invoices, payments, bookings).
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contact_id uuid,
  kind text not null check (kind in ('contact_created', 'note_added', 'quote_sent', 'quote_accepted',
                                     'invoice_sent', 'invoice_viewed', 'payment_received', 'deal_moved')),
  ref_id uuid,
  summary text not null check (char_length(summary) <= 300),
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete cascade
);
create index activities_contact_idx on public.activities (workspace_id, contact_id, created_at desc);
create index activities_actor_idx on public.activities (actor_id);

create trigger touch_companies before update on public.companies for each row execute function app.touch_updated_at();
create trigger touch_contacts before update on public.contacts for each row execute function app.touch_updated_at();
create trigger touch_notes before update on public.notes for each row execute function app.touch_updated_at();
create trigger fixed_ws_companies before update on public.companies for each row execute function app.forbid_workspace_change();
create trigger fixed_ws_contacts before update on public.contacts for each row execute function app.forbid_workspace_change();
create trigger fixed_ws_notes before update on public.notes for each row execute function app.forbid_workspace_change();

-- Stamp the author from the session so nobody can post as someone else.
create or replace function app.stamp_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'contacts' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
  elsif tg_table_name = 'notes' then
    new.author_id := coalesce((select auth.uid()), new.author_id);
  end if;
  return new;
end;
$$;
revoke all on function app.stamp_author() from public, anon, authenticated;
create trigger stamp_contacts before insert on public.contacts for each row execute function app.stamp_author();
create trigger stamp_notes before insert on public.notes for each row execute function app.stamp_author();

-- Timeline entries and quest progress.
create or replace function app.crm_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'contacts' then
    insert into public.activities (workspace_id, contact_id, kind, ref_id, summary, actor_id)
    values (new.workspace_id, new.id, 'contact_created', new.id, 'Added as a client', (select auth.uid()));
    perform app.complete_quest_step(new.workspace_id, 'first_client');
  elsif tg_table_name = 'notes' then
    insert into public.activities (workspace_id, contact_id, kind, ref_id, summary, actor_id)
    values (new.workspace_id, new.contact_id, 'note_added', new.id, left(new.body, 140), (select auth.uid()));
  end if;
  return new;
end;
$$;
revoke all on function app.crm_activity() from public, anon, authenticated;
create trigger activity_contacts after insert on public.contacts for each row execute function app.crm_activity();
create trigger activity_notes after insert on public.notes for each row execute function app.crm_activity();

-- ---------------------------------------------------------------------------
-- Row-level security: members read; owner, admin and staff write; accountants read only.
-- ---------------------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.tags enable row level security;
alter table public.contact_tags enable row level security;
alter table public.notes enable row level security;
alter table public.activities enable row level security;

revoke all on public.companies, public.contacts, public.tags, public.contact_tags, public.notes,
  public.activities from anon, authenticated;

grant select, delete on public.companies to authenticated;
grant insert (workspace_id, name, vat_number, registration_number, address) on public.companies to authenticated;
grant update (name, vat_number, registration_number, address, deleted_at) on public.companies to authenticated;

grant select, delete on public.contacts to authenticated;
grant insert (workspace_id, company_id, name, email, phone, address) on public.contacts to authenticated;
grant update (company_id, name, email, phone, address, deleted_at) on public.contacts to authenticated;

grant select, insert, delete on public.tags to authenticated;
grant update (name, colour) on public.tags to authenticated;

grant select, insert, delete on public.contact_tags to authenticated;

grant select, delete on public.notes to authenticated;
grant insert (workspace_id, contact_id, body) on public.notes to authenticated;
grant update (body) on public.notes to authenticated;

grant select on public.activities to authenticated;

-- One set of policies per table, written with the same two helpers.
create policy companies_select on public.companies for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy companies_insert on public.companies for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy companies_update on public.companies for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy companies_delete on public.companies for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));

create policy contacts_select on public.contacts for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy contacts_insert on public.contacts for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy contacts_update on public.contacts for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy contacts_delete on public.contacts for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));

create policy tags_select on public.tags for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy tags_insert on public.tags for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy tags_update on public.tags for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy tags_delete on public.tags for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));

create policy contact_tags_select on public.contact_tags for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy contact_tags_insert on public.contact_tags for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy contact_tags_delete on public.contact_tags for delete to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));

create policy notes_select on public.notes for select to authenticated
  using ((select app.is_member(workspace_id)));
create policy notes_insert on public.notes for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
-- Only the author edits a note; owners and admins may remove any.
create policy notes_update on public.notes for update to authenticated
  using (author_id = (select auth.uid()) and (select app.is_member(workspace_id)))
  with check (author_id = (select auth.uid()));
create policy notes_delete on public.notes for delete to authenticated
  using (author_id = (select auth.uid()) or (select app.has_role(workspace_id, array['owner', 'admin'])));

create policy activities_select on public.activities for select to authenticated
  using ((select app.is_member(workspace_id)));
