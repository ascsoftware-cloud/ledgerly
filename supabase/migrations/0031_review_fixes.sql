-- 0031_review_fixes: Phase 5 review.
-- Down script: supabase/migrations/down/0031_review_fixes.sql
--
-- 1. A retried "Send invitation" (same request id) must not rotate the token a second time, or the
--    invitee is left with a dead link next to the good one. `invite_member` now takes the request id and
--    leaves the invitation alone when that request already queued its email; `queue_invite_email`
--    answers a repeated request before it looks at the token.

drop function if exists public.invite_member(uuid, text, text, text);

create or replace function public.invite_member(p_workspace uuid, p_email text, p_role text, p_token_hash text, p_request uuid default null)
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
    -- The same button press again: its email is already queued with the token the invitation holds.
    if p_request is not null and exists (select 1 from public.outbox where idempotency_key = 'invite:' || inv.id || ':' || p_request) then
      return inv.id;
    end if;
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
  key := 'invite:' || i.id || ':' || p_request;
  select id into out_id from public.outbox where idempotency_key = key;
  if out_id is not null then
    return out_id;
  end if;
  if i.token_hash <> encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex') then
    raise exception 'That invitation link is out of date' using errcode = 'LDG03';
  end if;
  if i.accepted_at is not null or i.expires_at < now() then
    raise exception 'This invitation is no longer open' using errcode = 'LDG03';
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

revoke all on function public.invite_member(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.invite_member(uuid, text, text, text, uuid) to authenticated;
