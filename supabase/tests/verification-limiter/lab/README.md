# Disposable PostgreSQL 17 laboratory — offline artifacts

These artifacts are AUTHOR ONLY. No PostgreSQL integration has executed. This phase does not install PostgreSQL, initialize/start a cluster, create roles/databases, execute bootstrap/migrations, contact Supabase or change committed code. `launcher.py` has an unconditional execution refusal and imports no database client. Its `--check-only` reports OFFLINE validation only, never server readiness.

## Files and trust boundary

- bootstrap.sql: proposed SQL for a new private cluster; creates only five synthetic roles, one database, auth.users(id), public.cms_admins(user_id), ACLs and RLS.
- common.py: pinned commit/hash, exact gate bytes, artifact allowlist, private workspace and manifest validation, environment allowlist.
- migration_copy.py: local Git reads only; exports the eight reviewed artifacts and creates blocked/executable copies without executing either.
- manifest.py: creates a new private temporary workspace and PLANNED manifest; does not create the cluster or its socket directory.
- launcher.py: validates a separately reviewed manifest hash, offline artifacts/copies/environment; contains proposed per-connection guard SQL as TEXT ONLY. Runtime execution is disabled even with a matching manifest or authorization flag.
- test_lab.py: standard-library tests using local Git reads and disposable filesystem fixtures; no SQL, psql, network or database calls.

The trusted boundary is the local operator/filesystem and a separately reviewed manifest digest, not the JSON document's self-declared hashes. The manifest digest must be reviewed and retained outside the manifest. Anyone controlling that operator can replace the tools; this design does not defend against the same trusted user's deliberate tampering.

## Minimal model and ownership

Use PostgreSQL 17, not a full Supabase stack. `gen_random_uuid()` and PL/pgSQL are native prerequisites; no pgcrypto, pgTAP or dblink is needed. Role membership uses separate PostgreSQL 17 `GRANT ... WITH SET TRUE`, `WITH INHERIT FALSE` and `WITH ADMIN FALSE` statements. Syntax was reviewed statically against PostgreSQL 17 GRANT documentation; compatibility has NOT been behaviorally validated.

The initdb administrator must be named limiter_lab_bootstrap and is used only for bootstrap/verification/destruction. limiter_lab_owner is NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION and NOBYPASSRLS. limiter_lab_runner is the sole login test role, NOINHERIT, permitted to SET ROLE to the owner without ADMIN OPTION. The three API roles are NOLOGIN with no owner memberships. Test sessions must connect as runner and explicitly assume the owner; `PGOPTIONS=-c role=limiter_lab_owner` is proposed but its startup behavior must be validated before use.

RLS is enabled with no API policies. authenticated retains SELECT on cms_admins but sees no rows. The owner sees synthetic membership via table ownership, not SUPERUSER/BYPASSRLS. This deliberately does not reproduce Supabase auth.users columns, auth.uid(), JWT verification, self-membership policy, service-role BYPASSRLS, default platform grants, Data API exposure or PostgREST. No real Auth/authorization claim follows from a passing laboratory test. No production policy is changed or weakened.

## Offline preparation commands — do not confuse with execution authorization

After this artifact set is reviewed, offline commands may be used to generate/inspect a workspace:

```text
python3 -B supabase/tests/verification-limiter/lab/manifest.py
python3 -B supabase/tests/verification-limiter/lab/launcher.py /private/tmp/limiter-lab-<nonce>/manifest.json --manifest-sha256 <separately-reviewed-hash> --check-only
```

The generator exclusively creates `/private/tmp/limiter-lab-<32-hex-nonce>` with mode 0700, files 0600, and no overwrite of existing exports. Cluster identity remains null. The manifest contains the planned private socket/data paths, database limiter_lab, port 55417, cluster name, role graph and hashes. It intentionally cannot meet runtime prerequisites. Failures may leave offline partial exports for inspection; the tool does not delete ambiguous directories.

Pinned source: commit c7bb50aa48c9eeff10abc758e2510dcc6c2befe8. Migration SHA-256: 39d1ec602455cd2694b8253fdf316a68ceea6acb221c6a8a56253685c493b91a.

