-- Tests for 0022_work. Ends by raising "WORK TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int; t text; p uuid; p_b uuid; c uuid; c_b uuid; t1 uuid; t2 uuid; sub uuid; subsub uuid;
  alice uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); acc uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  ws uuid; ws_b uuid;
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'alice@work.test'), (sam, 'sam@work.test'), (acc, 'acc@work.test'), (bob, 'bob@work.test');
  insert into public.workspaces (slug, name, created_by) values ('work-test-a', 'A', alice) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('work-test-b', 'B', bob) returning id into ws_b;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner'), (ws, sam, 'staff'), (ws, acc, 'accountant'), (ws_b, bob, 'owner');
  insert into public.quest_steps (workspace_id, key, position) values (ws, 'first_task', 1);
  insert into public.contacts (workspace_id, name) values (ws, 'Thandi') returning id into c;
  insert into public.contacts (workspace_id, name) values (ws_b, 'Bea') returning id into c_b;

  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.projects (workspace_id, name, contact_id, hourly_rate_cents) values (ws, 'Kitchen', c, 45000) returning id into p;
  r := r || 'PASS staff can create a project for a client'::text;
  begin
    insert into public.projects (workspace_id, name, contact_id) values (ws, 'Wrong', c_b);
    r := r || 'FAIL a project cannot belong to another workspace''s client'::text;
  exception when foreign_key_violation then r := r || 'PASS a project cannot belong to another workspace''s client'::text;
  end;
  insert into public.tasks (workspace_id, project_id, title, due_date, assignee_id) values (ws, p, 'Measure walls', '2026-11-20', sam) returning id into t1;
  insert into public.tasks (workspace_id, project_id, title) values (ws, p, 'Order tiles') returning id into t2;
  insert into public.tasks (workspace_id, parent_id, title) values (ws, t1, 'Bring tape') returning id into sub;
  select coalesce(project_id::text, 'none') into t from public.tasks where id = sub;
  r := r || (case when t = p::text then 'PASS' else 'FAIL' end || ' a subtask joins its parent''s project');
  begin
    insert into public.tasks (workspace_id, parent_id, title) values (ws, sub, 'Too deep') returning id into subsub;
    r := r || 'FAIL subtasks go one level deep'::text;
  exception when check_violation then r := r || 'PASS subtasks go one level deep'::text;
  end;
  begin
    insert into public.tasks (workspace_id, title, assignee_id) values (ws, 'Bob''s job', bob);
    r := r || 'FAIL a task can only be assigned to a member'::text;
  exception when check_violation then r := r || 'PASS a task can only be assigned to a member'::text;
  end;
  update public.tasks set status = 'done' where id = t1;
  update public.tasks set status = 'todo' where id = t1;
  update public.tasks set status = 'done' where id = t1;
  reset role;
  select count(*) into n from public.xp_events where workspace_id = ws and kind = 'task_completed';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' completing a task earns XP once, however often it is reopened (' || n || ')');
  select count(*) into n from public.tasks where id = t1 and completed_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' completion time is recorded');
  select count(*) into n from public.quest_steps where workspace_id = ws and key = 'first_task' and completed_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' adding a task ticks "Add a task"');

  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.projects set deleted_at = now() where id = p;
    r := r || 'FAIL staff cannot archive a project'::text;
  exception when insufficient_privilege then r := r || 'PASS staff cannot archive a project'::text;
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.projects where id = p;
  reset role;
  select count(*) into n from public.projects where id = p;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' staff cannot delete a project');

  -- accountant: read-only
  perform set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.tasks where workspace_id = ws;
  r := r || (case when n = 3 then 'PASS' else 'FAIL' end || ' accountants can see tasks (' || n || ')');
  update public.tasks set title = 'Changed' where id = t2;
  begin
    insert into public.tasks (workspace_id, title) values (ws, 'Mine');
    r := r || 'FAIL accountants cannot add tasks'::text;
  exception when insufficient_privilege then r := r || 'PASS accountants cannot add tasks'::text;
  end;
  reset role;
  select title into t from public.tasks where id = t2;
  r := r || (case when t = 'Order tiles' then 'PASS' else 'FAIL' end || ' accountants cannot change tasks');

  -- another workspace
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.tasks where workspace_id = ws;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' another workspace cannot see A''s tasks');
  select count(*) into n from public.projects where workspace_id = ws;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' or A''s projects');
  insert into public.projects (workspace_id, name) values (ws_b, 'B job') returning id into p_b;
  begin
    insert into public.tasks (workspace_id, project_id, title) values (ws_b, p, 'Steal');
    r := r || 'FAIL a task cannot join another workspace''s project'::text;
  exception when foreign_key_violation then r := r || 'PASS a task cannot join another workspace''s project'::text;
  end;
  begin
    insert into public.tasks (workspace_id, parent_id, title) values (ws_b, t1, 'Steal');
    r := r || 'FAIL a subtask cannot hang off another workspace''s task'::text;
  exception when foreign_key_violation or check_violation then r := r || 'PASS a subtask cannot hang off another workspace''s task'::text;
  end;
  reset role;

  -- owner archives and deletes
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.projects set deleted_at = now() where id = p;
  select count(*) into n from public.projects where id = p and deleted_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the owner can archive a project');
  delete from public.tasks where id = t1;
  select count(*) into n from public.tasks where id = sub;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' deleting a task deletes its subtasks');
  reset role;

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'WORK TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
