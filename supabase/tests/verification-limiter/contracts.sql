-- AUTHOR ONLY; psql ON_ERROR_STOP required. All fixtures rolled back.
\set ON_ERROR_STOP on
begin isolation level read committed;
set local statement_timeout = '10s';
\ir fixtures.sql
-- Disposable fixture override; outer ROLLBACK restores the 30-second seed.
update verification_private.configuration set lease_seconds = 86400;
DO $$
declare r jsonb; s jsonb; n integer;
begin
 r := pg_temp.admit(1);
 perform pg_temp.assert_true(r->>'status' = 'admitted', 'first admission');
 perform pg_temp.assert_true(pg_temp.admit(1)->>'status' = 'replay', 'duplicate request');
 perform pg_temp.assert_true(pg_temp.admit(1,2)->>'status' = 'ownership-denied', 'cross admin replay');
 perform pg_temp.assert_true(pg_temp.checked_admit((r->>'request_id')::uuid,
  (r->>'admin_id')::uuid, '30000000-0000-0000-0000-000000000002')->>'status' = 'ownership-denied', 'cross session replay');
 perform pg_temp.assert_true(pg_temp.admit(2)->>'status' = 'concurrency-limited', 'admin concurrency');
 update verification_private.configuration set global_concurrency = 1;
 perform pg_temp.assert_true(pg_temp.admit(2,2)->>'status' = 'concurrency-limited', 'global concurrency');
 perform pg_temp.assert_true(pg_temp.release_result(r,2)->>'status' = 'ownership-denied', 'cross admin release');
 perform pg_temp.assert_true(pg_temp.checked_release((r->>'request_id')::uuid,
  (r->>'lease_id')::uuid, (r->>'admin_id')::uuid,
  '30000000-0000-0000-0000-000000000002')->>'status' = 'ownership-denied', 'wrong session release');
 perform pg_temp.assert_true(pg_temp.checked_release('20000000-0000-0000-0000-999999999999',
  (r->>'lease_id')::uuid, (r->>'admin_id')::uuid, (r->>'session_id')::uuid)->>'status' = 'ownership-denied', 'wrong request release');
 perform pg_temp.assert_true(pg_temp.checked_release((r->>'request_id')::uuid,
  '40000000-0000-0000-0000-999999999999', (r->>'admin_id')::uuid,
  (r->>'session_id')::uuid)->>'status' = 'unknown', 'unknown lease');
 delete from public.cms_admins where user_id = (r->>'admin_id')::uuid;
 perform pg_temp.assert_true(pg_temp.admit(3)->>'status' = 'membership-denied', 'revoked admission');
 perform pg_temp.assert_true(pg_temp.release_result(r)->>'status' = 'released', 'release after revocation');
 perform pg_temp.assert_true(pg_temp.release_result(r)->>'status' = 'already-released', 'duplicate release');
 insert into public.cms_admins values ((r->>'admin_id')::uuid);
 -- A denial has not reserved request 2; re-evaluate it successfully.
 s := pg_temp.admit(2);
 perform pg_temp.assert_true(s->>'status' = 'admitted', 'denial re-evaluation');
 update verification_private.leases set admitted_at = pg_catalog.clock_timestamp() - interval '61 seconds',
  expires_at = pg_catalog.clock_timestamp() - interval '1 second' where lease_id = (s->>'lease_id')::uuid;
 perform pg_temp.assert_true(pg_temp.release_result(s)->>'status' = 'expired', 'expiration blocks release');
 perform pg_temp.assert_true((select released_at is null from verification_private.leases where lease_id = (s->>'lease_id')::uuid), 'expiration never confirms release');
 -- Exact-boundary source coverage is static_checks.py, linked to BOTH real queries.
 -- This RPC case checks only history outside the window, not exact-clock behavior.
 update verification_private.admissions set admitted_at = pg_catalog.clock_timestamp() - interval '61 seconds';
 update verification_private.configuration set admin_budget = 1, global_budget = 100, global_concurrency = 10;
 r := pg_temp.admit(4);
 perform pg_temp.assert_true(r->>'status' = 'admitted', 'outside window ignored by RPC');
 perform pg_temp.assert_true(pg_temp.release_result(r)->>'status' = 'released', 'release before rate test');
 s := pg_temp.admit(5);
 if not exists (select 1 from verification_private.admissions where request_id = (r->>'request_id')::uuid
   and admitted_at > pg_catalog.clock_timestamp() - interval '60 seconds') then
   raise exception 'INVALID TIMING: rate fixture expired; discard and repeat' using errcode = 'P0004';
 end if;
 perform pg_temp.assert_true(s->>'status' = 'rate-limited', 'admin budget');
 update verification_private.configuration set admin_budget = 10, global_budget = 1;
 s := pg_temp.admit(5,2);
 if not exists (select 1 from verification_private.admissions where request_id = (r->>'request_id')::uuid
   and admitted_at > pg_catalog.clock_timestamp() - interval '60 seconds') then
   raise exception 'INVALID TIMING: rate fixture expired; discard and repeat' using errcode = 'P0004';
 end if;
 perform pg_temp.assert_true(s->>'status' = 'rate-limited', 'global budget');
 select count(*) into n from verification_private.admissions;
 -- Subtransaction rollback discards admission and lease together.
 begin
  update verification_private.configuration set global_budget = 100;
  r := pg_temp.admit(6);
  perform pg_temp.assert_true(r->>'status' = 'admitted', 'rollback admission granted');
  perform pg_temp.assert_true(exists (
    select 1 from verification_private.admissions a
    join verification_private.leases l on l.request_id = a.request_id
      and l.admin_id = a.admin_id and l.session_id = a.session_id
    where a.request_id = '20000000-0000-0000-0000-000000000006'
      and l.lease_id = (r->>'lease_id')::uuid
      and a.admin_id = (r->>'admin_id')::uuid and a.session_id = (r->>'session_id')::uuid
      and l.released_at is null
  ), 'admission and corresponding lease visible before rollback');
  -- Test-only sentinel, unrelated to P0002/SELECT INTO STRICT failures.
  raise exception 'intentional rollback' using errcode = 'ZX601';
 exception when sqlstate 'ZX601' then null;
 end;
 perform pg_temp.assert_true((select count(*) = n from verification_private.admissions), 'admission rollback');
 perform pg_temp.assert_true(not exists (select 1 from verification_private.admissions
   where request_id = '20000000-0000-0000-0000-000000000006'), 'specific admission rollback');
 perform pg_temp.assert_true(not exists (select 1 from verification_private.leases where request_id = '20000000-0000-0000-0000-000000000006'), 'lease rollback');
end $$;
rollback;
-- Fail closed outside READ COMMITTED.
begin isolation level repeatable read;
DO $$ begin
 begin
  perform public.admit_partner_logo_verification(pg_catalog.gen_random_uuid(), pg_catalog.gen_random_uuid(), pg_catalog.gen_random_uuid());
  raise exception 'Expected isolation rejection';
 exception when sqlstate '25000' then null;
 end;
end $$;
rollback;
