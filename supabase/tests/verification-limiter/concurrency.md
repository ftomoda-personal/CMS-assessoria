# AUTHOR ONLY — barrier orchestration with timing validity checks

Do not run in this phase. Requires an isolated disposable PostgreSQL database, reviewed migration application, fixtures and test-owner access. No dblink, extensions or dependencies. Use three interactive psql connections A, B, C with ON_ERROR_STOP. Give each a unique application_name (`limiter-A`, `limiter-B`, `limiter-C`); use READ COMMITTED. C needs pg_stat_activity visibility. Abort on any unexpected result or barrier timeout. Polling the predicates below is synchronization; sleeps alone are not a barrier.

For manual cases use a fresh disposable database separate from the automated harness fixture setup. Setup, in A: `BEGIN; \ir fixtures.sql`, then COMMIT (temporary helpers remain on A only). B uses explicit RPC arguments as below. Reset before each scenario in A, in a transaction: SELECT singleton FROM verification_private.global_lock WHERE singleton FOR UPDATE; TRUNCATE verification_private.leases, verification_private.admissions, verification_private.admin_locks; UPDATE verification_private.configuration SET admin_budget=10, global_budget=100, admin_concurrency=1, global_concurrency=10, lease_seconds=86400; COMMIT. This fixture-only TTL is restored to 30 under the global lock in cleanup. Use only this disposable database. Admission identities are fixture admin UUIDs ending 001/002, session `30000000-0000-0000-0000-000000000001`; request UUIDs have prefix `20000000-0000-0000-0000-` and unique 12-digit suffixes.

## Automated primary budget/concurrency cases

`concurrency_harness.py` is an AUTHOR-ONLY stdlib driver for psql, not executed in this phase. After separate authorization, external catalog review and approved gate removal in a disposable database only, set libpq connection parameters and explicitly set LIMITER_DISPOSABLE_DB_AUTHORIZED=yes before invoking it. Do not put credentials in arguments or logs. The environment flag prevents accidents; it does not establish human authorization or prove a database is disposable.

The driver runs the global/admin budget and concurrency cases below. A is the holder, B the waiter, C polls pg_blocking_pids with a bounded barrier deadline. Once the barrier is true, A admits and commits without a manual pause. B records a completion clock after the actual RPC and checks that A's admission is still inside the 60-second window, or that A's lease is still unreleased and live. This completion check conservatively bounds the RPC's earlier evaluation clock. Only then is the expected result asserted. A timing failure is SQLSTATE P0004 (INVALID TIMING): discard, reset and repeat the test, never report a limiter regression or automatically retry the operational RPC.

A one-day TTL is an isolated disposable fixture override, not a production setting; expiration is still checked. The seed must initially be exactly 60/10/100/1/10/30. Cleanup in finally restores all seed values and truncates only disposable limiter fixtures under the global lock. Abnormal process/database failure may prevent cleanup: discard the entire disposable database before another run. Fixture users/memberships remain until database destruction. No runtime TTL/window overrides were added.

Remaining cases are explicit manual orchestration, not automated tests. Use the validity envelope below; an unbounded manual pause is never accepted as deterministic coverage.

## Shared lock-wait barrier

1. A: BEGIN; SELECT singleton FROM verification_private.global_lock WHERE singleton FOR UPDATE. Make any configuration changes for the scenario while this lock is held.
2. B: BEGIN ISOLATION LEVEL READ COMMITTED; invoke `SELECT public.admit_partner_logo_verification(request_uuid, admin_uuid, session_uuid)`; this must remain pending.
3. C confirms B is waiting **on A**, before A progresses:
   `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity b JOIN pg_catalog.pg_stat_activity a ON a.application_name='limiter-A' WHERE b.application_name='limiter-B' AND b.wait_event_type='Lock' AND a.pid = ANY(pg_catalog.pg_blocking_pids(b.pid)));`
   Require true. Operator completion of this query is the explicit barrier acknowledgment. Never commit A before it.
4. A performs its admission using a different request ID then COMMIT (or scenario-specific ROLLBACK). B finishes; assert its exact expected status and COMMIT. C checks admission/lease cardinality and identities. Define only the assert_true helper in C if desired (do not reinsert fixture users); any mismatch is failure.

## Validity envelope for every manual timing-sensitive case

B must execute one uninterrupted SQL batch: BEGIN; DO block that captures the RPC result, then clock_timestamp as completion time, verifies A's expected blocking admission/lease against that completion time, then asserts the expected status; COMMIT or ROLLBACK. Inspecting timing afterwards by hand is insufficient. For rates require A.admitted_at > completion - interval '60 seconds'; for concurrency and a first live release require A.expires_at > completion and the expected release state. For new admissions require the returned lease.expires_at > completion as well. If a prerequisite fails, RAISE EXCEPTION 'INVALID TIMING' USING ERRCODE='P0004', roll back and discard/reset/repeat that local case. Status assertion follows validity verification. See the actual DO block in concurrency_harness.py as the executable pattern.

