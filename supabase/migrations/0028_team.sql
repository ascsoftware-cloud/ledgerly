-- 0028_team: inviting people, accepting, the member list with emails, and the activity log.
-- Down script: supabase/migrations/down/0028_team.sql
--
-- Rules the database enforces:
--  * Only owners and admins invite. Ownership is never given by invitation. One open invitation per email.
--  * An invitation is accepted only by the signed-in user whose email it was sent to; a forwarded link
--    does not hand over access. Only the hash of the token is stored.
--  * The activity log is append-only and written only by triggers and functions.

alter table public.outbox drop constraint outbox_template_check;
alter table public.outbox add constraint outbox_template_check
  check (template in ('document', 'reminder', 'booking_confirmed', 'booking_reminder', 'team_invite'));

-- ---------------------------------------------------------------------------
-- Activity log
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 1 and 60),
  summary text not null check (char_length(summary) between 1 and 300),
  entity text check (char_length(entity) <= 40),
  entity_id uuid,
  created_at timestamptz not null default now()
);
create index audit_log_ws_idx on public.audit_log (workspace_id, created_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select app.has_role(workspace_id, array['owner', 'admin'])));

-- Who did it, in words: their name, else their email.
create or replace function app.person(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select coalesce(nullif(btrim(p.full_name), ''), u.email::text) from auth.users u left join public.profiles p on p.id = u.id where u.id = uid),
    'Someone');
$$;

create or replace function app.rand(cents bigint)
returns text
language sql
immutable
set search_path = ''
as $$ select 'R' || to_char(cents / 100.0, 'FM999999999990.00'); $$;

