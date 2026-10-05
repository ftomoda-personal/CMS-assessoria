# Phase 4 — Edit Offer

Implemented on 05/10/2026. No commit or push.

## 1. Current Figma inspection

File `AZGV9uAHOqYfKEcJ0Ifntr`, CMS page `818:156`, current **Editar oferta** section `1033:6512`.

All seven top-level frames were inspected with design context and screenshots, and compared before implementation:

| Frame | Observed state |
| --- | --- |
| `970:1673` | Active, immutable Partner Input, coupon expanded, expiration, disabled deletion |
| `1027:3694` | Active after removing coupon; coupon Input hidden |
| `976:1729` | Inactive, Reactivate action, enabled destructive deletion |
| `1021:2985` | Inactive with deletion Dialog |
| `1027:3110` | Reactivated Active with Success Toast |
| `1027:3284` | List after deletion, Success Toast |
| `1027:3996` | List after modification, Success Toast |

Metadata identified the complete section inventory; implementation used each frame's full design context and screenshot. Flow was reconstructed from controls, content, status and action differences. Prototype connections were not required. No old Draft/Figma Make frames were used. The current section's seven frames are Dark references; Light uses the existing Spectra tokens and CMS theme provider.

## 2. Inferred flow

List Edit action → `/offers/:offerId/edit` → loaded values → modify → Save → List with updated row and Success Toast. Cancel returns without saving form values. Active → Deactivate → List with Inactive status and Warning Toast (product correction supplied after the original Figma inspection). Inactive → Reactivate → Active on the same form with Success Toast. Inactive → Delete → Dialog → Cancel/close/Escape preserves the record; confirmation removes it → List with deletion Toast. Active deletion is disabled and guarded by the repository.

Status actions persist immediately, independently of unsaved text/date fields. Cancel discards those field edits but does not undo a previously performed status action. No confirmation was added to reversible status changes, and no unsaved-changes confirmation was added.

## 3. Files created/modified

Created:

- `src/features/offers/components/OfferForm.tsx`
- `src/features/offers/pages/EditOfferPage.tsx`
- `src/features/offers/form.ts`
- `docs/phase-4-edit-offer.md`

Modified in this phase:

- `src/features/offers/pages/CreateOfferPage.tsx`: wrapper around the shared form.
- `src/features/offers/creation.ts`: generalize the existing notice payload name to `OfferNotice`.
- `src/features/offers/pages/OfferListPage.tsx`: consume that same renamed payload; rendering, search, pagination and notification behavior retained.
- `src/features/offers/repository.ts`: guarded update and deletion operations.
- `src/features/offers/create-offer.css`: Edit header/status composition using public tokens.
- `src/app/routes.tsx`: resolve Edit and decode its stable ID safely.
- `src/app/App.tsx`: render Edit, pass its result into the existing post-navigation notice; focus dependencies track page/ID rather than the newly resolved route object.
- `README.md`: identify the implemented form flows and link phase reports.

The checkout already contained changes from previous phases. Those changes were retained; the complete Git diff is not limited to Phase 4.

## 4. Create reuse/refactoring

Moved the existing Create form into one `OfferForm`, parameterized by an optional stored Offer and an onSaved result callback. Shared Input/Textarea fields, coupon/expiration controls, field state, publication completeness, trimming, local calendar serialization, native form submission and save error handling. Create retains its Select, publication radios, scheduled DatePicker and exact creation notices. Edit replaces only the Partner control and publication panel with the current immutable Input and status/actions panel. No parallel form architecture or new state library.

## 5. Spectra reuse

Public `@ftomoda/spectra-design-system` exports: Input, Textarea, Checkbox, DatePicker, Button, StatusBadge, Toast and Dialog. Select and Radio remain part of the shared Create composition. Existing Navbar and IconButton integrations are preserved. Icons use the already installed Lucide dependency. Existing local theme logos and Partner assets are unchanged. No Spectra component recreation, internal CSS overrides or package edits.

## 6. Loading/update architecture

