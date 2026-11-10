-- Moonveil Club phase 1 multiplayer schema.
-- Safe to run more than once.
-- Dashboard: Supabase → SQL Editor → New query → paste this entire file → Run.
--
-- Tables: profiles, characters, saves, friendships, reports.
-- A trigger creates a profile when an auth user is inserted.
-- The anon key cannot run this file. Paste it in the SQL editor (postgres role).

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

create or replace function public.prevent_username_change()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  -- The SQL editor (postgres) can repair a username. API roles cannot.
  if new.username is distinct from old.username
     and current_user in ('anon', 'authenticated') then
    raise exception 'username is immutable' using errcode = '23514';
  end if;
  if new.id is distinct from old.id then
    raise exception 'profile id is immutable' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

create or replace function public.saves_limit_size()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if pg_column_size(new.data) > 200000 then
    raise exception 'save is too large' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

-- Reads auth.users metadata. Username is stored lowercase and must match
-- ^[a-z0-9_]{3,20}$. The browser adapter sends that metadata on sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uname text;
  dname text;
begin
  uname := lower(btrim(coalesce(
    new.raw_user_meta_data ->> 'username',
    split_part(coalesce(new.email, ''), '@', 1)
  )));

  if uname !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid username for profile' using errcode = '23514';
  end if;

  dname := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  dname := regexp_replace(dname, '[[:cntrl:]]', '', 'g');
  if char_length(dname) < 1 then
    dname := uname;
  elsif char_length(dname) > 32 then
    dname := left(dname, 32);
  end if;

  begin
    insert into public.profiles (id, username, display_name)
    values (new.id, uname, dname)
    on conflict (id) do nothing;
  exception
    when unique_violation then
      raise exception 'username is already taken' using errcode = '23505';
  end;

  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_username_key unique (username),
  constraint profiles_display_name_len check (
    char_length(display_name) between 1 and 32
    and display_name !~ '[[:cntrl:]]'
  )
);

create table if not exists public.characters (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  gender text not null,
  skin text not null,
  hair_style text not null,
  hair_color text not null,
  outfit_color text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint characters_gender_chk check (gender in ('male', 'female')),
  constraint characters_skin_chk check (char_length(skin) between 1 and 32 and skin !~ '[[:cntrl:]]'),
  constraint characters_hair_style_chk check (char_length(hair_style) between 1 and 32 and hair_style !~ '[[:cntrl:]]'),
  constraint characters_hair_color_chk check (char_length(hair_color) between 1 and 32 and hair_color !~ '[[:cntrl:]]'),
  constraint characters_outfit_color_chk check (char_length(outfit_color) between 1 and 32 and outfit_color !~ '[[:cntrl:]]'),
  constraint characters_name_chk check (char_length(name) between 1 and 24 and name !~ '[[:cntrl:]]')
);

create table if not exists public.saves (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  data jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint saves_version_chk check (version >= 1 and version <= 1000000),
  constraint saves_data_object_chk check (jsonb_typeof(data) = 'object')
);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  blocked_by uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_distinct_chk check (requester <> addressee),
  constraint friendships_status_chk check (status in ('pending', 'accepted', 'blocked')),
  constraint friendships_block_chk check (
    (
      status = 'blocked'
      and blocked_by is not null
      and (blocked_by = requester or blocked_by = addressee)
    )
    or (
      status <> 'blocked'
      and blocked_by is null
    )
  )
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references public.profiles (id) on delete cascade,
  target uuid not null references public.profiles (id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint reports_distinct_chk check (reporter <> target),
  constraint reports_reason_chk check (char_length(btrim(reason)) between 1 and 500)
);

comment on table public.profiles is 'One row per auth user. Username is the sign-in handle and is immutable from the API.';
comment on table public.characters is 'One avatar per profile. Appearance columns are publicly readable.';
comment on table public.saves is 'One JSON cloud save per profile.';
comment on table public.friendships is 'Directed request row. blocked_by records who applied a block so only they can lift it.';
comment on table public.reports is 'Player reports. Only the reporter can read their own rows.';
comment on column public.friendships.blocked_by is 'Set only when status is blocked. The blocked player cannot delete or accept the row.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists profiles_display_name_idx
  on public.profiles (lower(display_name));

