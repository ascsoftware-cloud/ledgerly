-- 0018_contact_tags_index: covers the (workspace_id, contact_id) foreign key on contact_tags,
-- so deleting or archiving a contact does not scan every tag link (performance advisor 0001).
-- Down: drop index public.contact_tags_ws_contact_idx;

create index if not exists contact_tags_ws_contact_idx on public.contact_tags (workspace_id, contact_id);
