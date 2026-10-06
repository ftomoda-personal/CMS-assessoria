# Phase 11A — Supabase client foundation

Adds `@supabase/supabase-js` 2.117.2 as an application dependency. The existing Supabase CLI devDependency remains 2.120.0. No generated database types exist; none were generated or manually duplicated. The shared client can accept the generated Database generic later.

Copy `.env.example` to `.env.local` and supply exactly these public Vite values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The example contains empty placeholders only. Actual `.env` files remain Git-ignored. Vite embeds these public values at build time; restart Vite after changing local values. The publishable key is browser-safe and subject to database authorization/RLS. Service-role and secret keys must never enter Vite environment variables or client code.

`src/vite-env.d.ts` extends the existing vite/client typing with optional environment values, reflecting that configuration may be absent. `src/lib/supabase/config.ts` validates trimmed values and throws a clear error without displaying values. `src/main.tsx` imports this boundary before rendering, so missing configuration stops startup.

`src/lib/supabase/client.ts` exports the single reusable `supabase` client, created with `createClient` and Supabase defaults. Import it in later infrastructure code rather than creating clients in components. It is not imported by the current application entry: startup validates configuration without initializing unused SDK/Auth behavior. Once imported in a later phase, the SDK defaults will apply.

Deferred: login UI, session provider/listeners, route protection, membership queries, database repositories/RPC calls, generated database types, Storage, and deployment environment configuration. Existing Offer/Partner mocks and UI behavior remain in place.

Validation: typecheck, build, lint and diff-check passed. Isolated configuration checks passed for missing values, empty URL, whitespace key, and valid trimmed placeholders. A separate build used process-local placeholders and wrote output under /private/tmp. No real environment values were read or printed. The example and Git-ignore behavior were checked; one createClient call was introduced; no application network/Auth/database/Storage calls were added. The Phase 10 migration SHA-256 remained unchanged.

Before Phase 11B, populate the ignored local environment with the Dev URL and publishable key. Builds compile without these variables, but browser startup intentionally fails when they are missing. npm reported the same three high-severity audit findings already reported before this SDK installation; no unrelated dependency remediation was performed.
