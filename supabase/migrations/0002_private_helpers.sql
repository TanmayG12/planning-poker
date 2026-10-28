-- Move the row-level-security helpers out of the API schema.
-- Policies can still use them, but they are no longer callable as /rpc
-- endpoints, so nobody can probe whether a room code exists.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_member(p_code text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.players p
     where p.room_code = p_code and p.user_id = (select auth.uid())
  )
$$;

create or replace function private.round_revealed(p_code text, p_round int)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
     where r.code = p_code and r.round = p_round and r.revealed
  )
$$;

revoke execute on function private.is_member(text), private.round_revealed(text, int) from public, anon;
grant execute on function private.is_member(text), private.round_revealed(text, int) to authenticated;

alter policy "members read their room" on public.rooms
  using (private.is_member(code));
alter policy "members see who is at the table" on public.players
  using (private.is_member(room_code));
alter policy "members read the history" on public.history
  using (private.is_member(room_code));
alter policy "members read the queue" on public.queue
  using (private.is_member(room_code));
alter policy "own vote, or everyone's once revealed" on public.votes
  using (
    private.is_member(room_code)
    and (user_id = (select auth.uid()) or private.round_revealed(room_code, round))
  );

drop function public.is_member(text);
drop function public.round_revealed(text, int);
