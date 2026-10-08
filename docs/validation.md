# Local validation record

Revision completed on 2026-10-08 with Foundry 1.8.3 and Solidity 0.8.26, using the unchanged committed `foundry.toml` configuration.

| Check | Result |
| --- | --- |
| `forge build` | Pass |
| `forge test` | 80 tests across 15 suites; 0 failures, 0 skipped (77 delivered tests plus three supplied proof tests in scratch) |
| Supplied blocking proofs | All three tests failed on the starting tree as reported; all pass after the revision, with byte-for-byte unchanged proof copies |
| Advisory reproduction | 12 local reproduction tests established the original reported behaviors; exact scope differences are recorded in `.imd-responses.json` |
| Fuzz tests | 256 runs each; includes the new redemption-limit checks after losses and partial utilization |
| Stateful invariant campaign | Three invariants; 128 runs × 64 depth = 8,192 calls; 0 reverts |
| `forge fmt --check` | Pass; temporary proof copies removed after testing because their supplied formatting lacks terminal newlines |
| ABI export comparison | All six JSON ABIs equal their compiled artifact ABIs |
| Canonical oracle source | Byte-for-byte equal to the supplied library/base contract; original digest and signature vectors unchanged |
| Local launch floor | Factory supply preservation, explicit owner, EIP-170/EIP-3860 bounds and forbidden opcode scan pass |
| Revision responses | 13 findings answered: eight fixed, five disputed scope/trust items |

The delivered regression suites cover expected loss recognition before lender exits, multiple auctions sharing a reserve, missing/burned/seized collateral, failed transfers, permissionless write-off deadlines and duplicate protection, late recoveries, signer rotation, stale timelocks, short-lived floors, fee timing, empty-pool income and the remaining one-wei withdrawal case. The invariant handler now leaves some marked or written-off auctions open across deposits/withdrawals and later settles them, checking cash, receivables, reserve coverage, share accounting, NFT custody and PAWN commitments together.

| Contract | Runtime bytes | Creation bytes, before arguments |
| --- | ---: | ---: |
| LaunchToken | 1,489 | 2,422 |
| PawnShop | 24,379 | 41,886 |
| LendingPool | 10,915 | 12,333 |
| LockDiscount | 2,765 | 3,048 |
| CollateralVault | 5,860 | 5,977 |
| MilestoneBurn | 4,668 | 6,349 |

MilestoneBurn now takes a fourth constructor address, `$contract:PawnShop`, after token, one-shot question setter and initial signer. The ABI, deployment fixtures and README reflect that dependency; the separate manifest contributor must use the revised signature. No `launch.json` was generated or edited by this revision.

The build emits Foundry heuristic lint warnings about timestamps, external-call events, receiver-selected ETH transfers and bounded casts. Timestamps intentionally govern timelocks, vesting, oracle validity and auction slopes; fund-moving entry points have reentrancy guards and effect-before-send accounting. Claim destinations are selected by the credit owner. These warnings are not suppressed or presented as an independent security analysis.

No funded wallet, live transaction, network fork, Slither/Mythril run or new independent review was performed. Local checks have no independent admission authority. The exact-question-hash versus changing oracle window conflict remains disputed and unresolved; daily live-window compatibility is not established. Accounting also requires permissionless keeper calls to refresh falling auction allowances and write off long-unsold debt. See [review notes](review-notes.md) and `.imd-responses.json` for the scope decisions and operational limits.
