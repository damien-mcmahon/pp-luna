-- Auth-only migration: apply after the existing schema and T-shirt Sizes.
-- CLI workflow setup is delivered by the separate database-workflow PR.
-- Existing unsigned seats cannot safely be claimed. Recreate active tables after upgrade.
begin;

-- Deliberately remove the prototype plaintext credentials, not real Auth accounts.
do $$
begin
  if exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'admin_users' and column_name = 'password') then
    drop table public.admin_users;
  end if;
end $$;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  -- Preserve the actor identifier even after their Auth account is deleted.
  actor_id uuid not null,
  action text not null check (action in ('rename', 'delete')),
  table_slug text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists public.admin_login_attempts (
  key text primary key,
  attempts integer not null,
  started_at timestamptz not null default now()
);
alter table public.participants add column if not exists session_token_hash text;
create unique index if not exists participants_session_token_hash_idx
  on public.participants(session_token_hash) where session_token_hash is not null;
-- Retire short, guessable legacy invite links without deleting tables/history.
update public.tables set
  slug = left(slug, 25) || '-' || replace(gen_random_uuid()::text, '-', ''),
  updated_at = clock_timestamp()
  where slug !~ '-[a-f0-9]{32}$';

alter table public.admin_users enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.admin_login_attempts enable row level security;
alter table public.tables enable row level security;
alter table public.participants enable row level security;
alter table public.rounds enable row level security;
alter table public.votes enable row level security;

drop policy if exists "public can read tables" on public.tables;
drop policy if exists "public can read participants" on public.participants;
drop policy if exists "public can read rounds" on public.rounds;
drop policy if exists "public can read votes" on public.votes;
-- Defense in depth: even an accidentally retained policy cannot expose these tables.
revoke all on public.tables, public.participants, public.rounds, public.votes,
  public.admin_users, public.admin_audit_log, public.admin_login_attempts from public, anon, authenticated;
grant all on public.tables, public.participants, public.rounds, public.votes,
  public.admin_users, public.admin_audit_log, public.admin_login_attempts to service_role;
grant usage, select on sequence public.admin_audit_log_id_seq to service_role;

-- The browser now polls the redacted API. No raw vote-change payload is public.
do $$
declare relation_name text;
begin
  foreach relation_name in array array['tables', 'participants', 'rounds', 'votes'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = relation_name) then
      execute format('alter publication supabase_realtime drop table public.%I', relation_name);
    end if;
  end loop;
end $$;

create or replace function public.consume_admin_login_attempt(p_key text)
returns boolean language plpgsql set search_path = '' as $$
declare attempt_count integer;
begin
  delete from public.admin_login_attempts where started_at < now() - interval '1 day';
  insert into public.admin_login_attempts as attempt (key, attempts, started_at)
    values (p_key, 1, now())
    on conflict (key) do update set
      attempts = case when attempt.started_at < now() - interval '15 minutes' then 1 else attempt.attempts + 1 end,
      started_at = case when attempt.started_at < now() - interval '15 minutes' then now() else attempt.started_at end
    returning attempts into attempt_count;
  return attempt_count <= 10;
end $$;

create or replace function public.admin_mutate_table(p_user_id uuid, p_slug text, p_action text, p_name text default null)
returns boolean language plpgsql set search_path = '' as $$
declare target public.tables%rowtype;
begin
  if not exists (select 1 from public.admin_users where user_id = p_user_id) then
    raise insufficient_privilege using message = 'Administrator access required';
  end if;
  select * into target from public.tables where slug = p_slug for update;
  if not found then return false; end if;
  if p_action = 'rename' and length(trim(p_name)) between 1 and 120 then
    update public.tables set name = trim(p_name), updated_at = clock_timestamp() where id = target.id;
  elsif p_action = 'delete' then
    delete from public.tables where id = target.id;
  else
    raise exception 'Invalid admin action';
  end if;
  insert into public.admin_audit_log(actor_id, action, table_slug, details)
    values (p_user_id, p_action, target.slug,
      jsonb_build_object('tableId', target.id, 'previousName', target.name, 'name', p_name));
  return true;
end $$;

