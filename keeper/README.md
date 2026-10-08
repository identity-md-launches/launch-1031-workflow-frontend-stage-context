# Pawn keeper (MIT)

Run from the repository root with Node 22 or newer. The committed `runtime.mjs`
bundles viem 2.38.5 and its dependencies; no install, package manifest, submodule,
network dependency download or private key file is needed at runtime. See
`THIRD_PARTY_LICENSES.md`. The keeper only reads the oracle API; it never buys
oracle requests or configures owner settings.

## Five-minute start

1. Edit `keeper/config.json`: use your mainnet RPC URL, verify the supplied live
   addresses against `web/deployment.json`, and add purchased **oracle UUIDs** to
   `floorRequestIds` and `marketCapRequestIds`. Empty arrays enable discovery
   of recent matching questions, not invented request IDs. The API must still
   be reachable at runtime to read answers. Setup must already have pinned the
   consumer's question hashes.
2. Run `node --test keeper/tests/*.test.mjs` offline.
3. Run `node keeper/run.mjs` for a read-only dry run. It discovers the shop owner
   for `eth_call`; it does not create or use a test signing key.
4. Fund a dedicated keeper wallet with ETH. Inject `KEEPER_PRIVATE_KEY` from
   your secret manager into the process environment, then run:
   `DRY_RUN=false node keeper/run.mjs`. Do not commit keys, env files or secret
   values. `RPC_URL` overrides the JSON RPC URL.
5. Schedule the command hourly with `cron.example` and an operator-owned
   wrapper, or install `hourly-workflow.yml` as a GitHub Actions workflow in
   your operator repository. Configure the secrets named in that template.
   This assignment prohibits touching `.github/`, so the installable workflow
   is delivered here. Actions schedules may be delayed or disabled by GitHub;
   use external cron if punctuality matters.

Optional alert configuration is environmental: `WEBHOOK_URL` receives JSON
`{text}`, or set `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID`. Alert failures do not
abort confirmed transactions. Alerts include stale floor, oracle failures or
incompatible evidence, auctions started/stuck at least three days, pending
shop/pool owners, low bounty/shortfall reserves and a completed burn. No alerts
were sent in local verification.

## Operating policy

Each action verifies mainnet code and token/shop bindings, validates oracle
consumer, governed signer, EIP-712 signature, UUID, question hash, chain, type,
consensus, 5% tolerance, age and expiry, and simulates before estimating gas.
A newer floor is posted; overdue active loans are auctioned only **after** the
three-day grace period; the milestone burns only once at >= $1M with a nonempty
vault. The burn follows PawnShop's current signer, matching the deployed
contract's automatic signer sync.

By default actions run only when a funded bounty covers action gas, a 45,000
gas allowance for claiming the pull credit, and a 20% margin at the RPC's
max fee estimate. An empty reserve or the floor's once-per-24-hour interval
means zero bounty. **MilestoneBurn has no bounty**, so it is skipped unless
`ALWAYS_RUN=true`. This override also permits necessary unprofitable floor
updates and auctions; the operator pays gas. `DRY_RUN` defaults to true; only
literal `DRY_RUN=false` enables broadcasts. Confirmed writes wait for one
confirmation, and every later action re-reads its bounty balance. Transactions
can still be repriced, front-run, reverted or reorged; inspect alerts and chain
state. The keeper does not automatically claim its credits.

Loan scans are bounded by `loanBatchSize` (default 100). A cursor in `stateFile`
wraps to loan 1 after reaching `nextLoanId`; at high loan counts increase the
batch or frequency so the entire book is scanned within your desired SLA.
Persist the cursor between runs; the Actions template caches it. Use one
operator/process per signing wallet, with the workflow concurrency group or
cron's `flock`. Do not run both schedulers against the same wallet.

Oracle discovery reads the newest `discoveryLimit` requests, capped at 500,
and validates each candidate; it does not assume the first global request
belongs to this consumer. Configure exact IDs when your request is outside
that page. Operators must keep buying/scheduling compatible fresh answers,
maintain ETH, replenish bounties, monitor RPC/API uptime, review owner changes,
and keep keys secure. A configured floor hash can only be changed by the
owner's delayed collection governance; the burn hash is immutable. The keeper
reports mismatches and never substitutes or overwrites hashes.

## Rebuilding the bundled runtime

Use the existing locked web dependencies in an isolated build directory (the
repository's dependency/configuration files remain unchanged). With Node 22:

```
web/node_modules/.bin/esbuild keeper/runtime-entry.ts --bundle --platform=node --format=esm --target=node22 --minify --legal-comments=eof --outfile=keeper/runtime.mjs
```

Make the locked `web/node_modules` available to the resolver at build time via
`NODE_PATH` or an isolated parent build directory, not a new keeper dependency.
Regenerate third-party notices from the bundle's dependency inventory when
updating it. `runtime-entry.ts` shares the exact browser oracle verifier, so
bundle it again whenever `web/src/oracle.ts` changes. The generated bundle is
what makes `node keeper/run.mjs` work without npm or network installs.
