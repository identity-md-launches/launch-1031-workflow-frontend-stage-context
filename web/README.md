# Pawn frontend

React 19, TypeScript, Vite and viem, retaining the pixel frog pawn shop theme. `web/` contains the source and unchanged package manifest/lockfile. Root `dist/` is the complete production export with relative assets and hash routes. Serve the directory directly; hosting does not rebuild it.

## Install, preview and rebuild

Use Node.js 22.12+ (this worker: 22.23.3):

```sh
npm ci --prefix web --cache /tmp/pawn-npm-cache
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build
npm --prefix web run validate:export
npm --prefix web run preview
```

`preview` serves the production export; `dev` serves source. Dependency installation is reproducible from `package-lock.json` and supports `npm ci --offline` with a populated cache. The build itself verifies **live mainnet state**, so it requires public RPC access. This is an explicit site requirement, not an offline Solidity build. The worker installed dependencies only in an isolated `/tmp/pawn-work/web` copy to preserve the repository's protected dependency directories and configuration. No dependency caches, npm archives or node_modules are submitted. No ignore files changed.

## Deployment and ABI verification

`deployment.json` targets launch #1139; the original launch #994 record is retained only for unchanged token/trading-fee provenance. The source copied from launch #1139 main is pinned by `abi-source.json` to commit `d47364ebc5bde6ef6aec8ae6b70151fa5e2d3af7`, with the SHA-256 of each ABI file in `docs/abi/`. No `git show` or `.imd/reads/deployment.json` comparison is used.

`src/verify-deployment.mjs` is shared by `scripts/prepare.mjs` and the browser bootstrap. It checks mainnet chain ID and the four supplied primary addresses, calls PawnShop's `lendingPool()`, `discountModule()` and `vaultFactory()`, checks code at all seven addresses, checks the exact FloorRelay runtime hash, decodes `getLoan(0)`, and exercises `owner()`, `oracleSigner()` (the attester getter), token and child/shop bindings. Each verification uses one block for all reads. These checks establish readable interfaces and bindings; they are not a contract audit.

| Contract | Mainnet address |
| --- | --- |
| PawnShop | `0xf0d9300d7d891bc842da540cc4ddef050da9bcd4` |
| FloorRelay | `0x1ff0fb56f9a6c5c5c8201906d487ec4d8f5afc50` |
| MilestoneBurn | `0x45098bc496b3fdc870f89b8785047fb0e19ee99a` |
| PAWN token | `0x4f2bacee5f2e7ce3f48dfbd635d96e9a8fcbe478` |
| LendingPool, discovered | `0xe51a10d7b6978d153ad5075818c22e6ddfe15160` |
| Active LockDiscount, discovered | `0x2546b64664146b1efc4fe66284386961fa25d52d` |
| VaultFactory, discovered | `0xa7820e9e40630f5c3edffd5868f5e6e6f886681b` |

Prepare updates the child addresses, ABI hashes, `keeper/config.json` and development manifest. Production manifest generation inventories every exported asset. Runtime checks each fetched ABI hash, checks the chain independently, and rejects stale child addresses before enabling transactions. A future signer/contract migration requires a reviewed configuration and verifier update. Historical token launch children are used only to verify the original liquidity receipt, never as active lending targets.

## Oracle flow

Setup, public Refresh floor and Burn use `src/oracle.ts` and `OracleFlow`. With an empty optional lookup, Fetch finds the newest exact-question/mainnet request. An optional request UUID or job UUID resolves through the public list. The saved lookup can be cleared to search again. The search asks for 100 entries, then 1,000 if needed; the current service caps the larger response at 500. Older exact request UUIDs can still be read directly. Job UUID resolution beyond the service's recent list is not guaranteed.

