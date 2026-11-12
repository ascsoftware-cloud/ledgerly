-- 0006_rate_limits_deny_policy: make "nobody reads or writes this table directly" explicit.
-- Behaviour is unchanged (no grants existed); this documents intent and clears advisor lint 0008.
-- Down: drop policy rate_limits_no_direct_access on public.rate_limits;
create policy rate_limits_no_direct_access on public.rate_limits
  as restrictive for all to anon, authenticated
  using (false) with check (false);
