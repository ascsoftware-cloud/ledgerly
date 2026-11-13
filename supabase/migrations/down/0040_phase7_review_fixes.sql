-- Down for 0040_phase7_review_fixes. Re-run 0038 (billing_start_checkout, billing_apply_payment, create_additional_workspace)
-- and 0039 (cancel_workspace_deletion, request_account_deletion, cancel_account_deletion, purge_due) to restore their earlier bodies.
drop policy if exists documents_write on storage.objects;
create policy documents_write on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (select app.has_role(app.folder_workspace(name), array['owner', 'admin', 'staff'])));
drop policy if exists receipts_write on storage.objects;
create policy receipts_write on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (select app.has_role(app.folder_workspace(name), array['owner', 'admin', 'staff'])));
drop policy if exists payment_proofs_write on storage.objects;
create policy payment_proofs_write on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
              and (select app.has_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin', 'staff'])));
revoke insert on public.consents from authenticated;
grant insert on public.consents to authenticated;
alter table public.workspaces drop column if exists deletion_via_account;
delete from storage.buckets where id = 'exports';
