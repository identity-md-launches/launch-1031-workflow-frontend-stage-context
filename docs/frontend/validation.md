# Frontend worker validation

Date: 2026-10-08. This is worker-generated evidence, not independent certification of behavior, security, or publication.

## Scope and assumptions

Implemented the approved Pawn website using Vite, React, TypeScript and viem. Source/configuration/lockfile are under `web/`; root `dist/` contains the static export and runtime deployment manifest. No contract, Foundry, dependency-library, root build, or GitHub workflow files were changed. No real transaction was signed or broadcast. No site was published, named or pinned.

The deployed source commit is `acb96152d7df6bba4f50f9946c7977026fea42c1`. The handoff's exact three application contracts, ABI hashes, pool key, chain, launch and attestation identifiers are preserved. Both build-input files were compared byte-for-byte with the pinned inputs using `cmp`. The handoff's deployed pool fee is 12,500; its older nested launch plan's 3,000 fee is not used. Auxiliary contracts are discovered through implementation-derived reads rather than added to the manifest contract set.

The source differs from the original product prose in documented ways: loan vaults are standalone deployments rather than clones; oracle signers are nonzero constructor requirements and have no zero-attester setup path. The frontend follows the deployed implementation. Unset question hashes remain owner/setter-configurable inputs. Nothing substitutes a fabricated address, signer, question, price, oracle signature or deployment ID.

The instruction requesting root `DESIGN.md` conflicts with the explicit write budget. The implemented design documentation is delivered at `docs/DESIGN.md`. The only new ignore file is the expressly allowed `web/.gitignore` (one-file path budget). It excludes nested dependency and cache output. No node_modules, dependency caches, vendored registry archives or submodules are part of the deliverable.

## Verification results

| Check | Actual command / evidence | Result |
| --- | --- | --- |
| Production export | `npm --prefix web run build`; `build.txt` | Exit 0; pinned ABIs verified and manifest regenerated after Vite |
| TypeScript | `npm --prefix web run typecheck`; `typecheck.txt` | Exit 0 |
| Unit tests | `npm --prefix web test`; `unit-tests.txt` | 10 tests passed |
| Export verification | `npm --prefix web run validate:export`; `export-check.txt` | Exit 0; 11 inventoried assets, 652,201 bytes excluding manifest |
| Browser interaction suite | `PLAYWRIGHT_BROWSERS_PATH=/tmp/pawn-browsers npm --prefix web run test:browser`; `browser-results.json` | 17 grouped checks passed against the production export using mocked wallet/RPC |
| Keyboard-only primary flow | Same browser command with `PAWN_BROWSER_CHECK=Keyboard-only`; `browser-targeted-results.json` | Wallet connection, seat inspection, NFT approval, review and pawn using Tab/Enter |
| Read-only chain checks | `npm --prefix web run check:live`; `live-read.json` | Both configured endpoints returned chain 1; code present at all three handoff contracts and both discovered children |
| Live browser | `PLAYWRIGHT_BROWSERS_PATH=/tmp/pawn-browsers node web/tests/render-live.mjs`; `live-browser.json` | Exit 0; live state and zero-liquidity trade message rendered without console or resource failures |
| Delivery integrity/size | `delivery-check.json` | Permitted paths, no dependencies/caches/submodules in candidates, export and submission size checked |

Vite emits one advisory that the main minified JavaScript chunk is slightly above 500 kB. The entire uncompressed asset inventory is about 637 KiB; its main JavaScript gzip size is about 163 kB. This is well below the export, asset-count, per-file, HTTP-budget and overall submission budgets. No packaging archive is included in `dist/`.

The supplied MCP browser could not initialize because `/opt/google/chrome/chrome` was absent. Chromium 141.0.7390.37 was installed under `/tmp/pawn-browsers` and used via local Playwright instead. Each test command owns its preview server and browser in one foreground process and closes both in `finally`. The export was served at `/preview/`, not just at the origin root.

### Interaction coverage

The mocked suite validates these actual UI sequences and transaction arguments:

- Disconnected and missing-wallet states; wallet rejection and retry; wrong chain; code 4902 → exact approved add-chain request → switch retry.
- Invalid monetary input; decoded contract simulation failure before signing; signing rejection and retry; native deposit; share preview; native withdrawal and separate pool claim.
- Exact PAWN approval to the discovered module, refreshed allowance, lock and unlock; individual seat ownership/approval, fee/net proceeds preview and pawn.
- Loan extension using saved terms and original module; pairing JSON; revoke; vault reward call; vault ETH credit and claim; token balance/decimals and recovery; principal repayment.
- Overdue auction initiation and auction purchase with an explicit native value ceiling.
- Native purchase quote and router execution with the exact attested hook/key; `0x10` command and `0x060c0f` actions decoded from the submitted call; ERC-20 sale with token→Permit2, Permit2→router, and zero-value execution as separate transactions; stale quote gating.
- Full signed-floor argument shape; bounty funding; burn-vault transfer and one-time burn; post-burn funding disabled. Oracle signatures in these tests are explicitly mock fixtures, not valid chain attestations.
- Owner cap queue/execution and pause; RPC code failure disabling writes and recovery on refresh; delayed receipt keeping duplicate/other writes disabled; account disconnection clearing transaction eligibility.
- An independent keyboard-only pass completes connection, seat inspection, approval, review and pawn using Tab and Enter. No pointer activation is used in that pass.

All mock writes are contained in the test process. The fixture provider never relays them to Ethereum. The rendered page uses the production bundle, not a test-only UI or test mode in application code.

### Live observations