`reviewed/` preserves the original tree so static_checks.py continues to find the BLOCKED migration. `copies/limiter.blocked.sql` is byte-identical to that committed migration. `copies/limiter.executable.sql` equals the original bytes minus exactly one full external_review_gate DO block. Missing/duplicated gates, changed source hashes and every other byte difference are rejected. Both copies are outside the repository's production migration directory. Existing committed files/blocker are never edited. No commented-out gate, caller-controlled override or broad regex removal is allowed.

## Separate future authorizations and connection safeguards

Installing tools requires separate authorization. Initializing/starting the laboratory and executing ANY SQL also requires explicit separate authorization. Neither the manifest nor LIMITER_DISPOSABLE_DB_AUTHORIZED=yes supplies it. The launcher does not contain a runtime switch that enables execution. A future reviewed runtime adapter and attestation format are required; do not bypass the refusal by invoking psql directly.

That future adapter must verify the workspace is canonical, outside every Git/linked project, private and owned by the operator; pin trusted psql/Python binaries; verify every artifact against the reviewed manifest digest; and reject inherited PG*, Supabase credential and database URL variables. It must construct its own environment, ignore existing .env files, and use empty explicit PGPASSFILE/PGSERVICEFILE rather than existing credentials. Arbitrarily named inherited variables are excluded from the child allowlist even when not recognized as credentials.

The private cluster must use `listen_addresses=''`, exactly the manifest socket directory, and peer authentication limited to the operator through a narrowly reviewed pg_ident/pg_hba mapping. No passwords or hosted credentials. Direct TCP access is disabled. Private directory ownership/permissions and socket identity must be verified, along with local postmaster PID, data directory and system identifier. OS process checks plus database evidence must agree; a supplied dictionary is not an attestation. `validate_server_evidence` is solely an offline regression model and never authorizes execution.

The proposed guard text checks database/nonce, server version, cluster/socket, no TCP, runner/effective owner, all five role flags, exact membership topology, bootstrap table ownership/RLS, migration state and post-application API execution/private access. It must run in each SAME execution connection before SQL, not through a separate connection with an assumed shared identity. Pre/post-migration forms are distinct. The bootstrap's initial and post-\connect guards run before mutations in those connections. They cannot replace OS/manifest verification.

Remaining runtime checks: fresh-cluster identification, schema/table/column/constraint counts, full default ACL inventory, owner membership visibility, PUBLIC private-schema/table ACLs, auth/public schema ownership, effective inherited privileges and exact post-application RPC return/signature/settings. bootstrap.sql contains CREATE DATABASE outside a transaction; failure invalidates the entire cluster, which must be discarded. Do not treat bootstrap as atomically rolled back.

## Future test sequence (not authorized here)

1. Review/install tools and create a fresh, private, independently identified cluster, then establish peer mapping/attestation through the future audited adapter. Never use this linked repository's Supabase CLI state.
2. Execute bootstrap with a validated nonce as the isolated bootstrap administrator; verify role graph, ownership, RLS, comments and seed absence. Roles/databases must not already exist.
3. Execute the original blocked COPY as the effective owner in one connection with ON_ERROR_STOP. Require SQLSTATE 42501 from the final gate; an earlier error is not proof. In a new guarded connection confirm the schema/functions do not exist. This tests actual transaction rollback.
4. Review the exact executable-copy difference. Execute only that temporary copy; retain BEGIN/COMMIT and all privilege preconditions/revocations. No grants to service_role. Use psql directly through the future guarded adapter, not an unverified migration runner that splits/commits statements or recovers through savepoints.
5. Verify actual catalogs and API denial. Run catalog.sql and contracts.sql in the clean database; their fixture changes roll back. contracts.sql must propagate unexpected failures and confirm ZX601 rollback of BOTH admission and lease.
6. Run the concurrency harness only with the future same-connection psql guard and sanitized private connection environment. It uses three connections (holder/waiter/observer); provision one additional administrative observer. The reviewed authorization flag remains additional, never sufficient.
7. For manual scenarios create a FRESH laboratory cluster/workspace with another nonce and bootstrap. The harness leaves synthetic auth users/memberships; do not insert those fixtures again or reuse the database as if clean. catalog/contracts can share a clean database; automated concurrency and manual fixtures cannot be mixed without separately verified recreation.
8. Complete concurrency.md cases: admin-lock initialization, replay/cross identity/lost acknowledgment, rollback with a waiter, membership revocation, duplicate release, lock_timeout, statement_timeout, exact-PID explicit cancellation and rollback of earlier admission/release work. Sleep is only a cancellation target, never a barrier.
9. Record actual results. Exact microsecond boundary is STILL source coverage only; no operational clock argument or behavioral controlled-clock mechanism has been introduced. Real network acknowledgment loss, Auth/PostgREST and deployment grants remain outside this suite.

