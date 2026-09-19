-- =====================================================================
-- Memento V1.7 — Milestone 6C: Row Level Security
-- =====================================================================
-- Run in the Supabase SQL Editor AFTER schema.sql. Safe to re-run:
-- functions are CREATE OR REPLACE, grants are REVOKE-then-GRANT, and each
-- policy is DROP POLICY IF EXISTS + CREATE POLICY. No tables or data are
-- touched. No service-role key is used or stored.
--
-- SECURITY MODEL
--   A user may touch a row only through a relationship they PARTICIPATE in:
--     participant = relationships.created_by  OR  a relationship_members row.
--   (The creator counts even before a member row exists, so a relationship
--   is never orphaned. Creators also insert their own member row.)
--
-- Defence in depth, three layers:
--   1. RLS policies  -> which ROWS a user can touch.
--   2. Column GRANTs -> which COLUMNS a user can write. Ownership and
--      history columns (created_by, relationship_id, created_at, ...) are
--      never writable after insert, and invites.token_hash is never
--      readable by clients.
--   3. anon has NO privileges on any table; RLS is never FORCEd (the
--      SECURITY DEFINER helpers rely on the table owner bypassing RLS).
--
-- Deliberately DENIED to clients (no policy, no grant), pending later work:
--   relationship_members UPDATE/DELETE, and adding any member other than
--   yourself to your own relationship (that is the invite-acceptance flow,
--   which must run as a future SECURITY DEFINER function);
--   settlements UPDATE/DELETE (financial events stay auditable);
--   invites UPDATE/DELETE (acceptance/revocation belong to that same flow);
--   profiles DELETE; relationships DELETE once the relationship is shared.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER, read-only, answer only about the
-- CALLER). Needed because a policy on relationship_members that queries
-- relationship_members would recurse infinitely. Running as the table
-- owner (which bypasses RLS) breaks that loop. Each function:
--   * only returns boolean, and only about auth.uid() -- it cannot be used
--     to read or enumerate anyone else's data;
--   * pins search_path = '' and schema-qualifies everything;
--   * is not executable by PUBLIC or anon.
-- ---------------------------------------------------------------------
create or replace function public.is_relationship_participant(p_relationship_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and (
       exists (select 1 from public.relationships r
                where r.id = p_relationship_id
                  and r.created_by = auth.uid())
       or
       exists (select 1 from public.relationship_members m
                where m.relationship_id = p_relationship_id
                  and m.user_id = auth.uid())
     );
$$;

create or replace function public.shares_relationship_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (
       select 1
         from public.relationship_members mine
         join public.relationship_members theirs
           on theirs.relationship_id = mine.relationship_id
        where mine.user_id   = auth.uid()
          and theirs.user_id = p_user_id
     );
$$;

revoke all on function public.is_relationship_participant(uuid) from public, anon;
revoke all on function public.shares_relationship_with(uuid)    from public, anon;
grant execute on function public.is_relationship_participant(uuid) to authenticated;
grant execute on function public.shares_relationship_with(uuid)    to authenticated;


-- ---------------------------------------------------------------------
-- Table privileges. Start from nothing, then grant exactly what the
-- policies below can use. (service_role is unaffected.)
-- REVOKE on a table also clears any column-level grants, so this is
-- re-runnable.
-- ---------------------------------------------------------------------
revoke all on table
  public.profiles, public.relationships, public.relationship_members,
  public.transactions, public.settlements, public.invites
from anon, authenticated;

-- profiles: read; create own; rename own. id is never updatable.
grant select                     on public.profiles to authenticated;
grant insert (id, display_name)  on public.profiles to authenticated;
grant update (display_name)      on public.profiles to authenticated;

-- relationships: only the label of the other person is editable.
grant select                                                on public.relationships to authenticated;
grant insert (id, created_by, person_name, person_phone)    on public.relationships to authenticated;
grant update (person_name, person_phone)                    on public.relationships to authenticated;
grant delete                                                on public.relationships to authenticated;

-- relationship_members: read; creator adds self. Nothing else.
grant select                              on public.relationship_members to authenticated;
grant insert (relationship_id, user_id)   on public.relationship_members to authenticated;

-- transactions: relationship_id / created_by / created_at are immutable.
grant select on public.transactions to authenticated;
grant insert (id, relationship_id, payer_side, beneficiary_side, amount, purpose, created_by)
  on public.transactions to authenticated;
grant update (payer_side, beneficiary_side, amount, purpose)
  on public.transactions to authenticated;
grant delete on public.transactions to authenticated;

-- settlements: append-only.
grant select on public.settlements to authenticated;
grant insert (id, relationship_id, payer_side, beneficiary_side, amount, method, closes_period, created_by)
  on public.settlements to authenticated;

-- invites: token_hash can be written once but never read back by clients.
grant select (id, relationship_id, phone, expires_at, accepted_by, accepted_at, created_by, created_at)
  on public.invites to authenticated;
grant insert (id, relationship_id, phone, token_hash, expires_at, created_by)
  on public.invites to authenticated;


-- ---------------------------------------------------------------------
-- RLS stays enabled (idempotent re-assertion; never FORCEd).
-- ---------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.relationships        enable row level security;
alter table public.relationship_members enable row level security;
alter table public.transactions         enable row level security;
alter table public.settlements          enable row level security;
alter table public.invites              enable row level security;


-- ---------------------------------------------------------------------
-- Policy naming: <table>_<command>_<who/what>. All are PERMISSIVE and
-- TO authenticated. There is no policy for anon and no FOR ALL policy.
-- ---------------------------------------------------------------------

-- ============ profiles ============
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- The other registered member of a shared relationship may see this
-- profile (display_name is what connected users see). Nobody else.
drop policy if exists profiles_select_relationship_peer on public.profiles;
create policy profiles_select_relationship_peer on public.profiles
  for select to authenticated
  using (public.shares_relationship_with(id));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using      (id = (select auth.uid()))
  with check (id = (select auth.uid()));


-- ============ relationships ============
drop policy if exists relationships_select_participant on public.relationships;
create policy relationships_select_participant on public.relationships
  for select to authenticated
  using (public.is_relationship_participant(id));

drop policy if exists relationships_insert_creator on public.relationships;
create policy relationships_insert_creator on public.relationships
  for insert to authenticated
  with check (created_by = (select auth.uid()));

drop policy if exists relationships_update_participant on public.relationships;
create policy relationships_update_participant on public.relationships
  for update to authenticated
  using      (public.is_relationship_participant(id))
  with check (public.is_relationship_participant(id));

-- Only the creator, and only while no OTHER registered user has joined.
-- Once a relationship is shared, clients cannot delete shared history.
drop policy if exists relationships_delete_creator_unshared on public.relationships;
create policy relationships_delete_creator_unshared on public.relationships
  for delete to authenticated
  using (
    created_by = (select auth.uid())
    and not exists (
      select 1 from public.relationship_members m
       where m.relationship_id = relationships.id
         and m.user_id <> (select auth.uid())
    )
  );


-- ============ relationship_members ============
drop policy if exists relationship_members_select_participant on public.relationship_members;
create policy relationship_members_select_participant on public.relationship_members
  for select to authenticated
  using (public.is_relationship_participant(relationship_id));

-- A creator may add THEMSELVES to a relationship they created. Nobody can
-- add anyone else, or themselves to someone else's relationship: joining
-- an existing relationship is the invite flow, not an INSERT by a client.
drop policy if exists relationship_members_insert_creator_self on public.relationship_members;
create policy relationship_members_insert_creator_self on public.relationship_members
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.relationships r
       where r.id = relationship_members.relationship_id
         and r.created_by = (select auth.uid())
    )
  );