The route decodes the internal stable ID; Edit reads the existing immutable repository snapshot through `useSyncExternalStore`. The form is keyed by Offer ID so different Edit routes initialize correctly. Save calls `update`, which rejects missing IDs rather than appending another record. Unknown IDs render a small message and Spectra button returning to Offers. Malformed URI encoding is handled safely. Browser History API routing remains in place.

## 7. Partner immutability

Edit uses the current designed disabled Spectra Input showing the stored Partner name. No Select or internal ID is exposed. Save retains the original `partnerId`; repository `update` rejects changes to that relationship. A Draft created without a Partner remains without a Partner in Edit and therefore cannot become publishable under the existing completeness rule. It displays `-` rather than an internal ID or undefined value.

## 8. Draft behavior

Save remains enabled and the form uses `noValidate`. Incomplete Drafts remain Draft. The existing Create publication requirements are reused without adding a state machine: a complete immediate Draft becomes Active, with today's local calendar day; a complete scheduled Draft becomes Scheduled using its already stored publication date. Existing non-Draft statuses and start dates remain unchanged on ordinary Save, including when a publication-required field is blank.

The current Edit section contains no Draft-specific frame or publication-mode/date editing controls. Therefore Edit does not add those controls. A scheduled Draft missing its publication date stays Draft; supplying/changing that missing date in Edit remains an unresolved product design. Completing an immediate Draft with an existing Partner was browser-tested.

## 9. Active/Inactive

Only the actions represented by the current section are exposed: Active gets Deactivate; Inactive gets Reactivate. Both update the stored status immediately without Dialogs. Reactivation retains its existing in-form Success Toast. The subsequent product correction adds deactivation → List through the existing post-navigation mechanism, with Warning Toast: `Oferta desativada` / `A oferta não está mais disponível para os usuários.` Scheduled, Draft and Expired show their existing badge and editable fields without speculative status actions.

## 10. Deletion

Only Inactive exposes enabled deletion. Active displays the exact restriction text and a disabled destructive button. Confirmation invokes the repository removal seam, which verifies the record is Inactive. Cancel, close and Escape never call removal. Confirmed deletion returns to List, updates counts/pagination and removes the row. No additional deletion flow for Scheduled, Draft or Expired was invented.

## 11. Toast/Dialog flows

The existing application-level notice mechanism now accepts `OfferNotice` for Create, modification, deletion and deactivation. Leaving List clears it, so browser forward does not replay a consumed result. In-form reactivation uses Spectra Toast on the existing form composition; there is no second provider, queue or notification architecture.

Exact current strings, with the real stored Partner name substituted:

- Deactivation (subsequent product correction): `Oferta desativada` / `A oferta não está mais disponível para os usuários.`
- Modification: `Oferta modificada` / `Oferta do Nubank foi modificada com sucesso`.
- Reactivation: `Oferta reativada` / `Oferta do Nubank foi reativada com sucesso`.
- Deletion: `Oferta excluida` / `Oferta do Nubank foi excluída com sucesso`.
- Dialog: `Excluir oferta?` / `Esta ação não poderá ser desfeita.` / `Cancelar` / `Excluir oferta`.
- Active restriction: `Para excluir esta oferta, desative-a primeiro.Ofertas ativas não podem ser excluídas.`
- Inactive warning: `A exclusão da oferta é permanente e não pode ser desfeita`.

Two minimal fallbacks cover application states absent from the current frames: modification of a Draft without a Partner uses `Oferta foi modificada com sucesso`; an unexpected update failure retains fields and uses `Não foi possível modificar a oferta` / the existing `Por favor tente novamente mais tarde`. These are adaptations, not claimed Figma copy. Update failures were not artificially induced in the browser.

## 12. Repository changes

Retained module-lifetime in-memory storage, frozen snapshots, subscriptions, getById and Create save behavior. Added update (existing ID and immutable Partner checks) and remove (Inactive guard and immutable filtered snapshot). List subscribers reflect updates immediately. No localStorage, persistence, backend, API, timers or global state package.

## 13. Dates

