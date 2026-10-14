"""Generate a planned manifest/workspace ONLY. Does not initialize a PostgreSQL cluster."""
import argparse
import json
from pathlib import Path
import secrets
from common import COMMIT, ROLES, SOURCE_HASH, digest, validate_manifest
from migration_copy import export, write_new


def generate():
    nonce = secrets.token_hex(16)
    workspace = Path('/private/tmp') / ('limiter-lab-' + nonce)
    workspace.mkdir(mode=0o700)  # Never reuse a pre-existing path.
    try:
        artifacts = export(workspace)
        bootstrap = Path(__file__).with_name('bootstrap.sql').read_bytes()
        write_new(workspace / 'bootstrap.sql', bootstrap)
        artifacts['bootstrap.sql'] = digest(bootstrap)
        # Explicitly empty files prevent fallback to the operator's credential files.
        write_new(workspace / 'empty.pgpass', b'')
        write_new(workspace / 'empty.pg_service.conf', b'')
        manifest = {'version': 1, 'state': 'planned', 'commit': COMMIT, 'source_hash': SOURCE_HASH,
                    'nonce': nonce, 'workspace': str(workspace), 'database': 'limiter_lab',
                    'postgres_major': 17, 'cluster_name': 'limiter-lab-' + nonce,
                    'data_dir': str(workspace / 'cluster'), 'socket_dir': str(workspace / 'socket'),
                    'port': 55417, 'roles': ROLES, 'cluster_identity': None, 'artifacts': artifacts}
        validate_manifest(manifest)
        path = workspace / 'manifest.json'
        write_new(path, (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode())
        return path
    except BaseException:
        # Preserve partial exports for inspection; never delete an ambiguous path.
        print('Offline generation failed; inspect partial workspace:', workspace)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    path = generate()
    print('Planned manifest:', path)
    print('Manifest SHA-256:', digest(path.read_bytes()))
    print('Cluster identity intentionally unset; no database created or contacted.')


if __name__ == '__main__':
    main()
