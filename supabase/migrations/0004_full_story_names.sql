-- Keep the full story name (up to 140 characters) in the Done list.
-- Same function as before; only the saved length changes.

create or replace function public.start_round(p_code text, p_save boolean, p_estimate text default null)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  r      public.rooms;
  v_next text := '';
  v_q    bigint;
  v_agree boolean;
begin
  r := public._room_for_update(p_code);
  if p_save then
    select count(*) >= 2 and count(distinct value) = 1 into v_agree
      from public.votes
     where room_code = p_code and round = r.round and value not in ('?', '☕');

    insert into public.history (room_code, story, estimate, rounds, seconds, consensus)
    values (
      p_code,
      coalesce(nullif(left(r.story, 140), ''), 'Untitled story'),
      coalesce(r.final, nullif(left(trim(p_estimate), 8), ''), '—'),
      r.story_rounds,
      greatest(0, extract(epoch from now() - r.story_started_at))::int,
      coalesce(v_agree, false) and r.story_rounds = 1
    );

    select q.id, q.story into v_q, v_next
      from public.queue q where q.room_code = p_code
     order by q.position, q.id limit 1;
    if v_q is not null then
      delete from public.queue where id = v_q;
    end if;

    update public.rooms
       set round = round + 1, revealed = false, final = null, timer_ends_at = null,
           story = coalesce(v_next, ''),
           story_rounds = 1, story_started_at = now(),
           hist_version = hist_version + 1,
           queue_version = queue_version + case when v_q is null then 0 else 1 end,
           updated_at = now(), version = version + 1
     where code = p_code
    returning * into r;
  else
    update public.rooms
       set round = round + 1, revealed = false, final = null, timer_ends_at = null,
           story_rounds = story_rounds + 1,
           updated_at = now(), version = version + 1
     where code = p_code
    returning * into r;
  end if;
  return r;
end
$$;
