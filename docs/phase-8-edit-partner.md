# Phase 8 — Edit Partner

## Design inspected

Current CMS file `AZGV9uAHOqYfKEcJ0Ifntr`, CMS page `818:156`, Edit Partner section `1062:7688`. All six current frames inspected through high-fidelity design contexts and screenshots before implementation:

- `1003:5195`: existing Partner, logo, status, Offer total, disabled delete.
- `1062:6630`: edited link and save state.
- `1062:6493`: zero Offers, Inactive, enabled delete.
- `1062:7146`: destructive Dialog.
- `1062:6753`: edit result in Partner List with Success Toast.
- `1062:7295`: deletion result in Partner List with Success Toast.

The section contains no separate logo-upload error/progress or save-error frame. Existing Phase 6 upload states and operation-error Toast pattern are reused. Figma and Spectra were not modified.

## Files

Created `src/features/partners/components/PartnerForm.tsx`, `src/features/partners/pages/EditPartnerPage.tsx` and this report. Modified `src/app/App.tsx`, `src/app/routes.tsx`, `src/features/offers/repository.ts`, Partner `model.ts`, `mockData.ts`, `repository.ts`, `list.ts`, `components/PartnersTable.tsx`, `components/LogoDropzone.tsx`, `pages/PartnerListPage.tsx`, `pages/CreatePartnerPage.tsx`, `create-partner.css`, and `README.md`.

## Implementation

`components/PartnerForm.tsx` is shared by CreatePartnerPage and EditPartnerPage. Create remains a thin wrapper; Edit loads canonical Partner by decoded stable route ID and shows a missing-record state for unknown IDs. Required Nome/Link, optional Logo, native form semantics and History API navigation are retained. Edit uses public Spectra large Inputs spanning the column; Create retains its existing size/layout.

The shared Dropzone accepts existing-logo metadata, displays the actual image with accessible alternative text and filename, and offers Trocar arquivo. Replacement keeps Phase 6 validation (PNG/JPG/SVG, MIME when supplied, maximum 2 MiB), timer/progress, cancellation, contextual errors and temporary-preview ownership. Invalid/failed replacement is excluded from Save and the old saved logo is retained. Valid replacement creates a repository-owned object URL and retains the uploaded filename. The repository revokes superseded/deleted session logos; cancel/unmount revokes only the temporary preview. No real upload/storage was introduced.

Partner no longer persists `status`. `derivePartners` derives Active from at least one existing Offer of **any** status, otherwise Inactive. The list uses that derived view for rows, filters and counters; the Edit panel uses the same all-Offer total. No manual status action, synchronized status field or state library exists. Initial mock totals are now 28 Partners, 4 Active and 24 Inactive. New Partners are Inactive until an Offer references them.

Partner repository gained `update`, `canDelete` and guarded `remove`. Session association history belongs to this repository and is seeded from existing mock Offers. Successful Offer saves record their partnerId; deleting an Offer does not erase that fact. This history is exclusively deletion eligibility, not current status. A Partner with zero current Offers but prior session association is Inactive and remains undeletable. Failed/invalid Offer saves do not create associations. No Offers are changed or cascaded during Partner deletion.

Offers retain stable partnerId; Partner edits change canonical data without rewriting Offer records. The existing Offer snapshot subscription resolves updated names/logos and removes deleted Partners from Create Offer options. Partner List search uses updated name and link; counts remain derived from Offers. Its current Figma table has text-only Name cells, so no new logo column/cell composition was invented; logos are resolved in Edit Partner and Offer List.

Dialog uses public Spectra Dialog/Buttons, alertdialog semantics, an initial Cancel focus ref, destructive naming and closeLabel. Delete is disabled with the exact explanation shown in current Figma for ineligible Partners. Cancel/Escape do not mutate. Confirm rechecks eligibility inside the repository, returns to Partner List and announces the exact deletion Success Toast. Save returns to Partner List with the designed Success Toast. Operation failures retain the form and use an Error Toast; Dropzone validation does not produce duplicate Toasts.

