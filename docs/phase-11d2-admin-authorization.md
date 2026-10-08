# Phase 11D.2 — CMS admin authorization

## Inspection and schema findings

Inspected AuthProvider/useAuth, AuthRouteBoundary, History API routes/navigation, LoginPage, Phase 11D.1 Navbar/logout, shared Supabase client, the initial migration and Phase 10A/10B/11A/11B/11C/11D.1 documentation before editing.

`public.cms_admins` has `user_id uuid primary key references auth.users(id) on delete cascade`. RLS is enabled. `cms_admins_select_self` permits SELECT for authenticated users only where `user_id = (select auth.uid())`; authenticated has SELECT privileges. Browser roles have no membership mutation grants/policies. Thus an authenticated client can safely check its own UUID through the public Data API, without enumerating other admins or privileged credentials.

Phase 10B records remote Development schema/policy verification and SQL runtime tests proving own-membership visibility and no rows for a synthetic nonmember. This phase inspected those existing findings and the migration; it did not perform a new remote catalog inspection or real authenticated HTTP/RLS test. No schema/policy problem requiring changes was found in the available evidence. Migrations, functions, permissions and database were not modified.

## Files

Modified:

- `src/app/auth.tsx`: membership verification and session-bound authorization results.
- `src/app/useAuth.ts`: explicit authorization status and retry action.
- `src/app/AuthRouteBoundary.tsx`: shared administrative gate and distinct blocked states.
- `src/app/layout/CmsNavigation.tsx`: consume extracted Logout hook; existing design and behavior preserved.

Created:

- `src/app/useLogout.ts`: Phase 11D.1 Logout logic shared with blocked-access UI.
- `src/app/AuthorizationNotice.tsx`: minimal access-denied/error experiences using Spectra Button/Toast.
- `src/app/authorization.css`: minimal layout/typography using existing tokens.
- `docs/phase-11d2-admin-authorization.md`: this report.

The previously modified `src/index.css` and untracked `src/assets/Corrida Urbana ao Pôr do Sol.png` were preserved without edits in this phase.

## Architecture and states

The existing AuthProvider and shared Supabase client remain the sole authentication infrastructure. Membership is queried outside the synchronous Auth listener using `from("cms_admins").select("user_id").eq("user_id", session.user.id).abortSignal(...).maybeSingle()`.

Authorization states exposed by useAuth:

- `checking`: auth restoration, new session/event or authorization retry pending.
- `unauthenticated`: no session.
- `authorized`: query succeeded with the current user's UUID.
- `unauthorized`: query succeeded without a matching membership row.
- `error`: query returned an error or threw; protected content stays blocked.

Email, user metadata and localStorage flags never authorize access. A result is accepted only for the exact session snapshot and retry attempt. Every Auth event creates a new snapshot, including refresh and same-user sessions, forcing a fresh query. The render immediately derives checking for an unmatched snapshot/attempt, before effects execute, preventing a protected-content flash. Effect cleanup aborts the request and rejects late updates. Even a result arriving before cleanup cannot match a newer snapshot/attempt. Auth events still take precedence over delayed getSession initialization. Only the existing Auth subscription exists; StrictMode cleanup remains intact.

Authorization remains in memory. Membership revocation is detected on the next auth event or explicit authorization recheck, not through realtime membership subscriptions. Database RLS remains the authoritative data protection; the interface gate is not a replacement.

## Routing and blocked UI

The root shared AuthRouteBoundary wraps all application routes, including six Offers/Partners routes and future routes. It mounts CMS children only after authorization succeeds. Unauthenticated users retain the existing safe login redirect; authorized users at Login are redirected to the validated destination/default Offers using replace semantics. Non-admin/error states stay at the current location (including Login) instead of bouncing between Login and CMS.

Non-admins see Acesso não autorizado, a short explanation and Sair. Query failures see a distinct verification error with Tentar novamente and Sair. Existing Spectra components/tokens keep the UI minimal; Navbar and Login were not redesigned.

Shared Logout preserves request locking, pending label/disabled state, generic retryable feedback on returned/thrown errors and success-only replacement to `/login`. The existing Auth listener clears access on sign-out. History entries remain protected by the same boundary.

## Validation

Passed:

- `npm run typecheck`.
- `npm run build` (nonblocking Vite warning: JS chunk slightly exceeds 500kB; no chunking/config changes made).
- `npm run lint`.
- `git diff --check`.
- Temporary Node harness with 59 assertions against actual transpiled AuthProvider, AuthRouteBoundary, routes and useLogout modules using isolated React hook/Supabase mocks. Covered initialization, Auth event precedence, admin/nonadmin, same-user refresh, pending session changes, cancellation/stale results, mismatched UUIDs, returned/thrown query errors, retries, logout during a pending query, all six known routes plus a future route, denied Login without redirect loops, safe/unsafe post-login redirects, duplicate logout requests, returned/thrown logout failures and successful replacement. Harness resides in `/private/tmp/cms-11d2-check.cjs`; no framework/dependency/test seam was added.

Local browser using the existing Development configuration, without signing in: direct `/partners/new?source=review` and `/offers/123/edit` led to Login with preserved destinations. Reload stayed at Login; Back/Forward between these locations showed Login, without protected content or loops. No credentials were accessed and no users or database rows were changed.

Pending real Supabase/browser tests:

1. Allowlisted administrator login → CMS; authenticated reload and direct navigation across all routes.
2. Authenticated nonmember → denied, including Login/direct URLs/reload/Back/Forward; working Sair.
3. Real authorization request failure → generic error, retry recovery and working Sair.
4. Successful logout → Login, reload stays unauthenticated and Back cannot reveal CMS.
5. Real session/token refresh or account change while a membership query is pending.
6. Authenticated theme/navigation and denied/error responsive/keyboard visual review.
7. End-to-end Data API verification of the self-membership RLS with real JWTs. Existing Phase 10B SQL-role tests and this phase's mocks do not constitute that test.

## Scope and Git status

Four tracked application files modified; three application files and this report created. Pre-existing CSS modification and untracked image remain. No Users module, student accounts/invitations, providers, Offer/Partner business/repository integration, Spectra/token, migration/database/RLS changes. No privileged browser credentials or sensitive logging. No commit, push or deployment. Awaiting review.
