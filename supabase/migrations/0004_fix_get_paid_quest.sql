-- 0004_fix_get_paid_quest: "Get paid" was ticked as soon as settings were saved if the
-- onboarding answers mentioned Yoco or PayFast. Saying you use Yoco is not connecting it.
-- Now only bank details complete it here; Phase 3 adds completion on a real payment connection.
-- Down: re-run app.quest_on_settings from 0002_provisioning.sql.

create or replace function app.quest_on_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(btrim(new.business_name), '') <> '' then
    perform app.complete_quest_step(new.workspace_id, 'business_details');
  end if;
  if new.bank_details is not null and new.bank_details <> '{}'::jsonb then
    perform app.complete_quest_step(new.workspace_id, 'get_paid_setup');
  end if;
  return new;
end;
$$;

revoke all on function app.quest_on_settings() from public, anon, authenticated;