Replay/ownership/revocation/rollback cases do not depend on retaining A's rate-window membership, but any expected NEW grant needs its configuration/history/lease prerequisites valid. For duplicate release, A performs release and validates it in the same uninterrupted batch after barrier acknowledgment; B's already-released expectation does not require an unexpired lease once confirmed release was committed. Set session statement_timeout=10s and a 5s barrier deadline; a missed barrier is an invalid run, not a successful assertion.

## Scenarios and exact assertions

| Scenario | A configuration / action after barrier | B invocation | Assertions after both commits |
|---|---|---|---|
| Concurrent global budget | global_budget=1; admit request 101 for admin 1 | request 102, admin 2 | A admitted; B rate-limited; exactly one admission and lease |
| Concurrent admin budget | admin_budget=1; admit 103, admin 1; release its lease before commit | 104, admin 1 | B rate-limited; one admission, one released lease |
| Global concurrency | global_concurrency=1; admit 105, admin 1 | 106, admin 2 | B concurrency-limited; one live lease |
| Admin concurrency | defaults; admit 107, admin 1 | 108, admin 1 | B concurrency-limited; one live lease |
| Concurrent creation of admin lock | admin_concurrency=2; admit 109, admin 1 | 110, admin 1 | Both admitted; one admin_locks row; two admissions and leases |
| Concurrent duplicate request | admit 111, admin 1 | 111, admin 1 | B replay (no lease_id); one admission/lease |
| Cross-identity replay | admit 112, admin 1 | 112, admin 2 | B ownership-denied; one admission/lease |
| Visibility after wait | global_budget=1; admit 113, admin 1 | 114, admin 2 | B rate-limited sees A's commit despite starting before it |
| Rollback while waiter pending | admit 115, admin 1, then ROLLBACK A | 116, admin 1 | B admitted; only request 116 stored; no lease or lock from A remains |
| Revocation during wait | DELETE membership for admin 2; COMMIT A, no A admission | 117, admin 2 | B membership-denied; no admission/lease/admin lock for admin 2; restore membership administratively |

For count assertions, inspect the exact request IDs as well as total counts; configuration/fixture reset is mandatory between rows. Global serialization intentionally serializes first insertion of admin lock rows as well.

## Lock timeout

A holds the global row. B: BEGIN; SET LOCAL lock_timeout='1s'; invoke admission 118. C confirms the shared barrier before timeout (if missed, repeat with a larger timeout). B must return SQLSTATE 55P03, never admitted/denied JSON. ROLLBACK B; ROLLBACK A; C asserts no request 118 or lease. Repeat for release of an existing live lease: timeout must not change released_at. Timeouts are errors and are never retried by an adapter.

## Commit with lost acknowledgment

A: BEGIN; SELECT pg_temp.admit(119); record returned lease; COMMIT. Deliberately discard the result/commit acknowledgment at the simulated adapter boundary. A new B transaction invokes admission with the same request/admin/session: require replay, no lease_id, exactly one admission and lease. This deterministically models a committed outcome with unknown client acknowledgment; it does not claim to simulate network transport failure. Adapter must block metadata on the lost acknowledgment and on replay. An explicit release using the recorded original tuple remains valid. Do not generate another request ID as an automatic retry.

## Duplicate release with contention

A holds global row and releases an admitted lease in its transaction. B issues release with the identical four UUIDs while A holds the lock. C confirms barrier; A commits. B returns already-released with all four UUIDs unchanged. C verifies a single unchanged released_at timestamp. Cross-administrator/session/request attempts must return ownership-denied and leave released_at unchanged; contracts.sql covers these tuples sequentially.

## Window boundary

Run static_checks.py without a database to check the actual global/admin count statements, strict lower bound, 60-second interval, admin filter and budget comparison. Its nine in-memory mutations must be rejected. Constant-only arithmetic assertions have been removed. contracts.sql exercises an RPC with history outside the window, not the exact microsecond boundary. Exact-clock behavioral integration remains pending an approved controlled-clock environment; no operational timestamp argument or test clock hook was introduced.

## statement_timeout and explicit cancellation — AUTHOR ONLY

