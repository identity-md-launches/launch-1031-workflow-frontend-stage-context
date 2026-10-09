# Pawn oracle and deployment validation — 2026-10-09

## Outcome

**Implementation and local validation complete; publication blocked.** The production export is `dist/`. `imd site publish dist --name pawn` returned exit 1: `not configured — run: imd pair --server <url>`. No CID was returned. The task environment lacks a configured publisher; this was not a rejection because contracts belong to another launch. No credentials or device configuration were read or changed.

The requested host `https://pawn.sites.imd.fun/` returned HTTP 200 but different HTML and the original PawnShop `0x0cc05d3b2879e8dfd18e987d1a50008506cc3756`. Consequently, this report does **not** claim the new site is live there. [Publication evidence](publication.json) records the exact result and byte comparison. An authorized publisher must publish the delivered export, compare all served bytes, and run the live browser test on that origin.

## Scope and provenance

Read the pinned project, original deployment, network, Better Interface guide and license. The task expressly overrides the original deployment record. Copied `web/` and `docs/abi/` from launch #1139 main at `d47364ebc5bde6ef6aec8ae6b70151fa5e2d3af7`; package.json, package-lock.json, Vite config and tsconfig were byte-identical to the workspace and left untouched. Existing Solidity/build/dependency configuration, lib, Git metadata, environment files and node_modules were not changed.

`web/abi-source.json` records every copied ABI's SHA-256. Build and runtime share `web/src/verify-deployment.mjs`: mainnet, exact supplied primary addresses, nonempty code at all seven contracts, FloorRelay code hash, PawnShop owner/attester/token/getLoan reads, three discovered child addresses, and child/token/shop bindings. `oracleSigner()` is the deployed ABI's attester getter. [Mainnet report](mainnet-verification.json) records the actual block and calls. No chain transaction was sent.

The active children are LendingPool `0xe51a10d7b6978d153ad5075818c22e6ddfe15160`, LockDiscount `0x2546b64664146b1efc4fe66284386961fa25d52d` and VaultFactory `0xa7820e9e40630f5c3edffd5868f5e6e6f886681b`. The separate standalone LockDiscount is not the active module. Original token-launch addresses remain only as historical trading-fee receipt provenance.

## Oracle route evidence and interactions

[oracle-cors.json](oracle-cors.json) records actual Chromium 154.0.8037.0 fetches from `https://pawn-put-your-seat-to-work.sites.imd.fun`. The list routes with limits 1, 100 and 1,000 and request-detail route returned HTTP 200 with `Access-Control-Allow-Origin: *`. The 1,000 query was capped to 500 entries. The `/attestation` route failed real browser CORS checks: its response lacked the header. Those expected probe failures are recorded separately from application errors.

The app uses the readable list/detail routes, whose detail response already includes the signed struct and signature. It reconstructs the v2 domain and independently recovers the attester. It never fetches `/attestation`, uses a proxy, or accepts manually pasted oracle evidence. List lookup matches either request ID or job ID, then validates the returned canonical request ID. Blank lookup finds the newest exact matching question on mainnet. A saved ID can be cleared to search again.

[Live browser report](live-browser.json), using real public RPC/API responses and only a read-only owner-address wallet adapter, passed:

- New PawnShop address and all initial contract checks.
- Public Refresh floor with an empty lookup automatically found request `4a3fa40e-32c7-49d1-9a2c-08c30495a2a6` and showed the owner-approval state.
- Owner Setup automatically reached enabled **Approve this hash**, displaying the signed **1.94 ETH** answer and canonical request UUID.
- Job ID `139f66e5-3cca-455d-8bd9-39aa393e7b3d` resolved to that same request and approval step.
- No request to `/attestation`, no page errors or failed application resources, and no signing/wallet mutation requests.

The request was fresh during these tests. It has a signed expiry, so this exact test must not be expected to pass indefinitely. The browser test uses the chain-read public owner address only to reveal owner UI; it never signs or sends an approval.

