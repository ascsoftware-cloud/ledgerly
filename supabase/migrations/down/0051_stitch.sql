-- Reverses 0051_stitch. Fails while Stitch payments exist (they would break the method check): remove them first.
-- remove_payment: re-run its definition from 0019_review_fixes.sql to drop the Stitch rule.
drop function if exists public.stitch_connection_secrets(uuid);
drop function if exists public.connect_stitch(uuid, text, text, text, text);
delete from vault.secrets where id in (select secret_id from public.payment_connections where provider = 'stitch')
                             or id in (select webhook_secret_id from public.payment_connections where provider = 'stitch');
delete from public.payment_connections where provider = 'stitch';
alter table public.payment_connections drop constraint payment_connections_stitch_client, drop column client_id;
alter table public.payments drop constraint payments_method_check,
  add constraint payments_method_check check (method in ('yoco', 'payfast', 'eft', 'cash', 'card', 'other'));
alter table public.payment_events drop constraint payment_events_provider_check,
  add constraint payment_events_provider_check check (provider in ('yoco', 'payfast'));
alter table public.payment_checkouts drop constraint payment_checkouts_provider_check,
  add constraint payment_checkouts_provider_check check (provider in ('yoco', 'payfast'));
alter table public.payment_connections drop constraint payment_connections_provider_check,
  add constraint payment_connections_provider_check check (provider in ('yoco', 'payfast'));
