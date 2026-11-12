-- 0015_workspace_delete_cascades: deleting a whole workspace failed once it had invoices,
-- deals or payments, because three foreign keys were ON DELETE RESTRICT, which is checked
-- row by row in the middle of the cascade. NO ACTION is checked at the end of the
-- statement instead: deleting one client who has invoices is still refused, but deleting
-- the workspace (which removes everything) now works. Needed for account deletion (POPIA).
-- Down: re-create the three constraints with ON DELETE RESTRICT and drop payments_workspace_id_fkey.

alter table public.sales_documents drop constraint sales_documents_workspace_id_contact_id_fkey;
alter table public.sales_documents add constraint sales_documents_workspace_id_contact_id_fkey
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete no action;

alter table public.deals drop constraint deals_workspace_id_stage_id_fkey;
alter table public.deals add constraint deals_workspace_id_stage_id_fkey
  foreign key (workspace_id, stage_id) references public.pipeline_stages (workspace_id, id) on delete no action;

alter table public.payments drop constraint payments_workspace_id_document_id_fkey;
alter table public.payments add constraint payments_workspace_id_document_id_fkey
  foreign key (workspace_id, document_id) references public.sales_documents (workspace_id, id) on delete no action;
alter table public.payments add constraint payments_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces (id) on delete cascade;