## Commands and results

Dependencies were installed with `npm ci` from the unchanged lockfile in `/tmp/pawn-work/web`, keeping repository dependency paths untouched. Source/ABIs were copied into that isolated build directory, the final export/configuration was copied back, and bytes were checked. See [commands.json](commands.json), [build.txt](build.txt), [typecheck.txt](typecheck.txt), [unit-tests.txt](unit-tests.txt), and [export-check.txt](export-check.txt).

| Check | Actual result |
| --- | --- |
| `npm run build` | Passed. Prepare verified mainnet, Vite built, manifest inventory passed. Vite emitted a non-fatal >500 kB JavaScript chunk warning. |
| `npm run typecheck` | Passed, exit 0. |
| `npm test` | 36 tests passed: chain/ABI/binding rejection, amounts/trading, oracle signature/domain/window checks, request/job lookup, busy exhaustion, transient transport recovery and cancellation. |
| `npm run validate:export` | Passed: complete relative assets, ABI hashes and SHA-256 inventory. |
| `tsx web/tests/launch-browser.ts` | 10 scenarios passed; deterministic RPC/wallet/signature fixtures, including real rendered retry/error states, approval→posting and pin→burn, expiry/revocation, keyboard review, responsive layout and axe. |
| `tsx web/tests/browser.ts` | 18 scenarios passed: wallet rejection/network switching, borrowing/NFT approval, lending/withdrawal, locking, loan/vault interactions, auctions, swaps, funding, quotes, governance, pending writes and keyboard actions. |
| `node web/tests/oracle-live.mjs` | Passed against local production `/preview/` with actual API/RPC data. |
| `node web/tests/oracle-cors.mjs` | Confirmed the readable routes and reproduced `/attestation` CORS denial in actual Chromium. |
| `imd site publish dist --name pawn` | Blocked, exit 1, exact response above. |

The installed browser tool initially navigated successfully but then returned `Transport closed`. Verification continued with the installed Chromium headless shell through Playwright in bounded foreground scripts; browser security/CORS stayed enabled. The current script entry points accept `PAWN_CHROMIUM_PATH`; the worker used `/opt/imd-tools/ms-playwright/chromium_headless_shell-1246/chrome-headless-shell-linux64/chrome-headless-shell`.

Two inherited harness assumptions were repaired before the final passing runs: mock RPC lacked the new `debtRealised`/`auctionOpenedAt` getters; the general browser test still searched for removed manual-signature forms. Cryptographic posting and burning are covered by the current dedicated oracle suite. Its deterministic test signer is introduced as a simulated governed rotation **after** real deployment-target bootstrap checks. No verification bypass is present in application code.

## Better Interface: six domains

Review used the pinned Better Interface core principles for every domain plus the document-web-design section. Kept the existing night theme, frog, typography and transaction review pattern. Screenshots were opened and visually inspected, not inferred from source. Full reports: [oracle scenarios](oracle-browser-results.json), [general scenarios](regression-browser-results.json).

