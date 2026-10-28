-- Optional housekeeping for a long-running public instance.
-- Run it by hand in the SQL editor, or schedule it with pg_cron
-- (Database, then Extensions, then enable pg_cron).

-- Rooms nobody has touched in 30 days. Players, votes and history go with them.
delete from public.rooms where updated_at < now() - interval '30 days';

-- Anonymous accounts older than 30 days that no longer sit at any table.
delete from auth.users u
 where u.is_anonymous
   and u.created_at < now() - interval '30 days'
   and not exists (select 1 from public.players p where p.user_id = u.id);

-- To run both nightly with pg_cron, uncomment:
-- select cron.schedule('poker-cleanup', '15 3 * * *', $$
--   delete from public.rooms where updated_at < now() - interval '30 days';
--   delete from auth.users u
--    where u.is_anonymous and u.created_at < now() - interval '30 days'
--      and not exists (select 1 from public.players p where p.user_id = u.id);
-- $$);
