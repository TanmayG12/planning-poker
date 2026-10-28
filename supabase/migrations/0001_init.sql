-- Planning poker on Supabase
-- Run this once in the Supabase SQL editor (or with `supabase db push`).
--
-- How it works:
--  * Players sign in anonymously (no email). Each one gets a real auth.uid().
--  * Votes live in their own table. Row-level security lets you read your own
--    vote, and everyone else's only after the round is revealed. That is what
--    keeps cards secret: other browsers never receive them early.
--  * "Who has voted" is visible inside the room through players.voted_round.
--  * Every write goes through the functions below. They check that you joined
--    the room and lock the room row, so two people clicking at once can't
--    leave it in a broken state.

-- ---------- tables ----------

create table public.rooms (
  code          text primary key check (code ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  round         int  not null default 1,
  revealed      boolean not null default false,
  story         text not null default '' check (char_length(story) <= 140),
  deck          text not null default 'fib' check (deck in ('fib', 'mfib', 'tshirt', 'pow2')),
  final         text check (final is null or char_length(final) <= 8),
  hist_version  int  not null default 0,
  queue_version int  not null default 0,
  version       bigint not null default 0,
  auto_reveal   boolean not null default false,
  anonymous     boolean not null default false,
  timer_ends_at timestamptz,
  story_rounds  int  not null default 1,
  story_started_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.players (
  room_code    text not null references public.rooms(code) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 24),
  spectator    boolean not null default false,
  voted_round  int,
  joined_at    timestamptz not null default now(),
  primary key (room_code, user_id)
);

create table public.votes (
  room_code   text not null references public.rooms(code) on delete cascade,
  round       int  not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  value       text not null check (char_length(value) <= 4),
  created_at  timestamptz not null default now(),
  primary key (room_code, round, user_id)
);

create table public.history (
  id          bigint generated always as identity primary key,
  room_code   text not null references public.rooms(code) on delete cascade,
  story       text not null,
  estimate    text not null,
  rounds      int  not null default 1,
  seconds     int,
  consensus   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Stories waiting their turn. Next story pulls the first one.
create table public.queue (
  id          bigint generated always as identity primary key,
  room_code   text not null references public.rooms(code) on delete cascade,
  story       text not null check (char_length(story) between 1 and 140),
  position    bigint not null,
  created_at  timestamptz not null default now()
);

create index history_room_idx on public.history (room_code, created_at);
create index players_user_idx on public.players (user_id);
create index votes_user_idx   on public.votes (user_id);
create index queue_room_idx   on public.queue (room_code, position);

-- ---------- helpers ----------

create or replace function public.deck_cards(p_deck text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_deck
    when 'fib'    then array['0','½','1','2','3','5','8','13','21','34','?','☕']
    when 'mfib'   then array['0','½','1','2','3','5','8','13','20','40','100','?','☕']
    when 'tshirt' then array['XS','S','M','L','XL','XXL','?','☕']
    when 'pow2'   then array['0','1','2','4','8','16','32','64','?','☕']
  end
$$;

create or replace function public.is_member(p_code text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.players p
     where p.room_code = p_code and p.user_id = (select auth.uid())
  )
$$;

create or replace function public.round_revealed(p_code text, p_round int)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
     where r.code = p_code and r.round = p_round and r.revealed
  )
$$;

-- Internal: confirm the caller joined the room, then lock the room row for
-- the rest of the transaction.
create or replace function public._room_for_update(p_code text)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.players p where p.room_code = p_code and p.user_id = auth.uid()
  ) then
    raise exception 'Join the room first' using errcode = '42501';
  end if;
  select * into r from public.rooms where code = p_code for update;
  return r;
end
$$;

-- ---------- row-level security ----------

alter table public.rooms   enable row level security;
alter table public.players enable row level security;
alter table public.votes   enable row level security;
alter table public.history enable row level security;
alter table public.queue   enable row level security;

create policy "members read their room" on public.rooms
  for select to authenticated using (public.is_member(code));

create policy "members see who is at the table" on public.players
  for select to authenticated using (public.is_member(room_code));

create policy "members read the history" on public.history
  for select to authenticated using (public.is_member(room_code));

create policy "members read the queue" on public.queue
  for select to authenticated using (public.is_member(room_code));

create policy "own vote, or everyone's once revealed" on public.votes
  for select to authenticated using (
    public.is_member(room_code)
    and (user_id = (select auth.uid()) or public.round_revealed(room_code, round))
  );

-- No insert, update or delete policies on purpose: writes only happen
-- through the functions below. Belt and braces:
revoke insert, update, delete, truncate
  on public.rooms, public.players, public.votes, public.history, public.queue
  from anon, authenticated;
revoke all on public.rooms, public.players, public.votes, public.history, public.queue from anon;

-- ---------- actions ----------

create or replace function public.join_room(p_code text, p_name text, p_spectator boolean default false)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  r      public.rooms;
  v_code text := lower(trim(p_code));
  v_name text := left(trim(p_name), 24);
  v_spec boolean := coalesce(p_spectator, false);
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_code is null or v_code !~ '^[a-z0-9][a-z0-9-]{1,47}$' then
    raise exception 'Room codes use letters, numbers and dashes' using errcode = '22023';
  end if;
  if coalesce(v_name, '') = '' then
    raise exception 'Add your name first' using errcode = '22023';
  end if;

  insert into public.rooms (code) values (v_code) on conflict (code) do nothing;
  select * into r from public.rooms where code = v_code for update;

  insert into public.players (room_code, user_id, name, spectator)
  values (v_code, auth.uid(), v_name, v_spec)
  on conflict (room_code, user_id) do update
    set name = excluded.name, spectator = excluded.spectator;

  if v_spec then
    delete from public.votes where room_code = v_code and round = r.round and user_id = auth.uid();
    update public.players set voted_round = null where room_code = v_code and user_id = auth.uid();
  end if;
  return r;
end
$$;

create or replace function public.cast_vote(p_code text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  r := public._room_for_update(p_code);
  if r.revealed then
    raise exception 'Cards are already revealed' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.players where room_code = p_code and user_id = auth.uid() and spectator
  ) then
    raise exception 'Spectators can''t vote' using errcode = '22023';
  end if;

  if p_value is null then
    delete from public.votes where room_code = p_code and round = r.round and user_id = auth.uid();
    update public.players set voted_round = null where room_code = p_code and user_id = auth.uid();
  else
    if not (p_value = any (public.deck_cards(r.deck))) then
      raise exception 'That card isn''t in this deck' using errcode = '22023';
    end if;
    insert into public.votes (room_code, round, user_id, value)
    values (p_code, r.round, auth.uid(), p_value)
    on conflict (room_code, round, user_id) do update
      set value = excluded.value, created_at = now();
    update public.players set voted_round = r.round where room_code = p_code and user_id = auth.uid();
  end if;
end
$$;

create or replace function public.reveal_round(p_code text)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  r := public._room_for_update(p_code);
  if r.revealed then
    return r; -- several browsers may auto-reveal at once; only the first counts
  end if;
  update public.rooms set revealed = true, updated_at = now(), version = version + 1
   where code = p_code returning * into r;
  return r;
end
$$;

-- Starts a fresh round.
--   p_save = true:  files the current story in the history (with how many
--                   rounds it took, how long, and whether the first-to-last
--                   votes agreed), then pulls the next story from the queue.
--   p_save = false: "vote again" on the same story.
-- The agreed card (rooms.final) wins over the client's suggestion.
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
      coalesce(nullif(left(r.story, 60), ''), 'Untitled story'),
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

create or replace function public.set_story(p_code text, p_story text)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  r := public._room_for_update(p_code);
  update public.rooms
     set story = left(trim(coalesce(p_story, '')), 140),
         story_started_at = case when r.story = '' then now() else story_started_at end,
         updated_at = now(), version = version + 1
   where code = p_code returning * into r;
  return r;
end
$$;

create or replace function public.set_deck(p_code text, p_deck text)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  r := public._room_for_update(p_code);
  if public.deck_cards(p_deck) is null then
    raise exception 'Unknown deck' using errcode = '22023';
  end if;
  if r.deck = p_deck then
    return r;
  end if;
  update public.rooms
     set deck = p_deck, round = round + 1, revealed = false, final = null, timer_ends_at = null,
         updated_at = now(), version = version + 1
   where code = p_code returning * into r;
  return r;
end
$$;

create or replace function public.set_final(p_code text, p_value text)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  r := public._room_for_update(p_code);
  if not r.revealed then
    raise exception 'Reveal the cards first' using errcode = '22023';
  end if;
  if p_value is not null
     and (p_value in ('?', '☕') or not (p_value = any (public.deck_cards(r.deck)))) then
    raise exception 'Pick a numbered card or a size' using errcode = '22023';
  end if;
  update public.rooms set final = p_value, updated_at = now(), version = version + 1
   where code = p_code returning * into r;
  return r;
end
$$;

-- Table-wide options. Pass null to leave one unchanged.
create or replace function public.set_options(p_code text, p_auto_reveal boolean default null, p_anonymous boolean default null)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  perform public._room_for_update(p_code);
  update public.rooms
     set auto_reveal = coalesce(p_auto_reveal, auto_reveal),
         anonymous   = coalesce(p_anonymous, anonymous),
         updated_at = now(), version = version + 1
   where code = p_code returning * into r;
  return r;
end
$$;

-- Discussion timer. 30 seconds to 15 minutes; null or 0 stops it.
create or replace function public.start_timer(p_code text, p_seconds int)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  perform public._room_for_update(p_code);
  update public.rooms
     set timer_ends_at = case when coalesce(p_seconds, 0) <= 0 then null
                              else now() + make_interval(secs => least(greatest(p_seconds, 30), 900)) end,
         updated_at = now(), version = version + 1
   where code = p_code returning * into r;
  return r;
end
$$;

create or replace function public.set_spectator(p_code text, p_spectator boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  r := public._room_for_update(p_code);
  update public.players set spectator = coalesce(p_spectator, false), voted_round = null
   where room_code = p_code and user_id = auth.uid();
  delete from public.votes where room_code = p_code and round = r.round and user_id = auth.uid();
end
$$;

create or replace function public.clear_history(p_code text)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  perform public._room_for_update(p_code);
  delete from public.history where room_code = p_code;
  update public.rooms set hist_version = hist_version + 1, updated_at = now(), version = version + 1
   where code = p_code returning * into r;
  return r;
end
$$;

-- Adds stories to the queue, one per line (up to 50 at a time, 200 queued).
-- If the table has no story yet, the first line becomes the current story.
create or replace function public.queue_add(p_code text, p_stories text[])
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  r      public.rooms;
  v_list text[];
  v_pos  bigint;
  v_room int;
begin
  r := public._room_for_update(p_code);
  select coalesce(array_agg(t), '{}') into v_list
    from (
      select left(trim(x), 140) as t
        from unnest(coalesce(p_stories, '{}')) with ordinality as u(x, n)
       where trim(x) <> ''
       order by n
       limit 50
    ) s;
  if array_length(v_list, 1) is null then
    return r;
  end if;

  if r.story = '' and not r.revealed then
    update public.rooms set story = v_list[1], story_started_at = now()
     where code = p_code;
    v_list := v_list[2:];
  end if;

  select count(*) into v_room from public.queue where room_code = p_code;
  if v_room + coalesce(array_length(v_list, 1), 0) > 200 then
    raise exception 'The queue holds up to 200 stories' using errcode = '22023';
  end if;

  select coalesce(max(position), 0) into v_pos from public.queue where room_code = p_code;
  insert into public.queue (room_code, story, position)
  select p_code, t, v_pos + n from unnest(v_list) with ordinality as u(t, n);

  update public.rooms set queue_version = queue_version + 1, updated_at = now(), version = version + 1
   where code = p_code returning * into r;
  return r;
end
$$;

-- Removes one queued story, or the whole queue when p_id is null.
create or replace function public.queue_remove(p_code text, p_id bigint default null)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  perform public._room_for_update(p_code);
  delete from public.queue where room_code = p_code and (p_id is null or id = p_id);
  update public.rooms set queue_version = queue_version + 1, updated_at = now(), version = version + 1
   where code = p_code returning * into r;
  return r;
end
$$;

-- ---------- permissions ----------

revoke execute on function
  public.deck_cards(text),
  public.is_member(text),
  public.round_revealed(text, int),
  public._room_for_update(text),
  public.join_room(text, text, boolean),
  public.cast_vote(text, text),
  public.reveal_round(text),
  public.start_round(text, boolean, text),
  public.set_story(text, text),
  public.set_deck(text, text),
  public.set_final(text, text),
  public.set_spectator(text, boolean),
  public.clear_history(text),
  public.set_options(text, boolean, boolean),
  public.start_timer(text, int),
  public.queue_add(text, text[]),
  public.queue_remove(text, bigint)
from public, anon;
revoke execute on function public._room_for_update(text) from authenticated;
grant execute on function
  public.deck_cards(text),
  public.is_member(text),
  public.round_revealed(text, int),
  public.join_room(text, text, boolean),
  public.cast_vote(text, text),
  public.reveal_round(text),
  public.start_round(text, boolean, text),
  public.set_story(text, text),
  public.set_deck(text, text),
  public.set_final(text, text),
  public.set_spectator(text, boolean),
  public.clear_history(text),
  public.set_options(text, boolean, boolean),
  public.start_timer(text, int),
  public.queue_add(text, text[]),
  public.queue_remove(text, bigint)
to authenticated;

-- ---------- realtime ----------
-- Browsers listen for room and player changes. Votes are deliberately not
-- broadcast: they're fetched after the reveal, through the policy above.
alter publication supabase_realtime add table public.rooms, public.players;
