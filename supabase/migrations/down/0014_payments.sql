-- Reverses 0014_payments. Destroys payment records: never run against production.
drop policy if exists payment_proofs_write on storage.objects;
drop policy if exists payment_proofs_read on storage.objects;
delete from storage.buckets where id = 'payment-proofs';
drop function if exists public.apply_payment_event(uuid, text, text, uuid, bigint, text, jsonb);
drop function if exists public.payment_connection_secrets(uuid);
drop function if exists public.disconnect_payment_provider(uuid);
drop function if exists public.attach_yoco_webhook(uuid, text, text);
drop function if exists public.connect_payment_provider(uuid, text, text, text, text, text);
drop function if exists public.record_manual_payment(uuid, bigint, text, date, text, text, uuid);
drop function if exists app.apply_payment(uuid, uuid, text, bigint, date, text, text, uuid, text);
drop table if exists public.payment_events;
drop table if exists public.payments;
drop table if exists public.payment_checkouts;
drop table if exists public.payment_connections;
delete from vault.secrets where name like 'pay:%';
