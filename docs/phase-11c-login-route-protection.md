# Phase 11C — Login and route protection

Adds authentication-only access to the CMS. Administrative authorization is deliberately deferred to Phase 11D; a valid Supabase session is the only access condition in this phase.

## Design and assets

Approved Figma file: `AZGV9uAHOqYfKEcJ0Ifntr`.

| State | Desktop node | Mobile node |
| --- | --- | --- |
| Default | `1074:5313` | `1076:6333` |
| Processing | `1075:5362` | `1076:6400` |
| Error | `1075:5422` | `1076:6475` |

Desktop references are 1280 × 900; Mobile references are 375 × 900. Desktop uses the unchanged `src/assets/Corredores ao Amanhecer na Cidade.png`, centered with cover sizing and a 25% dark overlay. `Corrida Urbana ao Pôr do Sol.png` remains unchanged and unused. The existing public XPTO SVG provides the brand at 82 × 96. Existing Lucide LogIn and LoaderCircle icons accompany the Spectra primary medium button. Only Entrar is available.

Uses Spectra 0.1.1 Input/Button and semantic color, spacing, radius, stroke and typography tokens. Login has a local `data-theme="dark"`; ThemeProvider and the document theme remain unchanged. Existing Inter/Barlow Condensed loading is retained. Desktop card is 476 px wide with background foundation/background, 24 px section gap, 16 px header padding, 48/53 px brand heading, 32/35 px form heading, 16/24 px body text and 40 px fields. At the existing 600 px CMS breakpoint, photography is removed; page padding is 16 px horizontally, card fills available width with foundation/surface-strong, section gap becomes 16 px, header padding is removed, headings become 24/26 px, body becomes 14/21 px and fields become 32 px with 12 px labels/control text. Responsive CSS adapts the single pair of Inputs without duplicating fields or form state.

Card height follows content and remains centered with 24 px minimum vertical page padding. Short viewports can scroll; copy may wrap at narrow widths. Default/Processing Mobile target height is 525 px, and Error adds 58 px for the single message and gap. LoaderCircle rotates during submission, respecting reduced motion.

## Authentication

`LoginPage` submits a semantic form to the existing `supabase.auth.signInWithPassword()` client. Email and current-password autocomplete are enabled. Local missing-field/email-validity checks use Input supportingText/showSupportingText and focus the first invalid field without calling Auth. Password is not trimmed.

A synchronous ref prevents duplicate requests even before React renders processing state. While submitting, both values remain visible (password masked), fields are readonly and the button is disabled with a loader. Returned failures and thrown errors show both Inputs in error state, no individual supporting messages, and exactly one alert: “Não foi possível entrar. Verifique suas credenciais e tente novamente.” Editing or retrying clears the general error. No raw Auth errors, credentials or sessions are logged/rendered. Successful session observation and navigation belong to the existing AuthProvider and the route boundary, not a second listener.

## Routing

Root composition: StrictMode → ThemeProvider → AuthProvider → AuthRouteBoundary → existing Application. The boundary renders a neutral loading status during initialization and guard redirects; protected children are never mounted for an unauthenticated visitor.

`useLocation()` observes pathname, query and fragment via the existing popstate/useSyncExternalStore mechanism. `/login` is handled by the boundary. All existing CMS routes are protected, including Offers/Partners list, create and edit paths. Unauthenticated requests are replaced with `/login?redirect=<encoded internal destination>`. The query survives reload without custom storage. After authentication, `/login` is replaced with the validated destination, otherwise `/offers`. Session changes update access immediately. Existing CMS navigation still pushes history; guards replace it to avoid redundant entries.

`safeCmsDestination()` accepts only same-origin known CMS paths. It rejects external/protocol-relative destinations, backslashes, whitespace/control characters, unknown paths, malformed path encoding and encoded unsafe path characters. Login cannot be its own destination. Internal query parameters and fragments are preserved. This URL boundary is not administrative authorization.

## Validation

Passed: `npm run typecheck`, `npm run build`, `npm run lint` (without warnings), `git diff --check`.

A temporary Node/TypeScript harness outside the repository transpiled the actual routing, boundary and Login modules and used isolated React/Auth mocks. It passed checks for all six protected routes, safe/unsafe destinations, initialization gating, authenticated access, authenticated Login redirects, intended query restoration, replace semantics, missing/malformed local validation, processing values/readonly/button state, duplicate submissions, generic rejection, clearing on edit and successful submission. No test framework or production test seam was added. These checks simulate authentication; they are not a live authenticated-browser test.

Browser checks with existing Development configuration: direct access to `/partners/new?source=review` and `/offers/123/edit?source=review` redirected to Login preserving query; Login reload retained the destination; Back/Forward worked between Login locations. Missing fields and malformed email displayed focused field messages. A synthetic invalid-credential submission displayed the disabled Processing state and then the single generic error with exactly two error Inputs and zero individual supporting messages. Editing cleared it. No real credentials were requested or used.

Desktop 1280 × 900 geometry verified: card 476 × 597, logo 82 × 96, no horizontal overflow. Mobile checked at 375 × 900 and 320 × 640: no photograph or horizontal overflow. The validation browser did not load the existing font faces; its fallback text wraps the Mobile intro differently, increasing the card height. Pixel fidelity with Inter and Barlow Condensed actually loaded therefore remains a manual review item. No font infrastructure changes were retained.

Pending manual browser tests: successful login with an existing manually provisioned user, authenticated persistence after reload, post-login intended route/default Offers behavior, authenticated `/login` redirect and session-loss handling. These paths were verified only with isolated mocks. Also review all six visual states with fonts loaded and authenticated Offers/Partners/Theme/Navbar regression behavior. Session persistence remains entirely managed by Supabase JS defaults.

## Scope

Created LoginPage, login.css, AuthRouteBoundary and this note; changed routes.tsx and App.tsx. No additional application files were changed. The two PNGs retain their original SHA-256 values and remain untracked. One shared client and one existing Auth subscription remain. AuthProvider/useAuth, Navbar, Offer/Partner screens and repositories, Spectra/package files, database, migrations, Auth configuration and users were not changed. No cms_admins checks, logout, roles, signup/reset or Storage work was added. No commit, push or deployment was performed.