## Cleanup and safe destruction

After a successful harness run verify configuration 60/10/100/1/10/30, no limiter fixtures, and no clients/threads/transactions/locks. Synthetic auth rows persist until cluster destruction. On any failed restoration, unclosed connection or uncertain backend state mark the run invalid; do not automatically reconnect/retry or reuse the database. Local subprocess reaping is not proof of server termination under network failures.

Before destruction revalidate the manifest digest, canonical path, nonce, local postmaster PID and system identifier. Stop only that cluster after separate authorization, confirm all its sessions/processes/socket are gone, and remove only that exact private temporary directory. Never use broad globs, recursive delete of the repository, hosted DROP DATABASE or production cleanup. Cleanup tooling is intentionally not implemented in this offline phase.

## Offline validation

```text
python3 -B supabase/tests/verification-limiter/lab/test_lab.py
python3 -B supabase/tests/verification-limiter/static_checks.py
```

Tests cover missing/malformed manifest, wrong workspace/database/roles/port, symlinks, inherited credential variables, bad hashes, invalid copy differences, missing/duplicate gate, prerequisites, forged attestation, exact bootstrap membership statements and the unconditional launcher refusal. Tests use temporary files and local Git only. A passed offline check does not establish PostgreSQL syntax, transaction/locking behavior, peer authentication, startup SET ROLE or live permissions. Preserve retryAuthorization=none, writes=blocked, storage=preserve, historicalAttribution=unestablished and databasePersistence=unestablished.

## Offline publication hardening

`write_new` now creates a random temporary file in the destination directory with O_CREAT/O_EXCL/O_NOFOLLOW and mode 0600 from creation. It handles short writes, fsyncs the unbuffered file and rereads its complete bytes before publishing. Directory traversal uses directory descriptors, O_DIRECTORY/O_NOFOLLOW, ownership checks and exact mode 0700 for the workspace and every intermediate directory; existing nonprivate directories are rejected rather than silently changed.

Publication uses same-directory `os.link` with directory descriptors. The final name becomes visible atomically with complete content, or publication fails if any destination already exists (including a symlink). No os.replace/overwrite is used. After publication the directory is fsynced; the temporary link is removed and the directory fsynced again. Ordinary pre-publication failures leave no final name and clean the temporary file. Earlier completed files from an interrupted multi-artifact export remain for inspection, but no successful manifest is produced.

Platform assumptions: the supported local POSIX filesystem (macOS/APFS or equivalent) must support hard links, dir_fd, O_NOFOLLOW/O_DIRECTORY and file/directory fsync. No fallback to unsafe overwrite publication exists. This is atomic publication of each file, not an atomic transaction for the entire export. SIGKILL/power loss or cleanup/fsync failure can leave a temporary name or a COMPLETE published file; such a run is invalid until inspected and hashes verified. Same-user deliberate directory relocation/tampering remains within the existing trusted-operator boundary. No portable guarantee of crash durability beyond the filesystem's fsync contract is claimed.

The adversarial suite starts from valid fixtures and now covers complete evidence with only role identity changed, modified/missing/duplicate gates, traversal, symlinked artifacts/directories/destinations, short/zero/false writes, interrupted writes/exports, fsync/link failures, mode checks, no-overwrite behavior, temporary cleanup and post-publication hash mismatch. These tests are offline only and do not enable the launcher or validate PostgreSQL.
