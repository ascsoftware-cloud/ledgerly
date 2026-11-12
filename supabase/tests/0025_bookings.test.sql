-- Tests for 0025_bookings. Ends by raising "BOOKING TESTS: n passed, m failed" (rolls back).
do $$
declare
  r text[] := '{}';
  n int; t text; res jsonb; slots timestamptz[]; s uuid; s_b uuid; b1 uuid; tok text;
  alice uuid := gen_random_uuid(); sam uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  ws uuid; ws_b uuid;
  day date := ((now() at time zone 'Africa/Johannesburg')::date + 7);
  dow smallint := extract(isodow from ((now() at time zone 'Africa/Johannesburg')::date + 7));
  nine timestamptz := (((now() at time zone 'Africa/Johannesburg')::date + 7) + time '09:00') at time zone 'Africa/Johannesburg';
  passed int; failed int;
begin
  insert into auth.users (id, email) values (alice, 'alice@book.test'), (sam, 'sam@book.test'), (bob, 'bob@book.test');
  insert into public.workspaces (slug, name, created_by) values ('book-test-a', 'Thandi Salon', alice) returning id into ws;
  insert into public.workspaces (slug, name, created_by) values ('book-test-b', 'B', bob) returning id into ws_b;
  insert into public.memberships (workspace_id, user_id, role) values (ws, alice, 'owner'), (ws, sam, 'staff'), (ws_b, bob, 'owner');
  insert into public.workspace_settings (workspace_id) values (ws), (ws_b);
  insert into public.quest_steps (workspace_id, key, position) values (ws, 'booking_page', 1);

  -- owner sets up: a 45-minute service with a 15-minute buffer, open 09:00–11:00 that weekday
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.services (workspace_id, name, duration_min, buffer_min, price_cents) values (ws, 'Cut', 45, 15, 25000) returning id into s;
  insert into public.availability_rules (workspace_id, weekday, start_time, end_time) values (ws, dow, '09:00', '11:00');
  update public.workspace_settings set booking_enabled = true where workspace_id = ws;
  reset role;
  select count(*) into n from public.quest_steps where workspace_id = ws and key = 'booking_page' and completed_at is not null;
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' switching bookings on ticks the quest');

  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.services (workspace_id, name, duration_min) values (ws, 'Staff service', 30);
    r := r || 'FAIL staff cannot change the booking setup'::text;
  exception when insufficient_privilege then r := r || 'PASS staff cannot change the booking setup'::text;
  end;
  reset role;

  -- the public page and slots (anonymous)
  set local role anon;
  res := public.get_booking_page('book-test-a');
  r := r || (case when res ->> 'name' = 'Thandi Salon' and jsonb_array_length(res -> 'services') = 1 then 'PASS' else 'FAIL' end || ' the booking page lists the services');
  r := r || (case when public.get_booking_page('book-test-b') is null then 'PASS' else 'FAIL' end || ' a business with bookings off shows nothing');
  slots := public.get_available_slots('book-test-a', s, day);
  -- 09:00–11:00 in 15-minute steps where 45 minutes still fits: 09:00 … 10:15 = 6 slots
  r := r || (case when array_length(slots, 1) = 6 and slots[1] = nine then 'PASS' else 'FAIL' end || ' slots fit the opening hours (' || coalesce(array_length(slots, 1), 0) || ')');
  slots := public.get_available_slots('book-test-a', s, day + 1);
  r := r || (case when coalesce(array_length(slots, 1), 0) = 0 then 'PASS' else 'FAIL' end || ' a closed day has no slots');
  begin
    perform public.create_booking('book-test-a', s, nine, 'Lerato', 'lerato@client.test', null, null);
    r := r || 'FAIL the public cannot book directly through the API'::text;
  exception when insufficient_privilege then r := r || 'PASS the public cannot book directly through the API'::text;
  end;
  begin
    perform * from public.bookings;
    r := r || 'FAIL the public cannot read bookings'::text;
  exception when insufficient_privilege then r := r || 'PASS the public cannot read bookings'::text;
  end;
  reset role;

  -- booking (as the server does it)
  set local role service_role;
  res := public.create_booking('book-test-a', s, nine, 'Lerato Dube', 'Lerato@Client.test', '+27821234567', 'First visit');
  tok := res ->> 'token';
  r := r || (case when char_length(tok) = 32 then 'PASS' else 'FAIL' end || ' a booking gets a private link token');
  begin
    perform public.create_booking('book-test-a', s, nine + interval '15 minutes', 'Someone Else', 'else@client.test', null, null);
    r := r || 'FAIL an overlapping time cannot be booked'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS an overlapping time cannot be booked'::text;
  end;
  slots := public.get_available_slots('book-test-a', s, day);
  -- 09:00 booking blocks 09:00–10:00 (45 + 15 buffer); 10:00 and 10:15 remain
  r := r || (case when array_length(slots, 1) = 2 and slots[1] = nine + interval '60 minutes' then 'PASS' else 'FAIL' end || ' the booked time and its buffer disappear from the slots (' || coalesce(array_length(slots, 1), 0) || ')');
  begin
    perform public.create_booking('book-test-a', s, nine + interval '5 minutes', 'Odd', 'odd@client.test', null, null);
    r := r || 'FAIL only offered slot times can be booked'::text;
  exception when sqlstate 'LDG03' then r := r || 'PASS only offered slot times can be booked'::text;
  end;
  reset role;

  select id into b1 from public.bookings where token = tok;
  select count(*) into n from public.contacts where workspace_id = ws and lower(email) = 'lerato@client.test';
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the customer becomes a client');
  select string_agg(template, ',' order by template) into t from public.outbox where workspace_id = ws and payload ->> 'booking_id' = b1::text;
  r := r || (case when t = 'booking_confirmed,booking_reminder' then 'PASS' else 'FAIL' end || ' a confirmation and a reminder are queued (' || coalesce(t, 'none') || ')');
  select count(*) into n from public.outbox where payload ->> 'booking_id' = b1::text and template = 'booking_reminder'
    and next_attempt_at = (select starts_at - interval '24 hours' from public.bookings where id = b1);
  r := r || (case when n = 1 then 'PASS' else 'FAIL' end || ' the reminder waits until 24 hours before');

  -- exclusion constraint is the last line of defence
  begin
    insert into public.bookings (workspace_id, service_id, starts_at, ends_at, blocked_until, customer_name, customer_email, token)
    values (ws, s, nine + interval '30 minutes', nine + interval '75 minutes', nine + interval '90 minutes', 'Race', 'race@client.test', 'racetokenracetokenracetokenrace1');
    r := r || 'FAIL two overlapping confirmed bookings cannot exist'::text;
  exception when exclusion_violation then r := r || 'PASS two overlapping confirmed bookings cannot exist'::text;
  end;

  -- the .ics lookup is by token only
  set local role anon;
  res := public.get_booking_ics(tok);
  r := r || (case when res ->> 'service' = 'Cut' and res ? 'starts_at' and not (res ? 'customer_email') then 'PASS' else 'FAIL' end || ' the calendar file shows the booking, not the customer''s details');
  r := r || (case when public.get_booking_ics('x' || substr(tok, 2)) is null then 'PASS' else 'FAIL' end || ' a wrong token shows nothing');
  reset role;

  -- staff can see and cancel; another workspace sees nothing
  perform set_config('request.jwt.claims', json_build_object('sub', sam, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.bookings set status = 'cancelled' where id = b1;
  select status into t from public.bookings where id = b1;
  r := r || (case when t = 'cancelled' then 'PASS' else 'FAIL' end || ' staff can cancel a booking');
  reset role;
  set local role anon;
  slots := public.get_available_slots('book-test-a', s, day);
  reset role;
  r := r || (case when array_length(slots, 1) = 6 then 'PASS' else 'FAIL' end || ' a cancelled booking frees its time');

  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.bookings where workspace_id = ws;
  r := r || (case when n = 0 then 'PASS' else 'FAIL' end || ' another workspace cannot see A''s bookings');
  insert into public.services (workspace_id, name, duration_min) values (ws_b, 'B service', 30) returning id into s_b;
  reset role;
  set local role anon;
  slots := public.get_available_slots('book-test-a', s_b, day);
  reset role;
  r := r || (case when coalesce(array_length(slots, 1), 0) = 0 then 'PASS' else 'FAIL' end || ' another workspace''s service gets no slots here');

  select count(*) filter (where x like 'PASS%'), count(*) filter (where x like 'FAIL%') into passed, failed from unnest(r) as x;
  raise exception E'BOOKING TESTS: % passed, % failed\n%', passed, failed,
    array_to_string(array(select x from unnest(r) as x where x like 'FAIL%'), E'\n');
end;
$$;
