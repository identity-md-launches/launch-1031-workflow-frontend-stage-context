# Pawn frontend

A static Vite / React / TypeScript application for the deployed Pawn contracts. Source is in `web/`, the complete production export is in root `dist/`, and worker evidence is in `docs/frontend/`. Serve the committed export directly; publishing does not require a build or backend.

## Install, build, and preview

Use Node.js 22.12+ (worker: Node.js 24.21.0) and npm. Run from the repository root:

```sh
npm ci --prefix web --cache /tmp/pawn-npm-cache
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build
npm --prefix web run validate:export
npm --prefix web run preview
```

`preview` is a local foreground development server. Stop it when finished. `npm --prefix web run dev` runs Vite against the prepared development manifest in `web/public/`. Run the build once before development when deployment inputs or ABIs change. All dependency installation, lockfiles and Vite/TypeScript configuration remain in `web/`. The explicit ignore-file budget is one file, `web/.gitignore`, covering dependency/cache output at every nesting level within `web/`. No dependency archive or offline npm registry is needed or included.

## Deployment source of truth

The browser fetches `./imd-deployment.json`, then its referenced raw ABI JSON. This is the only runtime address, chain, public RPC, and pool configuration. There is no independent address map in application code. Standard ERC-20/ERC-721/Uniswap interfaces live together in `src/config.ts`; they contain no deployment addresses. No private keys, RPC credentials, or WalletConnect project ID are needed.

`web/deployment.json` and `web/network.json` preserve the supplied handoff and chain-table input for reproducible builds after `.imd/reads/` is removed. These are build inputs, not separately consumed runtime maps. `scripts/prepare.mjs` reads all six ABI arrays from Git at deployed source commit `acb96152d7df6bba4f50f9946c7977026fea42c1`, compares their raw bytes with `docs/abi/`, and verifies canonical sorted-key Keccak hashes for the three attested contracts. Preserve that Git object when making a shallow source checkout. Auxiliary ABIs are implementation-derived from the same pinned commit; their bytes are bound by the asset inventory.

Vite uses `base: './'` and hash navigation. `scripts/manifest.mjs` runs after Vite, copies the exact handoff identifiers, three-contract set, pool key, network, and wallet-add-chain parameters, and hashes every other exported file. It excludes the manifest itself. `validate-export.mjs` checks exact configuration equality, ABI hashes, complete asset coverage, safe relative paths, SHA-256 values, file/count/export size limits, and a relative HTML entrypoint. Rebuild after any exported-byte change. The pinned handoff's pool fee is **12,500**, even though its older nested launch-plan pool describes 3,000; the site uses the actual attested `poolKey` without recomputing it.

The browser verifies RPC chain ID, nonempty code at application addresses, and token/shop bindings. LendingPool and the current discount module are discovered from PawnShop; each vault is discovered from `getLoan`. These are not extra deployment-manifest contracts. This verification establishes configuration and readable bindings, not a bytecode audit or proof of security.

## Wallet and transaction behavior

Browser-injected Ethereum wallets are supported. A missing wallet shows recovery guidance; a wrong chain shows one switch action. An unknown-chain error invokes the exact `walletAddChain` object and retries switching. Account/chain changes discard the current tool state. ENS resolution and WalletConnect are not configured; addresses are checksummed, copyable and linked to the supplied explorer. Public RPC fallback follows the supplied order, batches reads, and polls visible pages every 30 seconds. Manual refresh and post-receipt refresh are available. Signing always stays in the visitor's wallet.

Each write follows review → simulation → explicit confirmation → wallet → receipt → state refresh. It is simulated again immediately before the wallet request. The review shows the target, native value and effect; the wallet supplies the actual gas fee. Each action owns its submitting/error state, while the engine prevents concurrent writes. A transaction hash and persistent status survive tool changes. If a receipt times out, writes remain blocked until a manual “Refresh state” observes a receipt; use the explorer link before considering any retry. No unlimited approvals or auto-broadcast validation are used.

## Using the tools

