# FloorRelay, Setup and keeper handoff

The existing site name is **pawn.site.identitymd.eth**. Source is in `web/` and
its complete static export is in `dist/`. No on-chain deployment or transaction
is performed by this assignment. PawnShop, MilestoneBurn, PAWN, the existing
manifest, deployment addresses, dependencies and build settings are unchanged.

## Activate FloorRelay

1. The deployment operator deploys `src/FloorRelay.sol:FloorRelay` on Ethereum
   mainnet, with **no constructor arguments**, verifies its source and supplies
   its real address to the owner. There is no assumed or placeholder deployment
   address. It has no owner, storage, upgrade path, withdrawal or other external
   function besides `isValidSignature(bytes32,bytes)`.
2. Connect the current PawnShop owner to Setup and enter that address under
   **Deployed FloorRelay address**. The site checks the runtime against
   `web/src/floor-relay.json`, generated from this compiler-pinned build by
   `node tools/export-relay.mjs`. An EOA, proxy or different build is refused.
3. **Switch attester to FloorRelay** calls `PawnShop.queueAttester(address)`.
   The panel displays the current attester, pending countdown and cached burn
   signer. Wait **48 hours**, then use **Execute FloorRelay switch** within
   **7 days** of maturity. The transaction uses the exact queued address.
   A superseding queue or cancellation invalidates an earlier operation.
4. MilestoneBurn has no independently governed attester. It follows PawnShop
   automatically on each burn; anyone can also call `syncSigner()` to refresh
   its cached value. No separate burn rotation transaction is required.

The address field is an owner-entered operational setting saved in this
browser. Actual attester state always comes from chain. The site and keeper
detect the activated relay by runtime hash, so no site rebuild or keeper
address edit is needed after the switch. Before activation, the UI warns that
only answers signed for the relevant consumer contract are accepted; direct
EOA signatures still work then. Unknown contract signers fail closed.
All owner transaction controls remain gated by the relevant owner wallet.
Everyone can read owner state and queued changes in Governance; a non-owner
opening `#setup` sees that read-only state. The UI gating is not an on-chain
restriction: PawnShop permits anyone to execute a mature queued operation.

## Request-id workflow

There are **no oracle purchase, approval, payment-signature or paid-order API
calls** in the site or keeper. Buy the question on
[explorer.imd.fun](https://explorer.imd.fun), then paste its **oracle request UUID**
(not a payment order id or transaction hash). The same flow appears in Setup,
Borrow's public Refresh floor and Oracle & burn. Each shows the exact question
with a copy button. The site only reads the public API's
`GET /oracle/requests/:id` and `GET /oracle/requests/:id/attestation`.

For the relay, buy with **no consumer**, domain `IdentityMD Oracle`, version
`2`, chain 1, verifying contract zero. Request a uint256 with public panel
sources, at least five members, quorum at least four and tolerance at most
500 bps. Floor answers must have **validForSeconds >= 93600** (26 hours).
The floor question is:

> What is the current floor price, in wei, of the identity.md NFT collection at 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D on Ethereum mainnet, defined as the lowest active listing on OpenSea or Blur at the time of answering? Answer as a uint256 in wei.

The burn question is:

> What is the fully diluted market cap of the PAWN token (0x4f2bacee5f2e7ce3f48dfbd635d96e9a8fcbe478, Ethereum mainnet), computed as total supply times the spot price from its Uniswap v4 ETH pool, converted to USD at the current ETH price? Answer as a uint256 in USD with 18 decimals.

The site verifies the signature against the relay's pinned IMD attester,
domain, request UUID, question text, canonical question hash, chain, answer
type, panel consensus, age and expiry. It checks the signed hash against the
configured on-chain hash. If initially unset, only the owner (and, for burn,
the immutable question setter) can confirm the one-time hash transaction.
The signed question hash is shown in the transaction review. The site then
packs `abi.encode(attestation, imdSignature)` into the consumer's `signature`
argument, simulates and submits. It skips floors whose `issuedAt` is not newer.
Burn rechecks evidence immediately before simulation; it needs a nonempty
vault, a cap of at least $1M in 18-decimal USD units and `burned() == false`.
Deposits into the burn vault cannot be withdrawn and tokens sent after its
single burn stay stranded.

A floor bounty is a **0.001 ETH pull credit**, available at most once per
collection per rolling 24 hours if the reserve is funded. Claim it separately.
Anyone can post first, so buying an answer does not reserve its bounty. Posting
and claiming cost gas. A purchase may fail to reach consensus and spend its
price. The UI stores only the request id for resuming a poll; Stop waiting
stops further polling/prompts, not a transaction already sent.

## Constraints the relay does not change

The relay adapts only the EIP-712 domain. Its immutable IMD attester is
`0x5598aa9146215bc13eb26f2c692ad1461fd32982`, confirmed from the
[public API](https://api.imd.fun/oracle/requests?limit=1) on 2026-10-08.
If that key rotates, deploy a separately reviewed relay and use PawnShop's
48-hour rotation again. Consumers continue checking validity windows,
question hashes, quorum and replay rules. PawnShop requires strictly increasing
`issuedAt`; MilestoneBurn is a one-time operation, with no rolling newest-floor
state. Neither consumer source was changed.

The captured real floor request `62702d2a-1a38-4543-93cc-7ece5ac20a66` proves
zero-consumer signature verification, but its lifetime is **86400 seconds**.
It still fails PawnShop's existing 26-hour lifetime rule. Do not buy the
explorer's 24-hour default and expect the relay to extend it.

Canonical question hashes include the resolved window and definitions, not
just question text. New requests may have different hashes. Before enabling
borrowing or permanently pinning the burn hash, the operator must arrange
compatible requests with the oracle service. Floor hash changes require the
owner's delayed `queueCollection` / `executeCollection`; the burn hash cannot
be changed. This assignment cannot override those deployed constraints.

## Keeper and responsibilities

See [keeper/README.md](../keeper/README.md). Configure exact IDs in
`floorRequestIds` and `marketCapRequestIds`; there is no global discovery or
purchase logic. The shared browser/keeper verifier selects relay packing when
the current governed signer has the verified runtime. Simulations, profit
checks, `startAuction`, bounded scans and health alerts remain. Dry run is the
default. The operator supplies gas, new compatible request IDs, funded bounty
reserves, scheduling, RPC/API uptime monitoring and secure signing credentials.
The keeper never sets owner parameters or deploys contracts.

## Build, validation and publication

Use the existing locked web toolchain. No new dependencies were added; the
keeper runtime and static site bundle include their dependencies as ordinary
files and run without an install. Build steps are `forge build`,
`node tools/export-relay.mjs`, rebuild `keeper/runtime.mjs` as documented in
its README, then the existing web typecheck/tests/build/export validation.
Run `forge test`, `forge fmt --check` and `node --test keeper/tests/*.test.mjs`.
Golden packing bytes in `test/fixtures/site-packed-floor.json` are checked by
both JavaScript and Solidity; public signature vectors are committed for
offline conformance checks. See [relay validation](floor-relay-validation.md)
for test coverage and its limits.

Publish with `imd site publish dist --name pawn` using the existing authorized
host. Compare the live HTML, JS and pixel frog `pawn.svg` against the export's
SHA-256 inventory after publication. A successful local export is not evidence
that the hosted name changed. The publication result for this update is
recorded in `docs/frontend/floor-relay/publication.json`.
