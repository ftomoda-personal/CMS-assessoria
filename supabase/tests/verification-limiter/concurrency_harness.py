"""AUTHOR ONLY. PostgreSQL harness requires separate authorization and a disposable DB.
--self-test runs isolated lifecycle/deadline tests only: no psql, SQL or DB connections.
"""
from pathlib import Path
import queue
import signal
import subprocess
import threading
import time

HERE = Path(__file__).resolve().parent
ADMIN = '10000000-0000-0000-0000-000000000001'
OTHER = '10000000-0000-0000-0000-000000000002'
SESSION = '30000000-0000-0000-0000-000000000001'
SHUTDOWN_SECONDS = 2.0


def request(n):
    return f'20000000-0000-0000-0000-{n:012d}'


class AsyncCall:
    """Own one bounded I/O operation; deliver exceptions to the controller."""
    def __init__(self, target):
        self.result = queue.Queue(maxsize=1)
        self.consumed = False
        def invoke():
            try:
                self.result.put((True, target()))
            except BaseException as error:
                self.result.put((False, error))
        self.thread = threading.Thread(target=invoke, daemon=True)
        self.thread.start()

    def get(self, timeout):
        if timeout <= 0:
            raise TimeoutError('Operation deadline expired')
        try:
            ok, value = self.result.get(timeout=timeout)
        except queue.Empty as error:
            raise TimeoutError('Operation deadline expired') from error
        self.consumed = True
        if not ok:
            raise value
        return value

    def finish(self, timeout):
        self.thread.join(timeout=timeout)
        if self.thread.is_alive():
            raise TimeoutError('I/O thread failed to stop after process teardown')
        if not self.consumed:
            self.get(timeout=timeout)


class CleanupFailures(RuntimeError):
    def __init__(self, errors):
        self.errors = tuple(errors)
        super().__init__('Cleanup/restoration failures: ' + '; '.join(repr(e) for e in errors))


def complete(primary, cleanup_errors):
    """Python 3.9+: retain primary type/traceback and report separate failures."""
    if primary is not None:
        if cleanup_errors:
            import sys
            primary.cleanup_failures = tuple(getattr(primary, 'cleanup_failures', ())) + tuple(cleanup_errors)
            for error in cleanup_errors:
                print(f'SEPARATE CLEANUP/RESTORATION FAILURE: {error!r}', file=sys.stderr)
        raise primary.with_traceback(primary.__traceback__)
    if cleanup_errors:
        raise CleanupFailures(cleanup_errors)


def teardown(process, calls=(), graceful=None, timeout=SHUTDOWN_SECONDS):
    """Graceful deadline -> terminate -> kill -> bounded reap -> join -> close pipes.
    Return every failure so it cannot replace the primary test exception.
    """
    errors = []
    joins = list(calls)
    if process.poll() is None and graceful is not None:
        try:
            shutdown = AsyncCall(graceful)
            joins.append(shutdown)
            shutdown.get(timeout=timeout)
        except BaseException as error:
            errors.append(error)
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            process.terminate()
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                process.kill()
                process.wait(timeout=timeout)
            except BaseException as error:
                errors.append(error)
        except BaseException as error:
            errors.append(error)
            try:
                process.kill()
                process.wait(timeout=timeout)
            except BaseException as kill_error:
                errors.append(kill_error)
    except BaseException as error:
        errors.append(error)
        try:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=timeout)
        except BaseException as kill_error:
            errors.append(kill_error)
    if process.poll() is None:
        errors.append(RuntimeError('Process still alive: cleanup incomplete; discard disposable database'))
    # Process exit releases pipe I/O before joins/closes; never close a buffered pipe
    # while an active communicate/writer thread owns its internal lock.
    active = False
    # Graceful holder shutdown may register a nested exchange task.
    joins.extend(call for call in calls if call not in joins)
    for call in joins:
        try:
            call.finish(timeout=timeout)
        except BaseException as error:
            errors.append(error)
            active = active or call.thread.is_alive()
    if active:
        errors.append(RuntimeError('Pipe closure unsafe while I/O thread remains active'))
    else:
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None and not stream.closed:
                try:
                    stream.close()
                except BaseException as error:
                    errors.append(error)
    return errors


def psql(**options):
    return subprocess.Popen(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, **options)


def worker(sql, timeout=20):
    p = psql()
    try:
        call = AsyncCall(lambda: p.communicate(sql, timeout=timeout))
    except BaseException as error:
        complete(error, teardown(p))
    return p, call


