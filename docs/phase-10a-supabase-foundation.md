# Phase 10A — local database foundation

Migration: `supabase/migrations/20261006000000_initial_cms_foundation.sql`.

## Repository inspection

React 19 / TypeScript 6 / Vite 8, single npm package, existing dev/build/lint/preview/typecheck scripts. Strict TypeScript, Vite React plugin, no Supabase runtime dependency or existing Supabase directory. Root ignores dependencies, build output and environment files. Existing uncommitted changes predate this phase and are preserved.

The in-memory Offer model stores UI status, uses browser calendar dates, makes Partner immutable even in Draft and removes only Inactive Offers. Partner history is a session Set; logos use URLs. These are prototype differences, not database architecture blockers. Later integration must map logo paths, derive status, hide soft-deleted rows, permit Draft Partner changes and use the RPCs. No application files changed here.

## Tables and constraints

The migration is the exact authoritative table definition; there are no extra audit/status/count columns.

| Table | Columns |
| --- | --- |
| partners | id uuid PK default gen_random_uuid(); name/website text NOT NULL; logo_path/logo_name nullable text; ever_associated boolean NOT NULL default false |
| offers | id uuid PK default gen_random_uuid(); partner_id nullable uuid; title/description text NOT NULL default ''; subtitle nullable text; publication_mode text NOT NULL default 'now'; has_coupon/has_expiration boolean NOT NULL default false; coupon nullable text; starts_on/expires_on nullable date; published_at/deleted_at nullable timestamptz; enabled boolean NOT NULL default true |
| cms_admins | user_id uuid PK |

Offers reference Partners with ON DELETE RESTRICT, including deleted Offers. Admin membership references auth.users with ON DELETE CASCADE. Partner name/website require nonempty btrim; logo name requires a path. Offer CHECKs enforce mode, ordered dates, null coupon/expiration when their flags are false, enabled Drafts and complete published content. PostgreSQL CHECK accepts unknown for missing draft dates; published completeness explicitly requires required fields. Subtitle and optional expiration remain optional. UUIDs are database generated; client insert grants exclude Partner id/history.

## Functions and triggers

- `cms_private.is_cms_admin()`: stable SECURITY DEFINER membership check avoids recursive RLS; auth.uid is the identity. Accessible to authenticated for policies, no membership mutation.
- `cms_private.business_date()`: transaction timestamp converted to America/Sao_Paulo. Consistent through a command/transaction, inclusive calendar date boundaries.
- `offer_effective_status(offers)`: stable invoker SQL function returns draft/inactive/scheduled/expired/active in approved priority; NULL for deleted. Authoritative implementation for later repository projection and deletion/activation guards. No view, cron or persisted status. Client projection should use this function through the API computed-field facility or an equivalent later query adapter, rather than a second browser date algorithm.
- `guard_partner` trigger: forbids resetting history and deleting associated Partners. Browser column grants prevent either setting or resetting history.
- `guard_offer` trigger: forbids hard deletion, writes to deleted rows, changing published timestamp/Partner, deleting Active rows or changing other fields during deletion. First publication receives database time and 'now' receives business date; first scheduled publication requires today/future. Subsequent historical edits are allowed if CHECKs hold.
- `remember_association` AFTER trigger: SECURITY DEFINER updates protected Partner history atomically for inserts and Draft Partner moves. Old Partner history is never cleared. Empty/incomplete Draft associations also count.
- `save_offer(...)`: SECURITY DEFINER, admin check, locks existing Offer and replaces all editable content. NULL p_id creates a database-generated UUID. p_publish=false saves a valid incomplete Draft; p_publish=true validates first publication. Published rows never return to Draft. This is a full replacement command, not a patch; enabled/deleted_at/published_at are not client parameters. UI can later determine completeness for contextual Save and choose p_publish; database remains final validator. Invalid publication raises an error rather than silently downgrading to Draft.
- `set_offer_enabled(id, enabled)`: authorized, locked published-only disable/re-enable without changing dates.
- `activate_scheduled_offer(id)`: authorized, locked Scheduled-only start-date change to business date; preserves other fields, including publication_mode. Existing date CHECK guarantees expiration cannot precede the new start.
- `soft_delete_offer(id)`: authorized, locked timestamp update; trigger checks eligibility from OLD state. Repeated deletion fails. Active must be disabled in an earlier operation.

