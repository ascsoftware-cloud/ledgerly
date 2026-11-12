-- Reverses 0007_crm. Destroys all client data.
drop table if exists public.activities;
drop table if exists public.notes;
drop table if exists public.contact_tags;
drop table if exists public.tags;
drop table if exists public.contacts;
drop table if exists public.companies;
drop function if exists app.crm_activity();
drop function if exists app.stamp_author();
drop function if exists app.forbid_workspace_change();