create or replace function app.audit(ws uuid, actor uuid, p_action text, p_summary text, p_entity text default null, p_entity_id uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (workspace_id, actor_id, action, summary, entity, entity_id)
  values (ws, actor, p_action, left(p_summary, 300), p_entity, p_entity_id);
$$;
revoke all on function app.person(uuid), app.rand(bigint), app.audit(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;

-- Members joining, changing role, leaving or being removed.
create or replace function app.audit_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := coalesce(new.workspace_id, old.workspace_id);
  actor uuid := (select auth.uid());
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.workspaces w where w.id = ws) then
    return old;
  end if;
  if tg_op = 'INSERT' then
    -- The founding owner is not news.
    if new.role <> 'owner' then
      perform app.audit(ws, actor, 'member.joined', app.person(new.user_id) || ' joined as ' || new.role, 'membership', new.id);
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.role <> old.role then
      perform app.audit(ws, actor, 'member.role_changed',
        app.person(new.user_id) || ': role changed from ' || old.role || ' to ' || new.role, 'membership', new.id);
    end if;
    return new;
  end if;
  perform app.audit(ws, actor, case when actor = old.user_id then 'member.left' else 'member.removed' end,
    app.person(old.user_id) || case when actor = old.user_id then ' left the team' else ' was removed from the team' end,
    'membership', old.id);
  return old;
end;
$$;
create trigger audit_membership after insert or update or delete on public.memberships
  for each row execute function app.audit_membership();

create or replace function app.audit_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.audit(new.workspace_id, (select auth.uid()), 'member.invited', 'Invited ' || new.email || ' as ' || new.role, 'invite', new.id);
    return new;
  end if;
  if old.accepted_at is null and exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    perform app.audit(old.workspace_id, (select auth.uid()), 'invite.cancelled', 'Cancelled the invitation for ' || old.email, 'invite', old.id);
  end if;
  return old;
end;
$$;
create trigger audit_invite after insert or delete on public.invites
  for each row execute function app.audit_invite();

-- Sending and voiding documents.
create or replace function app.audit_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  word text := case new.kind when 'invoice' then 'Invoice ' when 'quote' then 'Quote ' else 'Credit note ' end;
begin
  if old.status = 'draft' and new.status not in ('draft', 'void') then
    perform app.audit(new.workspace_id, (select auth.uid()), 'document.sent', word || new.number || ' sent (' || app.rand(new.total_cents) || ')', 'document', new.id);
  elsif new.status = 'void' and old.status <> 'void' then
    perform app.audit(new.workspace_id, (select auth.uid()), 'document.voided', word || coalesce(new.number, '') || ' voided', 'document', new.id);
  end if;
  return new;
end;
$$;
create trigger audit_document after update of status on public.sales_documents
  for each row when (old.status is distinct from new.status) execute function app.audit_document();

create or replace function app.audit_payment_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    perform app.audit(old.workspace_id, (select auth.uid()), 'payment.removed',
      'Removed a ' || app.rand(old.amount_cents) || ' payment (' || old.method || ') from '
        || coalesce((select number from public.sales_documents where id = old.document_id and workspace_id = old.workspace_id), 'an invoice'),
      'payment', old.id);
  end if;
  return old;
end;
$$;
create trigger audit_payment_removed after delete on public.payments
  for each row execute function app.audit_payment_removed();

create or replace function app.audit_stock_adjusted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.audit(new.workspace_id, (select auth.uid()), 'stock.adjusted',
    case when new.reason = 'initial' then 'Opening stock of ' else 'Stock of ' end
      || coalesce((select name from public.products where id = new.product_id and workspace_id = new.workspace_id), 'a product')
      || case when new.reason = 'initial' then ' set to ' else ' changed by ' || case when new.qty_change > 0 then '+' else '' end end
      || trim(trailing '.' from trim(trailing '0' from new.qty_change::text)),
    'product', new.product_id);
  return new;
end;
$$;
create trigger audit_stock_adjusted after insert on public.stock_movements
  for each row when (new.reason in ('adjustment', 'initial')) execute function app.audit_stock_adjusted();

create or replace function app.audit_po_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.audit(new.workspace_id, (select auth.uid()), 'purchase_order.received', 'Received purchase order ' || new.number, 'purchase_order', new.id);
  return new;
end;
$$;
create trigger audit_po_received after update of status on public.purchase_orders
  for each row when (new.status = 'received' and old.status <> 'received') execute function app.audit_po_received();

revoke all on function app.audit_membership(), app.audit_invite(), app.audit_document(), app.audit_payment_removed(),
  app.audit_stock_adjusted(), app.audit_po_received() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create or replace function public.invite_member(p_workspace uuid, p_email text, p_role text, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
  inv public.invites%rowtype;
  actor uuid := (select auth.uid());
  pending integer;
begin
  if not app.has_role(p_workspace, array['owner', 'admin']) then
    raise exception 'Only owners and admins can invite people' using errcode = 'insufficient_privilege';
  end if;
  if p_role is null or p_role not in ('admin', 'staff', 'accountant') then
    raise exception 'Choose admin, staff or accountant. Ownership cannot be given by invitation.' using errcode = 'LDG03';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(e) > 200 then
    raise exception 'That email address does not look right.' using errcode = 'LDG03';
  end if;
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation token' using errcode = 'LDG03';
  end if;
  if exists (
    select 1 from auth.users u join public.memberships m on m.user_id = u.id and m.workspace_id = p_workspace
    where lower(u.email) = e
  ) then
    raise exception 'That person is already on your team.' using errcode = 'LDG03';
  end if;

  select * into inv from public.invites where workspace_id = p_workspace and email = e for update;
  if found then
    update public.invites
    set role = p_role, token_hash = p_token_hash, expires_at = now() + interval '7 days', accepted_at = null, invited_by = actor
    where id = inv.id;
    perform app.audit(p_workspace, actor, 'member.invited', 'Invited ' || e || ' as ' || p_role, 'invite', inv.id);
    return inv.id;
  end if;

  select count(*) into pending from public.invites
  where workspace_id = p_workspace and accepted_at is null and expires_at > now();
  if pending >= 25 then
    raise exception 'You have 25 open invitations. Cancel one first.' using errcode = 'LDG03';
  end if;
  insert into public.invites (workspace_id, email, role, token_hash, invited_by)
  values (p_workspace, e, p_role, p_token_hash, actor)
  returning id into inv.id;
  return inv.id;
end;
$$;

-- What the invitation page may say before anyone signs in: the business, the role, a masked email.
create or replace function public.invite_preview(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'business', coalesce(nullif(btrim(s.business_name), ''), w.name),
    'role', i.role,
    'email_hint', left(split_part(i.email, '@', 1), 1) || '**@' || split_part(i.email, '@', 2),
    'state', case when i.accepted_at is not null then 'accepted' when i.expires_at < now() then 'expired' else 'open' end
  )
  from public.invites i
  join public.workspaces w on w.id = i.workspace_id and w.deleted_at is null
  left join public.workspace_settings s on s.workspace_id = w.id
  where i.token_hash = p_token_hash;
$$;

create or replace function public.accept_invite(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  mail text;
  i public.invites%rowtype;
  w public.workspaces%rowtype;
  existing text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  select lower(email) into mail from auth.users where id = uid;
  select * into i from public.invites where token_hash = p_token_hash for update;
  if not found then
    raise exception 'This invitation link is not valid.' using errcode = 'LDG03';
  end if;
  if lower(i.email) is distinct from mail then
    raise exception 'This invitation was sent to a different email address. Sign in with the address it was sent to.' using errcode = 'LDG03';
  end if;
  select * into w from public.workspaces where id = i.workspace_id and deleted_at is null;
  if not found then
    raise exception 'This invitation link is not valid.' using errcode = 'LDG03';
  end if;
  select role into existing from public.memberships where workspace_id = i.workspace_id and user_id = uid;
  if existing is not null then
    return jsonb_build_object('slug', w.slug, 'name', w.name, 'role', existing);
  end if;
  if i.accepted_at is not null then
    raise exception 'This invitation was already used.' using errcode = 'LDG03';
  end if;
  if i.expires_at < now() then
    raise exception 'This invitation has expired. Ask for a new one.' using errcode = 'LDG03';
  end if;
  insert into public.memberships (workspace_id, user_id, role) values (i.workspace_id, uid, i.role);
  update public.invites set accepted_at = now() where id = i.id;
  return jsonb_build_object('slug', w.slug, 'name', w.name, 'role', i.role);
end;
$$;

-- Queues the invitation email. The caller must hold the real token; the outbox row keeps it for the link.
create or replace function public.queue_invite_email(p_invite uuid, p_token text, p_request uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.invites%rowtype;
  key text;
  out_id uuid;
  sender text;
begin
  select * into i from public.invites where id = p_invite;
  if not found or not app.has_role(i.workspace_id, array['owner', 'admin']) then
    raise exception 'Invitation not found' using errcode = 'no_data_found';
  end if;
  if i.token_hash <> encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex') then
    raise exception 'That invitation link is out of date' using errcode = 'LDG03';
  end if;
  if i.accepted_at is not null or i.expires_at < now() then
    raise exception 'This invitation is no longer open' using errcode = 'LDG03';
  end if;
  key := 'invite:' || i.id || ':' || p_request;
  select id into out_id from public.outbox where idempotency_key = key;
  if out_id is not null then
    return out_id;
  end if;
  if (select count(*) from public.outbox where workspace_id = i.workspace_id and template = 'team_invite'
        and created_at > now() - interval '1 day') >= 20 then
    raise exception 'That is a lot of invitation emails for one day. Try again tomorrow.' using errcode = 'LDG03';
  end if;
  select lower(email) into sender from auth.users where id = (select auth.uid());
  insert into public.outbox (workspace_id, template, to_address, reply_to, payload, idempotency_key, created_by)
  values (i.workspace_id, 'team_invite', i.email, sender, jsonb_build_object('invite_id', i.id, 'token', p_token), key, (select auth.uid()))
  returning id into out_id;
  return out_id;
end;
$$;

-- The team with their emails (emails are not in any table the app can read).
create or replace function public.list_members(p_workspace uuid)
returns table (member_id uuid, member_role text, member_name text, member_email text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_role(p_workspace, array['owner', 'admin']) then
    raise exception 'Team not found' using errcode = 'no_data_found';
  end if;
  return query
    select m.user_id, m.role, p.full_name, u.email::text, m.created_at
    from public.memberships m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    where m.workspace_id = p_workspace
    order by case m.role when 'owner' then 0 when 'admin' then 1 when 'staff' then 2 else 3 end, m.created_at;
end;
$$;

revoke all on function public.invite_member(uuid, text, text, text), public.accept_invite(text),
  public.queue_invite_email(uuid, text, uuid), public.list_members(uuid) from public, anon;
grant execute on function public.invite_member(uuid, text, text, text), public.accept_invite(text),
  public.queue_invite_email(uuid, text, uuid), public.list_members(uuid) to authenticated;
revoke all on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;
