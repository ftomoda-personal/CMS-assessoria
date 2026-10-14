"""Offline regressions only. Git reads and temporary files; never SQL/network/psql."""
import copy
import json
import os
from pathlib import Path
import secrets
import shutil
import stat
import subprocess
import unittest
from unittest.mock import patch
from common import COMMIT, GATE, MIGRATION, REVIEWED, REPOSITORY, ROLES, SOURCE_HASH, Refused, digest, load_manifest, sanitized_environment, validate_copy, validate_manifest, workspace_path
from launcher import EXECUTION_BLOCKER, launch, prerequisites, proposed_guard, validate_plan, validate_server_evidence
from migration_copy import executable_copy, export, write_new


class LabTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.blobs = {p: subprocess.check_output(['git', '-C', str(REPOSITORY), 'show', COMMIT + ':' + p], timeout=10)
                     for p in REVIEWED}

    def setUp(self):
        self.nonce = secrets.token_hex(16)
        self.w = Path('/private/tmp') / ('limiter-lab-' + self.nonce)
        self.w.mkdir(mode=0o700)
        self.addCleanup(shutil.rmtree, self.w)
        for name, data in self.blobs.items():
            write_new(self.w / 'reviewed' / name, data)
        write_new(self.w / 'copies/limiter.blocked.sql', self.blobs[MIGRATION])
        write_new(self.w / 'copies/limiter.executable.sql', executable_copy(self.blobs[MIGRATION]))
        write_new(self.w / 'bootstrap.sql', Path(__file__).with_name('bootstrap.sql').read_bytes())
        write_new(self.w / 'empty.pgpass', b'')
        write_new(self.w / 'empty.pg_service.conf', b'')
        self.m = {'version': 1, 'state': 'planned', 'commit': COMMIT, 'source_hash': SOURCE_HASH,
                  'nonce': self.nonce, 'workspace': str(self.w), 'database': 'limiter_lab',
                  'postgres_major': 17, 'cluster_name': 'limiter-lab-' + self.nonce,
                  'data_dir': str(self.w / 'cluster'), 'socket_dir': str(self.w / 'socket'),
                  'port': 55417, 'roles': copy.deepcopy(ROLES), 'cluster_identity': None,
                  'artifacts': {str(p.relative_to(self.w)): digest(p.read_bytes()) for p in self.w.rglob('*')
                                if p.is_file() and p.name not in ('empty.pgpass','empty.pg_service.conf')}}
        self.path = self.w / 'manifest.json'
        write_new(self.path, (json.dumps(self.m) + '\n').encode())
        self.hash = digest(self.path.read_bytes())

    def test_valid_offline_plan(self):
        m, env = validate_plan(self.path, self.hash, {})
        self.assertEqual(m['database'], 'limiter_lab')
        self.assertEqual(env['PGHOST'], str(self.w / 'socket'))
        self.assertNotIn('PGPASSWORD', env)

    def test_missing_manifest(self):
        with self.assertRaises(Refused): load_manifest(self.w / 'absent.json')

    def test_malformed_manifest(self):
        self.path.write_text('{broken')
        with self.assertRaises(Refused): load_manifest(self.path)

    def test_wrong_workspace(self):
        self.m['workspace'] = str(REPOSITORY)
        with self.assertRaises(Refused): validate_manifest(self.m)

    def test_symlink_workspace(self):
        link = self.w / 'alias'
        link.symlink_to(self.w, target_is_directory=True)
        with self.assertRaises(Refused): workspace_path(link)

    def test_wrong_database(self):
        self.m['database'] = 'production'
        with self.assertRaises(Refused): validate_manifest(self.m)

    def test_wrong_roles(self):
        self.m['roles']['owner'] = 'service_role'
        with self.assertRaises(Refused): validate_manifest(self.m)

    def test_unexpected_environment(self):
        for name in ('PGHOST','PGHOSTADDR','PGSERVICE','PGPASSWORD','PGOPTIONS','DATABASE_URL','SUPABASE_ACCESS_TOKEN'):
            with self.subTest(name=name), self.assertRaises(Refused):
                sanitized_environment(self.m, {name: 'value-not-printed'})

    def test_invalid_artifact_hash(self):
        (self.w / 'bootstrap.sql').write_text('-- unauthorized change\n')
        with self.assertRaises(Refused): validate_manifest(self.m)

    def test_wrong_manifest_hash(self):
        with self.assertRaises(Refused): validate_plan(self.path, '0' * 64, {})

    def test_unexpected_connection_port(self):
        self.m['port'] = 5432
        with self.assertRaises(Refused): validate_manifest(self.m)

    def test_credentials_file_not_empty(self):
        (self.w / 'empty.pgpass').write_text('not empty')
        with self.assertRaises(Refused): validate_plan(self.path, self.hash, {})

    def test_missing_gate(self):
        with self.assertRaisesRegex(Refused, 'gate'):
            executable_copy(self.blobs[MIGRATION].replace(GATE,b''))

    def test_duplicated_gate(self):
        with self.assertRaisesRegex(Refused, 'gate'):
            executable_copy(self.blobs[MIGRATION] + GATE)

    def test_unauthorized_executable_diff(self):
        source = self.blobs[MIGRATION]
        with self.assertRaisesRegex(Refused, 'difference'):
            validate_copy(source, executable_copy(source) + b'-- additional edit\n')

    def test_copy_keeps_source(self):
        source = self.blobs[MIGRATION]
        self.assertEqual(digest(source), SOURCE_HASH)
        self.assertEqual(executable_copy(source), source.replace(GATE,b'',1))

    def test_prerequisites_fail_closed(self):
        with self.assertRaises(Refused): prerequisites(self.m)

    def test_authorization_flag_cannot_enable_launch(self):
        with patch.dict(os.environ, {'LIMITER_DISPOSABLE_DB_AUTHORIZED': 'yes'}):
            with self.assertRaisesRegex(Refused, 'SQL execution disabled'):
                launch(self.path, self.hash, {})

    def test_no_forged_server_attestation(self):
        self.m['cluster_identity'] = {'pid': 123, 'system_identifier': 'claimed'}
        with self.assertRaises(Refused): validate_manifest(self.m)

    def server_evidence(self):
        return {'major': 17, 'database': self.m['database'], 'nonce': self.nonce,
                'cluster_name': self.m['cluster_name'], 'session_user': ROLES['runner'],
                'current_user': ROLES['owner'], 'socket_dir': self.m['socket_dir'],
                'tcp_disabled': True, 'api_execute': False, 'api_private_access': False,
                'owner': ROLES['owner'], 'membership': {'role': ROLES['owner'],
                'member': ROLES['runner'], 'set': True, 'inherit': False, 'admin': False}}

    def test_server_role_mismatch(self):
        evidence = self.server_evidence()
        validate_server_evidence(self.m, evidence)
        evidence['current_user'] = 'service_role'
        with self.assertRaises(Refused): validate_server_evidence(self.m, evidence)

    def test_guard_is_sql_text_only(self):
        text = proposed_guard(self.m, require_limiter=True)
        self.assertIn('API execution exposed', text)
        self.assertIn('Wrong laboratory role graph', text)
        self.assertIn(self.nonce, text)
        self.assertIn('shobj_description', text)

    def test_export_rejects_overwrite(self):
        with self.assertRaises(Refused): export(self.w)

    def test_modified_gate(self):
        source = self.blobs[MIGRATION]
        executable_copy(source)
        modified = source.replace(GATE, GATE.replace(b'UNAPPLIED', b'MODIFIED'), 1)
        with self.assertRaisesRegex(Refused, 'gate'):
            executable_copy(modified)

    def test_artifact_path_traversal(self):
        validate_manifest(self.m)
        key = 'bootstrap.sql'
        self.m['artifacts']['../bootstrap.sql'] = self.m['artifacts'].pop(key)
        with self.assertRaisesRegex(Refused, 'allowlist'):
            validate_manifest(self.m)

    def test_symlinked_artifact(self):
        validate_manifest(self.m)
        path = self.w / 'bootstrap.sql'
        data = path.read_bytes()
        target = self.w / 'bootstrap-target.sql'
        write_new(target, data)
        path.unlink()
        path.symlink_to(target)
        with self.assertRaisesRegex(Refused, 'symlink'):
            validate_manifest(self.m)

    def test_existing_destination_unchanged(self):
        target = self.w / 'bootstrap.sql'
        original = target.read_bytes()
        with self.assertRaises(FileExistsError): write_new(target, b'changed')
        self.assertEqual(target.read_bytes(), original)
        self.assertEqual(list(self.w.glob('.limiter-publish-*')), [])

    def test_symlink_destination_not_followed(self):
        target = self.w / 'bootstrap.sql'
        original = target.read_bytes()
        link = self.w / 'output.sql'
        link.symlink_to(target)
        with self.assertRaises(FileExistsError): write_new(link, b'changed')
        self.assertTrue(link.is_symlink())
        self.assertEqual(target.read_bytes(), original)
        self.assertEqual(list(self.w.glob('.limiter-publish-*')), [])

    def test_symlink_intermediate_rejected(self):
        self.assertEqual(workspace_path(self.w), self.w)
        (self.w / 'alias').symlink_to(self.w / 'copies', target_is_directory=True)
        with self.assertRaises(OSError): write_new(self.w / 'alias/new.sql', b'changed')
        self.assertFalse((self.w / 'copies/new.sql').exists())

    def test_writer_path_traversal_rejected(self):
        workspace_path(self.w)
        with self.assertRaisesRegex(Refused, 'traversing'):
            write_new(self.w / 'copies/../new.sql', b'changed')
        self.assertFalse((self.w / 'new.sql').exists())

    def test_private_modes_from_creation(self):
        real_open = os.open
        created_modes = []
        def inspect_open(path, flags, mode=0o777, **kwargs):
            fd = real_open(path, flags, mode, **kwargs)
            if flags & os.O_CREAT:
                created_modes.append(stat.S_IMODE(os.fstat(fd).st_mode))
            return fd
        old = os.umask(0o022)
        try:
            with patch('migration_copy.os.open', side_effect=inspect_open):
                write_new(self.w / 'new/inner/output.sql', b'complete')
        finally:
            os.umask(old)
        self.assertEqual(created_modes, [0o600])
        for directory in (self.w / 'new', self.w / 'new/inner'):
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.w / 'new/inner/output.sql').stat().st_mode), 0o600)

    def test_nonprivate_existing_directory_rejected(self):
        directory = self.w / 'public-directory'
        directory.mkdir(mode=0o755)
        with self.assertRaisesRegex(Refused, '0700'):
            write_new(directory / 'output.sql', b'complete')
        self.assertFalse((directory / 'output.sql').exists())

    def test_partial_write_completes_before_publication(self):
        real_write, real_link = os.write, os.link
        target = self.w / 'output.sql'
        data = b'complete-content-with-several-short-writes'
        def short_write(fd, view):
            self.assertFalse(target.exists())
            return real_write(fd, view[:3])
        def inspect_link(source, destination, **kwargs):
            self.assertFalse(target.exists())
            self.assertEqual((self.w / source).read_bytes(), data)
            return real_link(source, destination, **kwargs)
        with patch('migration_copy.os.write', side_effect=short_write), patch('migration_copy.os.link', side_effect=inspect_link):
            write_new(target, data)
        self.assertEqual(target.read_bytes(), data)
        self.assertEqual(list(self.w.glob('.limiter-publish-*')), [])

    def test_partial_write_failure_cleans_temporary(self):
        real_write = os.write
        calls = [0]
        def fail(fd, view):
            calls[0] += 1
            if calls[0] == 1: return real_write(fd, view[:3])
            raise OSError('simulated interrupted write')
        target = self.w / 'output.sql'
        with patch('migration_copy.os.write', side_effect=fail):
            with self.assertRaisesRegex(OSError, 'interrupted'):
                write_new(target, b'longer-than-three')
        self.assertFalse(target.exists())
        self.assertEqual(list(self.w.glob('.limiter-publish-*')), [])

    def test_zero_write_refused(self):
        target = self.w / 'output.sql'
        with patch('migration_copy.os.write', return_value=0):
            with self.assertRaisesRegex(Refused, 'Zero-length'):
                write_new(target, b'complete')
        self.assertFalse(target.exists())
        self.assertEqual(list(self.w.glob('.limiter-publish-*')), [])

    def test_false_write_count_caught(self):
        target = self.w / 'output.sql'
        with patch('migration_copy.os.write', side_effect=lambda fd, view: len(view)):
            with self.assertRaisesRegex(Refused, 'byte verification'):
                write_new(target, b'complete')
        self.assertFalse(target.exists())
        self.assertEqual(list(self.w.glob('.limiter-publish-*')), [])

    def test_file_fsync_failure_cleans_temporary(self):
        real_fsync = os.fsync
        def fail(fd):
            if stat.S_ISREG(os.fstat(fd).st_mode): raise OSError('simulated file fsync failure')
            return real_fsync(fd)
        target = self.w / 'output.sql'
        with patch('migration_copy.os.fsync', side_effect=fail):
            with self.assertRaisesRegex(OSError, 'fsync'):
                write_new(target, b'complete')
        self.assertFalse(target.exists())
        self.assertEqual(list(self.w.glob('.limiter-publish-*')), [])

    def test_link_failure_cleans_temporary(self):
        target = self.w / 'output.sql'
        with patch('migration_copy.os.link', side_effect=OSError('simulated publication failure')):
            with self.assertRaisesRegex(OSError, 'publication'):
                write_new(target, b'complete')
        self.assertFalse(target.exists())
        self.assertEqual(list(self.w.glob('.limiter-publish-*')), [])

    def test_interrupted_export_no_approved_manifest(self):
        fresh = self.w.parent / ('limiter-lab-' + secrets.token_hex(16))
        fresh.mkdir(mode=0o700)
        self.addCleanup(shutil.rmtree, fresh)
        workspace_path(fresh)
        calls = [0]
        def fail(path, data):
            calls[0] += 1
            if calls[0] == 2: raise OSError('simulated interrupted export')
            return write_new(path, data)
        with patch('migration_copy.write_new', side_effect=fail):
            with self.assertRaisesRegex(OSError, 'interrupted export'): export(fresh)
        self.assertEqual((fresh / 'reviewed' / MIGRATION).read_bytes(), self.blobs[MIGRATION])
        self.assertFalse((fresh / 'manifest.json').exists())
        self.assertFalse((fresh / 'copies/limiter.executable.sql').exists())
        self.assertEqual(list(fresh.rglob('.limiter-publish-*')), [])

    def test_hash_mismatch_after_publication(self):
        validate_plan(self.path, self.hash, {})
        artifact = self.w / 'bootstrap.sql'
        artifact.write_bytes(artifact.read_bytes() + b'-- changed after publication\n')
        with self.assertRaisesRegex(Refused, 'Invalid artifact hash'):
            validate_plan(self.path, self.hash, {})

    def test_bootstrap_role_options(self):
        text = (self.w / 'bootstrap.sql').read_text()
        for option in ('SET TRUE','INHERIT FALSE','ADMIN FALSE'):
            self.assertIn('GRANT limiter_lab_owner TO limiter_lab_runner WITH ' + option + ';', text)
        self.assertEqual(text.count('CREATE ROLE '), 5)
        self.assertNotIn('CREATE TABLE public.partners', text)
        self.assertNotIn('CREATE TABLE public.offers', text)
        self.assertNotIn('GRANT EXECUTE', text)
        self.assertEqual(text.count('ENABLE ROW LEVEL SECURITY'), 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