- **Borrow:** inspect an owned identity.md seat and select a live term. Preview principal, upfront fee, net pull credit, due date, and committed lock tier. Approve only that NFT, then pawn it. The discount preview simulates the actual module's `commit` as an RPC call; it never sends a transaction from PawnShop. Stale/unset floors, paused loans, insufficient idle assets, collection allocation and minimum principal block borrowing.
- **Lend:** deposit native ETH, withdraw ETH, redeem pETH shares, or donate without receiving shares. Native withdrawals become a separate pool claim. pETH uses the pool's on-chain decimals (24 in the deployed implementation); ETH and PAWN amounts are formatted using their proper units. Preview/max reads and simulation check liquidity and the cap.
- **Loans & auctions:** latest ten loans per page, page-local “mine”/auction filters, and direct ID lookup. Inspect saved terms and the original module; extend or repay active loans. Eligible expired loans can enter auction; buyers review a fresh price ceiling and separately claim excess. Loss marking and eligible write-offs are exposed. A borrower's verified vault supports pairing-message authorization, revocation, no-value reward calls, ETH-to-credit withdrawal, claim, and ERC-20 recovery with balance/decimal reads. Loans are discovered without an unbounded scan or indexer.
- **Lock PAWN:** exact approval before locking, then lock/unlock within the live balance. The original module can be loaded separately to recover available tokens following a rotation. New custom module implementations that do not expose the deployed LockDiscount read interface require a frontend update; the application fails closed if its required reads cannot be verified.
- **Trade:** simulate `quoteExactInputSingle` against the exact attested pool. Display received/minimum output, rate, quote age and a price difference including fees. Slippage is 0.05%–5%, default 0.50%; quotes expire after 60 seconds. No active liquidity produces an explicit unavailable state. Native input has no approvals; ERC-20 input uses exact token→Permit2 approval, then exact Permit2→Universal Router approval (30-minute expiry), only when short. Router execution uses `0x10`, inner actions `0x060c0f`, the unchanged hook/key, a 5-minute deadline, and the network's optional extended parameter tuple. Every router execution is simulated before signing. There is no live USD feed; values stay in token units.
- **Oracle & burn:** paste the full 15-field oracle attestation and signature; JSON integers larger than JavaScript's safe range must be strings. `answerType` for uint256 is 3. Floor and burn signatures have different consumer domains. Top up bounties, permanently fund the burn vault, trigger its one-time signed milestone, or sync the governed signer. There is no oracle request API integration or fabricated signed data. Burn deposits are disabled once burned.
- **Governance:** current owner/nominee/setter eligibility gates setup, pause, cap increases and ownership controls. Queue/execute terms, collections, signer, fee recipient and discount module; disable collections, cancel an operation, and inspect its execution time by operation hash. Generic tuple fields list exact ABI names/types. Durations/timestamps use seconds; percentages use bps. Initial question hashes are owner-settable settings, not invented defaults. The accepted deployment has no zero-attester initialization function. Claims can be forwarded to lenders with a separate donation.

## Validation

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/pawn-browsers npm exec --prefix web --cache /tmp/pawn-npm-cache -- playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/pawn-browsers npm --prefix web run test:browser
npm --prefix web run check:live
PLAYWRIGHT_BROWSERS_PATH=/tmp/pawn-browsers node web/tests/render-live.mjs
```

The browser scripts own and close their local HTTP server and Chromium in the same foreground run. They serve the production export at `/preview/`. Browser interaction tests intercept both approved RPC endpoints and install a test-only wallet. Mock values, signatures, balances, vault addresses and transaction receipts are fixtures and never enter the app bundle. The separate live scripts make read-only RPC calls; they do not connect a wallet or sign/broadcast.

See `../docs/frontend/validation.md` for actual results, six-domain Better Interface coverage, fixes, and unperformed checks. `../docs/DESIGN.md` records implemented tokens and components. Root `DESIGN.md` was not created because the assignment's explicit path budget permits only `web/**`, `dist/**`, and `docs/**` (plus the named `web/.gitignore`).

No deployment, site publication, IPFS pinning, ENS naming or real financial transaction was performed. A final public domain/CID and absolute social preview URL are publisher responsibilities. Publication checks are separate from this worker's browser/interaction evidence.

Worker Git note: this workspace mounts `.git` read-only. `git add` failed with `Read-only file system`, so the worker could not create a commit. The source, lockfile, export and evidence are present in the allowed working-tree paths for collection by the submission system.
