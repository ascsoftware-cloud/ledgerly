-- 0030_documents: folders and files, contract templates, contracts with e-signatures, and the customer portal.
-- Down script: supabase/migrations/down/0030_documents.sql
--
-- Rules the database enforces:
--  * Contract text is frozen once sent. Status changes only through the functions below.
--  * A signature records name, time, IP, device, an optional drawn mark and the SHA-256 of the contract as shown.
--    It is written only by `sign_contract`, which the public key and signed-in users cannot call: the server
--    passes the IP and device itself, behind its own rate limit. The record cannot be edited or deleted.
--  * The portal shows one client only what is theirs. A revoked or unknown token shows nothing at all.

alter table public.outbox drop constraint outbox_template_check;
alter table public.outbox add constraint outbox_template_check
  check (template in ('document', 'reminder', 'booking_confirmed', 'booking_reminder', 'team_invite', 'portal_link'));

-- /invite and /portal are public paths: a workspace can never take them as its slug.
do $$
declare
  c text;
begin
  select conname into c from pg_constraint
  where conrelid = 'public.workspaces'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%portal%';
  execute format('alter table public.workspaces drop constraint %I', c);
end;
$$;
alter table public.workspaces add constraint workspaces_slug_reserved
  check (slug not in ('start', 'login', 'auth', 'api', 'book', 'portal', 'invite', 'demo', 'styleguide',
                      'privacy', 'terms', 'popia', 'pricing', 'welcome', 'settings', 'admin'));

-- ---------------------------------------------------------------------------
-- Folders and files (one level of folders; the bytes live in the private `documents` bucket)
-- ---------------------------------------------------------------------------
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id)
);
create unique index folders_name_idx on public.folders (workspace_id, lower(name)) where deleted_at is null;
create index folders_created_by_idx on public.folders (created_by);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  folder_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  storage_path text not null unique check (char_length(storage_path) <= 300),
  mime_type text not null check (char_length(mime_type) <= 100),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id),
  check (split_part(storage_path, '/', 1) = workspace_id::text),
  foreign key (workspace_id, folder_id) references public.folders (workspace_id, id) on delete set null (folder_id)
);
create index files_ws_idx on public.files (workspace_id, created_at desc) where deleted_at is null;
create index files_folder_idx on public.files (workspace_id, folder_id);
create index files_created_by_idx on public.files (created_by);

-- ---------------------------------------------------------------------------
-- Contract templates, contracts and signatures
-- ---------------------------------------------------------------------------
create table public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, id)
);
create index contract_templates_ws_idx on public.contract_templates (workspace_id, name) where deleted_at is null;
create index contract_templates_created_by_idx on public.contract_templates (created_by);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contact_id uuid not null,
  template_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  -- The filled-in text, frozen when sent. Plain text: shown by React, never as HTML.
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  status text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'void')),
  sent_at timestamptz,
  signed_at timestamptz,
  voided_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete no action,
  foreign key (workspace_id, template_id) references public.contract_templates (workspace_id, id) on delete set null (template_id)
);
create index contracts_ws_idx on public.contracts (workspace_id, created_at desc);
create index contracts_contact_idx on public.contracts (workspace_id, contact_id);
create index contracts_template_idx on public.contracts (workspace_id, template_id);
create index contracts_created_by_idx on public.contracts (created_by);

create table public.contract_signatures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contract_id uuid not null,
  signer_name text not null check (char_length(btrim(signer_name)) between 2 and 120),
  -- A drawn mark as a small PNG data URL, if the signer drew one.
  signature_image text check (signature_image is null or (char_length(signature_image) <= 150000 and signature_image like 'data:image/png;base64,%')),
  signed_at timestamptz not null default now(),
  ip_address text check (char_length(ip_address) <= 64),
  user_agent text check (char_length(user_agent) <= 400),
  -- SHA-256 of the title and text exactly as shown and signed, so the record can be checked later.
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  unique (contract_id),
  foreign key (workspace_id, contract_id) references public.contracts (workspace_id, id) on delete cascade
);
create index contract_signatures_ws_idx on public.contract_signatures (workspace_id, contract_id);

create trigger touch_folders before update on public.folders for each row execute function app.touch_updated_at();
create trigger touch_files before update on public.files for each row execute function app.touch_updated_at();
create trigger touch_contract_templates before update on public.contract_templates for each row execute function app.touch_updated_at();
create trigger touch_contracts before update on public.contracts for each row execute function app.touch_updated_at();
create trigger fixed_ws_folders before update on public.folders for each row execute function app.forbid_workspace_change();
create trigger fixed_ws_files before update on public.files for each row execute function app.forbid_workspace_change();
create trigger fixed_ws_contract_templates before update on public.contract_templates for each row execute function app.forbid_workspace_change();
create trigger fixed_ws_contracts before update on public.contracts for each row execute function app.forbid_workspace_change();

