# Phase 10B — Dev runtime validation

Validated 2026-10-06 against linked Development project `paismtbcqnxgwprqrfdm`, using Supabase CLI 2.120.0 and its existing authentication. No credentials were requested, printed or written to artifacts.

## Remote schema inspection

Verified 21 columns across three tables, 14 constraints, 5 indexes (three PK indexes plus two Offer indexes), 3 domain triggers, 10 functions and 6 policies. All three tables have RLS enabled. All ten remote function bodies match the applied local migration exactly; all function search_paths are empty. Column types/defaults/nullability, constraints, indexes, triggers, policy expressions, function ACLs and table/column grants were inspected and correspond to the migration.

Migration history contains `20261006000000`. Function owners are postgres. Existing default service_role table grants remain privileged platform grants; no service-role credentials were used for tests.

## Method and cleanup

Runtime tests used one DO statement with an inner PL/pgSQL subtransaction. A deliberate exception rolled back all disposable DML after successful assertions; unexpected test errors would also roll back and stop at the first failure. A final intentional P0001 exported the result matrix through the CLI error response and rolled back the whole statement. This CLI exit code 1 was expected, not a failed domain test. The decoded matrix contains 37 PASS results and no FAIL.

Tests changed SET LOCAL ROLE and transaction-local request.jwt.claim.sub, using the existing admin UUID only inside SQL and a random synthetic nonmember UUID that was not persisted or added to Auth. These test database authorization and RLS directly, not token issuance, JWT signature validation, PostgREST routing or HTTP behavior.

All disposable Partners, Offers and history-marker changes were rolled back. Final SELECT found zero Partners with the reserved CMS VALIDATION prefix; admin membership count remains one. No Auth user or cms_admins row was created, changed or deleted successfully. No disposable rows remain from this run. Rollback discards test transactions; it does not bypass deletion or history guards.

## Test matrix

| Scenario | Expected | Actual | PASS/FAIL/BLOCKED |
| --- | --- | --- | --- |
| Admin identity and own membership | Admin identity and own membership | Existing admin recognized; SELECT returned only own membership | PASS |
| Partner create and edit | Partner create and edit | Inserted A/B/free Partner and verified edited name | PASS |
| Client cannot manually set history | Client cannot manually set history | UPDATE rejected: permission denied | PASS |
| Unassociated Partner deletion | Unassociated Partner deletion | Free Partner removed; SELECT found no row | PASS |
| Incomplete Draft enabled and association history | Incomplete Draft enabled and association history | Draft incomplete, enabled, status draft; Partner marker true | PASS |
| Draft move A to B retains both histories | Draft move A to B retains both histories | Offer moved to B; A and B markers both true | PASS |
| Associated Partner cannot be deleted by admin | Associated Partner cannot be deleted by admin | Admin DELETE affected no protected row; A remains | PASS |
| Draft cannot be disabled | Draft cannot be disabled | RPC rejected: Published Offer required | PASS |
| Draft soft delete and hidden SELECT | Draft soft delete and hidden SELECT | Deleted Draft absent from authenticated Offer SELECT | PASS |
| Deleted Draft rejects save | Deleted Draft rejects save | Save rejected: Deleted Offers are immutable | PASS |
| Publish Now assigns server timestamp and business date | Publish Now assigns server timestamp and business date | Timestamp equals transaction_timestamp; start equals São Paulo today; Active | PASS |
| Published save preserves Partner and publication timestamp | Published save preserves Partner and publication timestamp | Canonical A and original timestamp retained despite B parameter and p_publish=false | PASS |
| Incomplete first publication rejected | Incomplete first publication rejected | Publication rejected by offers_publication_complete | PASS |
| Active deletion rejected | Active deletion rejected | Delete rejected: Disable Active Offer before deleting | PASS |
| Active disable yields Inactive | Active disable yields Inactive | Enabled false; effective inactive | PASS |
| Reenable preserves dates and yields Active | Reenable preserves dates and yields Active | Enabled true; effective active; dates unchanged | PASS |
| Future publication yields Scheduled | Future publication yields Scheduled | Published timestamp present; future start yields scheduled | PASS |
| Past first schedule rejected | Past first schedule rejected | RPC rejected: New Schedule requires today or a future date | PASS |
| Activate Scheduled Now preserves expiration | Activate Scheduled Now preserves expiration | Start set to today, expiration retained, effective active | PASS |
| Inclusive expiry today remains Active | Inclusive expiry today remains Active | Expiry today yields active | PASS |
| Historical edit produces Expired | Historical edit produces Expired | Historical start/expiry accepted; effective expired | PASS |
| Reenable historical Offer retains dates and Expired | Reenable historical Offer retains dates and Expired | Disable/re-enable retained dates and returned expired | PASS |
| Expired soft deletion allowed | Expired soft deletion allowed | Deleted Expired Offer absent from authenticated SELECT | PASS |
| Scheduled reenable keeps future dates | Scheduled reenable keeps future dates | Future start retained through disable/re-enable; scheduled | PASS |
| Scheduled soft deletion allowed | Scheduled soft deletion allowed | Scheduled deletion succeeded | PASS |
| Active disable then Inactive deletion allowed | Active disable then Inactive deletion allowed | Active disabled, then Inactive deletion succeeded | PASS |
| Deleted Offer cannot reenable or delete again | Deleted Offer cannot reenable or delete again | Re-enable and repeated deletion both rejected as immutable | PASS |
| Admin direct Offer writes unavailable | Admin direct Offer writes unavailable | INSERT, UPDATE and DELETE rejected: permission denied | PASS |
| Admin cannot provision/change membership | Admin cannot provision/change membership | Membership INSERT, UPDATE and DELETE rejected: permission denied | PASS |
| Private date and trigger functions deny direct execution | Private date and trigger functions deny direct execution | Date and all three trigger helpers rejected: permission denied | PASS |
| Anon application tables and RPC deny execution | Anon application tables and RPC deny execution | All three tables, save RPC and soft-delete RPC rejected: permission denied | PASS |
| Nonadmin SQL identity sees no rows and denied RPCs | Nonadmin SQL identity sees no rows and denied RPCs | Synthetic nonmember saw zero application/membership rows; Partner INSERT rejected by RLS; all four write RPCs denied | PASS |
| Owner direct history mutation denied both directions | Owner direct history mutation denied both directions | Owner standalone false→true and true→false updates rejected by guard | PASS |
| Owner associated Partner deletion rejected by guard | Owner associated Partner deletion rejected by guard | Owner deletion rejected: Partner has Offer association history | PASS |
| Trigger prevents published Partner/timestamp and Draft reversal | Trigger prevents published Partner/timestamp and Draft reversal | Direct Partner change, timestamp replacement and clearing rejected by trigger | PASS |
| Draft enabled CHECK and Offer hard delete guard | Draft enabled CHECK and Offer hard delete guard | Draft enabled=false rejected by CHECK; hard DELETE rejected by trigger | PASS |
| Deleted rows persisted with Partner, cannot restore or edit | Deleted rows persisted with Partner, cannot restore or edit | Deleted Draft persisted with B; restore/edit rejected by trigger | PASS |
| Invalid expiration during Activate Now | Domain error before date CHECK | Cannot construct through valid operations: Scheduled requires starts_on > today and CHECK enforces expires_on >= starts_on, hence expiry cannot be < today. Error branch exists in exact remote function body; not runtime exercised | BLOCKED |
| Real API/JWT admin, nonadmin and anon requests | Same authorization through HTTP/API | No API credentials/JWTs made available to test harness; no secrets requested or extracted | BLOCKED |
| Unintended private RPC exposure | Private trigger helpers unavailable through API | SQL execution denied for all trigger helpers; private schemas/function ACLs inspected. HTTP routing not tested | BLOCKED |
| True concurrent sessions | Domain invariants survive interleavings | Lock/FK/trigger definitions inspected; no overlapping-session test executed | BLOCKED |