def interrupt(p):
    # psql SIGINT attempts PostgreSQL statement cancellation; ON_ERROR_STOP exits
    # and disconnects (aborting the transaction). Escalation handles unhealthy I/O.
    if p.poll() is None:
        p.send_signal(signal.SIGINT)


def run(sql, timeout=20):
    started = time.monotonic()
    p, call = worker(sql, timeout=timeout)
    primary = None
    result = None
    try:
        out, err = call.get(timeout=timeout - (time.monotonic() - started))
        result = subprocess.CompletedProcess(p.args, p.returncode, out, err)
    except BaseException as error:
        primary = error
    errors = teardown(p, (call,), graceful=lambda: interrupt(p))
    complete(primary, errors)
    return result


class Holder:
    def __init__(self):
        self.p = psql(bufsize=1)
        self.lines = queue.Queue()
        self.calls = []
        self.seq = 0
        self.healthy = True
        try:
            # Separate stderr reader avoids an undrained stderr pipe deadlock.
            self.calls.append(AsyncCall(self.read))
            self.calls.append(AsyncCall(self.read_errors))
        except BaseException as error:
            complete(error, teardown(self.p, self.calls))

    def read(self):
        try:
            for line in self.p.stdout:
                self.lines.put(line.rstrip())
        finally:
            self.lines.put(None)

    def read_errors(self):
        for line in self.p.stderr:
            self.lines.put('STDERR: ' + line.rstrip())

    def send(self, sql, timeout=20, exit_expected=False):
        if not self.healthy:
            raise RuntimeError('Holder communication unhealthy; restoration requires database discard')
        self.seq += 1
        marker = f'HOLDER_DONE_{self.seq}'
        deadline = time.monotonic() + timeout
        def exchange():
            self.p.stdin.write(sql + '\n' + ('' if exit_expected else '\\echo ' + marker + '\n'))
            self.p.stdin.flush()
            output = []
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('Holder command deadline expired')
                try:
                    line = self.lines.get(timeout=remaining)
                except queue.Empty as error:
                    raise TimeoutError('Holder command deadline expired') from error
                if line is None:
                    self.p.wait(timeout=max(0.001, deadline - time.monotonic()))
                    if exit_expected and self.p.returncode == 0:
                        return output
                    raise RuntimeError('Holder exited unexpectedly: ' + '\n'.join(output))
                if line == marker:
                    return output
                output.append(line)
        call = AsyncCall(exchange)
        self.calls.append(call)
        try:
            return call.get(timeout=timeout)
        except BaseException:
            self.healthy = False
            raise

    def close(self):
        graceful = (lambda: self.send('ROLLBACK;\n\\q', timeout=SHUTDOWN_SECONDS,
                                      exit_expected=True)) if self.healthy else None
        return teardown(self.p, self.calls, graceful=graceful)


def await_barrier(observe, failed, timeout=5, clock=time.monotonic):
    deadline = clock() + timeout
    while True:
        remaining = deadline - clock()
        if remaining <= 0:
            raise TimeoutError('Barrier deadline expired')
        observation = observe(remaining)
        # Include startup, connection, query and observation teardown elapsed time.
        if clock() >= deadline:
            raise TimeoutError('Barrier observation completed after deadline')
        if observation.returncode:
            raise RuntimeError('Barrier observation failed: ' + observation.stderr)
        if observation.stdout.strip() == 't':
            return
        if failed():
            raise RuntimeError('Synchronization failed: waiter exited before barrier')


