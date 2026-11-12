-- Reverses 0002_provisioning. Destroys quest, XP, streak and goal data.
drop trigger if exists quest_on_invite on public.invites;
drop trigger if exists quest_on_settings on public.workspace_settings;

drop function if exists public.provision_workspace(jsonb);
drop function if exists app.apply_answers(uuid, uuid, jsonb);
drop function if exists app.default_quest(uuid);
drop function if exists app.valid_answers(jsonb);
drop function if exists app.json_pick(jsonb, text[]);
drop function if exists app.quest_on_invite();
drop function if exists app.quest_on_settings();
drop function if exists app.complete_quest_step(uuid, text);
drop function if exists app.award_xp(uuid, uuid, text, text);
drop function if exists app.bump_streak(uuid, uuid);
drop function if exists app.sast_today();

drop table if exists public.goals;
drop table if exists public.streaks;
drop table if exists public.xp_events;
drop table if exists public.quest_steps;
drop table if exists public.onboarding_answers;

-- Restore the 0001 membership guard (without the founding-member rule).
-- Re-run the guard_membership definition from 0001_tenancy.sql after this script.