create index if not exists saves_updated_at_idx
  on public.saves (updated_at desc);

create unique index if not exists friendships_pair_unique
  on public.friendships ((least(requester, addressee)), (greatest(requester, addressee)));

create index if not exists friendships_requester_idx
  on public.friendships (requester);

create index if not exists friendships_addressee_idx
  on public.friendships (addressee);

create index if not exists friendships_pending_addressee_idx
  on public.friendships (addressee)
  where status = 'pending';

create index if not exists reports_reporter_idx
  on public.reports (reporter);

create index if not exists reports_target_idx
  on public.reports (target);

create index if not exists reports_created_at_idx
  on public.reports (created_at desc);

-- ---------------------------------------------------------------------------
-- Table triggers
-- ---------------------------------------------------------------------------

drop trigger if exists profiles_lock_username on public.profiles;
create trigger profiles_lock_username
  before update on public.profiles
  for each row
  execute function public.prevent_username_change();

drop trigger if exists characters_set_updated_at on public.characters;
create trigger characters_set_updated_at
  before insert or update on public.characters
  for each row
  execute function public.set_updated_at();

drop trigger if exists saves_set_updated_at on public.saves;
create trigger saves_set_updated_at
  before insert or update on public.saves
  for each row
  execute function public.set_updated_at();

drop trigger if exists saves_limit_size on public.saves;
create trigger saves_limit_size
  before insert or update on public.saves
  for each row
  execute function public.saves_limit_size();

drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at
  before insert or update on public.friendships
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Enable, but do not FORCE. The table owner (postgres) bypasses RLS so the
-- sign-up trigger can insert the profile. anon and authenticated do not.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.characters enable row level security;
alter table public.saves enable row level security;
alter table public.friendships enable row level security;
alter table public.reports enable row level security;

drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public
  on public.profiles
  for select
  to anon, authenticated
  using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists characters_select_public on public.characters;
create policy characters_select_public
  on public.characters
  for select
  to anon, authenticated
  using (true);

drop policy if exists characters_insert_own on public.characters;
create policy characters_insert_own
  on public.characters
  for insert
  to authenticated
  with check (profile_id = (select auth.uid()));

drop policy if exists characters_update_own on public.characters;
create policy characters_update_own
  on public.characters
  for update
  to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists characters_delete_own on public.characters;
create policy characters_delete_own
  on public.characters
  for delete
  to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists saves_select_own on public.saves;
create policy saves_select_own
  on public.saves
  for select
  to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists saves_insert_own on public.saves;
create policy saves_insert_own
  on public.saves
  for insert
  to authenticated
  with check (profile_id = (select auth.uid()));

drop policy if exists saves_update_own on public.saves;
create policy saves_update_own
  on public.saves
  for update
  to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists saves_delete_own on public.saves;
create policy saves_delete_own
  on public.saves
  for delete
  to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists friendships_select_participant on public.friendships;
create policy friendships_select_participant
  on public.friendships
  for select
  to authenticated
  using (
    requester = (select auth.uid())
    or addressee = (select auth.uid())
  );

drop policy if exists friendships_insert_own on public.friendships;
create policy friendships_insert_own
  on public.friendships
  for insert
  to authenticated
  with check (
    requester = (select auth.uid())
    and requester <> addressee
    and (
      (status = 'pending' and blocked_by is null)
      or (status = 'blocked' and blocked_by = (select auth.uid()))
    )
  );

drop policy if exists friendships_accept on public.friendships;
create policy friendships_accept
  on public.friendships
  for update
  to authenticated
  using (status = 'pending' and addressee = (select auth.uid()))
  with check (
    status = 'accepted'
    and addressee = (select auth.uid())
    and blocked_by is null
  );

drop policy if exists friendships_block on public.friendships;
create policy friendships_block
  on public.friendships
  for update
  to authenticated
  using (
    status <> 'blocked'
    and (
      requester = (select auth.uid())
      or addressee = (select auth.uid())
    )
  )
  with check (
    status = 'blocked'
    and blocked_by = (select auth.uid())
    and (
      requester = (select auth.uid())
      or addressee = (select auth.uid())
    )
  );

