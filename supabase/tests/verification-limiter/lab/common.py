"""Offline laboratory validation. No PostgreSQL/network client is imported."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat

REPOSITORY = Path(__file__).resolve().parents[4]
COMMIT = 'c7bb50aa48c9eeff10abc758e2510dcc6c2befe8'
MIGRATION = 'supabase/migrations/20261014000000_partner_logo_verification_limiter.sql'
SOURCE_HASH = '39d1ec602455cd2694b8253fdf316a68ceea6acb221c6a8a56253685c493b91a'
REVIEWED = (
    MIGRATION,
    'supabase/tests/verification-limiter/fixtures.sql',
    'supabase/tests/verification-limiter/contracts.sql',
    'supabase/tests/verification-limiter/catalog.sql',
    'supabase/tests/verification-limiter/concurrency.md',
    'supabase/tests/verification-limiter/static_checks.py',
    'supabase/tests/verification-limiter/concurrency_harness.py',
    'docs/phase-12b-3-5e-5d-3c-local-limiter-sql.md',
)
GATE = b"""DO $external_review_gate$
begin
  raise exception 'UNAPPLIED: external catalog/security review required before authorized gate removal'
    using errcode = '42501';
end;
$external_review_gate$;
"""
EXPECTED_ARTIFACTS = tuple('reviewed/' + p for p in REVIEWED) + (
    'copies/limiter.blocked.sql', 'copies/limiter.executable.sql', 'bootstrap.sql',
)
ROLES = {'runner': 'limiter_lab_runner', 'owner': 'limiter_lab_owner',
         'bootstrap': 'limiter_lab_bootstrap', 'api': ['anon', 'authenticated', 'service_role']}


class Refused(ValueError):
    pass


def require(ok, message):
    if not ok:
        raise Refused(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def private_path(path, directory=True):
    p = Path(path)
    require(p.is_absolute(), 'Path must be absolute')
    require(p == p.resolve(), 'Symlinks/noncanonical paths forbidden')
    require(p.is_dir() if directory else p.is_file(), 'Required path missing')
    info = p.stat()
    require(info.st_uid == os.getuid(), 'Wrong filesystem owner')
    require(stat.S_IMODE(info.st_mode) == (0o700 if directory else 0o600), 'Private permissions required')
    return p


def workspace_path(path, repository=REPOSITORY):
    p = private_path(path)
    repo = Path(repository).resolve()
    require(p != repo and repo not in p.parents and p not in repo.parents, 'Workspace must be outside repository')
    require(p.parent == Path('/private/tmp').resolve(), 'Workspace must be a direct private temporary-directory child')
    require(re.fullmatch(r'limiter-lab-[0-9a-f]{32}', p.name), 'Unexpected workspace name')
    require(not any((d / '.git').exists() or (d / 'supabase/.temp').exists()
                    for d in (p, *p.parents)), 'Linked/Git workspace forbidden')
    return p


def load_manifest(path):
    private_path(path, directory=False)
    try:
        value = json.loads(Path(path).read_text())
    except (OSError, ValueError) as error:
        raise Refused('Malformed manifest') from error
    require(isinstance(value, dict), 'Manifest must be an object')
    return value


def validate_manifest(m, repository=REPOSITORY):
    keys = {'version', 'state', 'commit', 'source_hash', 'nonce', 'workspace', 'database',
            'postgres_major', 'cluster_name', 'data_dir', 'socket_dir', 'port', 'roles',
            'cluster_identity', 'artifacts'}
    require(set(m) == keys, 'Unexpected/missing manifest fields')
    require(type(m['version']) is int and m['version'] == 1 and m['state'] == 'planned', 'Unsupported manifest state')
    require(m['commit'] == COMMIT and m['source_hash'] == SOURCE_HASH, 'Wrong committed source')
    require(isinstance(m['nonce'], str) and re.fullmatch('[0-9a-f]{32}', m['nonce']), 'Malformed nonce')
    w = workspace_path(m['workspace'], repository)
    require(w.name == 'limiter-lab-' + m['nonce'], 'Workspace/nonce mismatch')
    require(m['database'] == 'limiter_lab', 'Wrong database identity')
    require(type(m['postgres_major']) is int and m['postgres_major'] == 17, 'PostgreSQL 17 required')
    require(m['roles'] == ROLES, 'Role mismatch')
    require(m['cluster_name'] == 'limiter-lab-' + m['nonce'], 'Wrong cluster identity')
    require(m['data_dir'] == str(w / 'cluster') and m['socket_dir'] == str(w / 'socket'), 'Cluster/socket outside workspace')
    require(type(m['port']) is int and m['port'] == 55417, 'Unexpected port')
    require(m['cluster_identity'] is None, 'Unverified cluster attestation forbidden in planned manifest')
    require(isinstance(m['artifacts'], dict) and set(m['artifacts']) == set(EXPECTED_ARTIFACTS), 'Artifact allowlist mismatch')
    for name, expected in m['artifacts'].items():
        require(isinstance(expected, str) and re.fullmatch('[0-9a-f]{64}', expected), 'Malformed artifact hash')
        path = w / name
        require(path.resolve() == path and w in path.resolve().parents, 'Artifact symlink/escape')
        private_path(path, directory=False)
        require(digest(path.read_bytes()) == expected, 'Invalid artifact hash: ' + name)
    require(m['artifacts']['copies/limiter.blocked.sql'] == SOURCE_HASH, 'Wrong blocked migration hash')
    require(m['artifacts']['reviewed/' + MIGRATION] == SOURCE_HASH, 'Wrong reviewed migration hash')
    return w


def validate_copy(blocked, executable):
    require(digest(blocked) == SOURCE_HASH, 'Blocked source hash mismatch')
    require(blocked.count(GATE) == 1, 'Missing/duplicated exact gate')
    require(blocked.count(b'DO $external_review_gate$') == 1, 'Unexpected gate markers')
    expected = blocked.replace(GATE, b'', 1)
    require(executable == expected, 'Unauthorized executable-copy difference')
    return expected


def sanitized_environment(m, inherited):
    # Refuse ANY inherited libpq settings, even seemingly local ones. The launcher
    # must synthesize its own values after validating the manifest.
    bad = [k for k in inherited if k.startswith('PG') or 'SUPABASE' in k.upper()
           or k.upper() in {'DATABASE_URL', 'DB_URL', 'POSTGRES_URL', 'DATABASE_PASSWORD'}]
    require(not bad, 'Inherited connection/credential variables forbidden (values omitted)')
    w = Path(m['workspace'])
    return {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C',
            'PGHOST': str(w / 'socket'), 'PGPORT': str(m['port']),
            'PGDATABASE': m['database'], 'PGUSER': m['roles']['runner'],
            'PGOPTIONS': '-c role=' + m['roles']['owner'], 'PGCONNECT_TIMEOUT': '3',
            'PGPASSFILE': str(w / 'empty.pgpass'), 'PGSERVICEFILE': str(w / 'empty.pg_service.conf')}