Existing serialization uses local year/month/day. Stored `YYYY-MM-DD` values are restored with numeric local `new Date(year, month - 1, day)` rather than UTC date parsing. Existing start dates are preserved for non-Draft edits. DatePicker remains pt-BR; List remains DD/MM/YYYY. Browser changed 31/12/2026 to 30/12/2026 and displayed exactly 30/12/2026 after Save. Isolated checks also covered year rollover and leap day.

## 14. Accessibility

Verified label associations, required semantics, disabled Partner Input, no internal IDs, enabled Save with incomplete fields, Tab from title to subtitle and native Enter submission. DatePicker opens with Enter, arrow navigation changes the focused day, Enter selects and restores its trigger focus. Status action button remains the focused control while its label changes. Dialog uses `alertdialog`, accessible title/description, initial focus on Cancel, modal keyboard navigation, Escape dismissal and restoration to Delete. Successful navigation focuses main-content. Spectra Toast has status, aria-live=polite and aria-atomic=true; dismissal was verified. Independent screen-reader speech was not audited.

## 15. Light/Dark

Browser verified desktop form rendering, Active/coupon states, Inactive, reactivation Toast, Dialog, modification/deletion List Toasts and Draft/Expired fallback forms in Light and Dark. Scheduled editing and unknown-ID rendering were inspected while switching themes. Theme persisted across Save and browser history navigation. Existing logo switching was verified: Light `/logo-xpto_black.svg`, Dark `/logo-xpto.svg`, rendered desktop 38.25 × 45 px. No theme implementation changes or new mobile design.

## 16. Browser end-to-end scenarios

Verified against the existing localhost Vite app:

- List → Edit loads the matching ID, stored title/description/dates and Partner.
- Edit title, subtitle, coupon → Save → updated List and Success Toast; total unchanged.
- Calendar date edit → keyboard Enter submission → exact updated pt-BR date.
- Partner disabled; repository rejects changing partnerId.
- Browser back restores saved data; forward returns to List without replaying the notice; theme retained.
- Active → Edit → Deactivate → List; no Dialog; exact Warning Toast; Inactive row immediately visible and Active count changes 10 → 9. Reopen Edit to access enabled Delete.
- Inactive → Active; current reactivation Toast; Delete disabled again.
- Dialog cancellation and Escape preserve the record and restore focus.
- Confirmed deletion removes the fixture, changes total 28 → 27 and displays exact feedback.
- Back to the deleted ID displays the small not-found view.
- Arbitrary unknown ID displays the same safe fallback.
- Incomplete existing Draft remains Draft; completing its description with an existing Partner makes it Active using the existing publication rule.
- Create incomplete Draft without Partner → Edit → add description → remains Draft; no undefined Partner in feedback.
- Create scheduled complete Amazon Offer → Edit subtitle → still Scheduled, start date 10/10/2026 unchanged.
- Cancel text edits does not change the stored title.
- Light/Dark and logos, keyboard controls, Toast announcements, Dialog focus and console checked.

Captured console warnings/errors: none. Browser test data is disposable module-lifetime data; a reload restores the initial fixtures. Screenshots are saved in `/private/tmp/site-cms-phase-4/`, including edit, inactive, reactivated, dialog, saved and deleted views in both themes.

## 17. Validation

Passed: `npm run build`, `npm run typecheck`, `npm run lint`, `git diff --check`.

An isolated temporary Node/TypeScript verification also passed immutable snapshots, subscription notifications, stable update IDs, immutable Partner enforcement, rejection of unknown updates/Active deletion, confirmed removal, local date round trips and conditional publication requirements. No test dependency was installed and no temporary test harness was added to the project.

## 18. Figma/Spectra discrepancies

