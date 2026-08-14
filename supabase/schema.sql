-- Dealer's Choice uses a relational model. Run this in a new Supabase project,
-- then add the values in .env.local to enable hosted persistence and Realtime.

create table if not exists public.tables (
  id text primary key,
  slug text unique not null,
  name text not null,
  creator_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.participants (
  id text primary key,
  table_id text not null references public.tables(id) on delete cascade,
  name text not null,
  team text,
  is_creator boolean not null default false,
  is_dealer boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.rounds (
  id text primary key,
  table_id text not null references public.tables(id) on delete cascade,
  round_number integer not null,
  task text not null default '',
  revealed boolean not null default false,
  created_at timestamptz not null default now(),
  reveal_started_at timestamptz,
  revealed_at timestamptz,
  unique(table_id, round_number)
);

create table if not exists public.votes (
  table_id text not null references public.tables(id) on delete cascade,
  round_id text not null references public.rounds(id) on delete cascade,
  participant_id text not null references public.participants(id) on delete cascade,
  value integer not null check (value in (1, 2, 3, 5, 8, 13, 21)),
  created_at timestamptz not null default now(),
  primary key (round_id, participant_id)
);

create table if not exists public.admin_users (
  username text primary key,
  password text not null
);

insert into public.admin_users (username, password)
values ('admin', 'admin')
on conflict (username) do nothing;

alter table public.tables enable row level security;
alter table public.participants enable row level security;
alter table public.rounds enable row level security;
alter table public.votes enable row level security;

-- A table link is the access credential for the prototype. Mutations go through
-- the server route using the service role; public reads power Realtime clients.
create policy "public can read tables" on public.tables for select using (true);
create policy "public can read participants" on public.participants for select using (true);
create policy "public can read rounds" on public.rounds for select using (true);
create policy "public can read votes" on public.votes for select using (true);

alter publication supabase_realtime add table public.tables;
alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.rounds;
alter publication supabase_realtime add table public.votes;
