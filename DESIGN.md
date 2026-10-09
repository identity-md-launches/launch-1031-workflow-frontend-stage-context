# Pawn interface design

## Overview

Pawn serves seat borrowers, ETH lenders, PAWN holders and contract owners. The existing pixel pawn shop at night is preserved: deep green surfaces, cream body text, gold controls, and an original frog pawnbroker. The hero and four live statistics precede hash navigation and transaction panels. This update keeps that visual identity while replacing the oracle retrieval path, connecting the audit-fixed deployment, and reducing the emphasis of supporting oracle controls.

The source of truth is `web/src/style.css`, `web/src/components.tsx`, `web/src/App.tsx`, `web/src/setup.tsx`, `web/src/oracle-flow.tsx`, `web/src/operations.tsx` and `web/src/governance-state.tsx`. The later night-theme declarations in the stylesheet override the earlier light palette. This document supersedes the earlier light-theme description in `docs/DESIGN.md`.

## Colors

| Active token | Value | Role |
| --- | --- | --- |
| `--page` | `#0d2619` | Canvas and dark hero art |
| `--surface` | `#173b32` | Panels and statistics |
| `--surface-muted` | `#21483a` | Receipts, notices, inline reviews |
| `--text` | `#f2e8d0` | Main text |
| `--muted` | `#c9c6ac` | Secondary text and labels |
| `--border` | `#52634a` | Panel edges and separators |
| `--field-border` | `#89956e` | Input and review outlines |
| `--accent` | `#e0b14c` | Gold action fill |
| `--accent-hover` | `#f6d27a` | Hover fill |
| `--on-accent` | `#0d2619` | Text on gold |
| `--highlight`, `--focus` | `#f6d27a` | Highlight and focus |
| `--warning-bg`, `--warning-text` | `#403921`, `#f6d27a` | Warning notices |
| `--error`, `--success` | `#ffaca1`, `#bcdea0` | Textual transaction status |

The body has a fixed 145-degree gradient from `#173b32` to `#0d2619` at 65%. Art uses additional greens and golds. This is one fixed night theme; no theme switch is implemented. Rendered oracle panel text measured 10.09:1 and muted labels 7.12:1 against `#173b32`; gold secondary-action text measured 8.44:1 against that same surface. These are specific opaque pairs, not a claim about every state or the body gradient.

## Typography

`PawnPixel` is local VT323 Regular (`web/public/fonts/VT323-Regular.ttf`, OFL license beside it), with monospace fallback and `font-display: swap`. Headings, branding, eyebrows and large statistics use it at weight 400 and `.03em` letter spacing. Normal text uses Arial, Helvetica, sans-serif, 16px root and 1.55 line-height. No font service is required.

The desktop h1 uses `clamp(3.6rem, 10vw, 6.5rem)` and 1.04 line-height; mobile `.hero-copy h1` overrides it to 3.6rem at 720px and 3.1rem at 400px. General h2/h3 sizes are 2.3rem/1.7rem; specific risk/deployment headings retain their existing smaller sizes. `--small` is .8125rem, `--body` 1rem and `--heading` 1.625rem. Inputs/selects use 1rem; textareas rise from .9rem to 1rem at 720px. Body emphasis uses the system font stack.

Paragraphs cap at 68ch and use pretty wrapping; headings balance. `Pair` and addresses use tabular numbers; queue countdowns inherit that treatment. Long operation hashes remain selectable and wrap completely. The local VT323 asset loaded successfully in the production browser; the rendered pixel headings were inspected. System-font substitution depends on the device.

## Layout

Header, main and footer cap at 1280px with 48px desktop inline padding. `.workspace-grid` uses `1.12fr 1fr`, 24px gap, and `min-width: 0` children. Panels have 32px padding and 24px bottom spacing; fields use 20px block spacing and 7px internal gaps. Receipts/notices use 16px/20px padding. Navigation and button rows wrap.

At 1000px, outer padding becomes 28px and panels 26px. At 720px, tool panels and risk sections stack, statistics become two columns, the hero artwork is hidden, and header/footer/form rows wrap; panels use 24px padding. At 600px the brand tagline hides and OracleFlow padding becomes 12px. At 400px, outer padding becomes 16px, panel padding 20px and label/value rows wrap. The header frog remains visible on mobile.

