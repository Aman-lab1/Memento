-- =====================================================================
-- Memento V1.7 — 6C behavioural RLS test (OPTIONAL, self-cleaning)
-- =====================================================================
-- Run in the Supabase SQL Editor AFTER schema.sql and rls.sql.
--
-- What it does: creates 3 throw-away users (A, B, C) and a few
-- relationships INSIDE ONE TRANSACTION, then impersonates them
-- (role authenticated / anon + a fake auth.uid()) and checks what RLS
-- allows and blocks. At the very end it RAISES AN EXCEPTION ON PURPOSE,
-- which rolls back everything, so no data survives.
--
-- HOW TO READ THE RESULT: the editor will show a red error. That is
-- expected. The message starts with "6C RLS TEST (rolled back):" and lists
-- every scenario as PASS or FAIL, e.g.
--     6C RLS TEST (rolled back): 61 passed, 0 failed
-- Any other error text means the test itself could not run.
-- =====================================================================

do $test$
declare
  c        record;
  n        bigint;
  ok       boolean;
  detail   text;
  lines    text[] := '{}';
  passed   int := 0;
  failed   int := 0;
begin
  -- ---------- setup, as the table owner (bypasses RLS) ----------
  insert into auth.users (id) values
    ('a0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000002'),
    ('c0000000-0000-0000-0000-000000000003');
  insert into public.profiles (id, display_name) values
    ('a0000000-0000-0000-0000-000000000001', 'Test A'),
    ('b0000000-0000-0000-0000-000000000002', 'Test B'),
    ('c0000000-0000-0000-0000-000000000003', 'Test C');

  -- R2: shared A<->B (as if the future invite flow already ran)
  insert into public.relationships (id, created_by, person_name) values
    ('22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000001', 'B');
  insert into public.relationship_members (relationship_id, user_id) values
    ('22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000001'),
    ('22222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-000000000002');

  -- R3: C's private relationship, with a transaction, settlement, invite
  insert into public.relationships (id, created_by, person_name) values
    ('33333333-3333-3333-3333-333333333333', 'c0000000-0000-0000-0000-000000000003', 'Z');
  insert into public.relationship_members (relationship_id, user_id) values
    ('33333333-3333-3333-3333-333333333333', 'c0000000-0000-0000-0000-000000000003');
  insert into public.transactions (id, relationship_id, payer_side, beneficiary_side, amount, purpose, created_by) values
    ('cccccccc-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'user', 'person', 100, 'secret', 'c0000000-0000-0000-0000-000000000003');
  insert into public.settlements (id, relationship_id, payer_side, beneficiary_side, amount, method, created_by) values
    ('cccccccc-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'person', 'user', 50, 'cash', 'c0000000-0000-0000-0000-000000000003');
  insert into public.invites (id, relationship_id, token_hash, created_by) values
    ('eeeeeeee-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'hash-of-c', 'c0000000-0000-0000-0000-000000000003');

  -- ---------- scenarios: (order, name, actor, expectation, statement) ----------
  -- actor: A | B | C | none (authenticated, no uid) | anon | owner (no role switch)
  -- expect: allow (>=1 row) | deny (error OR 0 rows) | error (must raise) | count:N
  for c in
    select * from (values
    -- ===== relationships =====
    (10,'A creates own relationship R1','A','allow',$s$insert into public.relationships (id, created_by, person_name, person_phone) values ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','Jai','999')$s$),
    (11,'A cannot create a relationship as B','A','deny',$s$insert into public.relationships (created_by, person_name) values ('b0000000-0000-0000-0000-000000000002','x')$s$),
    (12,'A cannot forge relationships.created_at','A','deny',$s$insert into public.relationships (created_by, person_name, created_at) values ('a0000000-0000-0000-0000-000000000001','x','2001-01-01')$s$),
    (13,'A sees R1 (creator, no member row yet)','A','count:1',$s$select count(*) from public.relationships where id='11111111-1111-1111-1111-111111111111'$s$),
    (14,'C cannot see R1','C','count:0',$s$select count(*) from public.relationships where id='11111111-1111-1111-1111-111111111111'$s$),
    (15,'C cannot see R2 (shared A/B)','C','count:0',$s$select count(*) from public.relationships where id='22222222-2222-2222-2222-222222222222'$s$),
    (16,'B (member, not creator) sees R2','B','count:1',$s$select count(*) from public.relationships where id='22222222-2222-2222-2222-222222222222'$s$),
    (17,'A can edit person_name on R1','A','allow',$s$update public.relationships set person_name='Jai K' where id='11111111-1111-1111-1111-111111111111'$s$),
    (18,'C cannot edit R1','C','deny',$s$update public.relationships set person_name='hacked' where id='11111111-1111-1111-1111-111111111111'$s$),
    (19,'A cannot reassign relationships.created_by','A','deny',$s$update public.relationships set created_by='b0000000-0000-0000-0000-000000000002' where id='11111111-1111-1111-1111-111111111111'$s$),
    (20,'C cannot delete R1','C','deny',$s$delete from public.relationships where id='11111111-1111-1111-1111-111111111111'$s$),
    (21,'B (non-creator member) cannot delete shared R2','B','deny',$s$delete from public.relationships where id='22222222-2222-2222-2222-222222222222'$s$),
    (22,'A (creator) cannot delete SHARED R2','A','deny',$s$delete from public.relationships where id='22222222-2222-2222-2222-222222222222'$s$),
    -- ===== relationship_members =====
    (30,'A adds self to own R1','A','allow',$s$insert into public.relationship_members (relationship_id, user_id) values ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001')$s$),
    (31,'A cannot add B to R1 (invite-flow bypass)','A','deny',$s$insert into public.relationship_members (relationship_id, user_id) values ('11111111-1111-1111-1111-111111111111','b0000000-0000-0000-0000-000000000002')$s$),
    (32,'C cannot add self to A''s R1','C','deny',$s$insert into public.relationship_members (relationship_id, user_id) values ('11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000003')$s$),
    (33,'A cannot add self to C''s R3','A','deny',$s$insert into public.relationship_members (relationship_id, user_id) values ('33333333-3333-3333-3333-333333333333','a0000000-0000-0000-0000-000000000001')$s$),
    (34,'A sees both members of R2','A','count:2',$s$select count(*) from public.relationship_members where relationship_id='22222222-2222-2222-2222-222222222222'$s$),
    (35,'C sees no members of R2','C','count:0',$s$select count(*) from public.relationship_members where relationship_id='22222222-2222-2222-2222-222222222222'$s$),
    (36,'A cannot update a membership row','A','deny',$s$update public.relationship_members set joined_at=now() where relationship_id='22222222-2222-2222-2222-222222222222'$s$),
    (37,'A cannot delete a membership row','A','deny',$s$delete from public.relationship_members where relationship_id='22222222-2222-2222-2222-222222222222'$s$),
    -- ===== transactions =====
    (40,'A adds a transaction to own R1','A','allow',$s$insert into public.transactions (id, relationship_id, payer_side, beneficiary_side, amount, purpose, created_by) values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','user','person',500,'Dinner','a0000000-0000-0000-0000-000000000001')$s$),
    (41,'A cannot add a transaction to C''s R3','A','deny',$s$insert into public.transactions (relationship_id, payer_side, beneficiary_side, amount, purpose, created_by) values ('33333333-3333-3333-3333-333333333333','user','person',1,'x','a0000000-0000-0000-0000-000000000001')$s$),
    (42,'A cannot add a transaction as B (created_by forged)','A','deny',$s$insert into public.transactions (relationship_id, payer_side, beneficiary_side, amount, purpose, created_by) values ('11111111-1111-1111-1111-111111111111','user','person',1,'x','b0000000-0000-0000-0000-000000000002')$s$),
    (43,'A cannot forge transactions.created_at','A','deny',$s$insert into public.transactions (relationship_id, payer_side, beneficiary_side, amount, created_by, created_at) values ('11111111-1111-1111-1111-111111111111','user','person',1,'a0000000-0000-0000-0000-000000000001','2001-01-01')$s$),
    (44,'6B constraint still bites: payer = beneficiary','A','error',$s$insert into public.transactions (relationship_id, payer_side, beneficiary_side, amount, created_by) values ('11111111-1111-1111-1111-111111111111','user','user',5,'a0000000-0000-0000-0000-000000000001')$s$),
    (45,'C cannot see R1 transactions','C','count:0',$s$select count(*) from public.transactions where relationship_id='11111111-1111-1111-1111-111111111111'$s$),
    (46,'A cannot see C''s R3 transactions','A','count:0',$s$select count(*) from public.transactions where relationship_id='33333333-3333-3333-3333-333333333333'$s$),
    (47,'C sees own R3 transaction','C','count:1',$s$select count(*) from public.transactions where relationship_id='33333333-3333-3333-3333-333333333333'$s$),
    (48,'A adds a transaction to shared R2','A','allow',$s$insert into public.transactions (id, relationship_id, payer_side, beneficiary_side, amount, purpose, created_by) values ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','user','person',200,'Taxi','a0000000-0000-0000-0000-000000000001')$s$),
    (49,'B (other member) sees A''s R2 transaction','B','count:1',$s$select count(*) from public.transactions where relationship_id='22222222-2222-2222-2222-222222222222'$s$),
    (50,'B adds a transaction to shared R2','B','allow',$s$insert into public.transactions (relationship_id, payer_side, beneficiary_side, amount, purpose, created_by) values ('22222222-2222-2222-2222-222222222222','person','user',75,'Lunch','b0000000-0000-0000-0000-000000000002')$s$),
    (51,'B can edit amount on R2 transaction','B','allow',$s$update public.transactions set amount=250 where id='aaaaaaaa-0000-0000-0000-000000000002'$s$),
    (52,'C cannot edit R1 transaction','C','deny',$s$update public.transactions set amount=1 where id='aaaaaaaa-0000-0000-0000-000000000001'$s$),
    (53,'A cannot transfer transaction ownership (created_by)','A','deny',$s$update public.transactions set created_by='b0000000-0000-0000-0000-000000000002' where id='aaaaaaaa-0000-0000-0000-000000000001'$s$),
    (54,'A cannot move a transaction to another relationship','A','deny',$s$update public.transactions set relationship_id='22222222-2222-2222-2222-222222222222' where id='aaaaaaaa-0000-0000-0000-000000000001'$s$),
    (55,'A cannot delete C''s transaction','A','deny',$s$delete from public.transactions where id='cccccccc-0000-0000-0000-000000000001'$s$),
    -- ===== settlements =====
    (60,'A adds a settlement to own R1','A','allow',$s$insert into public.settlements (id, relationship_id, payer_side, beneficiary_side, amount, method, closes_period, created_by) values ('dddddddd-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','person','user',100,'cash',false,'a0000000-0000-0000-0000-000000000001')$s$),
    (61,'C cannot add a settlement to R1','C','deny',$s$insert into public.settlements (relationship_id, payer_side, beneficiary_side, amount, method, created_by) values ('11111111-1111-1111-1111-111111111111','person','user',1,'cash','c0000000-0000-0000-0000-000000000003')$s$),
    (62,'A cannot add a settlement as B','A','deny',$s$insert into public.settlements (relationship_id, payer_side, beneficiary_side, amount, method, created_by) values ('11111111-1111-1111-1111-111111111111','person','user',1,'cash','b0000000-0000-0000-0000-000000000002')$s$),
    (63,'C cannot see R1 settlements','C','count:0',$s$select count(*) from public.settlements where relationship_id='11111111-1111-1111-1111-111111111111'$s$),
    (64,'A cannot see C''s R3 settlements','A','count:0',$s$select count(*) from public.settlements where relationship_id='33333333-3333-3333-3333-333333333333'$s$),
    (65,'A cannot UPDATE own settlement','A','deny',$s$update public.settlements set amount=1 where id='dddddddd-0000-0000-0000-000000000001'$s$),
    (66,'A cannot DELETE own settlement','A','deny',$s$delete from public.settlements where id='dddddddd-0000-0000-0000-000000000001'$s$),
    -- ===== invites =====
    (70,'A creates an invite for own R1','A','allow',$s$insert into public.invites (id, relationship_id, phone, token_hash, created_by) values ('eeeeeeee-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','999','hash-of-a','a0000000-0000-0000-0000-000000000001')$s$),
    (71,'A cannot create an invite for C''s R3','A','deny',$s$insert into public.invites (relationship_id, token_hash, created_by) values ('33333333-3333-3333-3333-333333333333','h-evil','a0000000-0000-0000-0000-000000000001')$s$),
    (72,'A cannot create an invite as B','A','deny',$s$insert into public.invites (relationship_id, token_hash, created_by) values ('11111111-1111-1111-1111-111111111111','h-forged','b0000000-0000-0000-0000-000000000002')$s$),
    (73,'A cannot pre-accept an invite on insert','A','deny',$s$insert into public.invites (relationship_id, token_hash, created_by, accepted_by, accepted_at) values ('11111111-1111-1111-1111-111111111111','h-pre','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',now())$s$),
    (74,'A sees own R1 invite (safe columns)','A','count:1',$s$select count(*) from public.invites where relationship_id='11111111-1111-1111-1111-111111111111'$s$),
    (75,'A cannot read invites.token_hash','A','error',$s$select token_hash from public.invites where id='eeeeeeee-0000-0000-0000-000000000001'$s$),
    (76,'C cannot see A''s invite','C','count:0',$s$select count(*) from public.invites where relationship_id='11111111-1111-1111-1111-111111111111'$s$),
    (77,'A cannot see C''s invite','A','count:0',$s$select count(*) from public.invites where relationship_id='33333333-3333-3333-3333-333333333333'$s$),
    (78,'A cannot UPDATE an invite (accept/extend)','A','deny',$s$update public.invites set accepted_by='a0000000-0000-0000-0000-000000000001', accepted_at=now() where id='eeeeeeee-0000-0000-0000-000000000001'$s$),
    (79,'A cannot DELETE an invite','A','deny',$s$delete from public.invites where id='eeeeeeee-0000-0000-0000-000000000001'$s$),
    -- ===== profiles =====
    (80,'A sees own profile + peer B, not outsider C (2 rows)','A','count:2',$s$select count(*) from public.profiles$s$),
    (81,'C sees only own profile (1 row)','C','count:1',$s$select count(*) from public.profiles$s$),
    (82,'C cannot read A''s profile','C','count:0',$s$select count(*) from public.profiles where id='a0000000-0000-0000-0000-000000000001'$s$),
    (83,'A can rename own profile','A','allow',$s$update public.profiles set display_name='A renamed' where id='a0000000-0000-0000-0000-000000000001'$s$),
    (84,'A cannot rename B''s profile','A','deny',$s$update public.profiles set display_name='pwned' where id='b0000000-0000-0000-0000-000000000002'$s$),
    (85,'A cannot change own profile id','A','deny',$s$update public.profiles set id='c0000000-0000-0000-0000-0000000000ff' where id='a0000000-0000-0000-0000-000000000001'$s$),
    (86,'A cannot insert a profile for someone else','A','deny',$s$insert into public.profiles (id, display_name) values ('c0000000-0000-0000-0000-000000000003','dup')$s$),
    (87,'A cannot delete a profile','A','deny',$s$delete from public.profiles where id='a0000000-0000-0000-0000-000000000001'$s$),
    -- ===== unauthenticated / anon =====
    (90,'anon cannot read transactions','anon','error',$s$select count(*) from public.transactions$s$),
    (91,'anon cannot read profiles','anon','error',$s$select count(*) from public.profiles$s$),
    (92,'anon cannot insert relationships','anon','error',$s$insert into public.relationships (created_by, person_name) values ('a0000000-0000-0000-0000-000000000001','x')$s$),
    (93,'authenticated with no uid sees 0 transactions','none','count:0',$s$select count(*) from public.transactions$s$),
    -- ===== deletion semantics + cascade =====
    (95,'C cannot delete A''s unshared R1','C','deny',$s$delete from public.relationships where id='11111111-1111-1111-1111-111111111111'$s$),
    (96,'A (creator) deletes own UNSHARED R1','A','allow',$s$delete from public.relationships where id='11111111-1111-1111-1111-111111111111'$s$),
    (97,'...its transactions/settlements/invites/members cascaded away','owner','count:0',$s$select (select count(*) from public.transactions where relationship_id='11111111-1111-1111-1111-111111111111') + (select count(*) from public.settlements where relationship_id='11111111-1111-1111-1111-111111111111') + (select count(*) from public.invites where relationship_id='11111111-1111-1111-1111-111111111111') + (select count(*) from public.relationship_members where relationship_id='11111111-1111-1111-1111-111111111111')$s$),
    (98,'shared R2 history survived every attack above','owner','count:2',$s$select count(*) from public.transactions where relationship_id='22222222-2222-2222-2222-222222222222'$s$)
    ) as v(ord, name, actor, expect, stmt)
    order by ord
  loop
    ok := false; detail := '';
    begin
      if c.actor = 'anon' then
        execute 'set local role anon';
      elsif c.actor <> 'owner' then
        execute 'set local role authenticated';
        perform set_config('request.jwt.claim.sub',
          case c.actor
            when 'A' then 'a0000000-0000-0000-0000-000000000001'
            when 'B' then 'b0000000-0000-0000-0000-000000000002'
            when 'C' then 'c0000000-0000-0000-0000-000000000003'
            else '' end, true);
        perform set_config('request.jwt.claims', '', true);
      end if;

      if c.expect like 'count:%' then
        execute c.stmt into n;
        ok := (n = substr(c.expect, 7)::bigint);
        detail := 'got ' || coalesce(n::text, 'null');
      elsif c.expect = 'error' then
        execute c.stmt;
        ok := false; detail := 'statement unexpectedly succeeded';
      else
        execute c.stmt;
        get diagnostics n = row_count;
        if c.expect = 'allow' then ok := (n >= 1); detail := n || ' row(s)';
        else ok := (n = 0); detail := 'succeeded with ' || n || ' row(s)'; end if;
      end if;
    exception when others then
      if c.expect in ('deny', 'error') then ok := true; detail := 'blocked: ' || sqlerrm;
      else ok := false; detail := 'ERROR: ' || sqlerrm; end if;
    end;
    execute 'reset role';

    if ok then passed := passed + 1; else failed := failed + 1; end if;
    lines := lines || (case when ok then 'PASS ' else 'FAIL ' end || c.ord || ' ' || c.name
                       || case when ok then '' else '  -> ' || detail end);
  end loop;

  raise exception E'6C RLS TEST (rolled back): % passed, % failed\n%',
    passed, failed, array_to_string(lines, E'\n');
end
$test$;