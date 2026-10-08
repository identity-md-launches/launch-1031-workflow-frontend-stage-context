# Local verification of the Setup/keeper update

- `forge build`: passes using the pinned Solidity 0.8.26 compiler.
- `forge test`: 94 tests pass, including the two new complete setup/public
  refresh/claim and burn lifecycle tests; existing fuzz/invariant suites pass.
- `forge fmt --check`: passes.
- Frontend TypeScript check: passes with the existing locked toolchain.
- Frontend unit tests: 12 pass, including two new factory discovery/claim tests.
- `node --test keeper/tests/*.test.mjs`: 11 pass offline. Coverage includes
  valid floor/cap signatures, wrong consumer/signer/UUID/hash/question/type,
  forged answers, consensus/tolerance, expired/stale/future evidence, 26-hour
  floor expiry, pending and failed panels, payment amount/input rejection,
  both Permit2/QuoteApproval signatures, gas economics, grace/bounty boundaries,
  dry runs, live success, low funds, reverted simulation and reverted receipt.
- Existing production build/export validator: passes; static asset SHA-256
  inventory and pinned ABI hashes match the existing handoff.
- Live keeper dry run on mainnet: passes; reports stale/unset floor,
  unset burn question and low bounty reserve; broadcasts nothing.
- Read-only trading-factory discovery verified original launch receipt and
  `positionOf(994)` against the handoff pool; `claimFees(994)` returns pending
  ETH/PAWN in an eth_call. No claim was sent.
- Paid API browser-origin preflight returns 404; this external service
  limitation and required origin configuration are recorded in the handoff.

No live payments, wallet signatures, webhook messages, deployments or ENS
updates were performed. The static export targets the existing hosting name.

- Focused mobile/browser tests pass: owner-only Setup, disconnected public controls, no horizontal overflow, wrong consumer rejected with no sends, paid-elsewhere floor setup plus posting, duplicate posting avoided, and visible paid-API refusal with no writes. Deterministic screenshots and result JSON are committed alongside this record. Browser dependencies/fonts were isolated in `/tmp`; they are verification tools, not runtime dependencies.