Real Chromium tests found CORS headers on `/oracle/requests?limit=1`, `?limit=100`, `?limit=1000`, and `/oracle/requests/<id>`. `/oracle/requests/<id>/attestation` lacked CORS headers and failed in the browser. The site reads the signature and signed struct already present in the readable detail response, reconstructs the IdentityMD Oracle v2 typed domain, and independently recovers the signer. No proxy, manual answer/signature paste, or verification bypass is used.

Busy responses (including HTTP 200 with `error: "busy"`) and HTTP 429/503 receive at most five retries after the initial attempt, spaced 1, 2, 4, 8 and 16 seconds. Browser transport failures use the same bound because a busy gateway may omit CORS. Each attempt has a 20-second timeout. Retry status is announced, Stop waiting aborts requests/backoff, changing the lookup invalidates old results, and API messages are shown as text with recovery guidance. Generic browser failures never appear as “Load failed”.

Inspection checks the exact question, chain, panel/tolerance, canonical request ID, hash, signed domain, signer, signature, value, expiry and floor block window. The owner admits a new floor hash before anyone posts it. The burn setter pins a qualifying answer before Burn; the $1M and one-hour constraints remain enforced. All transactions still require review, simulation and explicit wallet confirmation. The real test request `4a3fa40e-32c7-49d1-9a2c-08c30495a2a6` and its job `139f66e5-3cca-455d-8bd9-39aa393e7b3d` both reached **Approve this hash** against live mainnet reads in the local production browser. This attestation expires; future reruns need a fresh qualifying request once it is stale.

## Checks

```sh
npm --prefix web test
npm --prefix web run typecheck
npm --prefix web run validate:export
npm --prefix web run check:live
# Install Playwright Chromium to a temporary cache if no browser is available:
PLAYWRIGHT_BROWSERS_PATH=/tmp/pawn-browsers npm exec --prefix web -- playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/pawn-browsers npm --prefix web run test:browser
PLAYWRIGHT_BROWSERS_PATH=/tmp/pawn-browsers web/node_modules/.bin/tsx web/tests/launch-browser.ts
PLAYWRIGHT_BROWSERS_PATH=/tmp/pawn-browsers node web/tests/oracle-live.mjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/pawn-browsers node web/tests/oracle-cors.mjs
```

The browser scripts also accept `PAWN_CHROMIUM_PATH`. This worker used installed Chromium headless shell 154.0.8037.0. Each script owns its temporary preview server and browser in one foreground run. General and oracle regression suites use deterministic RPC/wallet fixtures. The oracle suite simulates a governed signer rotation after the deployment checks so a public test signature can exercise admission and burning. Fixtures never enter the production app.

`oracle-live.mjs` uses real RPC/API reads and a wallet adapter containing only the chain-read owner address; signing and transaction methods throw. It can run against an already published site by setting `PAWN_SITE_URL`. Source and runtime verification fixtures, 36 unit checks, 18 general browser scenarios, 10 oracle scenarios, mobile/desktop reflow, keyboard review and automated accessibility results are recorded in [the current validation report](../docs/frontend/oracle-fix/validation.md). Original historical browser scripts/reports describe earlier site revisions; the commands above are the current validation entry points.

## Publish

On an already configured IdentityMD publisher, from the repository root:

```sh
imd site publish dist --name pawn
PAWN_SITE_URL=https://pawn.sites.imd.fun/ node web/tests/oracle-live.mjs
```

**Blocked in this task environment:** the first command returned exit 1, `not configured — run: imd pair --server <url>`. No new CID or name update was returned. A read of `pawn.sites.imd.fun` confirmed it still serves the old assets and PawnShop `0x0cc05d3b2879e8dfd18e987d1a50008506cc3756`. This is not a platform rejection of launch #1139; the command could not authenticate a publisher. No device credentials/configuration were inspected or modified. See [publication.json](../docs/frontend/oracle-fix/publication.json).

After authorized publication, compare the served HTML, manifest, favicon and every manifest asset's SHA-256 with `dist/`, then rerun the live browser check. The worker did not modify `.git/`; source, existing lockfile and finished export are ready for the network's submission collector.