`live-read.json` records an empty lending pool, no loans, zero bounty funding, paused new borrowing, and unset floor/burn question hashes. The attested Uniswap pool's active liquidity is zero. The final live browser read confirmed these conditions and showed the explicit liquidity-unavailable message instead of a tradable quote. Existing contract code was observed; no implication of a runtime bytecode audit is made.

## Better Interface review

Applied the pinned Better Interface guide and Ethereum frontend UX adapter while implementing, beginning with the contents/workflow and the core principles of accessibility, layout, writing, typography, colors and UI. The references were provided inputs and were not fetched or modified. Coverage is consolidated below rather than counted as separate design scores.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native links/buttons/fields/disclosures, persistent labels, live error/transaction announcements, disabled eligibility, skip link, focus outline, and keyboard-only primary flow. Axe: zero violations on the disconnected page and 320px transaction review. This is not full accessibility certification; no screen-reader session was performed. |
| Layout | Checked | Desktop 1440×1050; reflow at 320, 390, 800 and 1440px; mobile capture 390×844 and 320px transaction review. No document overflow in checked states. Native 200% zoom, physical-device interaction and exhaustive long-content combinations were not tested. |
| Writing | Checked | Labels name the action; reviews describe target, value and consequence; approval/claim steps are explicit; fees, credits and USD unavailability are explained. Error recovery remains near the action. Copy follows the deployed behavior rather than promises from the original brief. |
| Typography | Checked | Actual source scale, body/heading line heights, persistent 16px inputs, bounded prose, tabular figures and wrapping addresses. Desktop/mobile screenshots inspected. System font fallback varies by OS; no claim of an external font loading or every installed font weight. |
| Colors | Checked | Semantic tokens and computed rendered text/background pairs measured in `live-browser.json`. Body 11.63:1, hero 10.77:1, hero emphasis 9.95:1, muted text on page 5.39:1, muted text on panels 5.78:1, field labels 12.47:1, warning 6.54:1. Ratios apply only to the recorded opaque pairs; not every hover/alpha/selection/forced-color combination was measured. |
| UI | Checked | Distinct controls, one primary stage per transaction, inline review/cancel, explicit loading/error/empty/pending/confirmed states, native disclosures and copy/explorer links. Motion is limited to button feedback behind a reduced-motion query. No custom modal, theme switching, carousel or animation timeline was needed. |

No localization, RTL or dark-theme variants were requested or implemented. They are not claimed as reviewed. Native zoom, screen readers, forced-colors rendering and reduced-motion browser emulation remain unperformed subchecks; source support alone does not prove their rendering.

### Findings and fixes

| Severity | Final source location | Finding, correction and recheck |
| --- | --- | --- |
| Medium | `web/src/style.css:669` and mobile media rules | The first mobile screenshot joined “Clear terms.” and “Real responsibilities.” because a removed line break carried no space. Preserved the line break. Final mobile and 320px review screenshots show separated lines. |
| High | `web/src/engine.tsx:470`, `web/src/finance.tsx:257` | A fast next action after a receipt could lose its preview when the post-receipt refresh completed. “Confirmed” now follows refresh, and pool previews reset when their input changes rather than on a polling timestamp. The deposit → withdrawal → claim regression passed. |
| High | `web/src/finance.tsx:49`, `web/src/trade.tsx:54` | Source review found asynchronous seat/quote reads could finish after the user changed inputs. Generation guards discard obsolete results. Quote execution additionally checks a stored expiry before review and again before signing. Stale-quote interaction and final build/typecheck passed; artificial out-of-order response timing was not separately injected. |
| High | `web/src/engine.tsx:447` | Receipt review found viem can return a successful receipt for a cancelled/replaced transaction. The handler now follows replacement hashes and only treats an unchanged repricing as completion of the requested action. A timeout retains the write lock until a manual receipt recheck. Delayed receipt locking was browser-tested; actual mempool replacement/cancellation and the full 180-second timeout were not reproduced. |
| Medium | `web/src/logic.ts:77` | Floating-point precision could reject a valid 0.29% slippage setting. Parse basis points as an exact bigint instead. Unit tests cover 0.05%, 0.29%, 0.50%, 5%, and invalid inputs. |

Testing also repaired test-harness selectors and injected-wallet serialization; those were test setup defects, not reported as product findings.

## Remaining limitations

No funded transaction, real NFT approval, signed oracle submission, router execution, real wallet extension, hardware wallet or mobile wallet was exercised. No live swap can currently be quoted because the deployed pool has no active liquidity. Owner setup and funding are existing on-chain controls; this worker did not execute them. Generic governance forms were source/ABI-reviewed, but not every permutation of every queued change was exercised in the browser.

The current application supports the deployed LockDiscount interface. Governance replacing it with a different read interface requires corresponding frontend work; required unreadable state fails closed. Loans use bounded pagination, not complete historical indexing. ENS labels and WalletConnect are not configured; checksum addresses and browser wallets are supported. No USD source was provided. A final public hostname, absolute social preview image URL, IPFS CID and publication verification remain publisher work.

Completion: implemented and checked within the permitted frontend/documentation scope. Root design-file placement is the documented scope exception. This evidence does not stand in for the control plane's post-publication checks or unperformed live financial interactions.

## Git delivery limitation

`git add -- web dist docs/DESIGN.md docs/frontend` exited 128: Git could not create `.git/index.lock` because `.git` is mounted read-only. No staging or commit was possible, and no attempt was made to change the mount or bypass it. All deliverables remain in the permitted working-tree paths for the submission system to collect. Git commit creation is the outstanding environment-limited step; implementation, export and worker checks are complete.