Run each case in a fresh B connection with ON_ERROR_STOP and a unique application_name. A holds global, C verifies B blocked on A. Use statement_timeout=10s, lock_timeout=0 so cancellation, not lock timeout, is the expected cause. If the barrier is not observed before expiration, mark INVALID and repeat with a larger test-only deadline. Once the barrier is acknowledged, A continues holding the row until B exits with SQLSTATE 57014. B's connection must roll back/close; no JSON result is accepted.

- Admission: B begins, calls admission request 120. After 57014, release A's lock and assert no request 120 admission or lease and no waiter-created administrator lock. Verify no admission lacking a corresponding lease.
- Release: create and commit a live lease in the disposable database. B begins, attempts release with its exact tuple. After 57014, C requires released_at remains NULL; expiration alone is not success. No adapter may accept a void/success response for the canceled call.
- Explicit cancellation: repeat both with statement_timeout=0. After the blocking barrier, C calls pg_catalog.pg_cancel_backend on the EXACT B PID and requires true, then observes SQLSTATE 57014. PID comes from the unique application_name plus pg_blocking_pids match, not a reused/stale process ID. Do not use pg_terminate_backend. A remains locked until cancellation acknowledgment.

To verify partial transaction rollback deterministically, B first executes BEGIN; CREATE TABLE verification_private.cancellation_marker(id integer); INSERT INTO verification_private.cancellation_marker VALUES(1); before the blocked RPC before the blocked RPC; after cancellation and ROLLBACK/connection close, C verifies SELECT pg_catalog.to_regclass('verification_private.cancellation_marker') IS NULL returns true. Second cancellation variant: B first admits a distinct request under the global lock inside its open transaction, C captures the exact PID, then B runs SELECT pg_catalog.pg_sleep(3600). Configure statement_timeout=10s or have C cancel after observing B's active pg_sleep query. This sleep is solely an interrupt target, never a synchronization barrier. After error and transaction rollback, both the earlier admission and its lease must be absent. For release, B first releases a fixture lease, then runs the interrupt target in the SAME transaction; rollback must restore released_at=NULL. Set psql VERBOSITY=verbose to check SQLSTATE, and use exact UUID queries for both objects. This variant proves rollback of earlier transaction work, not cancellation at an internal RPC instruction. No internal-stage injection hook was added.

Uncaught PostgreSQL cancellation is an error; neither RPC catches or converts it to success. These are manual scenarios authored only. After all cases restore configuration to 60/10/100/1/10/30 under the global lock, then destroy the disposable database.

Finish by destroying the disposable database. Do not use production cleanup commands or run any of this against Development.

## F2 lifecycle/deadline reliability corrections

The rollback contract scenario now catches only the test-only sentinel ZX601, after a newly admitted response and a visible matching admission/lease pair. Unexpected P0002/SELECT INTO STRICT failures propagate; after subtransaction rollback the specific request's admission and lease must both be absent, in addition to the original count assertion.

All psql processes (holder, waiter and observations) share centralized teardown. Healthy holder shutdown sends ROLLBACK and quits; active waiters/observations receive SIGINT to attempt cancellation/disconnection. Graceful operations, wait, terminate, kill, reap and thread joins use bounded intervals (two seconds per teardown stage/task). Reader, writer and communicate thread errors are delivered to the controller. A holder communication failure disables further commands to prevent competing consumers or ambiguous restoration. Pipes close only after I/O tasks finish; an unreaped process/remaining I/O task is an explicit cleanup failure, never a successful run. Primary exceptions retain their type and traceback; cleanup/restoration failures are attached and reported separately. Python 3.9 or newer is supported.

Each barrier observation receives ONLY the remaining five-second budget. Startup, connection, query and observation teardown count toward the deadline, and even a true result arriving after the deadline is rejected. No arbitrary sleep implements synchronization. OS process creation and forced cleanup are not precisely interruptible by Python's subprocess API: physical return may exceed five seconds during those stages, but such an observation cannot produce an accepted barrier. Timeout and waiter-exited synchronization failure have distinct errors.

After separate authorization, real PostgreSQL teardown still needs validation: local process reaping cannot by itself prove backend termination through a broken network. Do not accept a failed-restoration run or reuse its database; require disposable database shutdown/destruction and external confirmation that its sessions/locks are gone. No automatic reconnection, RPC retry or privileged cleanup RPC was added.

`python3 supabase/tests/verification-limiter/concurrency_harness.py --self-test` selects dependency-free isolated regressions and NEVER calls the PostgreSQL main path, psql or the operational harness. Tests use fake processes/clocks and local Python child processes, including a minimal stdin/marker emulator; they cover normal exit, ignored graceful shutdown, kill escalation, worker errors, preservation of primary failures and barrier budget/late-success behavior. This mode is distinct from an authorized PostgreSQL harness run.
