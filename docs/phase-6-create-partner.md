# Phase 6 — Create Partner

Inspected current CMS Figma file AZGV9uAHOqYfKEcJ0Ifntr, section 1016:5929 (Criar parceiro). All eight frames inventoried: 995:1370 empty form, 998:2091 uploading, 997:1736 completed, 1000:2193 upload failure, 997:1855 size error, 997:1994 format error, 1003:4816 success list, 1052:4048 repository save error. High fidelity contexts and screenshots inspected for form and upload states and success/error Toast nodes 1003:4791 and 1052:4149.

Created upload.ts, components/LogoDropzone.tsx, pages/CreatePartnerPage.tsx and create-partner.css. Modified Partner model/repository, PartnerListPage, partners.css and App notice state. Existing uncommitted work preserved.

Required Nome/Link, optional Logo. No extra URL validation rule, Draft, lifecycle actions or Offer creation. Save is disabled while required text is blank or upload runs. Invalid optional logo is excluded from Save, matching enabled Save shown in contextual-error frames. Native required semantics remain.

Public Spectra Input, Button, Progress and Toast reused; existing Navbar/IconButton preserved. Dropzone is CMS composition with native file input, keyboard selection and drag/drop enhancement, replacement, preview, contextual errors associated by aria-describedby/aria-invalid and polite announcement. No removal/retry button invented; Trocar arquivo can reselect the same file.

Accepted extensions PNG, JPG, SVG with matching MIME when supplied. Maximum 2 MiB (binary interpretation of Figma 2MB). Format/size validation precedes upload. Exact Figma copy retained. No Toast for upload errors.

Isolated cancellable simulated transport advances ten percentage points every 160ms. In development only, filenames beginning simulate-upload-failure. fail at 20%; other files finish at 100%. Replacement or unmount cancels timers. Public Progress receives CMS-owned percentage and accessible name. No network, storage, Supabase, API, dependency installation, base64 or localStorage.

Preview object URL belongs to Dropzone and is revoked on replacement/unmount. Successful Save creates a separate session URL owned by canonical repository. Partner logoKind explicitly distinguishes session-object-url from existing static logoUrl. Repository revokes replaced temporary logos and on non-cached pagehide; cached pages retain URLs. Failed Save revokes its newly created URL. Full reload loses created Partners/logos. Future Storage adapter must replace temporary references; URLs are not permanent storage.

Partner repository validates minimum identity/name/site and keeps existing immutable subscription architecture. Offer snapshot already consumes canonical Partners; no second options list. Newly created Partner list page is selected using notice partnerId so appended record appears immediately. Partner Success Toast uses existing App-level notice pattern; local save-error Spectra Toast retains form. Cancel navigates /partners using existing History API. No Dialog added.

## Runtime integration correction

Root cause: the previously prepared page was unreachable. `/partners/new` matched a route without a `page` discriminator; App imported only the PartnerNotice type and had no CreatePartnerPage render branch. It therefore rendered the foundation placeholder. The prior implementation deliberately left that wiring pending the initial-status decision; reloading could not fix missing source integration.

The running Vite process (PID 26771, localhost:5173) has this workspace as its working directory. Browser inspection before the fix showed the actual placeholder. After editing and reloading the same tab, the real form mounted, confirming current source delivery rather than a stale build issue. No startup/runtime console errors explained the missing UI.

Smallest correction, two source files:
- `src/app/routes.tsx`: add `partner-create` to the route page union and set it on `/partners/new`.
- `src/app/App.tsx`: import CreatePartnerPage and render it for `partner-create`, pass `initialStatus="active"`, and reuse existing Partner notice state plus `navigate("/partners")` on creation.

Existing Phase 6 components, model, upload logic and repository were not rewritten. No placeholder/gate remains for Create Partner. Edit Partner retains its scoped placeholder. New Partners now receive administrative Active status from the explicit user decision, independent of Offers.

## Browser verification results

Verified on the running Chrome CMS tab at localhost:5173:
- Partner List → Adicionar parceiro → /partners/new renders Nome, Link, native Logo control, Dropzone, Cancelar and Salvar. Direct reload also renders it.
- Empty form has disabled Save. Nome/Link can be filled. Main receives navigation focus.
- Light and Dark form rendered; theme toggle and existing Navbar preserved. Completed state inspected in Dark and failure state in Light. Theme retained through Partner/Offer/history navigation; restored Light.
- Native macOS file picker selected `partner.svg`. Browser-extension setFiles initially failed due disabled access to file URLs; used native picker without changing permissions.
- Valid file entered uploading with named Spectra Progress at 0 and disabled Save; then completed with preview, file name, size and Trocar arquivo. Replacement file also completed. Failure fixture demonstrated progress 0 → 20 and exact local failure copy.
- `oversized.svg` (>2 MiB) displayed exact size error; no Toast.
- Native picker All Files allowed `invalid.txt`; exact unsupported-format error appeared locally; no Toast.
- Trocar arquivo recovered from size error, simulated failure and invalid format. Enter on replacement button opened picker. Cancellation used keyboard Enter.
- Save created `Phase 6 Browser Partner` / `phase6.example` with status Ativo and zero Offer counts, returned to /partners and showed exact success Toast. Automatically selected final list page containing the appended record.
- Global counters changed 28/22/6 → 29/23/6. Search found new Partner with counters 1/1/0; Active showed it, Inactive showed empty with 0–0 summary.
- Create Offer Select included and successfully selected the new Partner via the canonical repository.
- Existing Offer list retained 28 records, four existing Partner names and original counters. Create Offer form mounted correctly; no Offer was created by Partner creation.
- Cancel returned to list; browser Back returned to actual Create Partner and Forward returned to list. No unexpected Dialog.
- Captured browser warning/error logs returned an empty array.

Not verified: real Finder-to-browser drag/drop. Browser automation has no file-drag primitive, extension local file access is disabled, and the native window drag attempt could not establish a verifiable cross-window drop. The existing Dropzone onDragOver/onDrop implementation remains unchanged. Do not count this scenario as passed. Ordinary upload progress was observed at start/completion; the explicit failure fixture verified intermediate value 20. Exhaustive Light/Dark combinations for every error were not exercised.

Evidence: `/private/tmp/cms-phase6/create-partner-light.png` and `create-partner-dark.png`. Test files and created record are session-only; reload loses the record and temporary logo.

## Final validation

`npm run build`, `npm run typecheck`, `npm run lint`, `git diff --check`: all passed after integration correction. No Figma/Spectra changes, dependency installation, commit or push. Production Storage remains intentionally unresolved; temporary URLs are session representations, not persistent URLs.
