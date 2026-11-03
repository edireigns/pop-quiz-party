-- Pop Quiz Party schema.
-- All game state for a room lives in rooms.state (JSONB) and is ONLY read or
-- written by the Next.js server over a direct Postgres connection. Browsers
-- never touch these tables: RLS is enabled with NO policies, and the
-- anon/authenticated roles are explicitly revoked.

create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_token_hash text not null,
  state jsonb not null,
  phase text not null default 'lobby',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists rooms_ended_at_idx on public.rooms (ended_at);
create index if not exists rooms_updated_at_idx on public.rooms (updated_at);

create table if not exists public.rate_limits (
  key text primary key,
  count integer not null,
  reset_at timestamptz not null
);
create index if not exists rate_limits_reset_idx on public.rate_limits (reset_at);

alter table public.rooms enable row level security;
alter table public.rate_limits enable row level security;

-- Fixed-window rate limiter. Returns true if the call is allowed.
create or replace function public.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
as $$
declare
  c integer;
begin
  insert into public.rate_limits as rl (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update
    set count = case when rl.reset_at < now() then 1 else rl.count + 1 end,
        reset_at = case when rl.reset_at < now() then now() + make_interval(secs => p_window_seconds) else rl.reset_at end
  returning count into c;
  return c <= p_limit;
end;
$$;

-- Deletes rooms (and with them every submitted word, inside joke and custom
-- dare, which live inside rooms.state) 24 hours after the game ends. Rooms
-- that never finished are removed after 7 days without activity so a host
-- can still prepare a game ahead of time. The built-in word bank lives in
-- the app code and is never touched.
create or replace function public.cleanup_expired_rooms()
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  delete from public.rooms
  where (ended_at is not null and ended_at < now() - interval '24 hours')
     or (updated_at < now() - interval '7 days');
  get diagnostics n = row_count;
  delete from public.rate_limits where reset_at < now() - interval '1 hour';
  return n;
end;
$$;

-- Lock down Supabase's API roles (no-op on plain Postgres).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.rooms, public.rate_limits from anon, authenticated';
    execute 'revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated';
    execute 'revoke execute on function public.cleanup_expired_rooms() from public, anon, authenticated';
  end if;
end
$$;
