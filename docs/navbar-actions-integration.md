# Navbar actions integration

## Inspection

Re-read Spectra Navbar.tsx, Navbar.css, public exports, existing stories and package/build configuration, plus CMS CmsNavigation.tsx, AppLayout.tsx and index.css. Current CMS Figma frame 883:2813 was inspected using design context and screenshot. Its Navigation instance 883:3058 references the current Spectra remote master Navbar / Desktop 918:429 (key 0bb3ee030c9aebc1ce0d91c4d05e38f06b91f9a0). The master was read programmatically: Brand and Navigation slots, fixed Language Toggle followed by Theme Toggle, showLanguage/showTheme booleans, three equal regions, 64px height, 32px horizontal padding and 8px actions gap. Remote-master design-context rendering was unavailable from the consuming file; its properties and child structure were inspected directly. Mobile implementation and existing mobile stories were also inspected. Figma was not modified.

## Spectra changes

- src/components/Navbar/Navbar.tsx: optional public actions?: ReactNode, rendered after built-in controls.
- src/components/Navbar/Navbar.css: neutral flex custom-actions group with spacing/2; wrapping within the mobile panel.
- src/components/Navbar/README.md: composition contract and limitations.
- stories/components/Navbar.stories.tsx: CustomActions, CustomActionsWithBuiltIns, CustomActionsDark, CustomActionsMobile using Spectra Button and IconButton.

The distributed package was rebuilt for the existing CMS file dependency; no dependency or version change.

Ordering is explicit: language (if enabled), existing theme (if enabled), custom actions. Custom content is additive, not a replacement. Consumers must turn off the corresponding built-in when supplying their own theme/language control. Existing defaults and interactions are preserved.

Desktop retains the original three-region grid, with centered links and right-aligned actions inside its painted Navbar. Below the existing 1064px container breakpoint, the compact header retains its brand/menu trigger. Custom actions are a wrapping row after the built-ins within the collapsible panel, visible only when open. Existing Escape, focus restoration, close-on-link and resize logic is unchanged. Children receive no CMS-specific styling.

## CMS changes

- src/app/layout/CmsNavigation.tsx: move the existing theme IconButton and Admin/avatar group into Navbar actions. Preserve useTheme, labels, icons and both manually selected SVGs.
- src/index.css: remove cms-navigation flex alignment, outer border and right padding, its nav flex/min-width/border override, and its narrow-screen padding rule. CMS action/brand/avatar composition styling remains.
- docs/navbar-actions-integration.md: this report.

Navbar now fills the bare semantic header and owns background/border. No Spectra internal selector override or 100vw workaround.

## Browser verification

Built Storybook served locally on port 6007. All eight existing stories and four new stories rendered in both Light and Dark (24 cases), with expected desktop/mobile visibility and custom group presence. Screenshots inspected for desktop coexistence in both themes and expanded mobile. Built-in theme/language interactions, mobile Escape/focus return and close-on-link verified. No Storybook console warnings/errors captured.

CMS on port 5174: root Navbar and desktop border both measured 1400px, matching document clientWidth; outer header and root nav have 0px bottom border, desktop shell owns the sole 1px border. Actions reside inside spectra-navbar__custom-actions. Background spans the same full width. Three-region alignment, theme/Admin/avatar composition, Light→Dark→Light, Sun/Moon classes, accessible labels, both logos, Offers/Partners navigation and back/forward verified. Offer List→Create→Save→List regression produced a visible Active Offer and Success Toast; search finds it. No CMS console warnings/errors captured after final reload.

## Validation

Passed:

- Spectra npm run build.
- Spectra tsc --noEmit.
- Navbar story typecheck with vite/client asset types.
- Changed Spectra TSX lint using the already-installed CMS Oxlint; Spectra defines no lint script.
- Spectra npm run build-storybook.
- git diff --check in Spectra.
- CMS npm run build, npm run typecheck, npm run lint, git diff --check.

Spectra build logs report Lucide “use client” directives ignored. Storybook also reports its existing empty MDX pattern and >500kB chunks. These build notices do not prevent successful output; no runtime warnings were captured.

## Remaining limitations

The current CMS frame uses 48px Navbar gutters; the Spectra master/default retains 32px. Existing brand inset remains the Spectra default, and trailing actions now share that default. This difference is recorded rather than overriding internals or adding another unrelated sizing API.

Arbitrary actions must fit the fixed-height desktop region. They do not receive automatic responsive transformations. Like the existing brand, actions mount separate desktop/mobile copies; consumers should use useId instead of hardcoded IDs and keep shared action state in the application.

Existing Spectra horizontal logo has low text contrast in its Light story; the asset was not changed by this API work. CMS uses its own existing correct theme logos.

No changes to Offer/Partner business functionality, routing, theme provider or Figma. No dependencies installed. No commit or push.