-- Only a draft contract's text can change (functions running as the owner pass through).
create or replace function app.guard_contract_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and old.status <> 'draft'
     and (new.title is distinct from old.title or new.body is distinct from old.body or new.contact_id is distinct from old.contact_id) then
    raise exception 'Only a draft contract can be changed. Void it and make a new one.' using errcode = 'LDG02';
  end if;
  return new;
end;
$$;
create trigger guard_contract_text before update on public.contracts for each row execute function app.guard_contract_text();

-- ---------------------------------------------------------------------------
-- Portal links: one active link per client, revocable
-- ---------------------------------------------------------------------------
create table public.portal_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contact_id uuid not null,
  token text not null unique default translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'),
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete cascade
);
create unique index portal_links_active_idx on public.portal_links (contact_id) where revoked_at is null;
create index portal_links_ws_idx on public.portal_links (workspace_id, contact_id);
create index portal_links_created_by_idx on public.portal_links (created_by);

-- The client's active link, made on first use.
create or replace function app.ensure_portal_link(ws uuid, contact uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
begin
  select token into t from public.portal_links where contact_id = contact and workspace_id = ws and revoked_at is null;
  if t is null then
    insert into public.portal_links (workspace_id, contact_id) values (ws, contact) returning token into t;
  end if;
  return t;
end;
$$;
revoke all on function app.ensure_portal_link(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_portal_link(p_contact uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.contacts%rowtype;
begin
  select * into c from public.contacts where id = p_contact and deleted_at is null;
  if not found or not app.has_role(c.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Client not found' using errcode = 'no_data_found';
  end if;
  return app.ensure_portal_link(c.workspace_id, c.id);
end;
$$;

create or replace function public.revoke_portal_link(p_contact uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.contacts%rowtype;
begin
  select * into c from public.contacts where id = p_contact;
  if not found or not app.has_role(c.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Client not found' using errcode = 'no_data_found';
  end if;
  update public.portal_links set revoked_at = now() where contact_id = c.id and workspace_id = c.workspace_id and revoked_at is null;
end;
$$;

create or replace function public.rotate_portal_link(p_contact uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.contacts%rowtype;
begin
  select * into c from public.contacts where id = p_contact and deleted_at is null;
  if not found or not app.has_role(c.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Client not found' using errcode = 'no_data_found';
  end if;
  update public.portal_links set revoked_at = now() where contact_id = c.id and workspace_id = c.workspace_id and revoked_at is null;
  return app.ensure_portal_link(c.workspace_id, c.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Contract lifecycle
-- ---------------------------------------------------------------------------
create or replace function public.send_contract(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.contracts%rowtype;
begin
  select * into k from public.contracts where id = p_id for update;
  if not found or not app.has_role(k.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Contract not found' using errcode = 'no_data_found';
  end if;
  if k.status = 'void' then
    raise exception 'This contract was withdrawn' using errcode = 'LDG03';
  end if;
  if k.status = 'draft' then
    if exists (select 1 from public.contacts c where c.id = k.contact_id and c.deleted_at is not null) then
      raise exception 'This client is archived. Restore them first.' using errcode = 'LDG03';
    end if;
    update public.contracts set status = 'sent', sent_at = now() where id = k.id;
    perform app.audit(k.workspace_id, (select auth.uid()), 'contract.sent', 'Contract "' || k.title || '" sent for signing', 'contract', k.id);
  end if;
  return jsonb_build_object('status', case when k.status = 'draft' then 'sent' else k.status end,
                            'portal_token', app.ensure_portal_link(k.workspace_id, k.contact_id));
end;
$$;

create or replace function public.void_contract(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.contracts%rowtype;
begin
  select * into k from public.contracts where id = p_id for update;
  if not found or not app.has_role(k.workspace_id, array['owner', 'admin']) then
    raise exception 'Contract not found' using errcode = 'no_data_found';
  end if;
  if k.status = 'signed' then
    raise exception 'A signed contract cannot be voided' using errcode = 'LDG03';
  end if;
  if k.status = 'void' then
    return;
  end if;
  update public.contracts set status = 'void', voided_at = now() where id = k.id;
  perform app.audit(k.workspace_id, (select auth.uid()), 'contract.voided', 'Contract "' || k.title || '" withdrawn', 'contract', k.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- What the portal shows (public: by token only)
-- ---------------------------------------------------------------------------
create or replace function app.portal_link_by_token(p_token text)
returns public.portal_links
language sql
stable
security definer
set search_path = ''
as $$
  select l.* from public.portal_links l
  join public.workspaces w on w.id = l.workspace_id and w.deleted_at is null
  join public.contacts c on c.id = l.contact_id and c.workspace_id = l.workspace_id and c.deleted_at is null
  where p_token ~ '^[A-Za-z0-9_-]{32}$' and l.token = p_token and l.revoked_at is null;
$$;
revoke all on function app.portal_link_by_token(text) from public, anon, authenticated;

create or replace function public.get_portal(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.portal_links;
begin
  l := app.portal_link_by_token(p_token);
  if l.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'business', (select coalesce(nullif(btrim(s.business_name), ''), w.name)
                 from public.workspaces w left join public.workspace_settings s on s.workspace_id = w.id where w.id = l.workspace_id),
    'client', (select c.name from public.contacts c where c.id = l.contact_id),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', d.kind, 'number', d.number, 'status', d.status, 'issue_date', d.issue_date, 'due_date', d.due_date,
        'total_cents', d.total_cents,
        'balance_cents', case when d.kind = 'invoice' then greatest(d.total_cents - d.paid_cents - d.credited_cents, 0) end,
        'token', d.public_token) order by d.issue_date desc, d.number desc)
      from (select * from public.sales_documents
            where workspace_id = l.workspace_id and contact_id = l.contact_id and status not in ('draft', 'void')
            order by issue_date desc, number desc limit 100) d), '[]'::jsonb),
    'contracts', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'status', k.status, 'sent_at', k.sent_at, 'signed_at', k.signed_at)
                       order by k.created_at desc)
      from public.contracts k
      where k.workspace_id = l.workspace_id and k.contact_id = l.contact_id and k.status in ('sent', 'signed')), '[]'::jsonb));
end;
$$;

create or replace function public.get_portal_contract(p_token text, p_contract uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.portal_links;
  k public.contracts%rowtype;
begin
  l := app.portal_link_by_token(p_token);
  if l.id is null then
    return null;
  end if;
  select * into k from public.contracts
  where id = p_contract and workspace_id = l.workspace_id and contact_id = l.contact_id and status in ('sent', 'signed');
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', k.id, 'title', k.title, 'body', k.body, 'status', k.status, 'signed_at', k.signed_at,
    'signer_name', (select s.signer_name from public.contract_signatures s where s.contract_id = k.id),
    'business', (select coalesce(nullif(btrim(s.business_name), ''), w.name)
                 from public.workspaces w left join public.workspace_settings s on s.workspace_id = w.id where w.id = k.workspace_id),
    'client', (select c.name from public.contacts c where c.id = k.contact_id));
end;
$$;

-- Server only: the app passes the visitor's IP and device itself, behind its own rate limit.
create or replace function public.sign_contract(p_token text, p_contract uuid, p_name text, p_image text, p_ip text, p_ua text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.portal_links;
  k public.contracts%rowtype;
  nm text := btrim(coalesce(p_name, ''));
  h text;
begin
  l := app.portal_link_by_token(p_token);
  if l.id is null then
    raise exception 'This link is no longer valid.' using errcode = 'LDG03';
  end if;
  if char_length(nm) < 2 or char_length(nm) > 120 then
    raise exception 'Type your full name to sign.' using errcode = 'LDG03';
  end if;
  if p_image is not null and (char_length(p_image) > 150000 or p_image not like 'data:image/png;base64,%') then
    raise exception 'The drawn signature is not valid. Try again or type your name.' using errcode = 'LDG03';
  end if;
  select * into k from public.contracts
  where id = p_contract and workspace_id = l.workspace_id and contact_id = l.contact_id for update;
  if not found or k.status <> 'sent' then
    raise exception 'This contract cannot be signed (it may already be signed or withdrawn).' using errcode = 'LDG03';
  end if;
  h := encode(sha256(convert_to(k.title || E'\n' || k.body, 'utf8')), 'hex');
  insert into public.contract_signatures (workspace_id, contract_id, signer_name, signature_image, ip_address, user_agent, document_hash)
  values (k.workspace_id, k.id, nm, p_image, left(p_ip, 64), left(p_ua, 400), h);
  update public.contracts set status = 'signed', signed_at = now() where id = k.id;
  perform app.audit(k.workspace_id, null, 'contract.signed', 'Contract "' || k.title || '" signed by ' || nm, 'contract', k.id);
  return jsonb_build_object('hash', h, 'signed_at', now());
end;
$$;

-- The portal link by email, through the outbox (one email per request id; five a day per client).
create or replace function public.queue_portal_email(p_contact uuid, p_message text, p_request uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.contacts%rowtype;
  addr text;
  key text;
  out_id uuid;
  sender text;
begin
  select * into c from public.contacts where id = p_contact and deleted_at is null;
  if not found or not app.has_role(c.workspace_id, array['owner', 'admin', 'staff']) then
    raise exception 'Client not found' using errcode = 'no_data_found';
  end if;
  addr := lower(btrim(coalesce(c.email, '')));
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'This client has no email address. Add one first.' using errcode = 'LDG03';
  end if;
  if p_message is not null and char_length(p_message) > 1000 then
    raise exception 'Keep the message under 1000 characters' using errcode = 'LDG03';
  end if;
  key := 'portal:' || c.id || ':' || p_request;
  select id into out_id from public.outbox where idempotency_key = key;
  if out_id is not null then
    return out_id;
  end if;
  if (select count(*) from public.outbox where workspace_id = c.workspace_id and template = 'portal_link'
        and to_address = addr and created_at > now() - interval '1 day') >= 5 then
    raise exception 'You have already emailed this client five times today.' using errcode = 'LDG03';
  end if;
  perform app.ensure_portal_link(c.workspace_id, c.id);
  select lower(email) into sender from auth.users where id = (select auth.uid());
  insert into public.outbox (workspace_id, template, to_address, reply_to, payload, idempotency_key, created_by)
  values (c.workspace_id, 'portal_link', addr, sender,
          jsonb_build_object('contact_id', c.id, 'message', nullif(btrim(p_message), '')), key, (select auth.uid()))
  returning id into out_id;
  return out_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------
alter table public.folders enable row level security;
alter table public.files enable row level security;
alter table public.contract_templates enable row level security;
alter table public.contracts enable row level security;
alter table public.contract_signatures enable row level security;
alter table public.portal_links enable row level security;
revoke all on public.folders, public.files, public.contract_templates, public.contracts, public.contract_signatures, public.portal_links
  from anon, authenticated;

grant select on public.folders, public.files, public.contract_templates, public.contracts, public.contract_signatures to authenticated;
grant select (id, workspace_id, contact_id, token, revoked_at, created_at) on public.portal_links to authenticated;
grant insert (workspace_id, name) on public.folders to authenticated;
grant update (name, deleted_at) on public.folders to authenticated;
grant insert (workspace_id, folder_id, name, storage_path, mime_type, size_bytes) on public.files to authenticated;
grant update (folder_id, name, deleted_at) on public.files to authenticated;
grant insert (workspace_id, name, body) on public.contract_templates to authenticated;
grant update (name, body, deleted_at) on public.contract_templates to authenticated;
grant insert (workspace_id, contact_id, template_id, title, body) on public.contracts to authenticated;
grant update (contact_id, title, body) on public.contracts to authenticated;
grant delete on public.contracts to authenticated;

create policy folders_select on public.folders for select to authenticated using ((select app.is_member(workspace_id)));
create policy folders_insert on public.folders for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy folders_update on public.folders for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));

create policy files_select on public.files for select to authenticated using ((select app.is_member(workspace_id)));
create policy files_insert on public.files for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy files_update on public.files for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));

create policy contract_templates_select on public.contract_templates for select to authenticated using ((select app.is_member(workspace_id)));
create policy contract_templates_insert on public.contract_templates for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy contract_templates_update on public.contract_templates for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));

create policy contracts_select on public.contracts for select to authenticated using ((select app.is_member(workspace_id)));
create policy contracts_insert on public.contracts for insert to authenticated
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy contracts_update on public.contracts for update to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])))
  with check ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));
