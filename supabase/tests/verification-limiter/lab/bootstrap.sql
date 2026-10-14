-- LAB ONLY / AUTHOR ONLY. No Auth, PostgREST, Storage or business validation.
-- Future authorized execution: fresh private PostgreSQL 17 cluster ONLY.
-- Requires psql variable lab_nonce (32 lowercase hex) and cluster_name matching it.
\set ON_ERROR_STOP on
\if :{?lab_nonce}
\else
  SELECT 1 / 0 AS missing_lab_nonce;
\endif
SELECT current_database() = 'postgres'
  AND current_user = 'limiter_lab_bootstrap'
  AND session_user = 'limiter_lab_bootstrap'
  AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
  AND :'lab_nonce' ~ '^[0-9a-f]{32}$'
  AND current_setting('cluster_name') = 'limiter-lab-' || :'lab_nonce'
  AND current_setting('unix_socket_directories') = '/private/tmp/limiter-lab-' || :'lab_nonce' || '/socket'
  AND current_setting('listen_addresses') = ''
  AND inet_server_addr() IS NULL AS bootstrap_target_ok
\gset
\if :bootstrap_target_ok
\else
  SELECT 1 / 0 AS wrong_bootstrap_target;
\endif

BEGIN;
CREATE ROLE limiter_lab_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE limiter_lab_runner LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 6;
CREATE ROLE anon NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- PostgreSQL 17: one explicit membership option per GRANT.
GRANT limiter_lab_owner TO limiter_lab_runner WITH SET TRUE;
GRANT limiter_lab_owner TO limiter_lab_runner WITH INHERIT FALSE;
GRANT limiter_lab_owner TO limiter_lab_runner WITH ADMIN FALSE;
COMMIT;

-- CREATE DATABASE cannot be wrapped in the preceding transaction.
-- Any bootstrap failure invalidates the whole disposable cluster.
CREATE DATABASE limiter_lab OWNER limiter_lab_owner TEMPLATE template0
  ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C';
REVOKE ALL ON DATABASE limiter_lab FROM PUBLIC, anon, authenticated, service_role;
GRANT CONNECT, TEMPORARY ON DATABASE limiter_lab TO limiter_lab_runner;
COMMENT ON DATABASE limiter_lab IS :'lab_nonce';

-- Future executor must preserve the same guarded socket/bootstrap identity.
\connect limiter_lab
SELECT current_database() = 'limiter_lab'
  AND current_user = 'limiter_lab_bootstrap'
  AND session_user = 'limiter_lab_bootstrap'
  AND current_setting('cluster_name') = 'limiter-lab-' || :'lab_nonce'
  AND current_setting('unix_socket_directories') = '/private/tmp/limiter-lab-' || :'lab_nonce' || '/socket'
  AND current_setting('listen_addresses') = '' AND inet_server_addr() IS NULL
  AND (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname=current_database()) = :'lab_nonce'
  AS connected_lab_ok
\gset
\if :connected_lab_ok
\else
  SELECT 1 / 0 AS wrong_connected_target;
\endif
BEGIN;
SET LOCAL ROLE limiter_lab_owner;
ALTER SCHEMA public OWNER TO limiter_lab_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth AUTHORIZATION limiter_lab_owner;
REVOKE ALL ON SCHEMA auth FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.cms_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth.users, public.cms_admins FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cms_admins TO authenticated;
-- No API RLS policy: ordinary roles see no membership rows. The table owner
-- supplies fixture visibility without SUPERUSER/BYPASSRLS or production policy edits.
ALTER DEFAULT PRIVILEGES FOR ROLE limiter_lab_owner REVOKE EXECUTE ON FUNCTIONS
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
