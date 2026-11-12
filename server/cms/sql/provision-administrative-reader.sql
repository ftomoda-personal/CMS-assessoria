-- OFFLINE / UNAPPLIED. Not a migration-discovery input. No credentials or roles
-- are created here. Separate environment-specific authorization is mandatory.
-- PRE-APPLICATION GATE: a privileged reviewer must qualify I-01, common ownership
-- of cms_private and both tables, absence of FORCE RLS, owner trust/nonreachability
-- from API/runtime roles, effective ACL/default ACLs, exposed schemas, TLS and login
-- provisioning. Set cms.admin_reader_ownership_qualified = 'I-02H-reviewed' ONLY in
-- the separately authorized deployment session after that review. It is an operator
-- acknowledgement, NOT cryptographic evidence or a permission to run this file.
-- cms_admin_reader_runtime must already exist, with login/credentials handled
-- separately. Nothing here changes an owner, RLS, existing policies or F10 grants.
begin;
do $gate$
declare owner_id oid; runtime_id oid; r record; t record;
begin
  if current_setting('cms.admin_reader_ownership_qualified', true) is distinct from 'I-02H-reviewed' then
    raise exception 'STOP: pre-application ownership/RLS qualification required';
  end if;
  select oid into strict runtime_id from pg_catalog.pg_roles where rolname='cms_admin_reader_runtime'
    and not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb
    and not rolreplication and not rolinherit;
  if (select rolcanlogin from pg_catalog.pg_roles where oid=runtime_id) is not true then
    raise exception 'Reader runtime LOGIN required' using errcode = '42501';
  end if;
  if exists(select 1 from pg_catalog.pg_auth_members where member=runtime_id or roleid=runtime_id) then
    raise exception 'Runtime memberships/delegation forbidden';
  end if;
  select nspowner into strict owner_id from pg_catalog.pg_namespace where nspname='cms_private';
  if owner_id <> (select oid from pg_catalog.pg_roles where rolname=current_user)
    or owner_id=runtime_id then raise exception 'Run only as prequalified existing owner'; end if;
  if pg_catalog.to_regprocedure('cms_private.read_administrative_account(uuid)') is not null then
    raise exception 'Fresh function required; no silent replacement';
  end if;
  if (select count(*) from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role')) <> 3 then
    raise exception 'Required API roles missing';
  end if;
  for t in select c.* from pg_catalog.pg_class c where c.oid in
    ('public.cms_admins'::regclass,'public.accounts'::regclass) loop
    if t.relowner<>owner_id or not t.relrowsecurity or t.relforcerowsecurity then
      raise exception 'Unexpected table ownership or RLS';
    end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_policy where polrelid='public.accounts'::regclass) then
    raise exception 'I-01 account containment required';
  end if;
  for r in with recursive reachable(oid) as (
    select oid from pg_catalog.pg_roles where rolname in
      ('anon','authenticated','service_role','cms_f10_runtime','cms_admin_reader_runtime')
    union select m.roleid from pg_catalog.pg_auth_members m join reachable x on m.member=x.oid
  ) select p.* from pg_catalog.pg_roles p join reachable x on x.oid=p.oid loop
    if r.oid=owner_id or r.rolsuper or r.rolcreaterole
      or pg_catalog.has_schema_privilege(r.oid,'cms_private','CREATE') then
      raise exception 'Untrusted owner/admin reachability';
    end if;
  end loop;
end;
$gate$;

-- Function inherits current_user ownership: the gate requires the EXISTING trusted
-- table owner. Owner table-RLS exemption is used intentionally inside this fixed
-- projection only. No BYPASSRLS grant, owner credential or API privilege is added.
create function cms_private.read_administrative_account(p_actor uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'kind', 'read',
    'membership', case when m.user_id is null then null else
      pg_catalog.jsonb_build_object('user_id', m.user_id) end,
    'account', case when a.user_id is null then null else
      pg_catalog.jsonb_build_object('user_id', a.user_id, 'role', a.role, 'status', a.status) end)
  from (select p_actor as actor_id) as input
  left join public.cms_admins as m on m.user_id=input.actor_id
  left join public.accounts as a on a.user_id=input.actor_id;
$$;
-- Same transaction: no committed default-EXECUTE exposure window.
revoke all on function cms_private.read_administrative_account(uuid)
  from public, anon, authenticated, service_role;
