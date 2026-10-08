# Offline relay conformance fixtures

Retrieved from the public `https://api.imd.fun/oracle/requests/:id/attestation`
endpoint on 2026-10-08. These are authentic, unmodified signatures by
`0x5598aa9146215bc13eb26f2c692ad1461fd32982` in the zero-consumer chain-1 domain.
No private oracle key, RPC call or filesystem cheatcode is needed in Solidity
tests. `helpers/LiveRelayVectors.sol` contains the same values as Solidity
literals so Foundry needs no file permissions.

- `floor-zero-consumer.json`: `62702d2a-1a38-4543-93cc-7ece5ac20a66`, the actual
  identity.md floor question. Its 24-hour lifetime is insufficient for the
  unchanged PawnShop's 26-hour requirement. Both inherited consumer verifiers
  accept it through the production relay at its signed timestamp; the full
  `submitFloor` correctly rejects its lifetime.
- `large-uint-zero-consumer.json`: `cfab3863-bb1b-4b51-9612-c3e687e37d9f`, an
  ETH/USDC pool quote, not a PAWN FDV answer. An isolated MilestoneBurn test
  explicitly pins this fixture's question to test the full real-signature
  ERC-1271 call path. It must never be used as a production burn question.
- `site-packed-floor.json`: `web/src/oracle.ts::packRelay` output for the floor
  vector, frozen as a cross-language fixture. Browser and bundled keeper tests
  compare every byte. Solidity compares it with `abi.encode(a,signature)` and
  passes it through both consumer verifiers.

To exercise full positive floor updates with 26-hour lifetimes, the test
replaces only the 20-byte IMD attester constant in a test-local copy of the
compiled relay runtime with `vm.addr(TEST_KEY)`, asserting exactly one
replacement. It signs genuine EIP-712 messages with that deterministic test
key. This never changes source, deployment parameters or delivered runtime,
and does not mock ECDSA or ERC-1271 verification. The unchanged production
runtime is independently covered by the live vectors above. Full-path floor
checks cover equal and older `issuedAt`, duplicate requests and fresh success.
