# Pawn interface design

## Overview

The site serves identity.md seat borrowers, ETH lenders, PAWN holders and operators. It uses warm off-white surfaces, dark evergreen text, a restrained pawn illustration, and a large, plain-language pitch. Transaction tools sit below live protocol statistics in two-column panels. The illustration is decorative and generated from local SVG markup, not a remote image.

Source of truth: `web/src/style.css`, `web/src/components.tsx`, and `web/src/App.tsx`. This document is in `docs/` because the assignment's explicit write scope excludes a root `DESIGN.md`.

## Colors

All functional colors are CSS custom properties on `:root` in `web/src/style.css`. The site deliberately supplies one light theme with a dark hero; there is no theme switch.

| Token | Value | Use |
| --- | --- | --- |
| `--page` | `#f7f6f0` | Page canvas |
| `--surface` | `#fffef9` | Panels, controls |
| `--surface-muted` | `#eeeee5` | Receipts, neutral notices, disabled backgrounds |
| `--text` | `#20382f` | Main text |
| `--muted` | `#5c685f` | Supporting labels and descriptions |
| `--border` | `#cbd0c4` | Panel edges and separators |
| `--field-border` | `#899588` | Interactive outlines |
| `--accent` / `--accent-hover` | `#173b32` / `#244f42` | Main action and hover |
| `--on-accent` | `#f3f0e4` | Text on the hero and filled actions |
| `--highlight` | `#dfedbf` | Hero emphasis, selection background |
| `--focus` | `#2467c0` | Three-pixel keyboard focus outline |
| `--warning-bg` / `--warning-text` | `#fff2d6` / `#74500c` | Setup and connection warnings |
| `--error` / `--success` | `#a12921` / `#235a39` | Explicit error/success text |

The geometric illustration additionally uses `#b4ce98`, `#0e2822` and muted orbit strokes; these are art fills, not semantic UI tokens. Measured rendered text contrast includes body/page 11.63:1, hero 10.77:1, muted/page 5.39:1, muted/surface 5.78:1 and warning 6.54:1. Measurement scope and actual computed colors are in `frontend/live-browser.json`; it is not a claim that every state was measured.

## Typography

The stack is Arial, Helvetica, sans-serif, with Georgia/Times New Roman only for the italic hero word. There are no fetched or bundled font files. Actual system font substitution depends on the viewer's operating system. Body uses 16px and line-height 1.55; root font synthesis is disabled. Weights 400/500/600/700 are requested through CSS.

`--small` is .8125rem, `--body` 1rem, and `--heading` 1.625rem. The main heading uses `clamp(3rem, 6.2vw, 5.3rem)`, line-height 1.04, weight 400 and negative letter spacing. Panels use a 1.625rem heading; review headings are 1.1rem. Labels use 13px and weight 600. Inputs/selects use 16px; textareas rise to 16px at mobile widths. Hero/art captions are deliberately small decorative metadata.

Headings balance lines; descriptive paragraphs use `text-wrap: pretty` and cap at 68ch. Changing numbers use tabular numerals. Addresses are short visually with a full checksum in the title, clipboard support and an explorer link; provenance hashes wrap. Nothing globally disables text selection.

## Layout

The shared content maximum is 1280px, including 48px inline padding. Major groups use 24px/32px separation, with 7–12px internal field/control gaps and 16–20px receipt padding. `.workspace-grid` uses 1.12fr/1fr and 24px gap. `.panel` supplies consistent 32px padding, a border and the shared radius. The four-column `.stats` row precedes a health/refresh row and wrapping hash-navigation links.

At 1000px, outer padding becomes 28px and panels 26px. At 720px, panels stack, statistics become two columns, the decorative hero artwork disappears, and header/footer/control rows can wrap. At 400px, outer margins become 16px and panels 20px; long value rows can wrap. Form fields never have a fixed text width. The main action stays in normal flow within a panel.

The production export was checked at 320, 390, 800 and 1440 CSS pixels with no document overflow. A 320px transaction-review state is covered separately. This is not a claim about native zoom, physical devices, RTL or localization.

## Elevation & depth

Cards are mostly flat: a one-pixel border separates them from the canvas. Filled primary buttons indicate emphasis. Only the decorative hero note/chess piece and active trade segment have small shadows. Receipt/review regions use tonal separation plus borders. The skip link is the only overlay; it appears when focused. There are no modal dialogs or sticky transaction bars.

## Shapes

`--radius: 12px` is the panel radius. Inputs/buttons use 7px, receipts and notices 8px, the hero 18px, and tiny hero tags a pill shape. Rounded panels hold related content; they do not turn every stat into a separate card. The pawn SVG and note rotation are decorative exceptions.

## Components

- `Panel`, `Stat`, `Pair` and `Notice` in `web/src/components.tsx` provide grouped content, live statistics, label/value rows, and informational/warning states. Notice meaning is written in text as well as color.
- `Field` provides a persistent native label, input/select/textarea, and hint relationship. It supports pasted addresses and JSON. Native controls keep their keyboard behavior; placeholder-only labels are avoided.
- `Action` owns review, simulation, submission, receipt feedback and persistent inline errors. `primary` supplies filled emphasis. Eligibility and transaction state use native disabled controls. The inline review includes the effect, amount, contract link, explicit confirm and cancel. A fresh simulation precedes signing; the engine also gates all writes during a pending receipt.
- `ReadButton` supplies a loading state and recoverable error for explicit reads. These calls never ask for a signature.
- `AddressLink` provides explorer and copy actions; `units` and `when` format token and timestamp values. Contract addresses are derived from the runtime manifest/chain reads, not props invented in page components.
- `ContractForm` in `web/src/forms.tsx` uses native disclosure for advanced ABI-derived governance, worker and attestation inputs. It lists tuple fields and validates ABI types before simulation. The description becomes part of the transaction review.
- `.tabs` are real hash links with `aria-current`, preserving static-hosting navigation. `.segmented` uses native buttons with `aria-pressed` for buy/sell direction.

Keyboard focus is a 3px outline with 4px offset (2px on form controls). Forced-color mode uses the system highlight. Buttons are at least 44px tall; copy buttons and summaries are at least 32px. Motion is limited to 120ms button color changes and a .96 press scale under `prefers-reduced-motion: no-preference`. Nothing animates on initial load.

## Do's and don'ts

Use `Panel` inside `.workspace-grid` for a new tool, `Field` for inputs, and `Action` for every write. Keep instructions with the relevant field and show the transaction's practical consequence before its confirmation. Add a hash link rather than an unexported path. Reuse the semantic tokens; decorative artwork colors are not for status messages.

Keep financial values in their actual token units and show unavailable state rather than guessed balances/prices. Keep primary emphasis on the current transaction stage. Preserve recoverable errors and explicit approvals. Do not add hidden signing, unlimited approvals, remote asset dependencies, arbitrary deployment addresses, unsupported theme controls, or a second runtime configuration map.
