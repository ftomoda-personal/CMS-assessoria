-- I-01: LOCAL / UNAPPLIED. Requires explicit migration selection and review.
-- Does not activate invitations, student reads or the separate ALS workstream.
-- I-01A containment: no account API grants/policies until qualified ALS integration.
begin;
lock table public.cms_admins in share row exclusive mode;

create table public.accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('student', 'administrator')),
  status text not null default 'pending_invitation'
    check (status in ('pending_invitation', 'active', 'disabled')),
  display_name text not null check (btrim(display_name) <> ''),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp()
);

-- Preserve existing trusted memberships; never derive authority from Auth metadata.
insert into public.accounts(user_id, role, status, display_name)
select user_id, 'administrator', 'active', 'Administrator' from public.cms_admins;

-- I-01C: preserve the original membership-only administrative predicate and
-- self-membership policy. Account eligibility is separate from existing access.

create function cms_private.is_active_student() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.accounts
    where user_id = auth.uid() and role = 'student' and status = 'active');
$$;

alter table public.accounts enable row level security;
-- No positive account policies. Direct REST reads remain denied even if a
-- table SELECT grant is accidentally restored for an ordinary RLS-subject role.
revoke all on public.accounts from public, anon, authenticated, service_role;
-- Keep the table inaccessible to API roles, including direct REST access.

-- Full explicit command, not an upsert: stale creates cannot overwrite accounts.
-- Auth user provisioning is a future server-only integration. FK requires an
-- already provisioned Auth identity; email/metadata never establish identity.
create function public.create_account(
  p_user_id uuid, p_role text, p_display_name text
) returns public.accounts
language plpgsql security definer set search_path = '' as $$
declare result public.accounts;
begin
  -- Serialize management with membership changes before checking the actor.
  lock table public.cms_admins in share row exclusive mode;
  if not cms_private.is_cms_admin() then
    raise exception 'CMS administrator required' using errcode = '42501';
  end if;
  insert into public.accounts(user_id, role, display_name)
    values (p_user_id, p_role, p_display_name) returning * into result;
  -- Creation always remains pending, including administrator accounts.
  return result;
end;
$$;

create function public.update_account(
  p_user_id uuid, p_role text, p_status text, p_display_name text
) returns public.accounts
language plpgsql security definer set search_path = '' as $$
declare result public.accounts;
begin
  lock table public.cms_admins in share row exclusive mode;
  if not cms_private.is_cms_admin() then
    raise exception 'CMS administrator required' using errcode = '42501';
  end if;
  update public.accounts set role = p_role, status = p_status,
    display_name = p_display_name, updated_at = transaction_timestamp()
    where user_id = p_user_id returning * into result;
  if not found then raise exception 'Unknown account' using errcode = 'P0002'; end if;
  if result.role = 'administrator' and result.status = 'active' then
    insert into public.cms_admins(user_id) values (result.user_id) on conflict do nothing;
  else
    -- Reuse existing membership deletion/generation/admission revocation hooks.
    delete from public.cms_admins where user_id = result.user_id;
  end if;
  return result;
end;
$$;

revoke all on function cms_private.is_active_student(),
  public.create_account(uuid, text, text), public.update_account(uuid, text, text, text)
  from public, anon, authenticated, service_role;
-- No API EXECUTE grants: direct RPC calls remain unavailable, even for admins.
-- Function owners retain trusted maintenance authority; this is not an ALS gate.
-- No student policies: a future protected read must check is_active_student()
-- and reuse offer_effective_status(offer) = 'active', without segmentation.
commit;
