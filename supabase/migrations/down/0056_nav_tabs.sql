-- Reverses 0056_nav_tabs.
drop function if exists public.set_nav_tab(uuid, text, boolean);
drop function if exists public.nav_tabs(uuid);
drop table if exists public.workspace_nav_tabs;
