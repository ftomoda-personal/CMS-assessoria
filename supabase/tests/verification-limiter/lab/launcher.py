"""Offline launcher safety planner. EXECUTION IS UNCONDITIONALLY DISABLED."""
import argparse
import json
import os
from pathlib import Path
import stat
from common import ROLES, Refused, digest, load_manifest, private_path, require, sanitized_environment, validate_copy, validate_manifest

EXECUTION_BLOCKER = 'SQL execution disabled in this phase; separate authorization and audited runtime adapter required'


def validate_plan(path, manifest_hash, inherited, repository=None):
    require(isinstance(manifest_hash, str) and len(manifest_hash) == 64,
            'Reviewed manifest SHA-256 required outside the manifest')
    m = load_manifest(path)
    require(digest(Path(path).read_bytes()) == manifest_hash, 'Manifest hash mismatch')
    w = validate_manifest(m) if repository is None else validate_manifest(m, repository)
    require(Path(path) == w / 'manifest.json', 'Manifest outside declared workspace')
    validate_copy((w / 'copies/limiter.blocked.sql').read_bytes(),
                  (w / 'copies/limiter.executable.sql').read_bytes())
    for name in ('empty.pgpass', 'empty.pg_service.conf'):
        p = private_path(w / name, directory=False)
        require(p.read_bytes() == b'', 'Credential/service file must be empty')
    env = sanitized_environment(m, inherited)
    return m, env


def validate_server_evidence(m, evidence):
    """Pure offline regression model, NOT server attestation or authorization."""
    expected = {'major': 17, 'database': m['database'], 'nonce': m['nonce'],
                'cluster_name': m['cluster_name'], 'session_user': ROLES['runner'],
                'current_user': ROLES['owner'], 'socket_dir': m['socket_dir'],
                'tcp_disabled': True, 'api_execute': False, 'api_private_access': False,
                'owner': ROLES['owner'], 'membership': {'role': ROLES['owner'],
                'member': ROLES['runner'], 'set': True, 'inherit': False, 'admin': False}}
    require(evidence == expected, 'Unexpected server identity/roles/ACL evidence')
    # Never permits execution, even if a caller supplies a matching dictionary.


def prerequisites(m):
    w = Path(m['workspace'])
    private_path(w / 'cluster')
    private_path(w / 'socket')
    sock = w / 'socket' / ('.s.PGSQL.' + str(m['port']))
    require(sock.exists() and not sock.is_symlink() and stat.S_ISSOCK(sock.stat().st_mode), 'Private Unix socket unavailable')
    require(sock.stat().st_uid == os.getuid(), 'Socket owner mismatch')
    require(m['cluster_identity'] is not None, 'Verified cluster PID/system identity unavailable')
    # Planned manifests intentionally cannot satisfy cluster attestation.