Setup with a signed oracle answer, full UUIDs and question hashes was checked at 320, 390, 800 and 1440 CSS pixels without document overflow. Desktop/mobile screenshots were inspected. Native zoom, physical devices and RTL were not tested.

## Elevation & depth

Hard pixel shadows use `#091c13`: buttons 3px/3px, panels 4px/4px and hero 8px/8px. The frog art has a 12px drop shadow. Panel borders define groups; receipt/review surfaces use a lighter green. Reviews are inline rather than modal. Focused skip navigation is the only overlay.

## Shapes

The active `--radius` is 2px; panels, hero and buttons use square pixel-like corners. Existing field rules retain 7px corners because `.field input` is more specific than the later element selector. Receipts/notices keep 8px corners, reviews 8px and small hero tags their pill shape. These established exceptions are unchanged.

## Components

- `Panel`, `Pair`, `Stat`, `Notice` in `web/src/components.tsx` provide section headings, label/value rows, metrics and info/warning surfaces. States always have text alongside color.
- `Field` binds native labels and input/textarea hints; its native selects have visible labels. `ContractForm` uses native details/summary to reveal ABI-derived inputs.
- `Action` handles review, simulation, explicit confirmation, wallet submission, receipt and error states. Native disabled states reflect transaction readiness. `ReadButton` provides loading and retry feedback for reads.
- `AddressLink` provides an explorer link and copy button; full checksummed addresses are available in the title. `units` and `when` format values.
- Hash navigation in `App.tsx` uses real links with `aria-current`. Setup appears only for a connected PawnShop owner. A non-owner direct `#setup` visit displays Governance state. Public Governance shows paused/open loans, cap, floor hash Set/Not set, signer and queues; each contract's controls require its own owner. The burn question also requires its immutable setter. Owner claim buttons remain inside owner views. Personal borrowing/lending claims and public floor refresh retain their existing behavior.
- `QueuedChanges` in `web/src/governance-state.tsx` enumerates ChangeQueued events from the verified deployment block in 2,000-block chunks, then checks current storage to filter completed/cancelled/superseded operations. Loading, empty and read-error messages are explicit. `Countdown` updates once per second, covers delay/ready/expired states, and uses no live region so ticking does not interrupt assistive technology. Cap changes have no expiry.
- `OracleFlow` in `web/src/oracle-flow.tsx` is shared by Setup, public Refresh floor and Burn. A blank optional lookup finds the latest exact-question request; request UUIDs and job UUIDs are also accepted. The existing field remains labelled, and its hint explains the automatic mode. Copy question and a completed lookup use `.secondary`: green surface, gold text/border and no shadow. The next consequential action retains gold fill. Loading has a Stop waiting button and a stable polite status region; failures use an inline alert. The verified answer shows its canonical request UUID, value, issue time and complete wrapping hash. Burn adds a quiet countdown. Approval/pinning and posting/burning are separate explicit `Action` reviews. No manually pasted signature or answer is required.
- `Mascot` and `web/public/pawn.svg` contain the pixel frog, eyeshade, loupe, bow tie and three gold balls. The unchanged SVG is the relative favicon `./pawn.svg` in the export.

Focus uses a 3px gold outline with 4px offset, or 2px offset on inputs; forced colors uses `Highlight`. Buttons are at least 44px tall, copy buttons and summaries 32px. Color transitions are 120ms and press scale .96, only under `prefers-reduced-motion: no-preference`.

## Do's and don'ts

Reuse the existing tokens, panels, field labels, inline transaction review and hash routes. Keep unavailable reads explicit, display amounts in their actual units, and compare wallet addresses with live contract ownership. Hide owner controls by conditional rendering. Preserve public visibility of state and the public Refresh floor button.

Preserve the theme, frog and existing transaction review behavior when extending the oracle flow. Do not imply that UI visibility changes contract permissions. Keep real financial transactions out of browser validation.

The current six-domain review and limitations are in `docs/frontend/oracle-fix/validation.md`. The live hosted site is still the older build because publication was blocked; this document describes the delivered source/export.

Design review used the pinned Better Interface guidance by Jakub Krehel (MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`) and documentation guidance adapted from Paul Bakaus's Impeccable (Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`). License notices are retained in `docs/frontend/owner-controls/design-guidance-LICENSE.txt`.
