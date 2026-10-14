-- LOCAL / UNAPPLIED. Final unconditional gate prevents application pending external review.
begin;
create schema verification_private;
revoke all on schema verification_private from public, anon, authenticated, service_role;
create table verification_private.configuration (
  singleton boolean primary key default true check (singleton),
  window_seconds integer not null check (window_seconds = 60),
  admin_budget integer not null check (admin_budget > 0),
  global_budget integer not null check (global_budget > 0),
  admin_concurrency integer not null check (admin_concurrency > 0),
  global_concurrency integer not null check (global_concurrency > 0),
  lease_seconds integer not null check (lease_seconds > 0)
);
insert into verification_private.configuration values (true, 60, 10, 100, 1, 10, 30);
create table verification_private.global_lock (
  singleton boolean primary key default true check (singleton)
);
insert into verification_private.global_lock values (true);
create table verification_private.admin_locks (admin_id uuid primary key);
-- No FK to membership: revocation must preserve replay history and release.
create table verification_private.admissions (
  request_id uuid primary key,
  admin_id uuid not null,
  session_id uuid not null,
  admitted_at timestamptz not null,
  unique (request_id, admin_id, session_id)
);
create index admissions_time_idx on verification_private.admissions (admitted_at);
create index admissions_admin_time_idx on verification_private.admissions (admin_id, admitted_at);
create table verification_private.leases (
  lease_id uuid primary key,
  request_id uuid not null unique,
  admin_id uuid not null,
  session_id uuid not null,
  admitted_at timestamptz not null,
  expires_at timestamptz not null,
  released_at timestamptz,
  foreign key (request_id, admin_id, session_id)
    references verification_private.admissions (request_id, admin_id, session_id),
  check (expires_at > admitted_at),
  check (released_at is null or (released_at >= admitted_at and released_at < expires_at))
);
create index leases_active_idx on verification_private.leases (expires_at) where released_at is null;
create index leases_admin_active_idx on verification_private.leases (admin_id, expires_at) where released_at is null;