create or replace function public.create_planning_table(p_table jsonb, p_token_hash text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid seat token'; end if;
  -- INSERT, never UPSERT: supplied IDs cannot overwrite existing tables, seats, or rounds.
  insert into public.tables(id, slug, name, creator_id, deck)
    values (p_table->>'id', p_table->>'slug', p_table->>'name', p_table->>'creatorId', p_table->>'deck');
  insert into public.participants(id, table_id, name, is_creator, is_dealer, session_token_hash)
    values (p_table->>'creatorId', p_table->>'id', p_table->>'creatorName', true,
      (p_table->>'isDealer')::boolean, p_token_hash);
  insert into public.rounds(id, table_id, round_number)
    values (p_table->>'roundId', p_table->>'id', 1);
end $$;

create or replace function public.mutate_planning_table(p_slug text, p_token_hash text, p_action text, p_payload jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  target public.tables%rowtype;
  actor public.participants%rowtype;
  hand public.rounds%rowtype;
  participant jsonb;
  card text;
  member_id text;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise insufficient_privilege using message = 'Invalid seat token';
  end if;
  -- Serialize all changes to a table, including votes and joins. No stale client snapshots.
  select * into target from public.tables where slug = p_slug for update;
  if not found then raise no_data_found using message = 'Table not found'; end if;
  select * into hand from public.rounds where table_id = target.id order by round_number desc limit 1;
  select * into actor from public.participants
    where table_id = target.id and session_token_hash = p_token_hash;

  if p_action = 'join' then
    participant := p_payload->'participant';
    if not coalesce(length(trim(participant->>'name')) between 1 and 80, false)
      or coalesce(length(participant->>'team'), 0) > 80 then raise exception 'Invalid participant'; end if;
    if actor.id is not null then
      update public.participants set name = trim(participant->>'name'),
        team = participant->>'team', last_seen_at = clock_timestamp() where id = actor.id;
    else
      if hand.reveal_started_at is not null and not hand.revealed then raise exception 'Reveal in progress'; end if;
      if (select count(*) from public.participants where table_id = target.id) >= 20 then raise exception 'Table full'; end if;
      if not coalesce((participant->>'id') ~ '^[a-zA-Z0-9_-]{1,100}$', false) then raise exception 'Invalid participant ID'; end if;
      insert into public.participants(id, table_id, name, team, session_token_hash)
        values (participant->>'id', target.id, trim(participant->>'name'), participant->>'team', p_token_hash);
    end if;
  else
    if actor.id is null then raise insufficient_privilege using message = 'Seat required'; end if;
    if p_action in ('vote', 'task', 'start-reveal', 'finish-reveal', 'next-round')
      and (p_payload->>'roundId') is distinct from hand.id then raise exception 'Stale round'; end if;

    if p_action = 'vote' then
      if (p_payload->>'participantId') is distinct from actor.id or actor.is_dealer
        or hand.revealed or hand.reveal_started_at is not null then
        raise insufficient_privilege using message = 'Vote not allowed';
      end if;
      card := p_payload->>'value';
      if not (p_payload ? 'value') then raise exception 'Vote value required'; end if;
      if card is null then
        delete from public.votes where round_id = hand.id and participant_id = actor.id;
      else
        if (target.deck = 'fibonacci' and card not in ('1','2','3','5','8','13','21'))
          or (target.deck = 't-shirt-sizes' and card not in ('XS','S','M','L','XL','XXL')) then
          raise exception 'Invalid card';
        end if;
        insert into public.votes(table_id, round_id, participant_id, value)
          values (target.id, hand.id, actor.id, card)
          on conflict (round_id, participant_id) do update set value = excluded.value;
      end if;
    else
      if not actor.is_creator or actor.id <> target.creator_id then
        raise insufficient_privilege using message = 'Creator access required';
      end if;
      if p_action = 'rename' then
        if not coalesce(length(trim(p_payload->>'name')) between 1 and 120, false) then raise exception 'Invalid name'; end if;
        update public.tables set name = trim(p_payload->>'name') where id = target.id;
      elsif p_action = 'task' then
        if hand.revealed or hand.reveal_started_at is not null
          or not coalesce(length(p_payload->>'task') <= 500, false) then raise exception 'Task cannot be changed'; end if;
        update public.rounds set task = p_payload->>'task' where id = hand.id;
      elsif p_action = 'start-reveal' then
        if hand.revealed then raise exception 'Already revealed'; end if;
        if not exists (select 1 from public.participants where table_id = target.id and not is_dealer)
          or exists (select 1 from public.participants p where p.table_id = target.id and not p.is_dealer
            and not exists (select 1 from public.votes v where v.round_id = hand.id and v.participant_id = p.id)) then
          raise exception 'Waiting for votes';
        end if;
        update public.rounds set reveal_started_at = coalesce(reveal_started_at, clock_timestamp()) where id = hand.id;
      elsif p_action = 'finish-reveal' then
        if hand.reveal_started_at is null or clock_timestamp() < hand.reveal_started_at + interval '2.5 seconds' then
          raise exception 'Reveal countdown not finished';
        end if;
        update public.rounds set revealed = true, revealed_at = coalesce(revealed_at, clock_timestamp()) where id = hand.id;
      elsif p_action = 'next-round' then
        if not hand.revealed or not coalesce((p_payload->>'nextRoundId') ~ '^[a-zA-Z0-9_-]{1,100}$', false) then
          raise exception 'Cannot start round';
        end if;
        insert into public.rounds(id, table_id, round_number, task)
          values (p_payload->>'nextRoundId', target.id, hand.round_number + 1,
            case when (p_payload->>'clearTask')::boolean then '' else hand.task end);
      elsif p_action in ('role', 'remove-member') then
        if hand.reveal_started_at is not null and not hand.revealed then raise exception 'Reveal in progress'; end if;
        if p_action = 'role' then
          if jsonb_typeof(p_payload->'isDealer') is distinct from 'boolean' then raise exception 'Invalid role'; end if;
          update public.participants set is_dealer = (p_payload->>'isDealer')::boolean where id = actor.id;
          delete from public.votes where round_id = hand.id and participant_id = actor.id and not hand.revealed;
        else
          member_id := p_payload->>'participantId';
          if member_id is null or member_id = actor.id then raise exception 'Cannot remove creator'; end if;
          delete from public.participants where id = member_id and table_id = target.id and not is_creator;
        end if;
      else
        raise exception 'Unknown action';
      end if;
    end if;
    update public.participants set last_seen_at = clock_timestamp() where id = actor.id;
  end if;
  update public.tables set updated_at = clock_timestamp() where id = target.id;
end $$;

revoke all on function public.consume_admin_login_attempt(text) from public, anon, authenticated;
revoke all on function public.admin_mutate_table(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.create_planning_table(jsonb, text) from public, anon, authenticated;
revoke all on function public.mutate_planning_table(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.consume_admin_login_attempt(text) to service_role;
grant execute on function public.admin_mutate_table(uuid, text, text, text) to service_role;
grant execute on function public.create_planning_table(jsonb, text) to service_role;
grant execute on function public.mutate_planning_table(text, text, text, jsonb) to service_role;

commit;
