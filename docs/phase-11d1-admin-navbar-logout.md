# Phase 11D.1 — Admin Navbar and Logout

## Inspection

Figma MCP inspected frame `883:2813` and its Navigation instance `883:3058`, with screenshots and detailed design context. Navbar: 64px height, 48px gutters, background/border foundation tokens. Brand: existing XPTO runner asset at 38.2588 × 45px, 16px gap, two lines (18/27px XPTO and 12/18px ASSESSORIA ESPORTIVA). Center: Ofertas, Parceiros, Usuários; 14/20px semibold labels, 36px links, 4px gap, Accent active treatment. Right: 44 × 36px theme action, 1px account divider, 24px neutral round avatar, 12/18px muted semibold identification, Secondary Small Sair button (32px high, 16px LogOut icon). Figma was not edited.

Inspected installed Spectra Navbar API and implementation, token CSS, Button/IconButton/Toast APIs, existing logos, shared AppLayout, ThemeProvider hook, AuthProvider/useAuth, shared Supabase client, History API routing and AuthRouteBoundary. Spectra supports custom actions and disabled links, and already owns the three-region desktop grid and collapsible mobile panel. Existing auth listener receives session changes; the boundary prevents CMS children mounting without a session, including during restore and Back/Forward navigation.

## Changes

- `src/app/layout/CmsNavigation.tsx`: shared brand in two lines, accessible brand name, existing theme toggle, session email and derived initial, disabled Usuários, secondary Logout and generic error Toast.
- `src/index.css`: brand caption, compact neutral account, truncation, 44 × 36px theme action and feedback spacing; existing Spectra tokens throughout.
- `docs/phase-11d1-admin-navbar-logout.md`: inspection and validation report.

Email comes directly from `useAuth().user.email`. Avatar initial uses the first Unicode character of the trimmed email. An email-less account has generic identification and a question-mark avatar. Identification stays on one line, shrinks within the available action region and truncates at up to 192px. Title and accessible account label expose the complete email.

Logout calls the existing `supabase.auth.signOut()`. A shared ref locks both desktop/mobile button instances immediately; state disables them and displays Saindo…. Returned errors and thrown failures show generic feedback and release the lock for retry. No session information is logged. Only a successful result triggers History API replacement to `/login`; AuthProvider updates through its existing listener. The existing route boundary guards old history entries and reloads. No extra listener, auth mechanism or client was introduced.

Offers/Partners links and section active states remain unchanged. Usuários uses Spectra's disabled item: no rendered href, aria-disabled and no keyboard tab stop. No Users route exists or is added.

## Responsive behavior and design deviations

Desktop retains Spectra's 64px three-region layout and centered navigation. Mobile retains the existing container breakpoint below 1064px, compact brand/menu header, collapsible panel, close-on-link, Escape/focus restoration and custom actions. Account content can shrink; buttons/avatar remain visible. The existing brand text is hidden below 600px, with the full accessible brand name retained.

Known inherited difference: Spectra desktop gutters are 32px versus Figma's 48px. This phase preserves that existing library convention without changing Spectra internals. Users is disabled because the module does not exist; Spectra applies its disabled treatment. The static Administrator design label is replaced by session email as requested. Light theme retains the existing black XPTO logo and Moon action. Figma does not specify responsive layouts here; existing Spectra behavior is preserved. Rendered visual fidelity and absence of responsive overflow still need browser verification.

## Validation

Passed: `npm run typecheck`, `npm run build`, `npm run lint`, `git diff --check`.

Code inspection confirms session-based identification, success-only navigation, shared duplicate-request prevention, retryable generic error handling and existing guard before protected content mounts. These are inspection findings, not real-session browser test results.

Browser inventory contained no local CMS tab or authenticated CMS session (the existing deployed CMS tab was at login). No credentials were accessed and no production testing or data changes were performed.

Pending manual browser tests with a real local session:

- Desktop/light/dark visual comparison; theme toggle and exact logo geometry.
- Long emails, narrow screens, expanded mobile actions, no horizontal overflow, keyboard access and focus.
- Offers/Partners list/create/edit active states and Back/Forward navigation; Usuários cannot navigate.
- Successful logout, exact `/login` destination, reload remains unauthenticated, Back never displays protected CMS content.
- Returned/throwing sign-out errors, generic feedback and successful retry; duplicate clicks produce only one request.

## Scope and Git

Only the three files above were changed/created. The pre-existing untracked `src/assets/Corrida Urbana ao Pôr do Sol.png` was left untouched. No cms_admins authorization, Users module, profile/database tables, migrations, RLS, business logic or Spectra source changes. No commit, push or deployment. Ready for review, with manual tests pending.
