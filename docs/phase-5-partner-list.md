# Phase 5 — Partner List

## 1. Current Figma inspected
CMS file `AZGV9uAHOqYfKEcJ0Ifntr`, CMS page `818:156`, Administrator section `1004:6094`, full current Partners section `1004:6096`. Current dark frame `955:952` and light frame `1004:5716` inspected through metadata, design context and screenshots. Compared against the existing Offer List composition and current Offers section `1004:6095` (light `929:3583`, dark `883:2813`). No Draft/Figma Make source used.

## 2. Files
Created `src/features/partners/model.ts`, `mockData.ts`, `repository.ts`, `list.ts`, `partners.css`, `components/PartnersTable.tsx`, `pages/PartnerListPage.tsx` and this report. Modified `src/app/App.tsx`, `src/app/routes.tsx`, `src/features/offers/model.ts`, `mockData.ts`, `repository.ts`, `components/OffersTable.tsx`. Existing unrelated work retained.

## 3. Partner model
Readonly stable internal id, name, display website, optional logo reference and administrative active/inactive status. Preserved all four existing IDs and exact logo assets. Nike has no existing logo asset; none was invented. Current list frames show text names without logos. Offer rows render available logos and remain valid without one.

## 4. Repository
Canonical session-only Partner repository with frozen records/arrays/snapshots, stable getSnapshot, getById, subscriptions and immutable save seam for future forms. No storage, API or deletion/cascade method. Initial 28 records include the five designed names plus 23 clearly named synthetic partners and reserved `.example` domains to exercise pagination.

## 5. Offer relationship
Offers retain partnerId rather than duplicating partner attributes. Existing Offer repository snapshot contract still exposes partners, using the exact canonical Partner array. Partner changes replace that reference and notify Offer subscribers. Offer validation and existing update/activate/remove rules are preserved. No competing partner fixtures remain in Offers.

## 6. Spectra
Public Input, FilterGroup, Table and all table primitives, StatusBadge, IconButton, Pagination and Button imported through `@ftomoda/spectra-design-system`. Reused CMS PageHeader, Navbar, layout, theme and History API. No Spectra internal overrides/forks or new dependencies.

## 7. Search/filter
Case/accent-insensitive trimmed search across actual names and sites. Todos/Ativos/Inativos apply to actual Partner status. Counters reflect the searched set before the selected status filter, following Offer List behavior. Changing query or filter resets page one. No sorting or extra filters.

## 8. Administrative status
Independent of Offer counts, schedules or mutations. Initial 22 active and 6 inactive partners. A synthetic active partner with no offers remains active. Browser verified Nike remains inactive after creating an active Offer. No Partner status actions introduced.

## 9. Table
Native semantic six-column table: Nome, Site, Ofertas ativas, Total de ofertas, Status, Ações. Columns follow current design widths (160px except remaining Site width). Site is text. Success/error badges include Ativo/Inativo text. Pencil opens Edit placeholder. No visible internal ID column. Zero results use one native spanning row with a polite status message.

## 10. Offer counts
Calculated from the current Offer repository every render: total includes every Offer status; active includes only Active. No duplicated fixture counters. Initial counts: Nubank 4/7, Amazon 2/7, iFood 2/7, Shopee 2/7, Nike 0/0. Browser verified Nubank active 4→3→4 with total 7; Nike 0/0→1/1 after Create while administrative status stayed Inactive. Integration test verified offer deletion removes counts while preserving Partner.

## 11. Pagination
Five partners per page, computed on filtered results; 28 fixtures produce six actual pages. Final all page shows 26–28; inactive second page shows 6–6 of 6. Clamp protects shrinking result sets. No pagination shown on empty results; footer shows 0–0 of 0.

## 12. Navigation
Navbar opens `/partners`; Add opens `/partners/new`; Edit encodes the stable id in `/partners/:partnerId/edit`. Existing placeholders retained. Browser verified Nubank and Nike stable URLs, back/forward and Add return navigation.

## 13. Accessibility
Named search and filter group; native button pressed states, table headers/cells, explicit Edit names, named pagination controls and disabled boundary controls. Keyboard Enter exercised filter selection and Edit navigation. Status uses text in addition to color. Existing main focus and skip link retained. Existing Offer logo images are decorative beside readable names and all four loaded successfully.

## 14. Themes
Verified complete Partner List in Light/Dark at current 1400×909 desktop frame dimensions, including Navbar, CMS logo, badges, inputs, table and footer. Dark persisted through Offer navigation, Partner placeholder and history navigation. Restored original Light theme. Screenshots saved at `/private/tmp/site-cms-phase-5/partners-light.png` and `partners-dark.png`.

## 15. Browser scenarios
Navbar; name search `NÍKE`; site search `amazon.com`; all three filters; search counters; combined inactive search; active plus Nike yielding empty; last all page; inactive page two; search/filter reset; keyboard selection; stable Edit routes; Add placeholder; back/forward; both themes and preservation; live count changes. Console warning/error capture returned empty. No Partner mutation forms/actions added.

## 16. Offers regression
Existing four names/logos resolved and loaded after repository migration. Existing Edit partner remains disabled/readable. Browser exercised Active→Inactive→List warning toast and Inactive→Active existing success toast. Created an active Nike Offer using the existing Select/form/save/post-navigation success toast; names resolve even without a logo. Domain integration verified immutable updates, subscriptions, unknown partner rejection, unchanged partnerId on edit, removal only through Offer repository and Scheduled activation clearing future schedule. Original Draft/activation/deletion/form logic was not changed in Phase 5. Browser test Offer is session-only and disappears on reload.

## 17. Validation
`npm run build`, `npm run typecheck`, `npm run lint`, `git diff --check` passed. Temporary Node/TypeScript integration checks passed for canonical snapshot identity, freezing, notification propagation, search/filter, count changes, administrative independence, historical reference retention and existing activation rules. No dependency installation, commit or push.

## 18. Discrepancies
Figma illustrative Todos=28 while Ativos=4 plus Inativos=1 only accounts for the five visible rows. Pagination includes page10 despite five rows/page and total28. Used coherent real counters 28/22/6 and six pages, rather than literal inconsistent numbers. Offer counts deliberately reflect existing Offer fixtures instead of the Figma illustrative counts. No genuine Spectra blocker identified. Current Partner table has no logo column; existing Offer logos were preserved.

## 19. Intentionally unresolved lifecycle
Partner deletion/archive policy, status mutation rules, historical archival details and any eligibility rules for inactive Partners remain unresolved for their future flows. No inferred automatic status transitions, hard deletion or cascades introduced.

## 20. Scope
Create/Edit Partner remain placeholders. No upload/progress, Partner mutation Toast/Dialog, backend/API, Supabase, authentication, localStorage or new global state library. Figma and Spectra untouched. No commit/push.
