-- =====================================================================
-- Memento V1.7 — Milestone 6B: Supabase database foundation
-- =====================================================================
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Scope: tables, constraints, indexes, RLS ENABLED (no policies).
-- Not in scope: RLS policies (6C), auth, invites flow, frontend, data
-- migration, notifications, audit tables.
--
-- Money: numeric(12,2) only. No balance is ever stored; balances are
-- derived from transactions + settlements.
-- Sides: 'user' / 'person' are relative to relationships.created_by
-- (see "Decisions for 6C" in the final report).
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helper: keep updated_at current
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 1. profiles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_display_name_not_blank check (btrim(display_name) <> '')
);


-- ---------------------------------------------------------------------
-- 2. relationships
--    person_name / person_phone describe the OTHER side while they have
--    no account. No fake auth.users / profiles rows are created.
-- ---------------------------------------------------------------------
create table if not exists public.relationships (
  id           uuid primary key default gen_random_uuid(),
  created_by   uuid not null references public.profiles (id),
  person_name  text not null,
  person_phone text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint relationships_person_name_not_blank check (btrim(person_name) <> '')
);


-- ---------------------------------------------------------------------
-- 3. relationship_members  (registered users only; max 2 per relationship)
-- ---------------------------------------------------------------------
create table if not exists public.relationship_members (
  relationship_id uuid not null references public.relationships (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  joined_at       timestamptz not null default now(),
  primary key (relationship_id, user_id)
);

-- Enforce the two-person model: a relationship can never have more than
-- two registered members. (Not a group-expense system.)
create or replace function public.enforce_max_two_members()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Serialise concurrent inserts for the same relationship.
  perform pg_advisory_xact_lock(hashtextextended(new.relationship_id::text, 0));

  if (select count(*)
        from public.relationship_members
       where relationship_id = new.relationship_id) >= 2 then
    raise exception 'A relationship can have at most 2 members'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists relationship_members_max_two on public.relationship_members;
create trigger relationship_members_max_two
  before insert on public.relationship_members
  for each row execute function public.enforce_max_two_members();


-- ---------------------------------------------------------------------
-- 4. transactions
-- ---------------------------------------------------------------------
create table if not exists public.transactions (
  id               uuid primary key default gen_random_uuid(),
  relationship_id  uuid not null references public.relationships (id) on delete cascade,
  payer_side       text not null,
  beneficiary_side text not null,
  amount           numeric(12,2) not null,
  purpose          text,
  created_by       uuid not null references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint transactions_payer_side_check       check (payer_side in ('user', 'person')),
  constraint transactions_beneficiary_side_check check (beneficiary_side in ('user', 'person')),
  constraint transactions_sides_differ_check     check (payer_side <> beneficiary_side),
  constraint transactions_amount_positive_check  check (amount > 0)
);


-- ---------------------------------------------------------------------
-- 5. settlements
--    Independent money-transfer events. No transaction_id, no linking.
-- ---------------------------------------------------------------------
create table if not exists public.settlements (
  id               uuid primary key default gen_random_uuid(),
  relationship_id  uuid not null references public.relationships (id) on delete cascade,
  payer_side       text not null,
  beneficiary_side text not null,
  amount           numeric(12,2) not null,
  method           text not null,
  closes_period    boolean not null default false,
  created_by       uuid not null references public.profiles (id),
  created_at       timestamptz not null default now(),
  constraint settlements_payer_side_check       check (payer_side in ('user', 'person')),
  constraint settlements_beneficiary_side_check check (beneficiary_side in ('user', 'person')),
  constraint settlements_sides_differ_check     check (payer_side <> beneficiary_side),
  constraint settlements_amount_positive_check  check (amount > 0),
  constraint settlements_method_check           check (method in ('cash', 'online'))
);


-- ---------------------------------------------------------------------
-- 6. invites  (only a hash of the token is stored; 7-day default expiry)
-- ---------------------------------------------------------------------
create table if not exists public.invites (
  id              uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.relationships (id) on delete cascade,
  phone           text,
  token_hash      text not null unique,
  expires_at      timestamptz not null default (now() + interval '7 days'),
  accepted_by     uuid references public.profiles (id),
  accepted_at     timestamptz,
  created_by      uuid not null references public.profiles (id),
  created_at      timestamptz not null default now(),
  constraint invites_expiry_after_creation_check check (expires_at > created_at),
  constraint invites_max_7_days_check            check (expires_at <= created_at + interval '7 days'),
  constraint invites_accepted_pair_check         check ((accepted_by is null) = (accepted_at is null))
);


-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists relationships_set_updated_at on public.relationships;
create trigger relationships_set_updated_at
  before update on public.relationships
  for each row execute function public.set_updated_at();

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- Indexes (primary keys and invites.token_hash unique already indexed;
-- relationship_members.relationship_id is covered by the PK prefix but is
-- indexed explicitly as requested)
-- ---------------------------------------------------------------------
create index if not exists transactions_relationship_id_idx
  on public.transactions (relationship_id);
create index if not exists transactions_created_by_idx
  on public.transactions (created_by);

create index if not exists settlements_relationship_id_idx
  on public.settlements (relationship_id);
create index if not exists settlements_created_by_idx
  on public.settlements (created_by);

create index if not exists relationship_members_relationship_id_idx
  on public.relationship_members (relationship_id);
create index if not exists relationship_members_user_id_idx
  on public.relationship_members (user_id);

create index if not exists relationships_created_by_idx
  on public.relationships (created_by);

create index if not exists invites_relationship_id_idx
  on public.invites (relationship_id);
create index if not exists invites_expires_at_idx
  on public.invites (expires_at);


-- ---------------------------------------------------------------------
-- Row Level Security: ENABLED on every table, NO policies.
-- With RLS on and no policies, anon and authenticated roles can read and
-- write nothing. Policies arrive in 6C. (The service role and table owner
-- bypass RLS, as usual in Supabase.)
-- ---------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.relationships        enable row level security;
alter table public.relationship_members enable row level security;
alter table public.transactions         enable row level security;
alter table public.settlements          enable row level security;
alter table public.invites              enable row level security;