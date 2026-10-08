# Owner controls update — worker validation

Date: 2026-10-08. This is worker evidence, not an independent certification.

## Scope and assumptions

Continue the merged Setup/keeper/pixel-theme implementation. Owner UI is selected by the connected account and the live `PawnShop.owner()` or `LendingPool.owner()` result, compared case-insensitively. The burn question additionally retains its immutable setter check. Owner protocol/trading/bounty claims are hidden with the owner views; personal borrower/lender claims are preserved because they are primary user interactions, not owner administration. Contract permissions themselves are unchanged, including permissionless on-chain execution; the website intentionally offers governance execution only to the relevant owner.

Public Governance displays paused/open state, cap, floor question Set/Not set, signer, pending cap and all nonzero PawnShop queued operations. Event history is scanned from the pinned deployment block in 2,000-block chunks; current storage removes cancelled, superseded and executed operations. Expired entries remain visible as expired. Countdown updates use the browser clock, with exact timestamps also displayed; chain simulation remains authoritative. Large future histories can take longer to enumerate. Read failures show a retry instruction instead of an empty queue. Direct non-owner Setup hashes render the read-only Governance view.

No theme/CSS, frog, keeper, contract, dependency, lockfile or existing build-configuration changes. Dependencies and Chromium were installed only in `/tmp/pawn-owner-check` and `/tmp/pawn-owner-browsers`, keeping repository `node_modules/` untouched. Build scripts read the original Git objects via `GIT_DIR` without modifying metadata. The final temporary export was copied byte-for-byte into root `dist/`.

## Actual commands and results

Commands ran against an exact source copy under `/tmp/pawn-owner-check/web`; that directory holds the unchanged manifest/lockfile and installed dependencies. `GIT_DIR` pointed at this workspace's existing read-only Git directory for pinned ABI reads. No test sent a real transaction.

| Command/check | Actual outcome |
| --- | --- |
| `npm ci --prefix /tmp/pawn-owner-check/web --cache /tmp/pawn-owner-npm-cache --no-audit --no-fund` | Pass; 92 packages installed outside repository. No manifest/lockfile edits. |
| `npm --prefix /tmp/pawn-owner-check/web run typecheck` | Pass, exit 0 after final source change. See `typecheck.txt`. |
| `GIT_DIR=<workspace>/.git npm --prefix /tmp/pawn-owner-check/web run build` | Pass, exit 0; 438 modules, pinned ABI hashes verified, relative HTML/CSS/JS/font assets and inventory generated. See `build.txt`. |
| `npm --prefix /tmp/pawn-owner-check/web run validate:export` | Pass; 14 inventoried assets (995,760 bytes); complete export including inventory 1,000,330 bytes, all SHA-256 values and deployment/network/ABI bindings match. See `export-check.txt`. |
| `npm --prefix /tmp/pawn-owner-check/web test` | 12/12 pass. See `unit-tests.txt`. |
| `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 PLAYWRIGHT_BROWSERS_PATH=/tmp/pawn-owner-browsers npm --prefix /tmp/pawn-owner-check/web run test:browser` | 18/18 scenarios pass: primary borrowing/lending/locking/trading/loan/auction/oracle flows; wallet rejection/switching; simulation/confirmation; disabled writes after failed reads; keyboard-only wallet/seat approval/pawn. See `regression-browser-results.json`. |
| Same browser environment, `tsx tests/setup-browser.ts` | 6/6 scenarios pass: owner Setup navigation, mobile layout, consumer rejection, question pin and floor post, duplicate suppression and paid-API refusal. See `setup-browser-results.json`. |
| Same browser environment, `tsx tests/owner-browser.ts` | 7/7 scenarios pass, rerun after the final source changes. Countdown boundaries; disconnected direct Setup; non-owner hidden forms/claims; queue filtering and ticking; mobile/desktop and axe; public floor refresh; owner simulation and mock receipt; account switch clearing review; independent pool ownership and disconnect. See `owner-browser-results.json` and `owner-browser.txt`. |
| `npm --prefix /tmp/pawn-owner-check/web run check:live` | Pass. Both handoff RPCs report chain 1; all main/child contracts have code and bindings. No wallet connected. See `live-read.json`. |
| `node web/tests/render-live.mjs`, then scratch extension checking public Governance and favicon | Pass on the production export with live RPC, no injected wallet. Zero page errors/resource failures, 320/390/800/1440 widths without overflow; live swap correctly reports no liquidity. Public Governance has zero owner forms/actions, paused state, 10 ETH cap, hash not set and empty queue. Relative frog favicon returns HTTP 200. See `live-browser.json`. |
| `git diff --check` | Pass. No whitespace errors. |

Chromium 141.0.7390.37 was used. The supplied browser tool failed to launch because `/opt/google/chrome/chrome` was absent. Initial Playwright install also rejected Ubuntu 26.04; the official Ubuntu 24.04 build installed successfully with `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE`. Actual rendered checks used local Playwright, not an inferred source-only review. The build retains the existing >500 kB minified-JS warning (final main bundle about 554 kB); unrelated splitting/configuration changes were outside the requested update.

The existing broad browser and Setup checks ran before the last small public heading/read-unavailable refinements. The final typecheck/build, owner scenarios, live export/RPC check, favicon check and screenshot review ran after them. No CSS or other flow implementation changed after the broader checks.

## Better Interface consolidated review

