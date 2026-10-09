# Audit e4a761c2 fixes (source for the PawnShop / LockDiscount / MilestoneBurn redeployment)

Audit job `e4a761c2-59b8-4c34-84fc-54fade5f665a` reviewed commit `5086b57`. This revision changes
source only. Nothing is deployed by it. The token (`LaunchToken` at
`0x4f2bacee5f2e7ce3f48dfbd635d96e9a8fcbe478`) and `FloorRelay` are kept as they are. PawnShop (and
the LendingPool, LockDiscount and VaultFactory it creates), the CollateralVault implementation and
MilestoneBurn are redeployed with these fixes.

| Finding | Problem (as briefed) | Fix | Where | Tests (`test/AuditFixes.t.sol` unless noted) |
| --- | --- | --- | --- | --- |
| F1 | An auction could start from a stale stored floor and be bought in the same block | `startAuction` requires `floorFresh(collection)` (`StaleFloor`). `buyAuction` reverts `SameBlock` when `block.timestamp == auctionStarted` | `PawnShop.startAuction`, `buyAuction` | `test_F1_proof_staleFloorSameBlockSnipeIsBlocked`; `PawnShop.t.sol:test_auctionNeedsFreshFloorAndSocializesGap` |
| F2 | An unsold auction could not be re-priced | `restartAuction(id)`, open to anyone, allowed after `writeOffAuction` or 17 days after the start (10 days to reach the terminal price, then 7 days at it). It needs a fresh floor, resets `auctionStarted` and `auctionFloor` and re-runs the curve. Proceeds of a written-off loan still go through `receiveRecovery`, and any amount above principal is the borrower's surplus | `PawnShop.restartAuction` | `test_F2_*` (3 tests) |
| F3 | Missing collateral could be "sold" for zero | `buyAuction` reverts `CollateralMissing` when the vault does not hold the NFT. `writeOffAuction` (allowed at once when the collateral is missing) remains the way to settle | `PawnShop.buyAuction` | `test_F3_proof_missingCollateralCannotBeBoughtAtZero`; `ReviewRegression.t.sol` (seized, missing) |
| F4 | When the released loss allowance was larger than the realised loss, the share price jumped at once. The allowance could never fall | In `settleAuction`, any rise in `totalAssets()` caused by the settlement (allowance released minus realised loss) vests linearly over 7 days through `unvestedRelease()`. Unvested remainders roll into the new stream. `markAuctionLoss(id, principal, recovery, mayDecrease)` lowers the allowance only when the shop passes `mayDecrease = vault.holdsCollateral()` | `LendingPool.settleAuction`, `markAuctionLoss`, `unvestedRelease`, `totalAssets` | `test_F4_proof_excessAllowanceVestsOverSevenDays`, `test_F4_lowerAllowanceOnlyWhileCollateralHeld`, `test_F2_restartAfterTerminalPeriod` |
| F5 | No expected loss was booked between the due date and the auction | `markOverdue(id)` is open to anyone from `loan.due` onward. It books `principal - min(principal, storedFloor/2)` through `markAuctionLoss(..., mayDecrease=false)`, so the mark never decreases and is keyed by loan id. Repaying a marked loan settles through `settleAuction`, which clears the mark and vests it back (F4) | `PawnShop.markOverdue`, `repay` | `test_F5_markOverdueFromDueOnward`, `test_F4_*` |
| F6 | `pawn` had no slippage bound | `pawn(collection, tokenId, termId, minPrincipal, maxFee)` reverts `Slippage` if `principal < minPrincipal` or `fee > maxFee`. The site passes the displayed principal −1% and fee +1% | `PawnShop.pawn`; `web/src/finance.tsx` | `test_F6_pawnSlippageBounds` |
| F7 | A borrower could collect the auction bounty on their own loan, and small loans overpaid it | No bounty when `msg.sender == loan.borrower`. Otherwise `min(AUCTION_BOUNTY, principal / 100)` | `PawnShop.startAuction` | `test_F7_*` (2 tests) |
| F8 | The attested block window was not checked | `submitFloor` also rejects `a.fromBlock > a.toBlock` or `a.toBlock + 7800 < block.number` | `PawnShop.submitFloor` | `test_F8_blockWindowChecks` |
| F9 | Late recoveries never refilled the reserve a write-off had used | `reserveUsed[id]` is recorded at settlement. `receiveRecovery(id)` first restores `min(value, reserveUsed[id])` to `shortfallReserve` and vests the rest | `LendingPool.settleAuction`, `receiveRecovery(uint256)` | `test_F9_recoveryRestoresConsumedReserveFirst` |
| F10 | An invariant formula could underflow in intermediate subtraction | Additions are summed first, then deductions | `test/PoolAccountingInvariant.t.sol`, `test/PawnInvariant.t.sol` | the invariant suites |
| F11 | A burn accepted a market-cap answer up to 26 h old | Accepted age is at most `MAX_ATTESTATION_AGE = 1 hours`. `questionHash` stays settable once. The question must use a **24-hour time-weighted price** (see README) | `MilestoneBurn.burn` | `test_F11_burnAcceptsAtMostOneHourOldAnswers` |
| F12 | A queued deposit cap stayed executable forever | `executeDepositCap` has the same 7-day execution window as PawnShop changes (`WindowExpired`), and there is now an `onlyOwner cancelDepositCap()` | `LendingPool` | `test_F12_depositCapWindowAndCancel` |
| F13 | `isValidSignature` reverted when `ownerOf` reverted (for a burned token) | It uses `holdsCollateral()` (try/catch) and returns `0xffffffff` | `CollateralVault.isValidSignature` | `test_F13_isValidSignatureReturnsFailureWhenTokenBurned` |
| F14 | A buyer could send the NFT back into the vault or to the collection | `buyAuction` rejects `receiver == loan.vault` or `== loan.collection` | `PawnShop.buyAuction` | `test_F14_receiverCannotBeVaultOrCollection` |
| F15 | Loans could open at once against a newly written question | After any `questionHash` write to a collection (`setQuestionHashOnce`, or a queued rotation in `executeCollection`), new loans against it revert `QuestionCooldown` for 48 h (`loansDisabledUntil`). The constructor preset is exempt | `PawnShop` | `test_F15_queuedRotationDisablesNewLoansFor48Hours`, `Governance.t.sol` |
| F16 | A reverting discount module could block settlement | `IDiscountModule.release` is wrapped in try/catch on `repay`, `buyAuction` and `writeOffAuction`. A failure emits `DiscountReleaseFailed` | `PawnShop._releaseDiscount` | `test_F16_brokenModuleReleaseDoesNotBlockSettlement` |
| Protocol share | — | Lenders keep 85% of each fee. While either reserve is below target (bounty 0.2 ETH; shortfall 5% of `totalAssets`), 50% of the 15% protocol share fills the reserves, bounty first, and 50% goes to the fee recipient. Once both are at target, 100% goes to the recipient. Totals are in `protocolFeesToRecipient` and `protocolFeesToReserves`, and each split emits `ProtocolFeeSplit` | `PawnShop._distributeFee` | `PawnShop.t.sol:test_protocolShareSplitsHalfToReservesUntilBothAtTarget`, `test_pawnRepayAndConservation` |

