-- Clean Supabase database; auth.users/auth.uid and API roles are platform prerequisites.
begin;
create schema cms_private;
revoke all on schema cms_private from public, anon, authenticated;
grant usage on schema cms_private to authenticated;

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  website text not null check (btrim(website) <> ''),
  logo_path text,
  logo_name text,
  ever_associated boolean not null default false,
  constraint partners_logo_pair check (logo_name is null or logo_path is not null)
);
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.partners(id) on delete restrict,
  title text not null default '',
  subtitle text,
  description text not null default '',
  publication_mode text not null default 'now',
  has_coupon boolean not null default false,
  coupon text,
  has_expiration boolean not null default false,
  starts_on date,
  expires_on date,
  published_at timestamptz,
  enabled boolean not null default true,
  deleted_at timestamptz,
  constraint offers_mode check (publication_mode in ('now', 'scheduled')),
  constraint offers_dates check (expires_on >= starts_on),
  constraint offers_coupon_flag check (has_coupon or coupon is null),
  constraint offers_expiration_flag check (has_expiration or expires_on is null),
  constraint offers_draft_enabled check (published_at is not null or enabled),
  constraint offers_publication_complete check (
    published_at is null or (
      partner_id is not null and btrim(title) <> '' and btrim(description) <> ''
      and starts_on is not null
      and (not has_coupon or (coupon is not null and btrim(coupon) <> ''))
      and (not has_expiration or expires_on is not null)
    )
  )
);
create table public.cms_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create index offers_partner_id_idx on public.offers(partner_id);
create index offers_current_partner_id_idx on public.offers(partner_id, id) where deleted_at is null;

create function cms_private.is_cms_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cms_admins where user_id = auth.uid());
$$;
create function cms_private.business_date() returns date
language sql stable set search_path = '' as $$
  select (transaction_timestamp() at time zone 'America/Sao_Paulo')::date;
$$;
-- Single authoritative status implementation. NULL means excluded/deleted.
create function public.offer_effective_status(p_offer public.offers) returns text
language sql stable set search_path = '' as $$
  select case
    when p_offer.deleted_at is not null then null
    when p_offer.published_at is null then 'draft'
    when not p_offer.enabled then 'inactive'
    when p_offer.starts_on > (transaction_timestamp() at time zone 'America/Sao_Paulo')::date then 'scheduled'
    when p_offer.expires_on < (transaction_timestamp() at time zone 'America/Sao_Paulo')::date then 'expired'
    else 'active' end;
$$;

create function cms_private.guard_partner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.ever_associated or exists (select 1 from public.offers where partner_id = OLD.id) then
      raise exception 'Partner has Offer association history';
    end if;
    return OLD;
  end if;
  if TG_OP = 'UPDATE' and NEW.ever_associated is distinct from OLD.ever_associated then
    if OLD.ever_associated then
      raise exception 'Partner association history cannot be reset';
    end if;
    -- Only the nested association trigger, running as its trusted owner, may
    -- record history. Neither trigger depth alone nor a caller-set GUC authorizes it.
    if pg_trigger_depth() <> 2
      or current_user <> pg_get_userbyid((
        select proowner from pg_catalog.pg_proc
        where oid = 'cms_private.remember_association()'::regprocedure
      ))
      or not exists (select 1 from public.offers where partner_id = NEW.id)
    then
      raise exception 'Partner association history is database controlled';
    end if;
  end if;
  return NEW;
end;
$$;
create trigger partners_domain_guard before update or delete on public.partners
for each row execute function cms_private.guard_partner();

create function cms_private.guard_offer() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'DELETE' then raise exception 'Offers cannot be hard deleted'; end if;
  if TG_OP = 'INSERT' then
    if NEW.deleted_at is not null then raise exception 'Cannot insert deleted Offer'; end if;
  else
    if OLD.deleted_at is not null then raise exception 'Deleted Offers are immutable'; end if;
    if OLD.published_at is not null then
      if NEW.published_at is distinct from OLD.published_at then
        raise exception 'Publication timestamp is immutable';
      end if;
      if NEW.partner_id is distinct from OLD.partner_id then
        raise exception 'Published Partner is immutable';
      end if;
    end if;
    if NEW.deleted_at is not null then
      if public.offer_effective_status(OLD) = 'active' then
        raise exception 'Disable Active Offer before deleting';
      end if;
      if (to_jsonb(NEW) - 'deleted_at') is distinct from (to_jsonb(OLD) - 'deleted_at') then
        raise exception 'Deletion cannot change other fields';
      end if;
      NEW.deleted_at := transaction_timestamp();
    end if;
  end if;
  if NEW.published_at is not null and (TG_OP = 'INSERT' or OLD.published_at is null) then
    NEW.published_at := transaction_timestamp();
    if NEW.publication_mode = 'now' then
      NEW.starts_on := cms_private.business_date();
    elsif NEW.starts_on is null or NEW.starts_on < cms_private.business_date() then
      raise exception 'New Schedule requires today or a future date';
    end if;
  end if;
  return NEW;
end;
$$;
create trigger offers_domain_guard before insert or update or delete on public.offers
for each row execute function cms_private.guard_offer();

-- Definer needed to update the protected marker without granting it to clients.
-- Runs after FK checks; UPDATE locks the Partner and commits with the Offer.
create function cms_private.remember_association() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if NEW.partner_id is not null then
    update public.partners set ever_associated = true where id = NEW.partner_id;
  end if;
  return NEW;
end;
$$;
create trigger offers_remember_association after insert or update of partner_id on public.offers
for each row execute function cms_private.remember_association();

