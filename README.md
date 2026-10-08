# Pawn (PAWN)

Borrow ETH against an identity.md seat while its worker continues to participate in the IMD swarm. Lenders hold WETH-backed ERC-4626 shares. Loans have fixed principal and terms: there are no price-triggered liquidations, but an overdue seat can be auctioned. Project account: [@PawnIMD](https://x.com/PawnIMD).

This contribution contains contracts, local tests, vendored dependencies and ABI exports. The separate manifest contributor owns `launch.json`; independent review, source publication, admission, deployment and the IPFS frontend follow this contribution. No transactions are broadcast by this repository.

## Build and test

```sh
forge build
forge test
forge fmt --check
python3 tools/export_abis.py
```

Solidity **0.8.26**, Cancun, optimizer 200 runs, via IR, no metadata hash or CBOR footer. FFI and filesystem cheatcode permissions are not enabled. OpenZeppelin **5.5.0** and forge-std **1.9.7** are vendored as ordinary files; no network or submodules are needed to build. The version-pinned compiler is supplied by the verifier. Tests use local ERC-721/WETH fixtures and explicit configuration, never an RPC, wallet key, environment variables or broadcasts. Test keys occur only in `test/`.

The tests include the supplied oracle digest/signature vector, success and rejection paths, rounding fuzz tests, deployment/opcode checks and stateful conservation/custody invariants. These checks are not an independent security audit. See [review notes](docs/review-notes.md) for specific requirement conflicts and launch considerations.

The completed local run passed all 51 reported tests and 8,192 invariant calls; [validation details](docs/validation.md) record the commands, scope and runtime sizes.

## Contracts and deployment parameters

| Contract | Constructor arguments | Deployment |
| --- | --- | --- |
| `LaunchToken` | none | Launch token; manifest token identifier `LaunchToken` |
| `PawnShop` | `address owner_, address token_, address weth_, address attester_` | Application; `$owner`, `$token`, Ethereum WETH below, supplied oracle signer below |
| `LendingPool` | `address owner_, address weth_, address shop_` | Created and configured inside `PawnShop`'s constructor; discover with `lendingPool()` |
| `LockDiscount` | `address token_, address shop_` | Created and configured inside `PawnShop`'s constructor; discover with `discountModule()` |
| `CollateralVault` | none | One standalone instance created by `pawn()`, atomically initialized by PawnShop |
| `MilestoneBurn` | `address token_, address setter_, address signer_` | Application; `$token`, `$owner`, supplied oracle signer below |

The manifest should list **PawnShop and MilestoneBurn** as its two application deployments, after the token. Pool and discount are constructor-created children with their shop permanently set; listing them again would deploy unrelated duplicates. A vault is created only when there is collateral. All constructors are nonpayable and use supported static argument types. No constructor takes or redistributes any of the launch token supply. Children and per-loan vaults also have exported ABIs and need source verification and indexing after deployment. Constructor arguments are explicit; control never defaults to the launch factory's `msg.sender`.

| Ethereum mainnet parameter | Value / authority |
| --- | --- |
| Chain | 1 |
| Intended owner and burn question setter | `0x23e5d7a7b4ea19530ec39c67cd46aa8c10d15acf`, from the workflow; manifest `$owner` must resolve to this address |
| Identity collection | `0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D`, from the workflow |
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`, from the workflow |
| Initial attester for both consumers | `0x5598aa9146215bc13eb26f2c692ad1461fd32982`, supplied protocol reference; confirmed by [oracle API](https://api.imd.fun/oracle/requests?limit=1) on 2026-10-08 |
| Floor and burn question hashes | Unconfigured storage at launch; set to actual oracle canonical hashes after launch, never fabricated constructor values |

The identity collection is initially enabled with 40% floor LTV for both terms and a 100% collection share limit. New loans are **paused** initially. Mainnet addresses are supplied inputs, not invented test deployment addresses. Deployment services must check the intended network and verify live code; local tests do not claim to have fork-tested mainnet.

**Launch token:** Pawn / PAWN, 18 decimals, exactly 1,000,000,000 tokens minted to its deployer. No mint, owner, pause, tax, blocklist or upgrade functions. The factory allocates supply and creates the launch trading pool. Application contracts neither seed that pool nor implement swap fees. The owner can claim its protocol trading income and voluntarily forward ETH to `LendingPool.donate()`. The network's trading fee comes from LaunchFees (1.25% in the supplied policy); a manifest fee of 3000 is not a claim that the trading pool charges 0.3%.

## Borrowing and repayment

1. Approve PawnShop for the seat. Optionally approve and lock PAWN in LockDiscount first.
2. Call `pawn(collection, tokenId, termId)`. Term 0 starts at 30 days / 300 bps; term 1 at 7 days / 100 bps. Principal is the configured term's floor percentage, rounded down. Minimum principal is 0.01 ETH. The collection's outstanding principal plus this loan must fit its share of `pool.totalAssets()`, and enough idle WETH must exist.
3. PawnShop creates a vault, takes the NFT and credits principal minus the discounted fee. Call `PawnShop.claim(receiver)` to receive the ETH.
4. Any payer can `repay(loanId)` with exactly the full principal until an auction starts, including after expiry. The NFT always returns to the recorded borrower. There is no early repayment fee rebate.
5. Only the borrower can `extend(loanId, termId)` with exactly the discounted fee and a fresh floor. The new due date is `max(oldDue, now) + chosenDuration`. Both term choices are snapshotted at origination, so later term changes do not alter an existing loan. A module change applies only to new loans: each loan uses and eventually releases its original module.

Pausing or disabling a collection blocks new loans only. Extensions, repayments, lender withdrawals, claims, token unlocks and auctions remain available subject to their own conditions. An extension after maturity is possible until someone starts the auction. The first mined transaction wins that race.

Fees are calculated with ceiling rounding; module output is capped at the undiscounted fee. Of each fee, 15% rounded down is protocol income and the remainder (at least 85%) immediately increases lender assets. Protocol income fills, in order:

- The shop's bounty reserve to 0.2 ETH.
- The pool's shortfall reserve to 5% of its current total assets, excluding that reserve.
- A pull credit for the fee recipient, initially the owner.

No owner function withdraws reserves, pool assets, NFTs, borrower proceeds, locked PAWN or burn-vault tokens. Fee credits belong to the recipient at the time earned; changing the recipient cannot redirect existing credits.

## Lenders, reserves and donations

LendingPool is OpenZeppelin ERC-4626 over WETH, with a six-decimal virtual share offset (share decimals **24**, asset decimals **18**). Standard `deposit`, `mint`, `withdraw` and `redeem` use WETH. `depositETH(receiver)` wraps native ETH; `withdrawETH(assets, receiver, owner)` and `redeemETH(shares, receiver, owner)` unwrap and credit the recipient, who then calls `claim(receiver)`. Spending another account's shares requires a share allowance. Do not confuse 24-decimal pETH shares with 18-decimal ETH or PAWN.

```text
totalAssets = WETH balance + outstanding principal - shortfall reserve - unvested donations
idleAssets  = WETH balance - shortfall reserve - unvested donations
```

Only PawnShop can borrow or settle principal. Withdrawals cannot use outstanding loans, unvested donations or reserves. The initial deposit cap is 10 ETH of `totalAssets`; interest, direct transfers and vesting may take assets above the cap, in which case new deposits stop until there is room or a cap increase takes effect. The cap can only rise, with a 48-hour delay. Withdrawals have no queue or priority guarantee: first-come withdrawals depend on idle liquidity.

Anyone can `donate()` with ETH. Every donation vests linearly for exactly seven days from its timestamp. Cumulative checkpoints and binary search avoid unbounded scans, dust resets and fixed queue exhaustion. Unvested amounts round up to the next wei; they cannot be borrowed or withdrawn. Donors receive no shares and cannot recall donations. A direct WETH transfer bypasses vesting; use `donate()` for the intended behavior. The virtual share offset mitigates donation inflation attacks, but direct transfers can still change share prices. Integrators should use preview methods and appropriate transaction-level amount checks.

When auction proceeds are below principal, segregated reserves absorb the gap first. Any remaining gap reduces share value and increments `cumulativeLoss`. Unvested donations stay segregated. Reserves do not protect against every loss and are never a guaranteed return.

## Defaults, auctions and bounties

Anyone may call `startAuction` strictly after `due + 3 days`. It freezes the last stored floor, even if stale, and credits a 0.002 ETH bounty when enough bounty reserve exists. Once started, the loan cannot be repaid or extended. The price declines continuously, with ceiling rounding:

| Elapsed time | Price |
| --- | --- |
| Start | 100% of captured floor |
| First 72 hours | Linear decline to 70% |
| Next seven days | Linear decline from 70% to 50% |
| Ten days onward | Holds at 50% |

`buyAuction(loanId, receiver)` accepts ETH at least equal to the current price. Principal recovery goes to the pool; surplus goes to the borrower; overpayment goes to the buyer. Both surplus and overpayment are pull credits. LockDiscount releases the commitment and the NFT transfers to the chosen receiver. NFT transfers use `transferFrom` on exit to avoid a receiver callback blocking resolution; buyers must select an address able to manage the NFT. A failing collection transfer rolls the whole settlement back.

Anyone may `fundBounties()` with ETH; these contributions are nonrefundable. Insufficient bounty reserves skip the bounty and never block floor submission or auctions. The first valid floor update per collection per rolling 24 hours earns 0.001 ETH when funded. An unfunded first update still consumes that interval. Keepers compete for these credits; no gas-cost reimbursement is guaranteed.

## PAWN locks and worker operation

| PAWN locked at pawn/extension | Fee reduction | PAWN committed |
| --- | --- | --- |
| 1,000,000 | 2,000 bps (20%) | 1,000,000 |
| 5,000,000 | 3,333 bps (33.33%) | 5,000,000 |
| 20,000,000 | 5,000 bps (50%) | 20,000,000 |

The largest open commitment is locked, rather than the sum. Excess PAWN can be unlocked immediately. On extension, the loan's commitment is refreshed from the current locked balance; on repayment or auction settlement it is released. Three tier counters give constant-bounded lookup even for many loans. LockDiscount has no owner or asset rescue path. Accidental direct token transfers to it do not create lock credits.

The vault's ERC-1271 implementation recognizes only the borrower's current registered **WorkerAuthorization** digest. Its exact schema was checked against [IMD's pairing page](https://api.imd.fun/pair) on 2026-10-08:

```text
domain: name="IdentityMD Worker", version="2", chainId=current chain,
        verifyingContract=the NFT collection
WorkerAuthorization(bytes32 deviceKey,address wallet,uint256 tokenId,bytes32 nonce,uint64 expiresAt,string relayOrigin)
```

Use the pairing service's real device key, nonce and relay origin. `wallet` must be the **vault address**, which owns the seat; `tokenId` must be the loan's seat. The borrower calls `vault.authorizeWorker(message)`. An ERC-1271 client can then use an empty signature with that exact digest. Generic signing, sell-order hashes and permit hashes are refused. Registration expires with the message, can be replaced or revoked by the borrower, and becomes invalid at auction start or loan closure. The worker service must check ERC-1271 and current ownership when authenticating; this repository does not claim that an existing off-chain enrollment is automatically removed by a Solidity event.

While the loan is active the borrower may use `callFor(target,data)` without ETH value to claim rewards. Direct calls to the collection, shop, pool or vault are blocked, and NFT ownership is checked afterwards. The borrower can withdraw vault ERC-20 rewards and queue/claim vault ETH even after loan closure. A vault never approves its collateral. An unsolicited NFT sent with plain `transferFrom` cannot be recovered; safe transfers accept only its assigned collateral from PawnShop.

## Oracle operations and burn

Both consumers use the supplied **OracleAttestation v2** library unchanged. EIP-712 domain: `IdentityMD Oracle`, version `2`, current chain ID, verifying contract **the particular consumer**. The application requires `a.chainId == 1`, a pinned question hash, uint256 answer in wei (floor) or USD with 18 decimals (FDV), panel size at least five, quorum at least four, agreement at least quorum and no greater than panel size. It rejects future timestamps, attestations older than 26 hours, expired signatures and reused request IDs. Floor updates must be strictly newer than the collection's stored timestamp. Lending also stops as soon as the stored attestation expires, even if younger than 26 hours.

These are permissionless signed submissions, not contracts that buy oracle requests or receive Intake callbacks. Operators pay the oracle outside the application and submit the returned attestation to `submitFloor(collection,a,signature)` or `burn(a,signature)`. A signature for the shop cannot trigger a burn. The constructor requires the real nonzero signer supplied above; the canonical verifier rejects zero signers. PawnShop signer rotations take 48 hours. MilestoneBurn's signer is fixed because its brief expressly prohibits ongoing ownership.

MilestoneBurn accepts voluntary PAWN transfers. Once the signed FDV reaches **1,000,000 × 10^18 USD units**, anyone may burn its entire current balance by transferring it to the expressly requested `0x000000000000000000000000000000000000dEaD`. This is a one-time sink transfer, not ERC-20 supply reduction. Empty burns revert. PAWN sent after the burn stays trapped forever, so check `burned()` before sending. There is no withdrawal, rescue, owner or second burn. Its question setter can configure the hash once and has no other power.

## After launch

- Owner: call `PawnShop.setQuestionHashOnce(identityCollection, actualHash)`. Obtain the canonical hash from the oracle's attestation API after agreeing an unambiguous floor question, chain, window and definitions. Do not use a locally invented hash. Collection changes, including later hash rotations, use `queueCollection` / `executeCollection` with a 48-hour delay.
- Original owner / immutable `questionSetter`: call `MilestoneBurn.setQuestionHashOnce(actualHash)` with the canonical PAWN FDV question hash. Check the actual deployed PAWN address, USD units, supply convention and pricing method before consuming this one-time setting.
- Oracle operator: maintain a funded payment wallet and request collection floor and PAWN FDV attestations for the correct consumer domains. The supplied Ethereum Intake is `0x1397434cd35e8a9c8ac312a61d3a285eb31dea56`, payment asset IMD is `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7`, and the supplied action is the right-padded text `oracle.request@oracle-1`. The supplied price is 0.5 IMD; query the live service or `priceOf` before paying. Top up that operator wallet, **not** the shop or burn contract. Refused or inconclusive requests can spend the price without yielding an attestation. Oracle payments are not refunded by Pawn.
- Owner and oracle operator: resolve the canonical question-hash/window issue in [review notes](docs/review-notes.md) before enabling borrowing. The hash pins the resolved window as well as the question; do not assume a new relative-window answer will reuse it.
- Anyone: fund lender liquidity with `deposit` / `depositETH` and optionally keeper reserves through `fundBounties`. Owner: submit a valid floor, check all setup and then call `setNewLoansPaused(false)`.
- Owner: claim protocol trading income through the launch's deployed pool flow and forward desired ETH through `LendingPool.donate()`. This is a voluntary operational responsibility, not an automatic token tax.
- Frontend/deployment services: discover constructor-created children, index events and per-loan vaults, publish the actual deployment addresses and use the exact trading `poolKey` in the handoff. This repository contains no guessed application addresses.

## Governance and risks

PawnShop and LendingPool have independent OpenZeppelin Ownable2Step ownership, explicitly initialized to the intended owner. Transfer/accept ownership on both when rotating operations. Renunciation is disabled. LockDiscount and MilestoneBurn have no ongoing owner, and vault control is limited to the borrower and immutable PawnShop.

PawnShop's immediate powers are pausing/unpausing new loans, disabling new borrowing for a collection, setting an unset collection hash once, and cancelling a queued change. Changes to terms, collection limits/status/question, attester, fee recipient and discount module wait 48 hours. Anyone can execute the exact queued payload after its deadline. Terms are restricted to 7–90 days and 50–1,000 bps; LTV cannot exceed 4,000 bps; non-seat collection share cannot exceed 2,500 bps. The pool owner can queue only increases to its deposit cap, also delayed 48 hours. Economic constants such as fee split, bounty amounts, grace period and auction slopes are immutable; there is no generic arbitrary-call governance function.

Lenders trust the oracle attester's correctness, the collection's ownership/transfer implementation, and governance's future collection and module selections. A malicious replacement module can impair new loans using it; it cannot change existing loans' stored module. The reserve can be exhausted; unsold collateral, a bad or stale auction floor, collection transfer restrictions or a failing oracle can prevent timely recovery. Worker enrollment and reward-service compatibility are external dependencies. Transactions can be reordered and auction purchases can compete. ETH credits remain claimable if a chosen receiver rejects ETH; retry with a different receiver. Forced ETH transfers are not counted as lender assets or administrator income and have no rescue path.

The contract/source conflicts documented for independent review are part of this handoff; passing tests do not resolve them or constitute launch approval.