drop policy if exists friendships_delete_own on public.friendships;
create policy friendships_delete_own
  on public.friendships
  for delete
  to authenticated
  using (
    (
      status in ('pending', 'accepted')
      and (
        requester = (select auth.uid())
        or addressee = (select auth.uid())
      )
    )
    or (
      status = 'blocked'
      and blocked_by = (select auth.uid())
    )
  );

drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own
  on public.reports
  for insert
  to authenticated
  with check (
    reporter = (select auth.uid())
    and reporter <> target
  );

drop policy if exists reports_select_own on public.reports;
create policy reports_select_own
  on public.reports
  for select
  to authenticated
  using (reporter = (select auth.uid()));

drop policy if exists reports_delete_own on public.reports;
create policy reports_delete_own
  on public.reports
  for delete
  to authenticated
  using (reporter = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants
-- Column grants on profiles and characters are the public read surface.
-- id is included so clients can join a row to an auth user.
-- ---------------------------------------------------------------------------

revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.characters from public, anon, authenticated;
revoke all on table public.saves from public, anon, authenticated;
revoke all on table public.friendships from public, anon, authenticated;
revoke all on table public.reports from public, anon, authenticated;

grant select (id, username, display_name) on public.profiles to anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select (profile_id, gender, skin, hair_style, hair_color, outfit_color, name)
  on public.characters to anon, authenticated;
grant insert (profile_id, gender, skin, hair_style, hair_color, outfit_color, name)
  on public.characters to authenticated;
grant update (gender, skin, hair_style, hair_color, outfit_color, name)
  on public.characters to authenticated;
grant delete on public.characters to authenticated;

grant select, insert, update, delete on public.saves to authenticated;

grant select, delete on public.friendships to authenticated;
grant insert (requester, addressee, status, blocked_by) on public.friendships to authenticated;
grant update (status, blocked_by) on public.friendships to authenticated;

grant select, insert, delete on public.reports to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.prevent_username_change() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.saves_limit_size() from public, anon, authenticated;

do $service$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all privileges on table public.profiles, public.characters, public.saves, public.friendships, public.reports to service_role';
  end if;
end
$service$;

-- ---------------------------------------------------------------------------
-- Auth sign-up trigger
-- ---------------------------------------------------------------------------

do $auth_trigger$
begin
  if to_regclass('auth.users') is null then
    raise exception 'auth.users is missing. Run this script in the Supabase SQL editor.';
  end if;
  execute 'drop trigger if exists on_auth_user_created on auth.users';
  execute $trig$
    create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute function public.handle_new_user()
  $trig$;
end
$auth_trigger$;

-- ---------------------------------------------------------------------------
-- Presence authorization for the private channel "club:main".
-- Do not ALTER realtime.messages. RLS is already on, and postgres does not
-- own that table. Policy statements are the allowed door.
-- ---------------------------------------------------------------------------

do $presence$
begin
  if to_regclass('realtime.messages') is null or to_regprocedure('realtime.topic()') is null then
    raise notice 'Skipping club presence policies (realtime.messages or realtime.topic is not available).';
    return;
  end if;

  execute 'drop policy if exists moonveil_presence_read on realtime.messages';
  execute $policy$
    create policy moonveil_presence_read
    on realtime.messages
    for select
    to authenticated
    using (
      realtime.topic() in ('club:main', 'realtime:club:main')
      and realtime.messages.extension = 'presence'
    )
  $policy$;

  execute 'drop policy if exists moonveil_presence_write on realtime.messages';
  execute $policy$
    create policy moonveil_presence_write
    on realtime.messages
    for insert
    to authenticated
    with check (
      realtime.topic() in ('club:main', 'realtime:club:main')
      and realtime.messages.extension = 'presence'
      and (select auth.uid()) is not null
    )
  $policy$;
end
$presence$;

-- Friend-request rows can be subscribed to later. Presence itself does not
-- need this publication.
do $pub$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'friendships'
  ) then
    execute 'alter publication supabase_realtime add table public.friendships';
  end if;
end
$pub$;

notify pgrst, 'reload schema';
