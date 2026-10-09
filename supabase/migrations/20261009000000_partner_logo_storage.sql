-- Supabase Storage schema and the existing CMS admin helper are prerequisites.
-- Public delivery does not grant metadata listing. Uploads are append-only;
-- no SELECT, UPDATE or DELETE policy is introduced for this bucket.
begin;

-- Fail on an existing bucket instead of silently accepting conflicting settings.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'partner-logos',
  'partner-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg']::text[]
);

create policy partner_logos_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'partner-logos'
  and (select cms_private.is_cms_admin())
  -- Canonical lowercase UUID; exactly one folder and only approved extensions.
  and name ~ '^logos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](png|jpg)$'
);

commit;
