# L-02 — current account identity (local implementation, activation blocked)

## Security decision approved for this increment
The operator explicitly approved Supabase Auth plus current database authority as
the revised candidate architecture. Approval is conditional: verify bearer on the
backend, read role/status on every protected operation, deny absent/pending/disabled
or inconsistent accounts, prevent student escalation at API/RPC/table boundaries,
and document revocation limits. This is NOT evidence of ALS equivalence. Prior ALS,
F07/F10 and R3 evidence is preserved; its guarantees are not claimed by this code.

## Implemented local contract
`createCurrentAccountService` uses the existing exact-bearer parser, isolated
Supabase Auth factory and pure account eligibility helpers. getClaims receives
the original bearer with allowExpired:false; issuer/audience/subject/expiry/nbf
are checked against trusted server policy, followed by getUser on that same token.
JWT user_metadata/app_metadata never grant a CMS role. No cached account or actor
from request data is used. A request-local read must return account and membership
for the verified actor in one database snapshot. Null is confirmed absence only;
query errors must throw and become unavailable. All reads are awaited within an
explicit global budget; cancellation/late results cannot publish authority.

The query returns only `{account:{userId,role,status:'active'}}`. Administrator
requires role administrator, active status and matching current cms_admins row.
Student requires role student, active status and no conflicting admin membership.
Missing/ineligible/mismatched records fail closed; malformed evidence is unavailable.
`hasAdministrativeAccess`/`hasStudentAccess` now accept their actual three-field
projection type; their runtime eligibility logic is unchanged.

`createCmsHandler` implements POST /api/cms with exactly
`{operation:'current-account'}`. No user ID, requested role/status or business
operation is accepted. JSON is bounded to 2048 bytes and an explicit request
budget; this is an input-size cap, not a production timeout choice. Responses are
200 minimal own account, 401 authentication failure, 403 ineligible account,
400 malformed input, or 503 unavailable. Errors/headers do not echo credentials
or raw provider/database errors. Unknown operations remain 503; other methods
and paths retain the existing 405/404 handling. No provisioning/invite dispatch.

## Activation blocker — not hidden by injection
The HTTP factory and service are implemented, but api/cms.ts still binds the
existing unavailable handler. No concrete database reader, env composition, SQL
function, credential, role or grant has been fabricated. Therefore the default
endpoint remains 503 and the integrated frontend remains fail-closed. Positive
HTTP cases are prepared with injected synthetic dependencies, not a live database.
This is NOT a completed operational end-to-end L-02 and must be reported BLOCKED.

I-01 revokes account reads/EXECUTE from API roles; I-02H can read only administrative
identity and cannot be widened implicitly to students or used for table access.
The future minimum capability is an own-account projection plus current membership
in one read snapshot, limited to the verified actor, through a reviewed JWT-bound
RPC or a separately qualified dedicated PostgreSQL reader. No broad SELECT on
accounts/auth.users, service_role/postgres fallback, or browser membership fallback
is proposed. The chosen channel, ownership, RLS, EXECUTE/schema/connection ACLs and
staging validation need separate authorization before binding the default handler.
Existing direct REST/RPC/table business surfaces must enforce current account
eligibility too; initial UI lookup does not close those existing access paths.
Do not deploy/unblock administrative writes on the strength of this endpoint.

## Frontend
AuthProvider now queries same-origin /api/cms rather than authorizing from a
self-membership query. Bearer is a header, never a URL/body field; fetch omits
cookies, disallows redirects and has no retry. The response is shape/actor checked.
Auth events, refresh and retry use snapshot/attempt binding and cancellation so
old responses cannot overwrite new authority. Recovery isolation remains intact.
Only administrator results retain authorization='authorized', which is what the
existing CMS data provider requires. Students use a distinct state and /student
placeholder; administrative children never mount for students. This is neither a
catalog nor a complete account management UI. The default unavailable API shows
an error; no fallback to old membership or JWT roles is permitted.

## Revocation and separate environments
Account disablement/role changes must be checked by every protected server/SQL
operation; a previous current-account response is not a reusable authorization.
Frontend session-bound results can become stale and are presentation only.
Removing business authorization does not erase an access token, refresh token or
session. getClaims/getUser do not prove all-channel continuous session liveness,
immediate JWT revocation, password-grant purpose or ALS admission. Access-token
expiry, refresh/session invalidation and account denial are distinct. No stronger
logout/password/recovery revocation claim is made. Production policy must retain
these limitations explicitly and close direct-access enforcement before release.

No target is selected implicitly. Future server composition must bind a separately
reviewed HTTPS project origin/public key, audience, budgets and DB identity to its
own environment. Derive issuer from that trusted origin, never bearer claims or
HTTP input. Staging and production must have distinct configuration; the staging
I-02H transport profile is not a production profile. No VITE_* secret, env file or
configuration change was introduced. Development was not accessed.

## Prepared validation (NOT_EXECUTED)
- cms-current-account.test.ts: active admin/student; pending/disabled/missing;
  historical/foreign/conflicting membership; exact bearer and Auth subject/project;
  invalid authentication versus Auth outage; DB outage; current disablement on a
  second query; role/status/actor injection; direct unimplemented administrative
  operations; timeout/late result and cancellation; input size bounds.
- cms-current-account-client.test.ts: minimal DTO/actor binding, role area selection,
  HTTP error distinctions, invalid projections, transport failure and cancellation.
- Existing backend-boundary static assertions are updated for a type-only service
  dependency and explicit injected HTTP timer; the default entrypoint stays inert.
- Offline browser fixture has an explicit fake current-account transport alias;
  it reads only in-memory synthetic state and never creates a server connection.
  A prepared responsive-auth scenario transitions an admin fixture into an active
  student, attempts the admin URL and then disables the student, asserting no
  administrative table mounts. All browser scenarios remain NOT_EXECUTED.

Real negative tests of PostgREST/RPC/table access and real Auth/JWKS/project/TLS
behavior are still pending. Synthetic tests are not that evidence. No tests,
build, typecheck, SQL, migration, provisioning, fixture creation, deploy, dependency
installation or harness R3 execution occurred in this increment. Existing R3
artifacts and evidence are unchanged. The shared domain.ts parameter types changed
to their minimum projection; historical R3 copies keep their original bytes and
must not be rewritten to match this new revision. Earlier test/typecheck results
are not automatically evidence for the L-02 changes.

## Next minimum boundary
Review local diffs and authorize focused tests/typechecks separately. In parallel,
approve the minimal database read channel and direct-access account enforcement
change, with explicit SQL/privilege scope; do not silently lift I-01 containment.
Only after that channel is implemented/qualified should the real handler receive
its dependencies and be homologated in staging with approved fixtures. No role or
secret is requested or generated by this document.
