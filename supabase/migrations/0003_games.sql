-- Explicit games: "New game" creates a room with its settings up front, and
-- "Join" only enters a room that already exists (a typo no longer drops you
-- into an empty table). Additive: join_room stays for older clients.

alter table public.rooms
  add column if not exists title text not null default '' check (char_length(title) <= 60);

create or replace function public.create_room(
  p_code text,
  p_name text,
  p_spectator boolean default false,
  p_title text default '',
  p_deck text default 'fib',
  p_auto_reveal boolean default false,
  p_anonymous boolean default false
)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  r      public.rooms;
  v_code text := lower(trim(p_code));
  v_name text := left(trim(p_name), 24);
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
  if public.deck_cards(coalesce(p_deck, 'fib')) is null then
    raise exception 'Unknown deck' using errcode = '22023';
  end if;

  begin
    insert into public.rooms (code, title, deck, auto_reveal, anonymous)
    values (v_code, left(trim(coalesce(p_title, '')), 60), coalesce(p_deck, 'fib'),
            coalesce(p_auto_reveal, false), coalesce(p_anonymous, false))
    returning * into r;
  exception when unique_violation then
    raise exception 'That room code is taken' using errcode = '23505';
  end;

  insert into public.players (room_code, user_id, name, spectator)
  values (v_code, auth.uid(), v_name, coalesce(p_spectator, false));
  return r;
end
$$;

create or replace function public.join_game(p_code text, p_name text, p_spectator boolean default false)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  v_code text := lower(trim(p_code));
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.rooms where code = v_code) then
    raise exception 'No game with that code' using errcode = 'P0002';
  end if;
  return public.join_room(v_code, p_name, p_spectator);
end
$$;

revoke execute on function
  public.create_room(text, text, boolean, text, text, boolean, boolean),
  public.join_game(text, text, boolean)
from public, anon;
grant execute on function
  public.create_room(text, text, boolean, text, text, boolean, boolean),
  public.join_game(text, text, boolean)
to authenticated;
