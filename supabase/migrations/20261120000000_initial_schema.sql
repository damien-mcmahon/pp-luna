-- Baseline for the original Fibonacci-only relational schema.
-- All setup now runs through `npm run db:migrate`; do not apply this separately.
-- No prototype admin credentials or public read policies are seeded.

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

alter table public.tables enable row level security;
alter table public.participants enable row level security;
alter table public.rounds enable row level security;
alter table public.votes enable row level security;

-- The subsequent security migration installs service-role-only actions and Auth membership.