create function public.admit_partner_logo_verification(p_request_id uuid, p_admin_id uuid, p_session_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_now timestamptz;
  v_config verification_private.configuration%rowtype;
  v_admission verification_private.admissions%rowtype;
  v_lease verification_private.leases%rowtype;
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'READ COMMITTED required' using errcode = '25000';
  end if;
  if p_request_id is null or p_admin_id is null or p_session_id is null then
    raise exception 'Identifiers required' using errcode = '22004';
  end if;
  perform 1 from verification_private.global_lock where singleton for update;
  if not found then raise exception 'Missing global lock'; end if;
  -- Avoid lock-row growth from arbitrary non-member identities.
  if not exists (select 1 from public.cms_admins where user_id = p_admin_id) then
    return pg_catalog.jsonb_build_object('status', 'membership-denied');
  end if;
  insert into verification_private.admin_locks values (p_admin_id) on conflict do nothing;
  perform 1 from verification_private.admin_locks where admin_id = p_admin_id for update;
  v_now := pg_catalog.clock_timestamp();
  select * into strict v_config from verification_private.configuration where singleton;
  -- A fresh statement snapshot after lock wait; no JWT identity is trusted here.
  if not exists (select 1 from public.cms_admins where user_id = p_admin_id) then
    return pg_catalog.jsonb_build_object('status', 'membership-denied');
  end if;
  select * into v_admission from verification_private.admissions where request_id = p_request_id;
  if found then
    if v_admission.admin_id <> p_admin_id or v_admission.session_id <> p_session_id then
      return pg_catalog.jsonb_build_object('status', 'ownership-denied');
    end if;
    return pg_catalog.jsonb_build_object('status', 'replay', 'request_id', p_request_id);
  end if;
  if (select pg_catalog.count(*) from verification_private.admissions where admitted_at > v_now - interval '60 seconds') >= v_config.global_budget
    or (select pg_catalog.count(*) from verification_private.admissions where admin_id = p_admin_id and admitted_at > v_now - interval '60 seconds') >= v_config.admin_budget then
    return pg_catalog.jsonb_build_object('status', 'rate-limited');
  end if;
  if (select pg_catalog.count(*) from verification_private.leases where released_at is null and expires_at > v_now) >= v_config.global_concurrency
    or (select pg_catalog.count(*) from verification_private.leases where admin_id = p_admin_id and released_at is null and expires_at > v_now) >= v_config.admin_concurrency then
    return pg_catalog.jsonb_build_object('status', 'concurrency-limited');
  end if;
  insert into verification_private.admissions values (p_request_id, p_admin_id, p_session_id, v_now);
  insert into verification_private.leases (lease_id, request_id, admin_id, session_id, admitted_at, expires_at)
    values (pg_catalog.gen_random_uuid(), p_request_id, p_admin_id, p_session_id, v_now,
      v_now + pg_catalog.make_interval(secs => v_config.lease_seconds)) returning * into v_lease;
  return pg_catalog.jsonb_build_object('status', 'admitted', 'request_id', p_request_id,
    'lease_id', v_lease.lease_id, 'admin_id', p_admin_id, 'session_id', p_session_id,
    'admitted_at', v_now, 'expires_at', v_lease.expires_at);
end;
$$;

create function public.release_partner_logo_verification(p_request_id uuid, p_lease_id uuid, p_admin_id uuid, p_session_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_now timestamptz; v_lease verification_private.leases%rowtype; v_status text;
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'READ COMMITTED required' using errcode = '25000';
  end if;
  if p_request_id is null or p_lease_id is null or p_admin_id is null or p_session_id is null then
    raise exception 'Identifiers required' using errcode = '22004';
  end if;
  perform 1 from verification_private.global_lock where singleton for update;
  if not found then raise exception 'Missing global lock'; end if;
  -- Do not create lock rows for unknown release requests.
  perform 1 from verification_private.admin_locks where admin_id = p_admin_id for update;
  select * into v_lease from verification_private.leases where lease_id = p_lease_id for update;
  v_now := pg_catalog.clock_timestamp();
  if not found then return pg_catalog.jsonb_build_object('status', 'unknown'); end if;
  if v_lease.request_id <> p_request_id or v_lease.admin_id <> p_admin_id or v_lease.session_id <> p_session_id then
    return pg_catalog.jsonb_build_object('status', 'ownership-denied');
  end if;
  if v_lease.released_at is not null then v_status := 'already-released';
  elsif v_lease.expires_at <= v_now then v_status := 'expired';
  else
    update verification_private.leases set released_at = v_now where lease_id = p_lease_id;
    v_status := 'released';
  end if;
  return pg_catalog.jsonb_build_object('status', v_status, 'request_id', p_request_id,
    'lease_id', p_lease_id, 'admin_id', p_admin_id, 'session_id', p_session_id);
end;
$$;
revoke all on all tables in schema verification_private from public, anon, authenticated, service_role;
revoke all on function public.admit_partner_logo_verification(uuid, uuid, uuid),
  public.release_partner_logo_verification(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
-- Intentionally no EXECUTE grant: local history does not verify a safe definer owner.
-- Future reviewed migration must establish ownership/access and grant only service_role.
-- Inspect actual resulting objects after revocations, inside the creation transaction.
-- Conservatively traverse every membership edge, regardless of INHERIT/SET options.
DO $privilege_preconditions$
declare v_role record; v_function record; v_table record;
begin
  if (select pg_catalog.count(*) from pg_catalog.pg_roles
      where rolname in ('anon', 'authenticated', 'service_role')) <> 3 then
    raise exception 'Required API roles missing' using errcode = '42501';
  end if;
  for v_role in
    with recursive reachable(oid) as (
      select oid from pg_catalog.pg_roles where rolname in ('anon', 'authenticated', 'service_role')
      union
      select m.roleid from pg_catalog.pg_auth_members m join reachable r on m.member = r.oid
    ) select p.* from pg_catalog.pg_roles p join reachable r on r.oid = p.oid
  loop
    if v_role.rolsuper or v_role.rolcreaterole or exists (
      select 1 from pg_catalog.pg_auth_members where member = v_role.oid and admin_option
    ) then
      raise exception 'API-reachable role has role administration powers: %', v_role.rolname using errcode = '42501';
    end if;
    for v_function in select p.oid, p.proowner from pg_catalog.pg_proc p
      where p.oid in ('public.admit_partner_logo_verification(uuid,uuid,uuid)'::pg_catalog.regprocedure,
        'public.release_partner_logo_verification(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure)
    loop
      if v_function.proowner = v_role.oid
        or pg_catalog.has_function_privilege(v_role.oid, v_function.oid, 'EXECUTE') then
        raise exception 'API-reachable function ownership/EXECUTE: %', v_role.rolname using errcode = '42501';
      end if;
    end loop;
    if exists (select 1 from pg_catalog.pg_namespace where nspname = 'verification_private' and nspowner = v_role.oid)
      or pg_catalog.has_schema_privilege(v_role.oid, 'verification_private', 'USAGE,CREATE') then
      raise exception 'API-reachable private schema access: %', v_role.rolname using errcode = '42501';
    end if;
    for v_table in select c.oid, c.relowner from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'verification_private' and c.relkind = 'r'
    loop
      if v_table.relowner = v_role.oid or pg_catalog.has_table_privilege(v_role.oid, v_table.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
        raise exception 'API-reachable private table access: %', v_role.rolname using errcode = '42501';
      end if;
    end loop;
  end loop;
  -- Direct/default PUBLIC access must be absent, not merely hidden by schema ACLs.
  if exists (
    select 1 from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid in ('public.admit_partner_logo_verification(uuid,uuid,uuid)'::pg_catalog.regprocedure,
      'public.release_partner_logo_verification(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure)
      and a.grantee = 0
  ) or exists (
    select 1 from pg_catalog.pg_namespace n,
      lateral pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
    where n.nspname = 'verification_private' and a.grantee = 0
  ) or exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace,
      lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    where n.nspname = 'verification_private' and c.relkind = 'r' and a.grantee = 0
  ) then
    raise exception 'PUBLIC access remains' using errcode = '42501';
  end if;
end;
$privilege_preconditions$;
-- Membership/ACL checks cannot prove absence of arbitrary existing definer RPCs,
-- credential access or external role administration capable of changing this state.
-- No caller-set GUC, role-name allowlist or runtime switch can bypass this gate.
DO $external_review_gate$
begin
  raise exception 'UNAPPLIED: external catalog/security review required before authorized gate removal'
    using errcode = '42501';
end;
$external_review_gate$;
commit;
