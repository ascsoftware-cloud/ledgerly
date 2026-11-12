-- Tests for 0002_provisioning. Same harness as 0001: one DO block that ends by
-- raising "PROVISIONING TESTS: n passed, m failed", which rolls everything back.

do $$
declare
  r text[] := '{}';
  n int;
  t text;
  res jsonb;
  res2 jsonb;
  alice uuid := gen_random_uuid();
  bob uuid := gen_random_uuid();
  thandi uuid := gen_random_uuid();
  nobody uuid := gen_random_uuid();
  ws_a uuid;
  ws_b uuid;
  answers_a jsonb := '{"v":1,"business":"freelancer","team":"solo",
    "headaches":["getting_paid","admin"],"manage":["invoices","clients","expenses"],
    "paid":["eft","yoco"],"revenue":"20k_100k","accent":"violet","mode":"dark","dailyMinutes":10}';
  answers_shop jsonb := '{"v":1,"business":"online_store","team":"2_5",
    "headaches":["stock"],"manage":["invoices"],
    "paid":["none"],"revenue":"none","accent":"coral","mode":"light","dailyMinutes":5}';
  passed int;
  failed int;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (alice, 'alice@prov.test', '{"full_name":"Alice van der Merwe"}'),
    (bob, 'bob@prov.test', '{"full_name":"Bob Other"}'),
    (thandi, 'thandi.m@prov.test', '{}'),
    (nobody, '42@prov.test', '{"full_name":"  "}');

  -- ------------------------------------------------------------ signed out
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    perform public.provision_workspace(answers_a);
    r := r || 'FAIL signed-out visitors cannot provision'::text;
  exception when insufficient_privilege then r := r || 'PASS signed-out visitors cannot provision'::text;
  end;
  reset role;

  -- ------------------------------------------------------------ Alice
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.provision_workspace(jsonb_set(answers_a, '{business}', '"spaceship"'));
    r := r || 'FAIL unknown business type is refused'::text;
  exception when check_violation then r := r || 'PASS unknown business type is refused'::text;
  end;
  begin
    perform public.provision_workspace(jsonb_set(answers_a, '{paid}', '["none","eft"]'));
    r := r || 'FAIL "Not yet" plus a payment method is refused'::text;
  exception when check_violation then r := r || 'PASS "Not yet" plus a payment method is refused'::text;
  end;
  begin
    perform public.provision_workspace(jsonb_set(answers_a, '{manage}', '[]'));
    r := r || 'FAIL empty module list is refused'::text;
  exception when check_violation then r := r || 'PASS empty module list is refused'::text;
  end;
  begin
    perform public.provision_workspace(jsonb_set(answers_a, '{dailyMinutes}', '"10"'));
    r := r || 'FAIL a daily goal sent as text is refused'::text;
  exception when check_violation then r := r || 'PASS a daily goal sent as text is refused'::text;
  end;
  begin
    perform public.provision_workspace('[1,2,3]'::jsonb);
    r := r || 'FAIL non-object answers are refused'::text;
  exception when check_violation then r := r || 'PASS non-object answers are refused'::text;
  end;

  res := public.provision_workspace(answers_a);
  ws_a := (res ->> 'id')::uuid;
  r := r || (case when (res ->> 'created')::boolean then 'PASS' else 'FAIL' end || ' first call creates a workspace');
  r := r || (case when res ->> 'slug' ~ '^alice-[0-9a-f]{4}$' then 'PASS' else 'FAIL' end
             || ' slug is made from the first name (' || (res ->> 'slug') || ')');

  select name into t from public.workspaces where id = ws_a;
  r := r || (case when t = 'Alice''s business' then 'PASS' else 'FAIL' end || ' workspace is named after the person (' || t || ')');
  select count(*) into n from public.workspaces where id = ws_a and accent = 'violet' and mode = 'dark' and not needs_setup;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' theme comes from the answers');
  select count(*) into n from public.memberships where workspace_id = ws_a and user_id = alice and role = 'owner';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' creator is the owner');

  select string_agg(module, ',' order by module) into t from public.workspace_modules where workspace_id = ws_a and enabled;
  r := r || (case when t = 'clients,expenses,invoices,projects' then 'PASS' else 'FAIL' end
             || ' modules = chosen + essentials + freelancer default (' || t || ')');

  select count(*) into n from public.workspace_settings
  where workspace_id = ws_a and payment_methods = array['eft', 'yoco'] and daily_minutes = 10 and not vat_registered;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' settings: payment methods, daily goal, VAT off');

  select count(*) into n from public.goals where workspace_id = ws_a and kind = 'monthly_revenue' and target_cents = 6000000;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' goal is the middle of R20k-R100k (R60 000)');

  select string_agg(key, ',' order by position) into t from public.quest_steps where workspace_id = ws_a;
  r := r || (case when t = 'business_details,first_client,first_invoice,get_paid_setup,first_expense,first_task'
                  then 'PASS' else 'FAIL' end || ' quest matches headaches and modules (' || t || ')');

  select count(*) into n from public.streaks where workspace_id = ws_a and user_id = alice and current_days = 0;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' streak starts at zero');
  select count(*) into n from public.onboarding_answers where workspace_id = ws_a and answers = answers_a;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' answers are kept with the workspace');

  res2 := public.provision_workspace(answers_shop);
  r := r || (case when res2 ->> 'id' = ws_a::text and not (res2 ->> 'created')::boolean then 'PASS' else 'FAIL' end
             || ' second call returns the same workspace');
  select count(*) into n from public.workspaces where created_by = alice;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' second call creates nothing');
  select count(*) into n from public.workspaces where id = ws_a and accent = 'violet';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' second call does not overwrite a set-up workspace');

  -- Quest completion, XP and streak.
  update public.workspace_settings set business_name = 'Alice Designs' where workspace_id = ws_a;
  select count(*) into n from public.quest_steps where workspace_id = ws_a and key = 'business_details' and completed_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' adding business details completes that quest step');
  update public.workspace_settings set business_name = 'Alice Design Studio' where workspace_id = ws_a;
  select count(*) into n from public.xp_events where workspace_id = ws_a and kind = 'quest_step' and points = 30 and user_id = alice;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a quest step pays 30 XP exactly once (' || n || ')');
  select count(*) into n from public.quest_steps where workspace_id = ws_a and key = 'get_paid_setup' and completed_at is null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' saying "Yoco" in onboarding does not tick "Get paid"');
  update public.workspace_settings set bank_details = '{"bank":"FNB"}' where workspace_id = ws_a;
  select count(*) into n from public.quest_steps where workspace_id = ws_a and key = 'get_paid_setup' and completed_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' adding bank details ticks "Get paid"');
  select count(*) into n from public.streaks where workspace_id = ws_a and user_id = alice and current_days = 1;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' first XP of the day starts the streak');

  begin
    insert into public.xp_events (workspace_id, user_id, kind, ref, points) values (ws_a, alice, 'quest_step', 'cheat', 30);
    r := r || 'FAIL users cannot give themselves XP'::text;
  exception when insufficient_privilege then r := r || 'PASS users cannot give themselves XP'::text;
  end;
  begin
    update public.quest_steps set completed_at = now() where workspace_id = ws_a;
    r := r || 'FAIL users cannot tick quest steps directly'::text;
  exception when insufficient_privilege then r := r || 'PASS users cannot tick quest steps directly'::text;
  end;
  begin
    update public.streaks set current_days = 999 where workspace_id = ws_a;
    r := r || 'FAIL users cannot edit their streak'::text;
  exception when insufficient_privilege then r := r || 'PASS users cannot edit their streak'::text;
  end;
  begin
    perform app.award_xp(ws_a, alice, 'quest_step', 'cheat');
    r := r || 'FAIL users cannot call the XP function'::text;
  exception when insufficient_privilege then r := r || 'PASS users cannot call the XP function'::text;
  end;
  update public.goals set target_cents = 8000000 where workspace_id = ws_a; get diagnostics n = row_count;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' owner can change their goal');

  -- ------------------------------------------------------------ Bob: second device, no answers
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;

  res := public.provision_workspace(null);
  ws_b := (res ->> 'id')::uuid;
  select count(*) into n from public.workspaces where id = ws_b and needs_setup and accent = 'emerald';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' no answers: default workspace flagged "finish set-up"');
  select string_agg(module, ',' order by module) into t from public.workspace_modules where workspace_id = ws_b;
  r := r || (case when t = 'clients,invoices' then 'PASS' else 'FAIL' end || ' no answers: only the essentials (' || t || ')');
  select string_agg(key, ',' order by position) into t from public.quest_steps where workspace_id = ws_b;
  r := r || (case when t = 'business_details,first_client,first_invoice,get_paid_setup' then 'PASS' else 'FAIL' end
             || ' no answers: default quest (' || t || ')');
  select count(*) into n from public.goals where workspace_id = ws_b and target_cents = 1000000;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' no answers: R10 000 starter goal');

  res2 := public.provision_workspace(answers_shop);
  r := r || (case when res2 ->> 'id' = ws_b::text then 'PASS' else 'FAIL' end || ' answering later reuses the workspace');
  select count(*) into n from public.workspaces where id = ws_b and not needs_setup and accent = 'coral';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' answering later applies the answers');
  select string_agg(module, ',' order by module) into t from public.workspace_modules where workspace_id = ws_b;
  r := r || (case when t = 'clients,inventory,invoices' then 'PASS' else 'FAIL' end || ' online store gets inventory (' || t || ')');
  select string_agg(key, ',' order by position) into t from public.quest_steps where workspace_id = ws_b;
  r := r || (case when t = 'business_details,first_client,first_invoice,first_product,invite_team' then 'PASS' else 'FAIL' end
             || ' shop quest: stock and team steps (' || t || ')');
  select count(*) into n from public.workspace_settings where workspace_id = ws_b and payment_methods = '{}';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' "Not yet" means no payment methods');
  select count(*) into n from public.goals where workspace_id = ws_b and target_cents = 500000;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' "Nothing yet" revenue gives a R5 000 first goal');

  perform public.provision_workspace(answers_a);
  select count(*) into n from public.workspaces where id = ws_b and accent = 'coral';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' answers apply only once');

  -- Cross-tenant: Bob sees nothing of Alice's.
  select count(*) into n from public.quest_steps where workspace_id = ws_a;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' B cannot read A''s quest');
  select count(*) into n from public.xp_events where workspace_id = ws_a;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' B cannot read A''s XP');
  select count(*) into n from public.streaks where workspace_id = ws_a;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' B cannot read A''s streak');
  select count(*) into n from public.goals where workspace_id = ws_a;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' B cannot read A''s goal');
  select count(*) into n from public.onboarding_answers where workspace_id = ws_a;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' B cannot read A''s onboarding answers');
  update public.goals set target_cents = 1 where workspace_id = ws_a; get diagnostics n = row_count;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' B cannot change A''s goal');

  -- ------------------------------------------------------------ names
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', thandi, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.provision_workspace(null);
  select name into t from public.workspaces where id = (res ->> 'id')::uuid;
  r := r || (case when t = 'Thandi''s business' and res ->> 'slug' like 'thandi-%' then 'PASS' else 'FAIL' end
             || ' no name: uses the email (' || t || ', ' || (res ->> 'slug') || ')');

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', nobody, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.provision_workspace(null);
  select name into t from public.workspaces where id = (res ->> 'id')::uuid;
  r := r || (case when t = 'My business' and res ->> 'slug' like 'biz-%' then 'PASS' else 'FAIL' end
             || ' no usable name: neutral fallback (' || t || ', ' || (res ->> 'slug') || ')');

  -- ------------------------------------------------------------ streak rules (as the database owner)
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.streaks set current_days = 4, last_active_on = app.sast_today() - 1, freeze_week = null
    where workspace_id = ws_a and user_id = alice;
  perform app.award_xp(ws_a, alice, 'expense_logged', 'e1');
  select current_days into n from public.streaks where workspace_id = ws_a and user_id = alice;
  r := r || (case when n = 5 then 'PASS' else 'FAIL' end || ' active yesterday: streak grows (' || n || ')');
  perform app.award_xp(ws_a, alice, 'expense_logged', 'e2');
  select current_days into n from public.streaks where workspace_id = ws_a and user_id = alice;
  r := r || (case when n = 5 then 'PASS' else 'FAIL' end || ' second action the same day: no change');

  update public.streaks set current_days = 7, last_active_on = app.sast_today() - 2, freeze_week = null
    where workspace_id = ws_a and user_id = alice;
  perform app.award_xp(ws_a, alice, 'expense_logged', 'e3');
  select current_days into n from public.streaks where workspace_id = ws_a and user_id = alice;
  r := r || (case when n = 8 then 'PASS' else 'FAIL' end || ' one missed day is forgiven once a week (' || n || ')');

  update public.streaks set last_active_on = app.sast_today() - 2 where workspace_id = ws_a and user_id = alice;
  perform app.award_xp(ws_a, alice, 'expense_logged', 'e4');
  select current_days into n from public.streaks where workspace_id = ws_a and user_id = alice;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' a second missed day that week resets (' || n || ')');

  update public.streaks set current_days = 9, last_active_on = app.sast_today() - 5 where workspace_id = ws_a and user_id = alice;
  perform app.award_xp(ws_a, alice, 'expense_logged', 'e5');
  select current_days, longest_days into n, passed from public.streaks where workspace_id = ws_a and user_id = alice;
  r := r || (case when n = 1 and passed = 8 then 'PASS' else 'FAIL' end || ' a long gap resets, the record (8) is kept');

  -- ------------------------------------------------------------ report
  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%')
    into passed, failed from unnest(r) as x;
  raise exception E'PROVISIONING TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
