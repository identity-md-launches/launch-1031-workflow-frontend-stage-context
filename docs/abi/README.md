# Contract interface exports

The six JSON files here are standard JSON ABI arrays exported from Solidity 0.8.26 build artifacts. Regenerate after `forge build` using `python3 tools/export_abis.py`. No network access or external Python packages are required.

`PawnShop.getLoan(id)` returns the loan, its vault, original module, status, principal, due date, captured auction floor, auction start, and both snapshotted terms. `nextLoanId()` is the exclusive upper bound of issued IDs. Status values are None=0, Active=1, Auction=2, Repaid=3, Sold=4. Index `Pawned`, `Extended`, `Repaid`, `AuctionStarted`, `AuctionBought`, governance and credit events to discover history. No on-chain unbounded loan enumeration is used.

`claimable(account)` and `claim(receiver)` exist on PawnShop, LendingPool and each CollateralVault. These are separate credit ledgers; query and claim on the contract holding the credit. A claim always spends `msg.sender`'s credit, regardless of receiver.

`LendingPool.asset()` returns WETH. All ETH, WETH, reserve, fee, floor and PAWN amounts use 18 decimals. Lending shares have 24 decimals. `totalAssets`, `idleAssets`, `totalBorrowed`, `shortfallReserve`, `unvestedDonations`, `depositCap`, `cumulativeLoanFees`, `cumulativeDonations` and `cumulativeLoss` expose pool health and income counters. Income counters are cumulative flows, not APR promises. ERC-4626 preview and max methods express amounts in the appropriate asset/share units.

Worker authorization is a tuple with the exact fields documented in the README. Use the vault address as `wallet`. Only the borrower may register it. Oracle tuples retain all 15 canonical fields, including `figure`, `quorum` and `agreed`; signatures must use the receiving application's `attestationDigest` domain. Question configuration and both sides of every timelock have events for monitoring.

`buyAuction` takes a receiver and a native value ceiling; the price can decline while the transaction is pending and the excess is credited. `repay` and `extend` require exact payment. Integrators should preview against the current loan and locked tier and surface any stale-floor, idle-liquidity or payment error before resubmitting.

Constructor types and deployment responsibilities are listed in the root README. Actual deployed addresses and the trading pool key come from the deployment handoff, never from fixture addresses in tests.
