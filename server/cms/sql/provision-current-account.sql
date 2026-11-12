-- LOCAL / UNAPPLIED. Requires I-01 and a separately provisioned login.
-- Qualify owner, RLS, schema exposure, ACLs and TLS for each environment.
-- After review, acknowledge with cms.current_account_ownership_qualified=L-02B-reviewed.
-- Only after verifying the staging endpoint, set
-- cms.current_account_staging_project_ref = 'uhgeboelkbygidmhlugh' in this session.
-- This selects the approved staging profile; the GUC does not authenticate the server.
-- The trusted backend supplies only the UUID verified from bearer/Auth.
-- The runtime can call this UUID-parameterized projection; protect the credential
-- as trusted authority. There is no API role execution, enumeration or table ACL.
begin;
do $gate$
declare
  owner_id oid; runtime_id oid; r record; t record;
  staging_ref text := nullif(pg_catalog.current_setting('cms.current_account_staging_project_ref', true), '');
  membership_count bigint;
  approved_count bigint;
begin
  if current_setting('cms.current_account_ownership_qualified', true) is distinct from 'L-02B-reviewed' then
    raise exception 'STOP: pre-application ownership/RLS qualification required';
  end if;
  select oid into strict runtime_id from pg_catalog.pg_roles where rolname='cms_current_account_runtime'
    and not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb
    and not rolreplication and not rolinherit;
  if (select rolcanlogin from pg_catalog.pg_roles where oid=runtime_id) is not true then
    raise exception 'Reader runtime LOGIN required' using errcode = '42501';
  end if;
  if staging_ref is not null and staging_ref <> 'uhgeboelkbygidmhlugh' then
    raise exception 'Unknown current account staging profile';
  end if;
  select count(*), count(*) filter (
    where m.roleid = runtime_id and m.member = 'postgres'::pg_catalog.regrole
      and m.grantor = 10::pg_catalog.oid and m.admin_option and not m.inherit_option and not m.set_option
  ) into membership_count, approved_count
  from pg_catalog.pg_auth_members m where runtime_id in (m.member, m.roleid, m.grantor);
  if (staging_ref is null and membership_count <> 0)
    or (staging_ref is not null and (membership_count <> 1 or approved_count <> 1)) then
    raise exception 'Unexpected runtime membership or delegation';
  end if;
  select nspowner into strict owner_id from pg_catalog.pg_namespace where nspname='cms_private';
  if owner_id <> (select oid from pg_catalog.pg_roles where rolname=current_user)
    or owner_id=runtime_id then raise exception 'Run only as prequalified existing owner'; end if;
  if pg_catalog.to_regprocedure('cms_private.read_current_account(uuid)') is not null then
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
      ('anon','authenticated','service_role','cms_f10_runtime','cms_admin_reader_runtime','cms_current_account_runtime')
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
-- Keep relations qualified and place the session's temporary schema after the
-- catalog, including for lookup of types in the SQL body.
create function cms_private.read_current_account(p_actor uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
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
revoke all on function cms_private.read_current_account(uuid)
  from public, anon, authenticated, service_role;
-- CONNECT must already be available to the preprovisioned runtime principal.
-- A grant for the reviewed database name, if needed, is a separate provisioning
-- prerequisite; this script never guesses a database identifier.
grant usage on schema cms_private to cms_current_account_runtime;
grant execute on function cms_private.read_current_account(uuid) to cms_current_account_runtime;

do $effective_privileges$
declare
  rid oid; f record; t record; s record; denied_role record;
  staging_profile boolean := pg_catalog.current_setting('cms.current_account_staging_project_ref', true)
    is not distinct from 'uhgeboelkbygidmhlugh';
begin
  select oid into strict rid from pg_catalog.pg_roles where rolname='cms_current_account_runtime';
  for denied_role in select oid from pg_catalog.pg_roles where rolname in
    ('anon','authenticated','service_role','cms_f10_runtime','cms_admin_reader_runtime') loop
    if pg_catalog.has_function_privilege(denied_role.oid,'cms_private.read_current_account(uuid)','EXECUTE') then
      raise exception 'Forbidden effective function execution';
    end if;
  end loop;
  if exists(select 1 from pg_catalog.aclexplode((select proacl from pg_catalog.pg_proc
      where oid='cms_private.read_current_account(uuid)'::regprocedure))
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
  if pg_catalog.has_database_privilege(rid,pg_catalog.current_database(),'CREATE') then
    raise exception 'Unexpected database CREATE (including PUBLIC-derived)';
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
  for t in select c.oid, c.relname, c.relkind, c.relowner, c.relacl, n.oid as schema_id, n.nspname
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p','v','m','f') and n.nspname not in ('pg_catalog','information_schema')
      and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp_%' loop
    if pg_catalog.has_table_privilege(rid,t.oid,'MAINTAIN') then
      raise exception 'Unexpected effective relation MAINTAIN';
    end if;
    if pg_catalog.has_table_privilege(rid,t.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or pg_catalog.has_any_column_privilege(rid,t.oid,'INSERT,UPDATE,REFERENCES') then
      raise exception 'Unexpected effective relation access';
    end if;
    if pg_catalog.has_any_column_privilege(rid,t.oid,'SELECT') then
      if not (
        staging_profile and t.nspname = 'extensions'
        and t.relname in ('pg_stat_statements', 'pg_stat_statements_info')
        and t.relkind = 'v' and t.relowner = 'postgres'::pg_catalog.regrole
        and not pg_catalog.has_schema_privilege(rid,t.schema_id,'USAGE')
        and pg_catalog.has_table_privilege(rid,t.oid,'SELECT')
        and not pg_catalog.has_any_column_privilege(rid,t.oid,'SELECT WITH GRANT OPTION')
        and exists (
          select 1 from pg_catalog.aclexplode(t.relacl) a
          where a.grantee = 0 and a.privilege_type = 'SELECT' and not a.is_grantable
        )
        and exists (
          select 1 from pg_catalog.pg_depend d join pg_catalog.pg_extension e on e.oid = d.refobjid
          where d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass and d.objid = t.oid
            and d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
            and d.objsubid = 0 and d.refobjsubid = 0 and d.deptype = 'e'
            and e.extname = 'pg_stat_statements'
        )
      ) then
        raise exception 'Unexpected effective relation access';
      end if;
    end if;
  end loop;
  for f in select p.oid,n.oid as schema_id from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'
      and n.nspname not like 'pg_temp_%' and p.oid<>'cms_private.read_current_account(uuid)'::regprocedure loop
    if pg_catalog.has_schema_privilege(rid,f.schema_id,'USAGE') and pg_catalog.has_function_privilege(rid,f.oid,'EXECUTE') then
      raise exception 'Unexpected effective function execution (including PUBLIC/default ACLs)';
    end if;
  end loop;
end;
$effective_privileges$;
-- Fail on unexpected existing privileges; never normalize global PUBLIC grants.
-- Standard catalog utility access and session-local TEMP are permitted.
-- Unrelated application function privileges still block application.
commit;
