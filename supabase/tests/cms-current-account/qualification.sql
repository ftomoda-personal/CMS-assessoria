-- Prepared for an authorized isolated qualification after both L-02B SQL files.
-- Set cms.l02b_admin, cms.l02b_student to active, distinct fixture UUIDs and
-- cms.l02b_absent to an unused UUID. Preseed a visible partner and offer.
-- Run with a privileged operator able to SET ROLE and update the admin fixture.
begin;

do $reader$
declare
  admin_id uuid := current_setting('cms.l02b_admin')::uuid;
  student_id uuid := current_setting('cms.l02b_student')::uuid;
  absent_id uuid := current_setting('cms.l02b_absent')::uuid;
  actor uuid;
  expected_role text;
  principal text;
  statement text;
begin
  if admin_id = student_id or admin_id = absent_id or student_id = absent_id then
    raise exception 'Distinct fixtures required';
  end if;
  set local role cms_current_account_runtime;
  foreach actor in array array[admin_id, student_id] loop
    expected_role := case when actor = admin_id then 'administrator' else 'student' end;
    if cms_private.read_current_account(actor) is distinct from pg_catalog.jsonb_build_object(
      'kind', 'read',
      'account', pg_catalog.jsonb_build_object('user_id', actor, 'role', expected_role, 'status', 'active'),
      'membership', case when actor = admin_id then pg_catalog.jsonb_build_object('user_id', actor) end
    ) then raise exception 'Unexpected reader projection'; end if;
  end loop;
  if cms_private.read_current_account(absent_id) is distinct from
    '{"kind":"read","account":null,"membership":null}'::jsonb then raise exception 'Unexpected absence'; end if;
  foreach statement in array array[
    'select user_id from public.accounts where false',
    'select user_id from public.cms_admins where false',
    'update public.accounts set status = status where false',
    'select * from public.partners where false',
    'select * from public.offers where false'
  ] loop
    begin
      execute statement;
      raise exception 'Unexpected runtime access: %', statement;
    exception when insufficient_privilege then null;
    end;
  end loop;
  reset role;

  foreach principal in array array['anon','authenticated','service_role'] loop
    execute format('set local role %I', principal);
    begin
      perform cms_private.read_current_account(admin_id);
      raise exception 'Unexpected reader execution by %', principal;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
end;
$reader$;

-- Simulate distinct database request statements with the same bearer subject.
-- The update below is rolled back and intentionally leaves membership present.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', current_setting('cms.l02b_admin'), true);
select pg_catalog.set_config('request.jwt.claims', '', true);

do $active$
begin
  if not cms_private.is_cms_admin()
    or not exists(select 1 from public.cms_admins)
    or not exists(select 1 from public.partners)
    or not exists(select 1 from public.offers) then
    raise exception 'Active admin or visible business fixtures missing';
  end if;
  if pg_catalog.has_any_column_privilege(current_user, 'public.accounts', 'SELECT,INSERT,UPDATE,REFERENCES')
    or pg_catalog.has_table_privilege(current_user, 'public.accounts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    or pg_catalog.has_function_privilege(current_user, 'public.create_account(uuid,text,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege(current_user, 'public.update_account(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'Unexpected account-management privilege for authenticated';
  end if;
end;
$active$;

reset role;
update public.accounts set status = 'disabled' where user_id = current_setting('cms.l02b_admin')::uuid;
set local role authenticated;

do $direct$
declare actor uuid; statement text; changed bigint;
begin
  foreach actor in array array[current_setting('cms.l02b_admin')::uuid, current_setting('cms.l02b_student')::uuid] loop
    perform pg_catalog.set_config('request.jwt.claim.sub', actor::text, true);
    if cms_private.is_cms_admin() or exists(select 1 from public.cms_admins)
      or exists(select 1 from public.partners) or exists(select 1 from public.offers) then
      raise exception 'Direct SELECT exposed administrative data';
    end if;
    update public.partners set name = name;
    get diagnostics changed = row_count;
    if changed <> 0 then raise exception 'Direct UPDATE affected rows'; end if;
    delete from public.partners;
    get diagnostics changed = row_count;
    if changed <> 0 then raise exception 'Direct DELETE affected rows'; end if;
    foreach statement in array array[
      'insert into public.partners(name) values (''L02B denied'')',
      'select public.save_offer()',
      'select public.set_offer_enabled(null, false)',
      'select public.activate_scheduled_offer(null)',
      'select public.soft_delete_offer(null)',
      'select public.create_account(null, null, null)',
      'select public.update_account(null, null, null, null)'
    ] loop
      begin
        execute statement;
        raise exception 'Unexpected direct operation: %', statement;
      exception when insufficient_privilege then null;
      end;
    end loop;
  end loop;
end;
$direct$;

rollback;
