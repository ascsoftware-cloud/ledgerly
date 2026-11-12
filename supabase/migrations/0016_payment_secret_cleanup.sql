-- 0016_payment_secret_cleanup: when a payment connection row disappears (for example because
-- its workspace is deleted), its Yoco/PayFast keys must not linger in Vault (POPIA).
-- Down: drop trigger purge_payment_secrets on public.payment_connections; drop function app.purge_payment_secrets();

create or replace function app.purge_payment_secrets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id in (old.secret_id, old.passphrase_id, old.webhook_secret_id);
  return old;
end;
$$;
revoke all on function app.purge_payment_secrets() from public, anon, authenticated;

create trigger purge_payment_secrets after delete on public.payment_connections
  for each row execute function app.purge_payment_secrets();
