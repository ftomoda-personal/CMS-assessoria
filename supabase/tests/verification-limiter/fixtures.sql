-- AUTHOR ONLY. Disposable database only, run as reviewed test owner.
-- Caller begins transaction before inclusion. Never include on Development/production.
insert into auth.users (id) values
 ('10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002');
insert into public.cms_admins (user_id) values
 ('10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002');
create function pg_temp.assert_true(ok boolean, label text) returns void
language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'Assertion failed: %', label; end if;
end $$;
-- Validate the ACTUAL unversioned SQL contract. No invented version field.
create function pg_temp.assert_response(r jsonb, p_request uuid, p_admin uuid,
  p_session uuid, p_lease uuid default null) returns void
language plpgsql as $$
declare k text[]; expected text[]; s text; v verification_private.leases%rowtype;
begin
  perform pg_temp.assert_true(pg_catalog.jsonb_typeof(r) = 'object', 'one JSON object');
  s := r->>'status';
  perform pg_temp.assert_true(pg_catalog.jsonb_typeof(r->'status') = 'string', 'status type');
  if s = 'admitted' then
    expected := array['admin_id','admitted_at','expires_at','lease_id','request_id','session_id','status'];
  elsif s = 'replay' then expected := array['request_id','status'];
  elsif s in ('released','already-released','expired') then
    expected := array['admin_id','lease_id','request_id','session_id','status'];
  else
    perform pg_temp.assert_true(s in ('membership-denied','ownership-denied','rate-limited','concurrency-limited','unknown'), 'known negative status');
    expected := array['status'];
  end if;
  select pg_catalog.array_agg(key order by key) into k from pg_catalog.jsonb_object_keys(r) key;
  perform pg_temp.assert_true(k = expected, 'exact result keys; version absent in this contract');
  if s in ('admitted','replay','released','already-released','expired') then
    perform pg_temp.assert_true(pg_catalog.jsonb_typeof(r->'request_id') = 'string'
      and (r->>'request_id')::uuid = p_request, 'request identity');
  end if;
  if s in ('admitted','released','already-released','expired') then
    perform pg_temp.assert_true(pg_catalog.jsonb_typeof(r->'admin_id') = 'string'
      and (r->>'admin_id')::uuid = p_admin, 'administrator identity');
    perform pg_temp.assert_true(pg_catalog.jsonb_typeof(r->'session_id') = 'string'
      and (r->>'session_id')::uuid = p_session, 'session identity');
    perform pg_temp.assert_true(pg_catalog.jsonb_typeof(r->'lease_id') = 'string', 'lease type');
    select * into strict v from verification_private.leases where lease_id = (r->>'lease_id')::uuid;
    perform pg_temp.assert_true(v.request_id = p_request and v.admin_id = p_admin
      and v.session_id = p_session, 'persisted lease tuple');
    if s <> 'admitted' then
      perform pg_temp.assert_true(v.lease_id = p_lease, 'original release lease');
      perform pg_temp.assert_true((s in ('released','already-released') and v.released_at is not null)
        or (s = 'expired' and v.released_at is null), 'release state');
    else
      perform pg_temp.assert_true(pg_catalog.jsonb_typeof(r->'admitted_at') = 'string'
        and pg_catalog.jsonb_typeof(r->'expires_at') = 'string', 'timestamp types');
      perform pg_temp.assert_true((r->>'admitted_at')::timestamptz = v.admitted_at
        and (r->>'expires_at')::timestamptz = v.expires_at and v.expires_at > v.admitted_at, 'timestamp values');
      perform pg_temp.assert_true(exists (select 1 from verification_private.admissions a
        where a.request_id = p_request and a.admin_id = p_admin and a.session_id = p_session
          and a.admitted_at = v.admitted_at), 'admission and lease persisted together');
    end if;
  end if;
end $$;
-- Wrappers consume the scalar RPC via FROM, asserting row cardinality and every result.
create function pg_temp.checked_admit(q uuid, a uuid, s uuid) returns jsonb
language plpgsql volatile as $$
declare n bigint; rows jsonb; r jsonb;
begin
  select pg_catalog.count(*), pg_catalog.jsonb_agg(result) into n, rows
    from public.admit_partner_logo_verification(q,a,s) as rpc(result);
  perform pg_temp.assert_true(n = 1, 'exactly one admission result row');
  r := rows->0;
  perform pg_temp.assert_response(r,q,a,s);
  return r;
end $$;
create function pg_temp.checked_release(q uuid, l uuid, a uuid, s uuid) returns jsonb
language plpgsql volatile as $$
declare n bigint; rows jsonb; r jsonb;
begin
  select pg_catalog.count(*), pg_catalog.jsonb_agg(result) into n, rows
    from public.release_partner_logo_verification(q,l,a,s) as rpc(result);
  perform pg_temp.assert_true(n = 1, 'exactly one release result row');
  r := rows->0;
  perform pg_temp.assert_response(r,q,a,s,l);
  return r;
end $$;
create function pg_temp.admit(n integer, admin_n integer default 1) returns jsonb
language sql volatile as $$
 select pg_temp.checked_admit(
  ('20000000-0000-0000-0000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  ('10000000-0000-0000-0000-' || pg_catalog.lpad(admin_n::text, 12, '0'))::uuid,
  '30000000-0000-0000-0000-000000000001'::uuid);
$$;
create function pg_temp.release_result(r jsonb, admin_n integer default 1) returns jsonb
language sql volatile as $$
 select pg_temp.checked_release((r->>'request_id')::uuid,
  (r->>'lease_id')::uuid,
  ('10000000-0000-0000-0000-' || pg_catalog.lpad(admin_n::text, 12, '0'))::uuid,
  '30000000-0000-0000-0000-000000000001'::uuid);
$$;