def proposed_guard(m, require_limiter=False):
    """SQL TEXT ONLY. Future adapter must run this in EACH execution connection."""
    validate_manifest(m)
    socket = m['socket_dir'].replace("'", "''")
    return f"""DO $lab_target_guard$
DECLARE r record; f record; t record;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
    OR pg_catalog.current_database() <> 'limiter_lab'
    OR session_user <> 'limiter_lab_runner' OR current_user <> 'limiter_lab_owner'
    OR pg_catalog.current_setting('cluster_name') <> '{m['cluster_name']}'
    OR pg_catalog.current_setting('listen_addresses') <> ''
    OR pg_catalog.current_setting('unix_socket_directories') <> '{socket}'
    OR pg_catalog.inet_server_addr() IS NOT NULL
    OR (SELECT pg_catalog.shobj_description(oid, 'pg_database') FROM pg_catalog.pg_database
         WHERE datname = pg_catalog.current_database()) IS DISTINCT FROM '{m['nonce']}'
  THEN RAISE EXCEPTION 'Wrong laboratory connection' USING ERRCODE = '42501'; END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_roles WHERE rolname IN
       ('limiter_lab_owner','limiter_lab_runner','anon','authenticated','service_role')
       AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
       AND NOT rolbypassrls AND NOT rolinherit
       AND rolcanlogin = (rolname = 'limiter_lab_runner')) <> 5
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_auth_members m
         JOIN pg_catalog.pg_roles member_role ON member_role.oid = m.member
         JOIN pg_catalog.pg_roles parent_role ON parent_role.oid = m.roleid
         WHERE member_role.rolname IN ('limiter_lab_owner','limiter_lab_runner','anon','authenticated','service_role')
            OR parent_role.rolname IN ('limiter_lab_owner','limiter_lab_runner','anon','authenticated','service_role')) <> 1
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
         JOIN pg_catalog.pg_roles member_role ON member_role.oid = m.member
         JOIN pg_catalog.pg_roles parent_role ON parent_role.oid = m.roleid
         WHERE member_role.rolname = 'limiter_lab_runner' AND parent_role.rolname = 'limiter_lab_owner'
           AND m.set_option AND NOT m.inherit_option AND NOT m.admin_option)
  THEN RAISE EXCEPTION 'Wrong laboratory role graph' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles o ON o.oid=d.datdba
       WHERE d.datname=pg_catalog.current_database() AND o.rolname='limiter_lab_owner')
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
         JOIN pg_catalog.pg_roles o ON o.oid=c.relowner
         WHERE (n.nspname,c.relname) IN (('auth','users'),('public','cms_admins'))
           AND o.rolname='limiter_lab_owner' AND c.relrowsecurity AND NOT c.relforcerowsecurity) <> 2
  THEN RAISE EXCEPTION 'Wrong bootstrap ownership/RLS' USING ERRCODE='42501'; END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname IN ('admit_partner_logo_verification','release_partner_logo_verification')) <> {2 if require_limiter else 0}
  THEN RAISE EXCEPTION 'Wrong migration state' USING ERRCODE='42501'; END IF;
  FOR f IN SELECT p.oid,p.proowner,p.prosecdef,p.provolatile,p.proconfig FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname IN ('admit_partner_logo_verification','release_partner_logo_verification') LOOP
    IF pg_catalog.pg_get_userbyid(f.proowner) <> 'limiter_lab_owner' OR NOT f.prosecdef
      OR f.provolatile <> 'v' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
        LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        WHERE p.oid=f.oid AND a.grantee=0)
    THEN RAISE EXCEPTION 'Unsafe RPC owner/settings/PUBLIC ACL' USING ERRCODE='42501'; END IF;
    FOR r IN SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
      IF pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE') THEN
        RAISE EXCEPTION 'API execution exposed' USING ERRCODE='42501'; END IF;
    END LOOP;
  END LOOP;
  IF {'true' if require_limiter else 'false'} THEN
    IF pg_catalog.to_regprocedure('public.admit_partner_logo_verification(uuid,uuid,uuid)') IS NULL
      OR pg_catalog.to_regprocedure('public.release_partner_logo_verification(uuid,uuid,uuid,uuid)') IS NULL THEN
      RAISE EXCEPTION 'Wrong RPC signatures' USING ERRCODE='42501'; END IF;
    FOR r IN SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
      IF pg_catalog.has_schema_privilege(r.oid,'verification_private','USAGE,CREATE') THEN
        RAISE EXCEPTION 'API private schema access' USING ERRCODE='42501'; END IF;
      FOR t IN SELECT c.oid,c.relowner FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='verification_private' AND c.relkind='r' LOOP
        IF pg_catalog.pg_get_userbyid(t.relowner)<>'limiter_lab_owner'
          OR pg_catalog.has_table_privilege(r.oid,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
          RAISE EXCEPTION 'Unsafe private table ownership/access' USING ERRCODE='42501'; END IF;
      END LOOP;
    END LOOP;
  ELSIF pg_catalog.to_regnamespace('verification_private') IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected limiter schema before application' USING ERRCODE='42501';
  END IF;
END;
$lab_target_guard$;
"""


def launch(path, manifest_hash, inherited):
    m, env = validate_plan(path, manifest_hash, inherited)
    # Deliberately no database client, subprocess, exec or network call here.
    raise Refused(EXECUTION_BLOCKER)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    try:
        m, env = validate_plan(args.manifest, args.manifest_sha256, os.environ)
        if not args.check_only:
            raise Refused(EXECUTION_BLOCKER)
        print(json.dumps({'offline_checks': 'passed', 'execution': 'disabled',
                          'cluster_identity': 'unverified', 'database': m['database']}, indent=2))
    except (Refused, OSError, TypeError, KeyError) as error:
        parser.exit(2, 'REFUSED: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