## Catalog-only and runtime coverage distinction

Actual runtime SQL authorization covered: admin Partner CRUD, protected deletion, allowed RPC writes, forbidden direct Offer DML, forbidden membership DML, own membership visibility, synthetic nonadmin SELECT filtering/Partner INSERT denial/all four write RPC denials, anon SELECT denial on all tables plus save/delete execution denial, and authenticated private helper execution denial. All runtime tests explicitly used the relevant SQL roles, not owner-only assertions.

Catalog-only supplemental checks covered anon execution denial on every public CMS function, actual function owners/search_path/ACLs, RLS policy definitions, and private helper location. Catalog privilege checks confirmed all forbidden authenticated Offer writes, membership writes, marker column writes, and anon/authenticated date/helper execution are denied. Private trigger helpers are located in cms_private, not public; actual PostgREST schema exposure/routing remains untested.

## Concurrency

All existing-row commands lock the Offer with SELECT FOR UPDATE before mutation, including save/publication, enable, activation and deletion. FK ON DELETE RESTRICT and association-trigger Partner UPDATE protect deletion/association races. The legitimate nested marker transition was exercised through association and A→B Draft movement. Soft-delete and immutable publication/Partner guards execute on final rows. These are catalog/code inspections and sequential runtime tests, not proof from overlapping sessions. Deadlock retries and last-writer-wins full saves remain integration considerations.

## Findings and remaining limits

No database/domain defect was discovered in executed tests. No corrective migration is indicated by this evidence. The activation-expiration error is defensive and unreachable under currently valid Scheduled rows; constraints were not disabled to manufacture invalid data. HTTP/JWT behavior, PostgREST private schema routing, wall-clock midnight behavior, and true concurrency remain unverified. The test date was derived from the transaction timestamp in America/Sao_Paulo; inclusive today/yesterday semantics were runtime asserted.

Applied migration `20261006000000_initial_cms_foundation.sql` was not edited. SHA-256 before/after: `2ba9804e439e67c22b04d243cb3ebefa8ca8fac94d896203055a3abad2837f9d`.

Only this report was added to the repository. SQL harness and sanitized catalog/output artifacts stayed in /private/tmp. No new migration, database reset, unlink, Auth/Storage configuration, application/runtime dependency change, Vercel action, commit, push or deploy occurred.