-- ============ transactions ============
drop policy if exists transactions_select_participant on public.transactions;
create policy transactions_select_participant on public.transactions
  for select to authenticated
  using (public.is_relationship_participant(relationship_id));

drop policy if exists transactions_insert_participant on public.transactions;
create policy transactions_insert_participant on public.transactions
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_relationship_participant(relationship_id)
  );

drop policy if exists transactions_update_participant on public.transactions;
create policy transactions_update_participant on public.transactions
  for update to authenticated
  using      (public.is_relationship_participant(relationship_id))
  with check (public.is_relationship_participant(relationship_id));

drop policy if exists transactions_delete_participant on public.transactions;
create policy transactions_delete_participant on public.transactions
  for delete to authenticated
  using (public.is_relationship_participant(relationship_id));


-- ============ settlements (append-only) ============
drop policy if exists settlements_select_participant on public.settlements;
create policy settlements_select_participant on public.settlements
  for select to authenticated
  using (public.is_relationship_participant(relationship_id));

drop policy if exists settlements_insert_participant on public.settlements;
create policy settlements_insert_participant on public.settlements
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_relationship_participant(relationship_id)
  );


-- ============ invites ============
drop policy if exists invites_select_participant on public.invites;
create policy invites_select_participant on public.invites
  for select to authenticated
  using (public.is_relationship_participant(relationship_id));

-- A participant may create an unaccepted invite for their own
-- relationship, as themselves. Acceptance is a future definer function.
drop policy if exists invites_insert_participant on public.invites;
create policy invites_insert_participant on public.invites
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and accepted_by is null
    and accepted_at is null
    and public.is_relationship_participant(relationship_id)
  );