# Pawn site update and operating handoff

The static export in `dist/` is the next version for **pawn.site.identitymd.eth**.
Keep that existing name; do not register a new label. Publication/pinning and
ENS contenthash updates must be performed by the hosting service controlling
that name. This workspace has no hosting writer or ENS signing authority;
local delivery includes the source, static bytes and verified asset inventory,
not a claim that ENS has already changed. No chain transaction was broadcast,
and no deployed contract, token, dependencies or build configuration changed.

## Setup

Connect the current PawnShop owner on Ethereum. Setup navigation and its page
are gated by `owner()` from chain state. Names, full addresses and Etherscan
links appear at the top, including discovered children, factory, pool guard
and distributor. Loan-specific collateral vaults remain visible in Loans.
MerkleDistributor is discovered from the original deployment receipt
and its code is checked before display. The factory is discovered
from that receipt's `to`, with code and the exact `positionOf(994)` pool key
verified before claims. The deployment remains launch 994; token, shop and
burn addresses come from the existing handoff. The factory claim interface
selectors and return values were verified with read-only mainnet calls.

1. Floor: Request floor pays exactly 0.5 mainnet IMD with Permit2 and an EIP-712
   QuoteApproval, through `api.imd.fun`. If IMD allowance to Permit2 is too small,
   the wallet first approves exactly 0.5 IMD. Both payment signatures bind the
   quote and its exact prepared input. Payment signs the exact published x402
   witness shape; there is no added dependency. The standard exact proxy is
   from @x402/evm 2.28.0 and its code was checked on mainnet. Browser code checks
   its code again before signing. The page requests the brief's exact question,
   public panel evidence, 500 bps tolerance, uint256, consumer PawnShop on
   chain 1, 5 members / quorum 4, and **93,600 seconds** validity.
2. Poll the paid order until admitted, then its oracle UUID until attested.
   Request UUIDs bought elsewhere are also accepted. The page checks the
   consumer's domain, governed signer and signature; UUID; question, hash,
   consensus, answer type, timestamps and full 26-hour floor lifetime. If
   unset, the owner confirms one `setQuestionHashOnce` transaction; then the
   wallet confirms `submitFloor`. An already-stored or newer floor sends no
   transaction. Borrow's Refresh floor uses this same flow for any wallet.
3. Burn: fund MilestoneBurn with the fixed 10,000,000 PAWN transfer. Deposits
   are irreversible and the vault burns once. Request market cap uses the
   exact brief question and MilestoneBurn consumer, the same 0.5 IMD flow,
   public sources and USD with 18 decimals. It supplies the handoff pool key
   as context. Only the immutable `questionSetter()` can initially pin its
   question. Latest valid evidence from the recent request list (or the pasted
   UUID) is displayed against $1M. Burn is gated by qualifying evidence,
   nonempty vault and `burned() == false`; verification and simulation repeat
   immediately before the transaction.
4. Open: unpause requires a fresh floor in this UI. Raise queues the higher
   deposit cap; Apply raised cap executes after the deployed **48-hour delay**.
   Seeding uses `depositETH` and mints lender shares to the connected wallet.
   Pool ownership and burn question authority may differ after transfers;
   controls use their actual chain authorities.
5. Claims: the factory's permissionless `claimFees(994)` distributes accrued
   ETH and PAWN trading fees to its **fixed launch recipients**, which need not
   be the current shop owner. Pending values are the total distributable
   amounts returned by an `eth_call` simulation. Bounties and protocol fees
   are not separate balances in the deployed PawnShop: both buttons call
   `claim` and pay the wallet's whole pending shop balance, also including any
   borrower or auction credits. The page explicitly explains this and refreshes
   both buttons after either claim. A claim cannot redirect someone else's
   credits. No contracts were modified to pretend balances are separated.

Payment order tokens, UUIDs and exact signed retry payloads are retained in
local browser storage per wallet and purpose; no private key is stored.
Resume retries the same order and bytes, rather than charging again. Expired
or failed unpaid orders can be cleared; active/paid orders cannot be cleared
through that control. If a paid response is lost, Resume polls the saved order.
Use `GET /requests/paid-by/:wallet` at the service if browser storage is lost.
No refund or successful oracle answer is guaranteed by payment. A failed panel,
wrong domain, stale answer, mismatched hash or rejected wallet action is shown
and leaves the request available for inspection or retry. Stop waiting cancels
further polling/prompts; it does not cancel transactions already submitted.

## Service and oracle compatibility

The live public oracle GET endpoints returned `Access-Control-Allow-Origin: *`
in verification. The paid `/requests/quote` preflight for
`https://pawn.site.identitymd.eth.limo` returned 404 without CORS headers on
2026-10-08. The service must authorize this site's actual ENS/IPFS gateway
origin(s), OPTIONS requests, Authorization/Content-Type/PAYMENT-SIGNATURE
headers and POST routes before direct browser purchases work in production.
The UI reports the failure; it never signs an unverified substitute payment.
This cannot be repaired in the static site. Pasted UUID reads remain available
through the public API. Configure allowed origins on the service, then test
one real purchase using an operator-controlled wallet. No payment was made
by this assignment. Contract wallets are not supported by the service's paid
Permit2 flow; use an EOA/EIP-7702 account or buy elsewhere and paste the UUID.

The oracle signs a canonical question hash, not just plain question text.
Fresh quoted windows/definitions may change that hash. This deployment pins
floor hashes and permanently pins the burn hash; the UI/keeper must refuse
incompatible evidence. Before pinning, verify with the service that future
fresh answers preserve the intended hash/recipe. Otherwise floor maintenance
needs an owner-reviewed queued collection change after the 48-hour delay,
and the immutable burn question cannot be repaired on-chain by this update.
A pasted request needs the right consumer and, for floors, at least 26-hour
validity: the preexisting example request used a zero consumer and 24-hour
validity and is correctly rejected. These are deployed constraints, not values
the site can override. API/RPC outages and consensus failures remain possible.

## Design, maintenance and validation

The site preserves Borrow, Lend, Loans & auctions, Lock, Trade, Oracle & burn
and Governance. The original inline pixel frog has a green eyeshade/jacket,
gold jeweler's loupe/bow tie and three gold pawn balls. The same artwork is
the favicon. The night palette uses #173b32/#0d2619, #e0b14c/#f6d27a and
#f2e8d0. VT323 is bundled locally under its OFL license; no font CDN is needed.
All static assets and the viem keeper runtime are ordinary delivered files.

See `keeper/README.md` for five-minute startup, environmental secrets,
profitable-action policy, alert configuration, workflow installation, cron,
scan coverage and operational responsibilities. Live writes are opt-in.
Owner powers, governed signer rotation, chain/RPC trust and oracle-source
quality remain the existing contract trust assumptions. This frontend update
is not a replacement for the project's independent contract security review.

Sources checked for implementation: [paid API and oracle schemas](https://imd.fun/docs/),
[OpenAPI](https://api.imd.fun/openapi.json), the supplied pinned ABI/source inputs,
and the original mainnet deployment receipt. Verification is recorded in
`docs/frontend/update-validation.md`; browser screenshots use deterministic
RPC/oracle fixtures and are not assertions of live balances.
