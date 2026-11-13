-- 0035_search: one search over clients, invoices and quotes, tasks, projects and products.
-- Down script: supabase/migrations/down/0035_search.sql
--
-- SECURITY INVOKER: every table is read as the signed-in person, so row-level security decides what they find.
-- Matching is "every word appears somewhere" (case-insensitive, substring), so invoice numbers like INV-0042
-- and partial names both work. Workspaces are small; this scans one workspace's rows, not the whole table.

create or replace function public.search(p_workspace uuid, p_q text)
returns table (kind text, id uuid, title text, subtitle text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  words text[];
  pats text[];
begin
  if not app.is_member(p_workspace) then
    raise exception 'Business not found' using errcode = 'no_data_found';
  end if;
  p_q := left(btrim(coalesce(p_q, '')), 60);
  if char_length(p_q) < 2 then
    return;
  end if;
  -- At most 5 words; LIKE wildcards in what was typed are matched literally.
  words := (select coalesce(array_agg(w), '{}') from (select w from unnest(regexp_split_to_array(lower(p_q), '\s+')) as w where w <> '' limit 5) s);
  pats := (select coalesce(array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'), '{}') from unnest(words) as w);
  if cardinality(pats) = 0 then
    return;
  end if;

  return query
  (select 'client'::text, c.id, c.name, coalesce(c.email, c.phone)
     from public.contacts c
    where c.workspace_id = p_workspace and c.deleted_at is null
      and lower(c.name || ' ' || coalesce(c.email, '') || ' ' || coalesce(c.phone, '')) like all (pats)
    order by c.name limit 8)
  union all
  (select d.kind, d.id, coalesce(d.number, 'Draft ' || d.kind), c.name
     from public.sales_documents d
     join public.contacts c on c.workspace_id = d.workspace_id and c.id = d.contact_id
    where d.workspace_id = p_workspace and d.kind in ('invoice', 'quote')
      and lower(coalesce(d.number, 'draft ' || d.kind) || ' ' || c.name) like all (pats)
    order by d.created_at desc limit 8)
  union all
  (select 'task'::text, t.id, t.title, t.status
     from public.tasks t
    where t.workspace_id = p_workspace and lower(t.title) like all (pats)
    order by t.created_at desc limit 8)
  union all
  (select 'project'::text, p.id, p.name, p.status
     from public.projects p
    where p.workspace_id = p_workspace and p.deleted_at is null and lower(p.name) like all (pats)
    order by p.name limit 8)
  union all
  (select 'product'::text, pr.id, pr.name, pr.sku
     from public.products pr
    where pr.workspace_id = p_workspace and pr.deleted_at is null
      and lower(pr.name || ' ' || coalesce(pr.sku, '')) like all (pats)
    order by pr.name limit 8);
end;
$$;

revoke all on function public.search(uuid, text) from public, anon;
grant execute on function public.search(uuid, text) to authenticated;