def scenario(a, index, changes, other_admin, expected, timing):
    # Each case owns all configuration/limiter changes in A's transaction.
    # B rolls back; A commits visibility fixtures, cleaned in finally.
    name = f'limiter-B-{index}'
    q_a, q_b = request(index * 2), request(index * 2 + 1)
    # Holder failures before worker startup are handled by main teardown.
    a.send("BEGIN ISOLATION LEVEL READ COMMITTED; SELECT singleton FROM verification_private.global_lock WHERE singleton FOR UPDATE; "
           "UPDATE verification_private.configuration SET admin_budget=10,global_budget=100,admin_concurrency=1,global_concurrency=10,lease_seconds=86400; " + changes)
    # Fixture-only one-day TTL isolates lease timing. Still VERIFY it at completion.
    # Admission and release by A are committed only for rate/concurrency visibility;
    # cleanup restores configuration under the global lock in finally, even on failure.
    bsql = f"""\\set VERBOSITY verbose
SET application_name='{name}'; SET statement_timeout='10s';
BEGIN ISOLATION LEVEL READ COMMITTED;
DO $case$
DECLARE r jsonb; finished timestamptz;
BEGIN
 r := public.admit_partner_logo_verification('{q_b}','{other_admin}','{SESSION}');
 finished := pg_catalog.clock_timestamp();
 IF '{timing}' = 'rate' AND NOT EXISTS (SELECT 1 FROM verification_private.admissions
   WHERE request_id='{q_a}' AND admitted_at > finished - interval '60 seconds') THEN
   RAISE EXCEPTION 'INVALID TIMING: rate blocker outside window' USING ERRCODE='P0004';
 END IF;
 IF '{timing}' = 'lease' AND NOT EXISTS (SELECT 1 FROM verification_private.leases
   WHERE request_id='{q_a}' AND released_at IS NULL AND expires_at > finished) THEN
   RAISE EXCEPTION 'INVALID TIMING: lease blocker expired' USING ERRCODE='P0004';
 END IF;
 IF r IS DISTINCT FROM pg_catalog.jsonb_build_object('status','{expected}') THEN
   RAISE EXCEPTION 'Unexpected waiter response: %', r;
 END IF;
END $case$;
ROLLBACK;
"""
    p, call = worker(bsql)
    primary = None
    cleanup_errors = []
    try:
        await_barrier(
            lambda remaining: run(f"SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity b JOIN pg_catalog.pg_stat_activity a ON a.application_name='limiter-A' WHERE b.application_name='{name}' AND b.wait_event_type='Lock' AND a.pid=ANY(pg_catalog.pg_blocking_pids(b.pid)));", timeout=remaining),
            lambda: p.poll() is not None)
        # No manual pause between confirmed barrier, fresh A admission and commit.
        release = "PERFORM pg_temp.release_result(r);" if index == 2 else ''
        a.send(f"DO $$ DECLARE r jsonb; BEGIN r:=pg_temp.admit({index * 2}); PERFORM pg_temp.assert_true(r->>'status'='admitted','holder admitted'); {release} END $$; COMMIT;")
        out, err = call.get(timeout=20)
        if p.returncode:
            raise RuntimeError(err)  # INVALID TIMING means discard, not limiter failure.
        check = run(f"SELECT (SELECT count(*)=1 FROM verification_private.admissions WHERE request_id IN ('{q_a}','{q_b}')) AND (SELECT count(*)=1 FROM verification_private.leases WHERE request_id IN ('{q_a}','{q_b}'));")
        if check.returncode or check.stdout.strip() != 't':
            raise RuntimeError('Admission/lease cardinality mismatch: ' + check.stderr)
        print(f'Case {index}: barrier, waiter status, timing prerequisites and atomic cardinality verified')
    except BaseException as error:
        primary = error
    finally:
        cleanup_errors.extend(teardown(p, (call,), graceful=lambda: interrupt(p)))
        try:
            a.send("ROLLBACK; BEGIN; SELECT singleton FROM verification_private.global_lock WHERE singleton FOR UPDATE; TRUNCATE verification_private.leases,verification_private.admissions,verification_private.admin_locks; UPDATE verification_private.configuration SET admin_budget=10,global_budget=100,admin_concurrency=1,global_concurrency=10,lease_seconds=30; COMMIT;")
        except BaseException as error:
            cleanup_errors.append(error)
    complete(primary, cleanup_errors)


def main():
    import os
    if os.environ.get('LIMITER_DISPOSABLE_DB_AUTHORIZED') != 'yes':
        raise SystemExit('Refusing SQL execution without explicit disposable-database authorization flag')
    a = Holder()
    primary = None
    try:
        # Requires seed configuration, fresh fixtures and clean limiter; no unknown state reset.
        a.send("SET application_name='limiter-A'; SET statement_timeout='10s'; BEGIN; "
               "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM verification_private.configuration WHERE singleton AND window_seconds=60 AND admin_budget=10 AND global_budget=100 AND admin_concurrency=1 AND global_concurrency=10 AND lease_seconds=30) THEN RAISE EXCEPTION 'Seed configuration required'; END IF; IF EXISTS(SELECT 1 FROM verification_private.admissions) OR EXISTS(SELECT 1 FROM verification_private.leases) OR EXISTS(SELECT 1 FROM verification_private.admin_locks) THEN RAISE EXCEPTION 'Clean disposable limiter required'; END IF; END $$; "
               + (HERE / 'fixtures.sql').read_text() + '\nCOMMIT;')
        for args in ((1, 'UPDATE verification_private.configuration SET global_budget=1;', OTHER, 'rate-limited', 'rate'),
                     (2, 'UPDATE verification_private.configuration SET admin_budget=1;', ADMIN, 'rate-limited', 'rate'),
                     (3, 'UPDATE verification_private.configuration SET global_concurrency=1;', OTHER, 'concurrency-limited', 'lease'),
                     (4, '', ADMIN, 'concurrency-limited', 'lease')):
            scenario(a, *args)
    except BaseException as error:
        primary = error
    finally:
        errors = a.close()
    complete(primary, errors)
    print('Destroy the disposable database; fixture users/memberships intentionally remain there.')