All functions have empty search_path and qualified application object references. Trigger functions are not exposed RPCs. Definer functions use migration owner privileges; the platform migration runner must be a trusted role that can read membership and write the application tables. No GUC, user metadata or caller-supplied identity grants authority.

## RLS and privileges

All three tables enable RLS. Authenticated CMS admins have Partner SELECT/INSERT/UPDATE/DELETE policies (delete also checks history). Grants allow only editable Partner columns for INSERT/UPDATE. Anonymous and non-admin users have no application access.

Offers SELECT is admin-only and excludes deleted rows. **Intentional stricter implementation:** there are no direct INSERT/UPDATE/DELETE grants or write policies for Offers. Admins create/update/soft-delete through the authorized RPCs. This prevents clients supplying publication/deletion timestamps or bypassing command semantics. SECURITY DEFINER RPCs bypass owner RLS, so each explicitly checks membership. Trigger guards and CHECKs still execute.

cms_admins SELECT reveals only the caller's membership row; no browser INSERT/UPDATE/DELETE grants/policies. Provision admins later through a trusted administrative channel, outside the browser.

Explicit revokes cover PUBLIC, anon, authenticated and service_role for function execution before granting only the intended authenticated functions. Private schema functions have no general execution grants; only the membership/date helpers are callable by authenticated. Schema usage does not expose private trigger helpers through the configured public Data API. Trusted database owners/platform service privileges are not a browser authorization boundary. No global default privilege changes or grants on unrelated platform objects.

## Indexes and concurrency

Primary keys provide deterministic id ordering for future keyset pagination (UUID order is stable, not chronological). Full offers(partner_id) supports FK/history checks, including deleted rows. Partial offers(partner_id, id) WHERE deleted_at IS NULL supports current Partner association queries/counts and stable per-Partner pagination. No date/status indexes without a concrete filtering workload.

Existing Offer commands SELECT FOR UPDATE before mutation, serializing Draft Partner changes/publication, save/delete, and enable/activation. Constraints inspect the final row, preventing publication racing with an incomplete save. Ordinary concurrent full saves remain last-writer-wins; no speculative revision column.

Association updates lock the Partner via transactional UPDATE. FK key locks and ON DELETE RESTRICT prevent dangling associations if deletion races with association; successful marker/Offer mutations commit or roll back together. A concurrent delete or multi-row cross-Partner operation can deadlock with FK/marker lock order; PostgreSQL aborts a transaction rather than violating history. Later repository should handle/retry SQLSTATE 40P01/40001 at whole-command boundaries. Membership revocation is evaluated at command start under normal statement snapshots; immediate cancellation of already running admin commands is outside scope.

## Local setup and validation

config.toml uses a **local label**, cms-local, not a hosted project ID; db major_version=17, migrations enabled, seed disabled. supabase/.gitignore excludes CLI temp/branch state. No linked project, secrets, environment variables, packages, Storage setup, Vercel edits, runtime integration, commits or deployments.

Only one timestamped migration exists, explicit BEGIN/COMMIT, ordered tables → helpers → triggers → commands → RLS/grants. Reviewed SQL for NULL behavior, old/new transitions, authorization and controlled columns. TypeScript typecheck, production build and git diff --check passed. Python structural checks validated expected migration object counts; config TOML was reviewed manually (the available Python lacks tomllib). No CLI/PostgreSQL parser/server available: SQL/PLpgSQL execution, Supabase config acceptance, RLS behavior and concurrent transactions are **not runtime validated**.

Before applying to Dev, review the RPC-only write contract and trusted function ownership. With separately authorized database tooling, validate against a clean compatible Supabase database: admin/nonadmin/anon grants, RPC authorization, Draft completeness, first publication and immutable timestamp/Partner, expired historical edits, inclusive date boundaries and timezone midnight, all five deletion statuses, deleted-row immutability, A→B history, FK deletion races, publish/save/delete races and transaction rollback. Confirm Dev PostgreSQL version and API computed-field projection behavior. This phase does not execute those database tests or apply the migration.
