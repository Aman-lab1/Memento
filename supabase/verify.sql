-- =====================================================================
-- Memento V1.7 — Milestone 6B verification (read-only)
-- =====================================================================
-- Run AFTER schema.sql in the Supabase SQL Editor.
-- Inserts nothing, changes nothing: it only reads the system catalogs.
--
-- Result: one row per check. Every row must show passed = true.
-- The FIRST row is a summary: failed_checks must be 0.
-- =====================================================================

with
tbl(name) as (
  values ('profiles'), ('relationships'), ('relationship_members'),
         ('transactions'), ('settlements'), ('invites')
),
-- (table, column, expected data_type, expected is_nullable)
col(t, c, dt, nullable) as (
  values
  ('profiles','id','uuid','NO'),
  ('profiles','display_name','text','NO'),
  ('profiles','created_at','timestamp with time zone','NO'),
  ('profiles','updated_at','timestamp with time zone','NO'),

  ('relationships','id','uuid','NO'),
  ('relationships','created_by','uuid','NO'),
  ('relationships','person_name','text','NO'),
  ('relationships','person_phone','text','YES'),
  ('relationships','created_at','timestamp with time zone','NO'),
  ('relationships','updated_at','timestamp with time zone','NO'),

  ('relationship_members','relationship_id','uuid','NO'),
  ('relationship_members','user_id','uuid','NO'),
  ('relationship_members','joined_at','timestamp with time zone','NO'),

  ('transactions','id','uuid','NO'),
  ('transactions','relationship_id','uuid','NO'),
  ('transactions','payer_side','text','NO'),
  ('transactions','beneficiary_side','text','NO'),
  ('transactions','amount','numeric','NO'),
  ('transactions','purpose','text','YES'),
  ('transactions','created_by','uuid','NO'),
  ('transactions','created_at','timestamp with time zone','NO'),
  ('transactions','updated_at','timestamp with time zone','NO'),

  ('settlements','id','uuid','NO'),
  ('settlements','relationship_id','uuid','NO'),
  ('settlements','payer_side','text','NO'),
  ('settlements','beneficiary_side','text','NO'),
  ('settlements','amount','numeric','NO'),
  ('settlements','method','text','NO'),
  ('settlements','closes_period','boolean','NO'),
  ('settlements','created_by','uuid','NO'),
  ('settlements','created_at','timestamp with time zone','NO'),

  ('invites','id','uuid','NO'),
  ('invites','relationship_id','uuid','NO'),
  ('invites','phone','text','YES'),
  ('invites','token_hash','text','NO'),
  ('invites','expires_at','timestamp with time zone','NO'),
  ('invites','accepted_by','uuid','YES'),
  ('invites','accepted_at','timestamp with time zone','YES'),
  ('invites','created_by','uuid','NO'),
  ('invites','created_at','timestamp with time zone','NO')
),
-- (table, expected primary-key column list, in order)
pk(t, cols) as (
  values
  ('profiles','id'), ('relationships','id'),
  ('relationship_members','relationship_id,user_id'),
  ('transactions','id'), ('settlements','id'), ('invites','id')
),
-- (table, column, referenced table, referenced column)
fk(t, c, rt, rc) as (
  values
  ('profiles','id','auth.users','id'),
  ('relationships','created_by','public.profiles','id'),
  ('relationship_members','relationship_id','public.relationships','id'),
  ('relationship_members','user_id','public.profiles','id'),
  ('transactions','relationship_id','public.relationships','id'),
  ('transactions','created_by','public.profiles','id'),
  ('settlements','relationship_id','public.relationships','id'),
  ('settlements','created_by','public.profiles','id'),
  ('invites','relationship_id','public.relationships','id'),
  ('invites','accepted_by','public.profiles','id'),
  ('invites','created_by','public.profiles','id')
),
-- (table, constraint name)
chk(t, name) as (
  values
  ('transactions','transactions_payer_side_check'),
  ('transactions','transactions_beneficiary_side_check'),
  ('transactions','transactions_sides_differ_check'),
  ('transactions','transactions_amount_positive_check'),
  ('settlements','settlements_payer_side_check'),
  ('settlements','settlements_beneficiary_side_check'),
  ('settlements','settlements_sides_differ_check'),
  ('settlements','settlements_amount_positive_check'),
  ('settlements','settlements_method_check'),
  ('invites','invites_expiry_after_creation_check'),
  ('invites','invites_max_7_days_check'),
  ('invites','invites_accepted_pair_check')
),
idx(name) as (
  values
  ('transactions_relationship_id_idx'), ('transactions_created_by_idx'),
  ('settlements_relationship_id_idx'),  ('settlements_created_by_idx'),
  ('relationship_members_relationship_id_idx'),
  ('relationship_members_user_id_idx'),
  ('relationships_created_by_idx'),
  ('invites_relationship_id_idx'), ('invites_expires_at_idx')
),

