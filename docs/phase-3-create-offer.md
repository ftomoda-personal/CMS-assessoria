# Phase 3 — Create Offer

## Current Figma inspection

File: AZGV9uAHOqYfKEcJ0Ifntr, CMS page 818:156, current **Criar oferta** section 1005:7250.

Design context and screenshots inspected for:

- 945:786 — initial form.
- 950:4027 — scheduled publication, coupon and expiration options expanded.
- 1005:6107 — completed form.
- 1005:7251 — save failure Toast.
- 1005:6853 — Offer List with creation Success Toast.
- 1035:6755 — Offer List with Draft Warning Toast.

Section connectors inspected: 1035:7170, 1040:8279, 1040:8284, 1040:8289, 1040:8299 and 1040:8294. No older Draft/Figma Make screens were used. The section contains no unsaved-changes decision, date-order validation or mobile admin design.

## Files

Created:

- src/features/offers/pages/CreateOfferPage.tsx
- src/features/offers/creation.ts
- src/features/offers/create-offer.css
- docs/phase-3-create-offer.md

Modified:

- src/app/App.tsx — route composition, one creation result and navigation focus.
- src/app/routes.tsx — resolve the existing /offers/new route to the real form.
- src/features/offers/model.ts — optional Partner relationship for incomplete Drafts; retain publication/coupon/expiration choices.
- src/features/offers/repository.ts — accept absent Partner reference; continue rejecting unknown references.
- src/features/offers/list.ts — search handles absent Partner reference.
- src/features/offers/components/OffersTable.tsx — missing Draft values render as a dash; edit accessible name falls back to “Sem título”.
- src/features/offers/pages/OfferListPage.tsx — render creation result with Spectra Toast; initially show the page containing the newly appended Offer.

No files deleted by this phase. Existing changes from earlier phases remain intact.

## Form and publication requirements

Public Spectra exports reused: Input, Textarea, Select, Checkbox, Radio, DatePicker, Button and Toast. Existing Navbar and IconButton theme composition remains unchanged.

Fields and copy follow the current section:

- Parceiro: publication required; four existing Partner fixtures.
- Título: publication required.
- Subtítulo: optional.
- Descriçao: publication required; spelling preserved from current Figma.
- “Esta oferta possui um cupom”: reveals publication-required Cupom when checked.
- “Publicar agora”: default; “A oferta ficará disponível imediatamente”.
- “Agendar publicação”: reveals Data; “Escolha a data de início da oferta”. Choosing scheduling requires a selected date for publication.
- “Data de expiração”: reveals Data; “Ative esta opção se a oferta tem data de expiração”. Enabling expiration requires a selected date for publication.
- Cancelar and Salvar actions remain available.

Text requirements use trimmed, nonempty values. Save is always enabled. Native form uses noValidate so publication requirements retain required/aria-required semantics without blocking Draft saves. Missing fields are not presented as validation errors. No additional text limits, past-date restrictions or date ordering rules were introduced; the section defines none. DatePicker restricts selections to real calendar dates through its existing semantics.

## Model, repository and statuses

The existing immutable module repository and subscriptions are preserved. New Offers use crypto.randomUUID(). Partner relationship is stored as partnerId, not a copied name/logo. partnerId may be absent for an incomplete Draft. publicationMode, hasCoupon and hasExpiration retain conditional form choices, including incomplete Draft choices; legacy fixtures need no changes.

Complete immediate publication saves Active with the local current calendar day as startsOn. Complete scheduled publication saves Scheduled with the chosen startsOn. Missing publication requirements save Draft. There is no manual Draft control, status state machine, clock-driven transition or inferred Expired status.

Dates convert from DatePicker local Date selections using getFullYear/getMonth/getDate into YYYY-MM-DD. No ISO UTC conversion or parsing of date-only strings is introduced. DatePicker locale is pt-BR, with translated calendar controls; the list renders DD/MM/YYYY.

## Navigation and Toast

Application owns one nullable creation-result value. CreateOfferPage saves, then calls its onCreated callback; App carries the result while navigating to /offers. OfferListPage renders the existing Spectra Toast. Dismiss clears the result through Spectra onDismiss. Leaving the list clears the result, avoiding replay when navigating back. There is no notification provider, queue, state library or routing dependency inside Spectra.

Exact Toast copy:

- Success: “Oferta adicionada”; “Oferta do Nubank adicionada com sucesso” (Partner name changes to the selected fixture).
- Warning: “Oferta salva como rascunho”; “Preencha todos os campos obrigatórios para publica-la”.
- Save failure: “Não foi possível adicionar a oferta”; “Por favor tente novamente mais tarde”. A repository exception stays on the form, preserves entered fields and displays the error Toast. This error path is implemented but an artificial repository failure was not induced in the browser.

Cancelar navigates to /offers without saving or a confirmation Dialog. Browser History API behavior remains intact. Route changes focus the stable main content region. No unsaved form persistence/autosave is added.

## Verification

Browser verified against the local Vite app:

- List → Create → immediate complete Offer → List: new row visible, Nubank relationship, Active status, local date and Success Toast.
- Incomplete named Offer → Draft → List: missing Partner rendered as a dash, Draft badge and exact Warning Toast.
- Completely empty Offer with enabled scheduling/expiration but no dates → Draft: enabled Save, no validation blocking, missing title/Partner rendered safely.
- Complete Amazon Offer with coupon, scheduling and expiration → Scheduled: 03/10/2026 and 31/10/2026 correctly displayed in the list.
- Search + Active filter finds the new immediate Offer; search + Draft filter finds the new Draft; counters and pagination update from the repository.
- Newly appended Offers are immediately visible on their result page without changing existing list ordering.
- Cancelled title is absent from search results.
- Select opens/selects through keyboard; DatePicker opens through Enter, arrow keys move dates, Enter selects and Escape restores focus to its trigger.
- Native Enter submission works; Tab from title reaches subtitle; labels, accessible names and conditional required semantics inspected.
- Navigation returns focus to main-content. Toast uses status, aria-live=polite and aria-atomic; dismiss works. Screen-reader speech was not independently audited.
- Light → Dark → Light works; existing logo SVG switching verified. Form and list render in both themes. Theme persists through Save and browser back/forward.
- Browser console captured no warnings/errors from the implementation.
- Form uses two desktop columns; a single-column fallback only prevents broken narrow layout. No mobile admin design was introduced.

Commands passed: npm run build, npm run typecheck, npm run lint, git diff --check.

## Discrepancies and unresolved decisions

No new Spectra API limitation required recreating a component. Public className controls root widths of Input/Select to fit the form; component internals remain unchanged. DatePicker uses its existing overlay rather than pushing layout on open, which the current Figma component documentation explicitly permits. Existing Phase 2 Pagination typography difference remains unchanged.

Intentional unresolved decisions: date ordering/past dates, automatic scheduling or expiration transitions, backend publication behavior, persistence across reload, and unsaved-change protection. None are defined by this section or implemented here.

Edit Offer, Partner features, activation/deactivation/deletion, upload, Progress, authentication, backend/API, autosave, localStorage and global state libraries were not implemented. No dependencies installed. Spectra/Figma were not modified. No commit or push.