Pinned reference: Better Interface `267330e1adfc66a718fb65fa6918c1f06d0a689e` (Jakub Krehel, MIT); documentation guidance from Impeccable `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (Paul Bakaus, Apache-2.0). Contents, workflow, all six core domains and document-web-design were read. Notices/licenses are retained in `design-guidance-LICENSE.txt`.

| Domain | Coverage and evidence | Limits |
| --- | --- | --- |
| Accessibility — Checked | Native links/buttons/disclosures and labels retained; owner-only controls absent from the DOM for public users. Public ticking clocks do not use live announcements. Keyboard-only existing flow and Enter activation of non-owner Refresh floor pass. Axe reports zero violations in scanned Borrow and public Governance views. `keyboard-focus.png` inspected. | No screen-reader session, physical touch device, native 200% zoom or comprehensive forced-colors session. Axe is not certification. |
| Layout — Checked | Production public Governance with multiple long queued hashes inspected at 390/1440; overflow assertions pass at 320/390/800/1440. Existing Setup mobile check passes. Shared two-column/stacking layout and wrapping values retained. | RTL, translation expansion and native zoom not tested; only English is supplied. |
| Writing — Checked | Public heading now says Owner state. Set/Not set, Paused/Open, Ready/Expired and read-error recovery are explicit. Owner instructions/forms disappear for other wallets; public floor guidance remains actionable. | No usability interview or localization review. |
| Typography — Checked | Local PawnPixel loading confirmed via FontFaceSet; screenshot review of headings, labels, long hashes and tabular countdowns. Body/system font and spacing retained. | OS-specific fallback appearance and native iOS zoom not tested. |
| Colors — Checked | Reused established tokens, no palette changes. Computed opaque Governance text `#f2e8d0` on `#173b32`: 10.09:1; labels `#c9c6ac` on `#173b32`: 7.12:1. Scanned text contrast passes. | Not every hover/disabled/focus pair measured. `live-browser.json` body ratio uses ancestor solid color and does not measure the gradient at a point; do not treat it as a gradient result. No alternate theme exists. |
| UI — Checked | Loading/empty, ready/delay/expiry, owned/public, disconnected and wallet-change states checked. Countdown reuses receipt/Pair components and pixel theme. Reduced-motion emulation shows 0s button transition; frog SVG preserved. | No slow-motion animation-panel replay. Queue-RPC error message source-reviewed; forced queue-RPC failure was not browser-tested. Owner queue values are identified by operation hash/timestamps, with existing explorer link for event details. |

Findings and repairs, using final source locations:

- **High — `web/src/operations.tsx:260`:** disabled owner forms, claim and generic execution controls previously rendered for public visitors. Render owner sections conditionally by the relevant contract owner. Checked disconnected/non-owner DOM absence, visible public state, owner transaction review/receipt and account-switch removal.
- **Medium — `web/src/App.tsx:30`:** comparing two optional undefined values could expose Setup during initial loading. Require a connected account explicitly; gate both navigation and direct route content. Disconnected direct route and account disconnect checks pass.
- **High — `web/src/setup.tsx:120`:** PawnShop ownership alone previously exposed pool administration even when the pool had a different owner. Gate cap fields/actions by the independent pool owner. Split-owner Setup/Governance checks pass.
- **Medium — `web/src/governance-state.tsx:48`:** queue visibility previously required manual operation-hash lookup and only showed dates. Add automatic event/storage discovery and public countdowns, filtering cleared operations; keep manual lookup/execution owner-only. Two active/one cleared fixture and real empty chain state pass; time-boundary checks pass.
- **Low — `web/src/operations.tsx:234`:** public heading named owner controls despite the new read-only view. Use Owner state for public visitors. Final export screenshot rechecked.

Screenshots `owner-state-desktop.png`, `owner-state-mobile.png` and `keyboard-focus.png` were produced and opened for review. Final implemented tokens/components/responsive behavior are in root `DESIGN.md`. No unrelated design finding was used to expand this assignment.

## Publication and completion

**Incomplete overall: publication is blocked by the hosting service.** Implementation and local validation are complete for the requested scope.

`imd site publish dist --name pawn` bundled the final export into 233,416 bytes, then exited 1 with **503 `member_sites_closed`: “this plane names no member sites”**. No new CID/site version was returned. `pawn.site.identitymd.eth` remains the requested existing name; no substitute name was published. HTTPS checks of the `.eth.limo` page and favicon and `.eth.link` page failed at TLS (curl 35, no HTTP response). Thus this worker cannot confirm new live assets or the live frog favicon. Local final-export favicon/asset verification passed. Exact attempted publication, gateway failures and new asset hashes are in `publication.json`.

An authorized hosting service must publish this exact `dist/` under the existing name when the naming endpoint is available, then verify the served asset inventory and favicon. No requester-only contract value/address was missing, so no placeholder or `.imd-blocked.json` was introduced.

Git metadata and ignored paths were not modified. `artifacts/` is excluded by the environment's existing `.git/info/exclude`; deliverable evidence is mirrored here so collection can include it without any ignore change. Existing source, manifest/lockfile and runtime assets remain complete. The submission system must create the commit because this assignment prohibits writing `.git/`.

Packaging audit: the candidate working-tree payload measured 6,635,631 bytes across 226 files before this final evidence note; a test gzip archive measured 3,721,855 bytes. Both fit the 8,388,608-byte budget with over 1.7 MB raw-payload headroom. This is a candidate archive measurement, not a claim that a Git commit/bundle was created. `delivery-check.json` records the measured scope, export/source equality, every asset hash, unchanged favicon, zero protected-path changes, no dependency/cache archives and no submodule. The final evidence files add only a few kilobytes.