create policy contracts_delete on public.contracts for delete to authenticated
  using (status = 'draft' and (select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));

create policy contract_signatures_select on public.contract_signatures for select to authenticated using ((select app.is_member(workspace_id)));
-- Link tokens are secrets: the people who can share them can read them, the read-only accountant cannot.
create policy portal_links_select on public.portal_links for select to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin', 'staff'])));

revoke all on function public.create_portal_link(uuid), public.revoke_portal_link(uuid), public.rotate_portal_link(uuid),
  public.send_contract(uuid), public.void_contract(uuid), public.queue_portal_email(uuid, text, uuid) from public, anon;
grant execute on function public.create_portal_link(uuid), public.revoke_portal_link(uuid), public.rotate_portal_link(uuid),
  public.send_contract(uuid), public.void_contract(uuid), public.queue_portal_email(uuid, text, uuid) to authenticated;
revoke all on function public.get_portal(text), public.get_portal_contract(text, uuid) from public;
grant execute on function public.get_portal(text), public.get_portal_contract(text, uuid) to anon, authenticated;
revoke all on function public.sign_contract(text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.sign_contract(text, uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Private bucket for files: one folder per workspace, 10 MB, short-lived signed links only.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create policy documents_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (select app.is_member(app.folder_workspace(name))));
create policy documents_write on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (select app.has_role(app.folder_workspace(name), array['owner', 'admin', 'staff'])));
create policy documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (select app.has_role(app.folder_workspace(name), array['owner', 'admin', 'staff'])));
