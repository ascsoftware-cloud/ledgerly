-- Reverses 0001_tenancy. Destroys all workspace data: never run against production.
drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.workspace_settings;
drop table if exists public.workspace_modules;
drop table if exists public.invites;
drop table if exists public.memberships;
drop table if exists public.workspaces;
drop table if exists public.profiles;

drop function if exists app.handle_new_user();
drop function if exists app.guard_membership();
drop function if exists app.shares_workspace(uuid);
drop function if exists app.has_role(uuid, text[]);
drop function if exists app.is_member(uuid);
drop function if exists app.touch_updated_at();

drop schema if exists app;
