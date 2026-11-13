-- Down for 0031_review_fixes: back to the 0028 definitions (no request id on invite_member).
drop function if exists public.invite_member(uuid, text, text, text, uuid);
-- Re-run public.invite_member and public.queue_invite_email from 0028_team.sql.