-- CONNECT must already be available to the preprovisioned runtime principal.
-- A grant for the reviewed database name, if needed, is a separate provisioning
-- prerequisite; this script never guesses a database identifier.
grant usage on schema cms_private to cms_admin_reader_runtime;
grant execute on function cms_private.read_administrative_account(uuid) to cms_admin_reader_runtime;

do $effective_privileges$
declare rid oid; f record; t record; s record; denied_role record;
begin
  select oid into strict rid from pg_catalog.pg_roles where rolname='cms_admin_reader_runtime';
  for denied_role in select oid from pg_catalog.pg_roles where rolname in
    ('anon','authenticated','service_role','cms_f10_runtime') loop
    if pg_catalog.has_function_privilege(denied_role.oid,'cms_private.read_administrative_account(uuid)','EXECUTE') then
      raise exception 'Forbidden effective function execution';
    end if;
  end loop;
  if exists(select 1 from pg_catalog.aclexplode((select proacl from pg_catalog.pg_proc
      where oid='cms_private.read_administrative_account(uuid)'::regprocedure))
    where grantee not in (rid,(select oid from pg_catalog.pg_roles where rolname=current_user))
      or (grantee=rid and is_grantable)) then
    raise exception 'Unexpected function grantee';
  end if;
  for denied_role in select oid from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role') loop
    if pg_catalog.has_table_privilege(denied_role.oid,'public.accounts','MAINTAIN') then
      raise exception 'I-01 API MAINTAIN containment mismatch';
    end if;
    if pg_catalog.has_table_privilege(denied_role.oid,'public.accounts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or pg_catalog.has_any_column_privilege(denied_role.oid,'public.accounts','SELECT,INSERT,UPDATE,REFERENCES') then
      raise exception 'I-01 API ACL containment mismatch';
    end if;
  end loop;
  if not pg_catalog.has_database_privilege(rid,pg_catalog.current_database(),'CONNECT') then
    raise exception 'Preprovisioned database CONNECT required';
  end if;
  if pg_catalog.has_database_privilege(rid,pg_catalog.current_database(),'CREATE,TEMP') then
    raise exception 'Unexpected database CREATE/TEMP (including PUBLIC-derived)';
  end if;
  for t in select c.oid from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind='S' and n.nspname not in ('pg_catalog','information_schema') loop
    if pg_catalog.has_sequence_privilege(rid,t.oid,'USAGE,SELECT,UPDATE') then
      raise exception 'Unexpected sequence access';
    end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_class where relowner=rid)
    or exists(select 1 from pg_catalog.pg_proc where proowner=rid)
    or exists(select 1 from pg_catalog.pg_namespace where nspowner=rid)
    or exists(select 1 from pg_catalog.pg_database where datdba=rid) then
    raise exception 'Runtime must own no database objects';
  end if;
  for s in select * from pg_catalog.pg_namespace where nspname not like 'pg_temp_%' and nspname not like 'pg_toast_temp_%' loop
    if pg_catalog.has_schema_privilege(rid,s.oid,'CREATE') then raise exception 'Runtime schema CREATE forbidden'; end if;
    if s.nspname in ('auth','storage') and pg_catalog.has_schema_privilege(rid,s.oid,'USAGE') then
      raise exception 'Unexpected Auth/Storage usage';
    end if;
  end loop;
  for t in select c.oid from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p','v','m','f') and n.nspname not in ('pg_catalog','information_schema')
      and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp_%' loop
    if pg_catalog.has_table_privilege(rid,t.oid,'MAINTAIN') then
      raise exception 'Unexpected effective relation MAINTAIN';
    end if;
    if pg_catalog.has_table_privilege(rid,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or pg_catalog.has_any_column_privilege(rid,t.oid,'SELECT,INSERT,UPDATE,REFERENCES') then
      raise exception 'Unexpected effective relation access';
    end if;
  end loop;
  for f in select p.oid,n.oid as schema_id from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'
      and n.nspname not like 'pg_temp_%' and p.oid<>'cms_private.read_administrative_account(uuid)'::regprocedure loop
    if pg_catalog.has_schema_privilege(rid,f.schema_id,'USAGE') and pg_catalog.has_function_privilege(rid,f.oid,'EXECUTE') then
      raise exception 'Unexpected effective function execution (including PUBLIC/default ACLs)';
    end if;
  end loop;
end;
$effective_privileges$;
-- Fail on unexpected existing privileges; never normalize global PUBLIC grants.
-- Standard catalog utility access remains. PUBLIC-derived TEMP or unrelated
-- function privileges block application and require separate environment review.
commit;