Navigation focuses main-content, including when changing edit IDs. Existing Navbar/actions, theme provider, CMS logos, Offer flows and packaged Spectra/deployment settings are preserved.

## Design/data discrepancies preserved

- The edit-success frame labels its Toast **Parceiro adicionado**, while its description says the Partner was modified. This exact current title is retained; not silently corrected.
- Figma displays `nubank.svg`; the actual existing CMS asset is `nubank.png`, which is correctly displayed by its real filename. Replacements retain their original filenames.
- Illustrative Figma Offer counts differ between frames; real repository counts are used, not hardcoded design numbers.
- Only Dark frames exist in the current Edit section. Light uses the existing Spectra tokens and was checked in the browser.
- There is no Edit operation-error frame; the existing CMS Error Toast pattern supplies the necessary failure handling.

## Validation and browser results

`npm run build`, `npm run typecheck`, `npm run lint` and `git diff --check` passed.

Repository checks using the actual transpiled source passed: no stored Partner status; all five Offer statuses count toward Active; IDs/Offer records remain unchanged after Partner edit; canonical Partner data updates; eligible deletion removes Create Offer selection; invalid references and unknown updates are rejected; removing the last Offer produces Inactive while preserving historical deletion protection.

Verified in Chrome at `http://127.0.0.1:5176`:

- Partner List Edit opens the real form; direct `/partners/nubank/edit` and reload populate correct data/logo/counts.
- Nome/Link edit and Save preserve ID/relationships; list reflects changes and designed Success Toast.
- Search finds the edited link; filters/counters and active/total Offer counts remain coherent.
- Edited name appears in Offer List, Create Offer options and existing Edit Offer's disabled Partner field.
- Existing Offer edit/save regression passed.
- Create Partner regression: new Partner appears Inactive with zero Offers; counters 29/4/25.
- Creating a Draft Offer for that Partner produces Active, with zero Active Offers and one Total Offer. Active filter finds it; Inactive excludes it. Draft publication through Edit Offer also passed.
- Partners with Offers have disabled Delete; no manual Activate/Deactivate Partner exists.
- Zero-history Nike opens Delete Dialog; Cancel keeps it. Dialog tested in both themes. Initial focus is Cancel; Tab reaches destructive action; Escape closes without mutation.
- Confirm removes Nike, returns to list, displays deletion Success Toast and updates counters. Search no longer finds it; Create Offer option count for Nike is zero.
- Back returns to Edit Partner and Forward to Partner List. Navbar/theme/Light/Dark logos retained.
- Existing logo loaded with 48 × 48 geometry; final Edit field wrapper uses the full column and public large Input sizing.
- Warning/error console log query returned no entries.

**Not verified in browser:** logo replacement, contextual upload validation/recovery, and file-picker keyboard completion. Chrome extension `fileChooser.setFiles` is blocked because local-file URL access is disabled. The actual current logo and replacement control were verified, but this is not an end-to-end upload pass. No browser permissions were changed. Real cross-window file drag/drop and operation-failure injection were also not exercised. Existing upload logic is reused and repository-level URL/data behavior is covered separately.

Evidence saved at `/private/tmp/cms-phase8/edit-partner-light.png`, `edit-partner-dark.png`, `delete-partner-light.png` and `delete-partner-dark.png`. Test mutations are session-only and reset on reload. The temporary repository assertion runner is `/private/tmp/cms-phase8/check-repositories.mjs`.

## Deferred

Supabase schema/database enforcement of never-associated deletion and historical relationships across reloads remains unresolved. Session history cannot reconstruct pre-session associations. Storage, authentication, persistence, API/backend, cascading deletion and localStorage remain out of scope. No dependencies installed; no commit, push, deploy, registry, monorepo, Vercel configuration or custom-domain changes.