## Other changes needed to ship the fixes

- **VaultFactory.** With the fixes, PawnShop's runtime grew past EIP-170 (26,624 > 24,576 bytes),
  because it embedded the CollateralVault creation code. PawnShop's constructor now also creates a
  `VaultFactory` (exposed as `vaultFactory()`). Only that shop can call it, and it deploys each
  `CollateralVault(shop)`. The vault takes the shop as a constructor argument instead of
  `msg.sender`, and its behaviour is otherwise unchanged. PawnShop's runtime is now about 20.9 KB.
  `Deployment.t.sol` checks the size and forbidden opcodes of the factory as well.
- **Constructor presets.** The identity.md collection is created with question hash
  `0x71ed43868c5c61fe21b72bbbdcc09913d4952a113a393c526e49f3289edf4be1`
  (`IDENTITY_QUESTION_HASH`), and `newLoansPaused = true`. The attester is the `attester_`
  constructor argument, which must be the deployed FloorRelay. MilestoneBurn's `signer_` must be
  the same address, because its constructor checks it against the shop.
- **Interface changes** (everything else is unchanged): `pawn` takes 5 arguments;
  `LendingPool.markAuctionLoss` takes a fourth `bool mayDecrease`; `LendingPool.receiveRecovery`
  takes the loan id. New functions: `markOverdue`, `restartAuction`, `cancelDepositCap`,
  `unvestedRelease`, `reserveUsed`, `loansDisabledUntil`, `protocolFeesToRecipient`,
  `protocolFeesToReserves` and `vaultFactory`.

## Not done here (operator and requester actions)

- **FloorRelay address.** `.imd/reads/deployment.json` lists no deployed FloorRelay, and this job
  was given no address. The manifest step must pass the real FloorRelay address as PawnShop's
  `attester_` and MilestoneBurn's `signer_`. The committed `launch.json` dates from the earlier
  launch and still names the EOA signer `0x5598…2982`. It is left unchanged because the manifest
  step owns it.
- **Site addresses and publication.** The new contracts have no addresses yet. The site reads them
  from `web/deployment.json` and `web/public/imd-deployment.json`, which must be refreshed from
  the post-deployment `deployment.json` (with the new ABI hashes). Only then can the site be built
  and published under `pawn.site.identitymd.eth`. The site source and ABIs in `web/public/abi`
  are updated for the new interface. The committed `dist/` export still serves the live (old)
  contracts on purpose: publishing the new ABI against the old addresses would break borrowing.
- Keeper: `markOverdue` and `restartAuction` are public upkeep calls. The keeper in `keeper/` does
  not call them yet; until it does, an operator can call them from a block explorer.
- An independent adversarial review of this revision is still needed before release.

## Local verification (this revision)

- `forge build`, `forge fmt --check`: pass (solc 0.8.26 as pinned).
- `forge test`: **125 passed, 0 failed** across 20 suites, including the invariant suites.
- Web (in a scratch copy, with `npm ci`): `tsc --noEmit` passes. 16 of 17 unit tests pass. The one
  failure is expected: `pinned implementation ABIs match canonical handoff hashes` compares the new
  `web/public/abi/PawnShop.json` with the **old** deployed PawnShop's `abiHash` in
  `web/deployment.json`. It passes once that file is refreshed from the redeployment record, which
  is also when `npm run build` can regenerate `dist/` and the site can be published.
- Slither, Mythril, a mainnet fork and an independent review were not run.