checks as (

  -- tables exist
  select 'table exists: ' || t.name as check_name,
         to_regclass('public.' || t.name) is not null as passed
    from tbl t

  union all
  -- columns: exist, right type, right nullability
  select 'column: ' || c.t || '.' || c.c || ' (' || c.dt || ', nullable=' || c.nullable || ')',
         exists (
           select 1 from information_schema.columns ic
            where ic.table_schema = 'public' and ic.table_name = c.t
              and ic.column_name = c.c and ic.data_type = c.dt
              and ic.is_nullable = c.nullable)
    from col c

  union all
  -- money columns are numeric(12,2)
  select 'money numeric(12,2): ' || m.t || '.amount',
         exists (
           select 1 from information_schema.columns ic
            where ic.table_schema = 'public' and ic.table_name = m.t
              and ic.column_name = 'amount' and ic.data_type = 'numeric'
              and ic.numeric_precision = 12 and ic.numeric_scale = 2)
    from (values ('transactions'), ('settlements')) as m(t)

  union all
  -- no float types anywhere in the six tables
  select 'no float/real/money columns in application tables',
         not exists (
           select 1 from information_schema.columns ic
            where ic.table_schema = 'public'
              and ic.table_name in (select name from tbl)
              and ic.data_type in ('real', 'double precision', 'money'))

  union all
  -- no stored balance columns
  select 'no stored balance column',
         not exists (
           select 1 from information_schema.columns ic
            where ic.table_schema = 'public'
              and ic.table_name in (select name from tbl)
              and ic.column_name ilike '%balance%')

  union all
  -- settlements are not linked to transactions
  select 'settlements has no transaction_id',
         not exists (
           select 1 from information_schema.columns ic
            where ic.table_schema = 'public' and ic.table_name = 'settlements'
              and ic.column_name = 'transaction_id')

  union all
  -- primary keys (exact columns, in order)
  select 'primary key: ' || p.t || '(' || p.cols || ')',
         coalesce((
           select string_agg(a.attname, ',' order by k.ord)
             from pg_constraint con
             cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
             join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
            where con.contype = 'p'
              and con.conrelid = to_regclass('public.' || p.t)
         ), '') = p.cols
    from pk p

  union all
  -- foreign keys
  select 'foreign key: ' || f.t || '.' || f.c || ' -> ' || f.rt || '.' || f.rc,
         exists (
           select 1
             from pg_constraint con
             join pg_attribute a  on a.attrelid  = con.conrelid  and a.attnum  = con.conkey[1]
             join pg_attribute ra on ra.attrelid = con.confrelid and ra.attnum = con.confkey[1]
            where con.contype = 'f'
              and array_length(con.conkey, 1) = 1
              and con.conrelid  = (case when f.t = 'auth.users' then 'auth.users' else 'public.' || f.t end)::regclass
              and con.confrelid = f.rt::regclass
              and a.attname = f.c and ra.attname = f.rc)
    from fk f

  union all
  -- cascade behaviour on the important foreign keys
  select 'on delete cascade: ' || d.t || '.' || d.c,
         exists (
           select 1
             from pg_constraint con
             join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
            where con.contype = 'f' and con.confdeltype = 'c'
              and con.conrelid = ('public.' || d.t)::regclass
              and a.attname = d.c)
    from (values
      ('profiles','id'),
      ('relationship_members','relationship_id'),
      ('relationship_members','user_id'),
      ('transactions','relationship_id'),
      ('settlements','relationship_id'),
      ('invites','relationship_id')) as d(t, c)

  union all
  -- created_by / accepted_by must NOT cascade (history must survive)
  select 'no cascade (history preserved): ' || d.t || '.' || d.c,
         exists (
           select 1
             from pg_constraint con
             join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
            where con.contype = 'f' and con.confdeltype <> 'c'
              and con.conrelid = ('public.' || d.t)::regclass
              and a.attname = d.c)
    from (values
      ('relationships','created_by'),
      ('transactions','created_by'),
      ('settlements','created_by'),
      ('invites','created_by'),
      ('invites','accepted_by')) as d(t, c)

  union all
  -- CHECK constraints exist
  select 'check constraint: ' || k.t || '.' || k.name,
         exists (
           select 1 from pg_constraint con
            where con.contype = 'c' and con.conname = k.name
              and con.conrelid = ('public.' || k.t)::regclass)
    from chk k

  union all
  -- CHECK definitions contain the expected logic
  select 'check definition: ' || x.name,
         exists (
           select 1 from pg_constraint con
            where con.conname = x.name and con.contype = 'c'
              and pg_get_constraintdef(con.oid) ilike x.pattern)
    from (values
      ('transactions_payer_side_check',       '%user%person%'),
      ('transactions_beneficiary_side_check', '%user%person%'),
      ('transactions_sides_differ_check',     '%payer_side%<>%beneficiary_side%'),
      ('transactions_amount_positive_check',  '%amount%>%0%'),
      ('settlements_payer_side_check',        '%user%person%'),
      ('settlements_beneficiary_side_check',  '%user%person%'),
      ('settlements_sides_differ_check',      '%payer_side%<>%beneficiary_side%'),
      ('settlements_amount_positive_check',   '%amount%>%0%'),
      ('settlements_method_check',            '%cash%online%')
    ) as x(name, pattern)

  union all
  -- invites.token_hash unique
  select 'unique: invites.token_hash',
         exists (
           select 1
             from pg_constraint con
             join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
            where con.contype = 'u' and array_length(con.conkey, 1) = 1
              and con.conrelid = 'public.invites'::regclass
              and a.attname = 'token_hash')

  union all
  -- invites has no plaintext token column
  select 'invites stores no plaintext token column',
         not exists (
           select 1 from information_schema.columns ic
            where ic.table_schema = 'public' and ic.table_name = 'invites'
              and ic.column_name in ('token', 'invite_token', 'plaintext_token'))

  union all
  -- two-member trigger installed
  select 'trigger: relationship_members_max_two',
         exists (
           select 1 from pg_trigger tg
            where tg.tgrelid = 'public.relationship_members'::regclass
              and tg.tgname = 'relationship_members_max_two'
              and not tg.tgisinternal)

  union all
  -- indexes
  select 'index: ' || i.name,
         exists (
           select 1 from pg_indexes pi
            where pi.schemaname = 'public' and pi.indexname = i.name)
    from idx i

  union all
  -- RLS enabled on every table
  select 'RLS enabled: ' || t.name,
         coalesce((select c.relrowsecurity from pg_class c
                    where c.oid = to_regclass('public.' || t.name)), false)
    from tbl t

  union all
  -- 6B must leave NO policies in place
  select 'no RLS policies yet (6C) on: ' || t.name,
         not exists (
           select 1 from pg_policies pp
            where pp.schemaname = 'public' and pp.tablename = t.name)
    from tbl t
)

select check_name, passed
  from (
    select 0 as sort_key, 'SUMMARY: ' || count(*) filter (where not passed) || ' failed of ' || count(*) as check_name,
           count(*) filter (where not passed) = 0 as passed
      from checks
    union all
    select 1, check_name, passed from checks
  ) r
 order by sort_key, passed, check_name;