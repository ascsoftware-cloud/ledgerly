-- 0056_nav_tabs: Accounting, Courier and Shopify tabs in the navigation.
-- Down script: supabase/migrations/down/0056_nav_tabs.sql
--
-- Defaults: Accounting and Courier show for everyone; Shopify shows for online stores and
-- service businesses (onboarding question 1). An owner or admin can switch any of them on or
-- off from More; that choice wins over the default.

create table public.workspace_nav_tabs (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  tab text not null check (tab in ('accounting', 'courier', 'shopify')),
  shown boolean not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, tab)
);
create index workspace_nav_tabs_updated_by_idx on public.workspace_nav_tabs (updated_by);

alter table public.workspace_nav_tabs enable row level security;
revoke all on public.workspace_nav_tabs from anon, authenticated;
grant select on public.workspace_nav_tabs to authenticated;
create policy workspace_nav_tabs_select on public.workspace_nav_tabs for select to authenticated
  using ((select app.is_member(workspace_id)));

/**
 * The extra tabs this workspace shows, for any member. Security definer because the business
 * type lives in onboarding_answers, which only owners and admins may read; only the yes/no
 * per tab comes out.
 */
create or replace function public.nav_tabs(p_workspace uuid)
returns table (tab text, shown boolean, is_default boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.tab,
         coalesce(o.shown,
                  case t.tab
                    when 'shopify' then coalesce(a.answers ->> 'business', '') in ('online_store', 'service')
                    else true
                  end),
         o.shown is null
  from (values (1, 'accounting'), (2, 'courier'), (3, 'shopify')) as t (pos, tab)
  left join public.workspace_nav_tabs o on o.workspace_id = p_workspace and o.tab = t.tab
  left join public.onboarding_answers a on a.workspace_id = p_workspace
  where app.is_member(p_workspace)
  order by t.pos;
$$;
revoke all on function public.nav_tabs(uuid) from public, anon;
grant execute on function public.nav_tabs(uuid) to authenticated;

/** Shows or hides one tab for the whole workspace (owner or admin). */
create or replace function public.set_nav_tab(p_workspace uuid, p_tab text, p_shown boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_role(p_workspace, array['owner', 'admin']) then
    raise exception 'Only owners and admins can change the tabs' using errcode = 'insufficient_privilege';
  end if;
  if p_tab not in ('accounting', 'courier', 'shopify') or p_shown is null then
    raise exception 'Unknown tab' using errcode = 'LDG03';
  end if;
  insert into public.workspace_nav_tabs (workspace_id, tab, shown, updated_by)
  values (p_workspace, p_tab, p_shown, (select auth.uid()))
  on conflict (workspace_id, tab) do update set shown = excluded.shown, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function public.set_nav_tab(uuid, text, boolean) from public, anon;
grant execute on function public.set_nav_tab(uuid, text, boolean) to authenticated;
