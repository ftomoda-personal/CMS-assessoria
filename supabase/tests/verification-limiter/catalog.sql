-- AUTHOR ONLY. Checks the initial, intentionally disabled migration state.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', label; end if; end $$;
DO $$
declare r text; f regprocedure; t record;
begin
 foreach f in array array['public.admit_partner_logo_verification(uuid,uuid,uuid)'::regprocedure,
  'public.release_partner_logo_verification(uuid,uuid,uuid,uuid)'::regprocedure] loop
  perform pg_temp.assert_true((select prosecdef and not proretset and prorettype = 'pg_catalog.jsonb'::regtype and provolatile = 'v' and proconfig = array['search_path=""']::text[] from pg_catalog.pg_proc where oid = f), 'function security settings');
  foreach r in array array['anon','authenticated','service_role'] loop
   perform pg_temp.assert_true(not pg_catalog.has_function_privilege(r,f,'EXECUTE'), 'no initial execution: ' || r);
  end loop;
  perform pg_temp.assert_true(not exists (select 1 from pg_catalog.pg_proc p,
   lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f',p.proowner))) a
   where p.oid = f and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'no PUBLIC execution');
 end loop;
 foreach r in array array['anon','authenticated','service_role'] loop
  perform pg_temp.assert_true(not pg_catalog.has_schema_privilege(r,'verification_private','USAGE'), 'private schema');
  perform pg_temp.assert_true(not pg_catalog.has_schema_privilege(r,'verification_private','CREATE'), 'schema write');
  for t in select c.oid from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'verification_private' and c.relkind = 'r' loop
   perform pg_temp.assert_true(not pg_catalog.has_table_privilege(r,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'), 'private table');
  end loop;
 end loop;
 -- Check every conservatively reachable role, not just the three named roles.
 for t in with recursive reachable(oid) as (
   select oid from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role')
   union select m.roleid from pg_catalog.pg_auth_members m join reachable x on m.member=x.oid
 ) select p.* from pg_catalog.pg_roles p join reachable x on x.oid=p.oid loop
   perform pg_temp.assert_true(not t.rolsuper and not t.rolcreaterole, 'no reachable role administration');
   perform pg_temp.assert_true(not exists(select 1 from pg_catalog.pg_auth_members where member=t.oid and admin_option), 'no reachable ADMIN OPTION');
   foreach f in array array['public.admit_partner_logo_verification(uuid,uuid,uuid)'::regprocedure,
     'public.release_partner_logo_verification(uuid,uuid,uuid,uuid)'::regprocedure] loop
     perform pg_temp.assert_true(not pg_catalog.has_function_privilege(t.oid,f,'EXECUTE')
       and (select proowner <> t.oid from pg_catalog.pg_proc where oid=f), 'no reachable RPC ownership/execute');
   end loop;
   perform pg_temp.assert_true(not pg_catalog.has_schema_privilege(t.oid,'verification_private','USAGE,CREATE'), 'no reachable schema privileges');
 end loop;
end $$;
rollback;
