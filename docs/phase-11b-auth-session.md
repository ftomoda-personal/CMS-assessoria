# Phase 11B — Auth session foundation

`src/app/auth.tsx` owns the application session through the existing shared Supabase browser client. The root composition is `StrictMode → App → ThemeProvider → AuthProvider → Application`, preserving the theme and existing History API routing. Children render immediately, regardless of Auth state.

`useAuth()` from `src/app/useAuth.ts` exposes only `session: Session | null`, `user: User | null`, and `isLoading: boolean`, using official Supabase types. User is derived from `session.user`, never an application profile. Calling the hook outside its provider throws `useAuth requires AuthProvider`.

Initial state is null session/user with loading enabled. The provider subscribes before calling `supabase.auth.getSession()` to restore the SDK-managed local session. A returned session or null finishes initialization. Auth events also finish initialization and take precedence over a delayed initial result. The synchronous callback observes sign-in, sign-out, initial session and refresh events without calling other Auth APIs inside it.

There is one application subscription call site. Effect cleanup unsubscribes and prevents late initialization results from updating an unmounted provider. React StrictMode's development setup/cleanup/setup cycle does not leave duplicate active subscriptions.

Returned initialization errors and rejected promises resolve to null session/user and loading false when no newer Auth event has arrived. Only a fixed generic warning is logged, never the error object, credentials or session contents. Later Auth events can still update state. This phase does not expose an error API or global error UI.

Persistence, token storage and refresh remain entirely managed by Supabase JS defaults. No custom storage, cookies, JWT decoding, database queries, membership checks or admin inference are introduced. Client session observation is not an authorization decision. Tokens are not logged or rendered. No Auth configuration, users, migrations, RLS or RPCs are changed.

Deferred to 11C/11D: Login UX, route protection, account/logout Navbar behavior, and admin authorization through the planned membership boundary. The existing static Admin/avatar, Offer/Partner mocks and screens remain unchanged; visitors can still access the CMS without authentication.

## Validation

No test framework is configured, and none was added. `npm run typecheck`, `npm run build`, `npm run lint`, and `git diff --check` passed. Source review confirms one shared client and one application Auth subscription, with no database/admin/UI/routing or migration changes.

Manual runtime check: started Vite with the existing ignored Development `.env.local`, opened `/offers` in the in-app browser without performing authentication, reloaded it, and opened `/partners`. Both existing mock lists rendered normally, and the browser reported zero error-level console entries after the Offers reload. No password was requested and no Auth user was created. Authenticated restoration, refresh/sign-out events, and injected initialization failures were not exercised. The public UI deliberately has no session indicator, so the manual check confirms rendering and reload behavior rather than directly inspecting context state.

Before 11C: consume the hook for Login/protection and decide how restoration failure should be surfaced or retried in that UX. No architectural blocker was found.
