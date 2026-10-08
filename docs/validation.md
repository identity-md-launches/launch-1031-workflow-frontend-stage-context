# Local validation record

Completed on 2026-10-08 with Foundry 1.8.5 and Solidity 0.8.26, using the committed `foundry.toml` configuration.

| Check | Result |
| --- | --- |
| `forge build` | Pass |
| `forge test` | 51 reported tests across 11 suites; 0 failures, 0 skipped |
| Fuzz tests | 256 runs each for token transfers, loan accounting, share round trips and discount rounding |
| Stateful invariant campaign | Three invariants; 128 runs × 64 depth = 8,192 calls; 0 reverts |
| `forge fmt --check` | Pass |
| ABI export comparison | All six JSON ABIs equal their compiled artifact ABIs |
| Canonical oracle source | Byte-for-byte equal to the supplied library/base contract |
| Local launch floor | Factory supply preservation, explicit owner, EIP-170/EIP-3860 bounds and forbidden opcode scan pass |

The grouped invariant campaign checks ETH credit backing, collateral and commitment ownership, debt totals, reserve separation, cash conservation and share accounting while sequencing deposits, withdrawals, donations, floor changes, time advances, loans, repayments, auctions, locks/unlocks and claims.

| Contract | Runtime bytes | Creation bytes, before arguments |
| --- | ---: | ---: |
| LaunchToken | 1,489 | 2,422 |
| PawnShop | 21,521 | 37,847 |
| LendingPool | 9,790 | 11,180 |
| LockDiscount | 2,765 | 3,048 |
| CollateralVault | 5,627 | 5,744 |
| MilestoneBurn | 4,299 | 5,684 |

The build emits Foundry heuristic lint warnings about timestamps, external-call events, receiver-selected ETH transfers and bounded casts. Timestamps intentionally govern timelocks, vesting, oracle validity and auction slopes; fund-moving entry points have reentrancy guards and effect-before-send accounting. Claim destinations are selected by the credit owner. These warnings are not suppressed or presented as an independent security analysis.

Local passing results have no independent admission authority. No funded wallet, network fork, live transaction, Slither/Mythril run or independent review was part of this validation. The source/requirement conflicts in [review notes](review-notes.md) remain for the separate reviewer.
