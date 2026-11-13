-- Down for 0030_documents.
drop policy if exists documents_delete on storage.objects;
drop policy if exists documents_write on storage.objects;
drop policy if exists documents_read on storage.objects;
delete from storage.objects where bucket_id = 'documents';
delete from storage.buckets where id = 'documents';
drop function if exists public.queue_portal_email(uuid, text, uuid);
drop function if exists public.sign_contract(text, uuid, text, text, text, text);
drop function if exists public.get_portal_contract(text, uuid);
drop function if exists public.get_portal(text);
drop function if exists app.portal_link_by_token(text);
drop function if exists public.void_contract(uuid);
drop function if exists public.send_contract(uuid);
drop function if exists public.rotate_portal_link(uuid);
drop function if exists public.revoke_portal_link(uuid);
drop function if exists public.create_portal_link(uuid);
drop function if exists app.ensure_portal_link(uuid, uuid);
drop table if exists public.portal_links, public.contract_signatures, public.contracts, public.contract_templates, public.files, public.folders;
drop function if exists app.guard_contract_text();
delete from public.outbox where template = 'portal_link';
alter table public.outbox drop constraint outbox_template_check;
alter table public.outbox add constraint outbox_template_check
  check (template in ('document', 'reminder', 'booking_confirmed', 'booking_reminder', 'team_invite'));
alter table public.workspaces drop constraint workspaces_slug_reserved;
alter table public.workspaces add constraint workspaces_slug_check1
  check (slug not in ('start', 'login', 'auth', 'api', 'book', 'portal', 'demo', 'styleguide',
                      'privacy', 'terms', 'popia', 'pricing', 'welcome', 'settings', 'admin'));