| Domain | Coverage and evidence | Limitations |
| --- | --- | --- |
| Accessibility — checked | Native labelled controls; oracle regions; stable status/alert feedback; cancellation; keyboard Tab/Shift+Tab/Enter through review and cancel; visible gold focus ring inspected; zero axe violations in checked states; reduced-motion transition disabled. | No screen-reader session, physical touch device or forced-color device test. Automated scans are not a compliance claim. |
| Layout — checked | Setup, public floor flow and burn with full UUIDs/hashes at 320, 390, 800 and 1440 CSS px; no horizontal document overflow. Full-page and focused screenshots inspected. | Native browser zoom, RTL and pseudo-localization unperformed; English-only fixed theme. |
| Writing — checked | Fetch/approve/post and verify/pin/burn name their distinct actions. Optional automatic lookup replaces required ID paste instructions. Busy and API error messages remain local, actionable and readable; no raw “Load failed”. | API prose is external and may vary. |
| Typography — checked | Local pixel headings and system body; 16px inputs; complete selectable hashes wrap; stable numeric amounts/timer; body measure and heading hierarchy reviewed. | OS-specific font rendering and Safari/iOS unverified. |
| Colors — checked | Measured rendered text/surface pairs: cream `#f2e8d0` on `#173b32` 10.09:1; muted `#c9c6ac` 7.12:1; gold secondary text `#f6d27a` 8.44:1. Status has text in addition to color. | Measurements apply to those opaque pairs, not every gradient/art pixel or browser state. No alternate theme exists. |
| UI — checked | Existing pixel edges/shadows retained; loading, empty, pending, failure, verified, approval and expired states; supporting buttons now visually secondary; inline reviews keep keyboard navigation in page flow. | No motion-editor 10% playback; no modal or theme transition is implemented. |

## Findings, fixes and rechecks

| Severity | Source | Reproduction and fix | Recheck |
| --- | --- | --- | --- |
| High | `web/scripts/prepare.mjs:6`, `web/src/config.ts:159` | Original launch/Git ABI comparison blocked the redeployed source. Source-bound copied ABIs and the shared live verification now govern preparation and browser bootstrap. | Build and live browser passed; old-target, no-code, wrong-chain and binding-failure unit checks reject. |
| High | `web/src/oracle.ts:247` | `/attestation` was unreadable cross-origin. Read signature/struct from browser-tested detail route after canonical list resolution; keep full independent signature/domain/request validation. | Live request and job both reached Approve this hash; no `/attestation` application fetch. |
| High | `web/src/oracle.ts:130` | HTTP 200 `{error:"busy"}` could be mistaken for pending; raw browser failures were unhelpful. Added bounded five-retry backoff, readable service messages, transport retry, timeout and abort. | Retry/exhaustion/cancel/HTTP-200 tests and rendered busy/error scenarios passed. |
| Medium | `web/src/oracle-flow.tsx:146`, `web/src/setup.tsx:85` | Required request-ID paste and old Setup instruction conflicted with automatic flow. Empty lookup discovers the latest matching request; IDs remain optional for exact request/job selection; old Setup copy was removed. | Real public and owner flows completed with no typed/pasted ID; job lookup also passed. |
| Low | `web/src/style.css:1164` | Copy, refetch and approval all had equal gold fill. Supporting oracle controls now use the existing surface/highlight tokens while the next transaction remains prominent. | Desktop/mobile screenshots inspected; secondary-action contrast measured 8.44:1; axe remained clear. |

## Artifacts and limits

[DESIGN.md](../../../DESIGN.md) documents implemented tokens, typography, components and breakpoints. Screenshots: [desktop setup](setup-desktop.jpg), [mobile setup](setup-mobile.jpg), [live floor approval desktop](oracle-approve-desktop.png), [live floor approval mobile](oracle-approve-mobile.png), [burn](burn-flow-mobile.png), [keyboard focus](keyboard-focus.png).

No mainnet transaction, funded purchase, real wallet signature, contract deployment, or live burn was performed. Recent job-ID search is bounded by the service's 500-item cap; older exact request UUIDs remain directly readable. Build/live operation needs a responding public RPC/API. All independent-verifier claims are out of scope: these are worker-run checks. **The outstanding acceptance item is publication and verification at pawn.sites.imd.fun.**

The complete prospective file-tree Git snapshot measured **4,864,163 bytes**, below the 8,388,608-byte limit; the production export is about 1.03 MB. See [submission-size.json](submission-size.json). No dependency/cache directories or npm archives are included. The repository is a partial clone, so its unavailable upstream history could not be bundled without fetching into read-only `.git`; the size check used an isolated temporary repository containing all deliverable files. It made no commit or metadata change in the task repository.
