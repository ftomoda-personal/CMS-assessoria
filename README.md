# XPTO CMS

React 19 + TypeScript + Vite. The application provides the shell, theme, six routes and a working Offer List backed by session-only mocks. Create Offer and Edit Offer are implemented. All Partner routes remain placeholders. See [Phase 3](docs/phase-3-create-offer.md) and [Phase 4](docs/phase-4-edit-offer.md) for the current form flows and verification.

## Local development

Keep `Site CMS` and `spectra-design-system` as sibling directories. Run `npm install`, then `npm run dev`.
The local `file:../spectra-design-system` dependency links the package and consumes its public `dist` exports. Spectra must already be built; after changing Spectra in its own repository, rebuild it there. Vite deduplicates React and React DOM so the linked library shares the application's React runtime. No Spectra source or CSS is copied here.

The stylesheet is imported through `@ftomoda/spectra-design-system/tokens.css` in `src/main.tsx`. Inter and Barlow Condensed load through Google Fonts in `index.html`; network access is required for those fonts.

## Structure

- `src/app/routes.tsx`: six explicit route patterns and History API navigation. Browser back/forward, modified clicks and native hash links are preserved. `/` defaults to `/offers`; unknown paths show a placeholder. A production host must serve `index.html` for application routes.
- `src/app/theme.tsx` and `useTheme.ts`: session-only application theme context, initially light, applied to the document root using `data-theme`. The Navbar CMS composition uses the public Spectra IconButton (tertiary/small), showing Moon in Light and Sun in Dark. Its accessible label announces the destination mode. No separate ThemeToggle component exists.
- `src/app/layout`: stable layout, main landmark and CMS navigation. Spectra Navbar is consumed directly. Its current API has no arbitrary actions slot, so the static Admin/avatar block is a sibling composition; it is not authentication. No Navbar internals are copied.
- `src/components/PageHeader.tsx`: CMS composition justified by repeated list/create/edit headings in Figma.

The source shell reference is Portfolio / CMS, node `818:156`, with admin list `883:2813`. The logo is downloaded from that current Figma design. Administrative mobile layouts are not specified; only basic overflow protection and the existing Spectra mobile navigation are provided.

## Checks

- `npm run build`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`

## Offer List (Phase 2)

Source: current CMS admin Light `929:3583` and Dark `883:2813`. Draft/Figma Make screens are not used. The manual theme-specific shell logos are preserved.

- `src/features/offers/model.ts`: Offer IDs, Partner references, explicit UI statuses, title/subtitle/description, optional coupon and calendar-day dates. No state machine or backend fields.
- `mockData.ts`: four current Figma examples plus 24 synthetic fixtures for pagination. Totals: 28, Active 10, Scheduled 5, Draft 8, Expired 4, Inactive 1. Figma's example category counters sum to 38 despite a total of 28, so the app uses actual fixture counts. The long iFood example reproduces the current multiline title.
- `repository.ts`: immutable snapshots and subscriptions, held for the lifetime of the loaded application. `save` is a storage seam for future forms; no form or business transition calls it yet. No localStorage, backend or persistence across full reloads.
- `list.ts`: search matches title and partner name, ignoring case, accents and outer whitespace. Status counts are computed after search, before applying the selected status. These search/count choices are provisional UI behavior, not backend requirements.
- `pages/OfferListPage.tsx`: four items per page based on the current first-page design. Search and filter changes reset to page 1; pages clamp if repository contents shrink. Pagination uses the filtered collection and the Spectra summary API. With 28 records there are 7 pages, rather than Figma's inconsistent page-10 example.
- `components/OffersTable.tsx`: native Spectra table primitives, six columns, 700px title column and five shared remaining columns. Rows grow with multiline content. No sorting, row click, selection, mobile card conversion or hidden columns.
- `offers.css`: CMS composition layout only; no Spectra internal styles are overridden. The administrative reference is desktop; layout has a 1302px content minimum.

The current list has Todos, Ativos, Agendados, Rascunhos and Expirados filters. Inactive offers appear under Todos without adding an undesigned filter. StatusBadge maps Active to success, Scheduled to info, Draft to warning, and Expired/Inactive to error (Inactive follows the inspected offer-edit badge).

Partner logos are local copies of the current Figma list assets. `lucide-react` 1.46.0 is an explicit dependency because Spectra IconButton requires a Lucide icon; Search, Plus and Pencil use that same icon library. Linked Spectra's React declarations are resolved against CMS React types in tsconfig to avoid duplicate ref type identities.

The current Spectra Pagination summary uses Body/SM (14px/21px), while the CMS Figma footer uses Caption (12px/18px). The component is consumed unchanged; this typography discrepancy requires design-system reconciliation. No CSS fork is introduced.

A filtered empty result uses one text row and a zero summary without pagination. It does not introduce a designed empty-state illustration, recovery action or new screen.

Create navigates to `/offers/new`; Edit navigates to `/offers/:offerId/edit` through the existing History API. Theme changes are available in the Navbar before Admin/avatar, using the existing provider. The temporary placeholder control has been removed.

At the end of Phase 2, forms, activation/deactivation/deletion and Toast/Dialog orchestration were not implemented; Phases 3 and 4 now provide those Offer flows. Partner features, upload, backend and authentication remain out of scope. Draft creation rules, status transitions, search semantics, final page size and administrative responsive/empty designs remain product decisions.