def self_test():
    """Isolated fake subprocess/clock tests. Never invokes main, psql or worker."""
    import io
    import unittest

    class FakeProcess:
        def __init__(self, exit_on='graceful'):
            self.returncode = None
            self.exit_on = exit_on
            self.events = []
            self.stdin, self.stdout, self.stderr = io.StringIO(), io.StringIO(), io.StringIO()

        def poll(self):
            return self.returncode

        def wait(self, timeout):
            self.events.append(('wait', timeout))
            if self.returncode is None:
                raise subprocess.TimeoutExpired('fake', timeout)
            return self.returncode

        def graceful(self):
            self.events.append('graceful')
            if self.exit_on == 'graceful':
                self.returncode = 0

        def terminate(self):
            self.events.append('terminate')
            if self.exit_on == 'terminate':
                self.returncode = -15

        def kill(self):
            self.events.append('kill')
            self.returncode = -9

    class ReliabilityTests(unittest.TestCase):
        def assert_closed(self, p):
            self.assertIsNotNone(p.poll())
            self.assertTrue(all(stream.closed for stream in (p.stdin, p.stdout, p.stderr)))
            self.assertTrue(all(event[1] > 0 for event in p.events if isinstance(event, tuple)))

        def test_normal_exit(self):
            p = FakeProcess()
            self.assertEqual(teardown(p, graceful=p.graceful, timeout=0.05), [])
            self.assertNotIn('terminate', p.events)
            self.assert_closed(p)

        def test_already_exited(self):
            p = FakeProcess()
            p.returncode = 0
            self.assertEqual(teardown(p, graceful=p.graceful, timeout=0.05), [])
            self.assertNotIn('graceful', p.events)
            self.assert_closed(p)

        def test_ignores_graceful(self):
            p = FakeProcess('terminate')
            self.assertEqual(teardown(p, graceful=p.graceful, timeout=0.05), [])
            self.assertIn('terminate', p.events)
            self.assertNotIn('kill', p.events)
            self.assert_closed(p)

        def test_requires_kill(self):
            p = FakeProcess('kill')
            self.assertEqual(teardown(p, graceful=p.graceful, timeout=0.05), [])
            self.assertIn('terminate', p.events)
            self.assertIn('kill', p.events)
            self.assert_closed(p)

        def test_graceful_exception_reported(self):
            p = FakeProcess('terminate')
            def fail():
                raise BrokenPipeError('fake communication failure')
            errors = teardown(p, graceful=fail, timeout=0.05)
            self.assertTrue(any(isinstance(e, BrokenPipeError) for e in errors))
            self.assert_closed(p)

        def python_child(self, code):
            import sys
            p = subprocess.Popen([sys.executable, '-u', '-c', code], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            ready = AsyncCall(p.stdout.readline)
            try:
                self.assertEqual(ready.get(timeout=2).strip(), 'READY')
            except BaseException as error:
                complete(error, teardown(p, (ready,), timeout=0.1))
            return p, ready

        def test_real_child_normal_exit(self):
            p, ready = self.python_child("import sys; print('READY',flush=True); sys.stdin.readline()")
            errors = teardown(p, (ready,), graceful=lambda: p.communicate('exit\n', timeout=0.2), timeout=0.2)
            self.assertEqual(errors, [])
            self.assertEqual(p.returncode, 0)
            self.assertTrue(p.stdin.closed)

        def test_real_child_ignores_graceful(self):
            p, ready = self.python_child("import signal; print('READY',flush=True); signal.pause()")
            errors = teardown(p, (ready,), graceful=lambda: None, timeout=0.1)
            self.assertEqual(errors, [])
            self.assertEqual(p.returncode, -signal.SIGTERM)

        def test_real_child_requires_kill(self):
            p, ready = self.python_child("import signal; signal.signal(signal.SIGTERM,signal.SIG_IGN); print('READY',flush=True); signal.pause()")
            errors = teardown(p, (ready,), graceful=lambda: None, timeout=0.1)
            self.assertEqual(errors, [])
            self.assertEqual(p.returncode, -signal.SIGKILL)

        def test_holder_graceful_exchange_tasks_reaped(self):
            import sys
            from unittest.mock import patch
            code = ("import sys\n"
                    "for line in sys.stdin:\n"
                    " if line.startswith(chr(92)+'echo '): print(line[6:].strip(),flush=True)\n"
                    " if line.strip()==chr(92)+'q': break\n")
            def fake_psql(**options):
                return subprocess.Popen([sys.executable, '-u', '-c', code], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            with patch.dict(globals(), {'psql': fake_psql}):
                h = Holder()
                primary = None
                try:
                    h.send('NO_DATABASE_COMMAND', timeout=1)
                except BaseException as error:
                    primary = error
                errors = h.close()
                complete(primary, errors)
                self.assertEqual(h.p.returncode, 0)
                self.assertTrue(all(not call.thread.is_alive() for call in h.calls))
                self.assertTrue(all(stream.closed for stream in (h.p.stdin,h.p.stdout,h.p.stderr)))

        def test_worker_exception_propagated(self):
            def fail():
                raise ValueError('fake worker error')
            call = AsyncCall(fail)
            with self.assertRaisesRegex(ValueError, 'fake worker error'):
                call.get(timeout=0.1)
            call.finish(timeout=0.1)

        def test_unobserved_worker_exception_reported(self):
            def fail():
                raise ValueError('unobserved worker error')
            call = AsyncCall(fail)
            p = FakeProcess()
            p.returncode = 0
            errors = teardown(p, (call,), timeout=0.1)
            self.assertTrue(any(isinstance(e, ValueError) for e in errors))
            self.assert_closed(p)

        def test_cleanup_preserves_primary(self):
            primary = AssertionError('primary assertion')
            with self.assertRaises(AssertionError) as caught:
                complete(primary, [RuntimeError('restoration failed')])
            self.assertIs(caught.exception, primary)
            self.assertEqual(str(primary.cleanup_failures[0]), 'restoration failed')

        def test_cleanup_without_primary_fails(self):
            with self.assertRaises(CleanupFailures):
                complete(None, [RuntimeError('restoration failed')])

        def test_late_barrier_success_rejected(self):
            now = [0.0]
            def observe(remaining):
                self.assertEqual(remaining, 5)
                now[0] = 5.01
                return subprocess.CompletedProcess('fake', 0, 't', '')
            with self.assertRaisesRegex(TimeoutError, 'after deadline'):
                await_barrier(observe, lambda: False, clock=lambda: now[0])

        def test_observation_budget_decreases(self):
            now, budgets = [0.0], []
            def observe(remaining):
                budgets.append(remaining)
                now[0] += 2
                return subprocess.CompletedProcess('fake', 0, 'f', '')
            with self.assertRaises(TimeoutError):
                await_barrier(observe, lambda: False, clock=lambda: now[0])
            self.assertEqual(budgets, [5, 3, 1])

        def test_blocking_observation_timeout_propagates(self):
            def observe(remaining):
                self.assertEqual(remaining, 5)
                raise subprocess.TimeoutExpired('fake observation', remaining)
            with self.assertRaises(subprocess.TimeoutExpired):
                await_barrier(observe, lambda: False, clock=lambda: 0.0)

        def test_failed_synchronization_distinct(self):
            def observe(remaining):
                return subprocess.CompletedProcess('fake', 0, 'f', '')
            with self.assertRaisesRegex(RuntimeError, 'Synchronization failed'):
                await_barrier(observe, lambda: True, clock=lambda: 0.0)

        def test_unexpected_no_data_found_not_caught_statically(self):
            sql = (HERE / 'contracts.sql').read_text()
            block = sql.split('-- Subtransaction rollback', 1)[1].split('end $$;', 1)[0]
            self.assertIn("exception when sqlstate 'ZX601' then null", block)
            self.assertNotIn('no_data_found', block)
            self.assertNotIn("'P0002'", block)
            self.assertLess(block.index('admission and corresponding lease visible'),
                            block.index("using errcode = 'ZX601'"))
            self.assertIn('specific admission rollback', block)
            self.assertIn('lease rollback', block)

    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ReliabilityTests))
    if not result.wasSuccessful():
        raise SystemExit(1)


if __name__ == '__main__':
    import sys
    if sys.argv[1:] == ['--self-test']:
        self_test()
    elif sys.argv[1:]:
        raise SystemExit('Usage: concurrency_harness.py [--self-test]')
    else:
        main()
