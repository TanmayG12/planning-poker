-- A read-only health check for the externally scheduled availability probe.
-- It returns no user, room, or game data.
create function public.planning_poker_healthcheck()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select true $$;

revoke all on function public.planning_poker_healthcheck() from public;
grant execute on function public.planning_poker_healthcheck() to anon, authenticated;