-- Full replacement of editable content. Caller explicitly chooses draft vs first publication.
-- Existing published rows stay published regardless of p_publish.
-- Their canonical Partner is preserved; p_partner_id only applies to Drafts/new rows.
create function public.save_offer(
  p_id uuid default null, p_partner_id uuid default null,
  p_title text default '', p_subtitle text default null, p_description text default '',
  p_publication_mode text default 'now', p_has_coupon boolean default false,
  p_coupon text default null, p_has_expiration boolean default false,
  p_starts_on date default null, p_expires_on date default null, p_publish boolean default false
) returns public.offers
language plpgsql security definer set search_path = '' as $$
declare v_offer public.offers;
begin
  if not cms_private.is_cms_admin() then raise exception 'CMS administrator required' using errcode = '42501'; end if;
  if p_publish is null then raise exception 'Publication command is required'; end if;
  if p_id is null then
    insert into public.offers (partner_id, title, subtitle, description, publication_mode,
      has_coupon, coupon, has_expiration, starts_on, expires_on, published_at)
    values (p_partner_id, p_title, p_subtitle, p_description, p_publication_mode,
      p_has_coupon, p_coupon, p_has_expiration, p_starts_on, p_expires_on,
      case when p_publish then transaction_timestamp() end)
    returning * into v_offer;
  else
    select * into v_offer from public.offers where id = p_id for update;
    if not found then raise exception 'Unknown Offer'; end if;
    update public.offers set partner_id = case when v_offer.published_at is not null
      then v_offer.partner_id else p_partner_id end, title = p_title, subtitle = p_subtitle,
      description = p_description, publication_mode = p_publication_mode,
      has_coupon = p_has_coupon, coupon = p_coupon, has_expiration = p_has_expiration,
      starts_on = p_starts_on, expires_on = p_expires_on,
      published_at = coalesce(v_offer.published_at, case when p_publish then transaction_timestamp() end)
    where id = p_id returning * into v_offer;
  end if;
  return v_offer;
end;
$$;

create function public.set_offer_enabled(p_id uuid, p_enabled boolean) returns public.offers
language plpgsql security definer set search_path = '' as $$
declare v_offer public.offers;
begin
  if not cms_private.is_cms_admin() then raise exception 'CMS administrator required' using errcode = '42501'; end if;
  select * into v_offer from public.offers where id = p_id for update;
  if not found or v_offer.published_at is null then raise exception 'Published Offer required'; end if;
  update public.offers set enabled = p_enabled where id = p_id returning * into v_offer;
  return v_offer;
end;
$$;
create function public.activate_scheduled_offer(p_id uuid) returns public.offers
language plpgsql security definer set search_path = '' as $$
declare v_offer public.offers;
begin
  if not cms_private.is_cms_admin() then raise exception 'CMS administrator required' using errcode = '42501'; end if;
  select * into v_offer from public.offers where id = p_id for update;
  if not found or public.offer_effective_status(v_offer) is distinct from 'scheduled' then
    raise exception 'Scheduled Offer required';
  end if;
  if v_offer.expires_on is not null and v_offer.expires_on < cms_private.business_date() then
    raise exception 'Scheduled Offer expiration cannot precede activation date';
  end if;
  update public.offers set starts_on = cms_private.business_date() where id = p_id returning * into v_offer;
  return v_offer;
end;
$$;
create function public.soft_delete_offer(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not cms_private.is_cms_admin() then raise exception 'CMS administrator required' using errcode = '42501'; end if;
  perform 1 from public.offers where id = p_id for update;
  if not found then raise exception 'Unknown Offer'; end if;
  update public.offers set deleted_at = transaction_timestamp() where id = p_id;
end;
$$;

alter table public.partners enable row level security;
alter table public.offers enable row level security;
alter table public.cms_admins enable row level security;
create policy partners_select on public.partners for select to authenticated using ((select cms_private.is_cms_admin()));
create policy partners_insert on public.partners for insert to authenticated with check ((select cms_private.is_cms_admin()) and not ever_associated);
create policy partners_update on public.partners for update to authenticated using ((select cms_private.is_cms_admin())) with check ((select cms_private.is_cms_admin()));
create policy partners_delete on public.partners for delete to authenticated using ((select cms_private.is_cms_admin()) and not ever_associated);
create policy offers_select on public.offers for select to authenticated using ((select cms_private.is_cms_admin()) and deleted_at is null);
-- Offer writes are exclusively authorized RPCs; no direct-write policies/grants.
create policy cms_admins_select_self on public.cms_admins for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.partners, public.offers, public.cms_admins from public, anon, authenticated;
grant select, delete on public.partners to authenticated;
grant insert (name, website, logo_path, logo_name), update (name, website, logo_path, logo_name) on public.partners to authenticated;
grant select on public.offers, public.cms_admins to authenticated;
revoke all on all functions in schema cms_private from public, anon, authenticated, service_role;
-- Invoker status projection computes the same date directly, so the private
-- date helper is needed only by trusted internal trigger/RPC execution.
grant execute on function cms_private.is_cms_admin() to authenticated;
-- Supabase default privileges can grant functions to API roles as well as PUBLIC.
revoke all on function public.offer_effective_status(public.offers),
  public.save_offer(uuid, uuid, text, text, text, text, boolean, text, boolean, date, date, boolean),
  public.set_offer_enabled(uuid, boolean), public.activate_scheduled_offer(uuid),
  public.soft_delete_offer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.offer_effective_status(public.offers),
  public.save_offer(uuid, uuid, text, text, text, text, boolean, text, boolean, date, date, boolean),
  public.set_offer_enabled(uuid, boolean), public.activate_scheduled_offer(uuid),
  public.soft_delete_offer(uuid) to authenticated;
commit;