- Reactivated frame `1027:3110` retains the Inactive permanent-deletion warning while rendering Active and disabled Delete. Implementation uses the explicit Active restriction from the other current frames; disabled deletion is consistent throughout.
- The Partner example Input contains `Nubamk`; runtime shows the stored canonical `Nubank` relationship rather than copying that fixture typo.
- Current section has no Draft/Scheduled/Expired-specific editing frames, update-error frame or unknown-ID view. The omitted deactivation Toast/navigation was subsequently specified by the user and implemented. Fallbacks and reused rules are identified above.
- Spectra DatePicker uses its existing anchored overlay; the Figma component documentation explicitly permits it.
- Existing Phase 2 Pagination typography discrepancy and transient List Toast overlapping the Create action remain unchanged. Dismiss the Toast to access Create in that state.
- No new Spectra API limitation required a workaround or a local fork.

## 19. Deliberately unresolved product decisions

Missing Partner on immutable Drafts; supplying a missing scheduled publication date in Edit; editing publication timing; status/deletion actions for Scheduled/Draft/Expired; automatic schedule/expiry transitions; past-date/date-order rules; final error copy for edit failures/Partner-less records; unsaved-change protection and persistence across reload. No speculative controls, transitions or infrastructure were added for these.

## 20. Scope confirmation

Preserved Offer List, Create, session repository, Navbar/custom actions, both theme logos, History API, existing post-navigation Toast and public Spectra integration. No Partner List/Create/Edit, Partner activation, upload, backend/API, authentication, autosave, localStorage, global state library or mobile CMS feature was implemented. No dependencies installed. Figma and Spectra were not modified. No commit or push.

Correction verification: tested the complete deactivation navigation/Warning Toast and reverse reactivation Success Toast in the browser. No new console warnings/errors. Build, typecheck, lint and git diff --check passed again. Only OfferForm and this report changed for the correction; Figma/Spectra remain unchanged, with no commit or push.

## Product addition — early activation of Scheduled Offers

The user explicitly added Scheduled → Active manual activation after the original Figma inspection. Edit now exposes `Ativar oferta` as the existing small tertiary status action, without a Dialog or arbitrary status selector.

`activation.ts` defines one guarded activation operation for Scheduled and Inactive only. `offerRepository.activate(id)` loads the stored record, applies that operation and updates the same ID through the existing immutable repository/subscriptions. Scheduled activation changes status to Active, publicationMode to now and startsOn to the local current calendar date. This removes the previous future publication timing while preserving Partner, title, subtitle, description, coupon, expiration and conditional choices. Inactive reactivation shares the operation but preserves its existing dates/publication metadata and existing in-form Success Toast.

Scheduled activation returns to `/offers` through the existing application onSaved/post-navigation notice, using Spectra Success Toast: `Oferta ativada` / `A oferta já está disponível para os usuários.` No second notification mechanism was added. Active → Inactive and deletion are unchanged.

Browser verified on 05/10/2026 with a newly created Offer scheduled for 10/10/2026: action available in Edit; early activation without Dialog; returned row Active with startsOn 05/10/2026; exact Success Toast; global counters Active 10 → 11 and Scheduled 6 → 5; total remains 29. Searching the test title gives Active 1 and Scheduled 0; Scheduled filter is empty and Active filter finds the record. Reopening and saving edits retains Active and today's start date; subtitle, description, Partner and coupon were preserved. Deactivation still returns to List with Warning Toast, and reactivation still shows its existing Success Toast in Edit. Light/Dark were inspected; no new console warnings/errors. Evidence: `/private/tmp/site-cms-phase-4/scheduled-activated-light.jpg` and `scheduled-activated-dark.jpg`.

Isolated activation/repository checks passed preservation of every other field including expiration, removal of future scheduling, original snapshot immutability, stable IDs, subscription notifications, inactive date preservation, rejection of unknown IDs and activation from Draft/Expired/Active, and Active persistence after a later update.

This addition resolves the previously unspecified Scheduled activation action only. Draft/Expired actions, publication timing edits and automatic status transitions remain unspecified. Files added: `activation.ts`. Files changed: `repository.ts`, `components/OfferForm.tsx`, the stale status comment in `model.ts`, and this report. Build, typecheck, lint and git diff --check passed. No Spectra/Figma modifications, dependencies, commit or push.
