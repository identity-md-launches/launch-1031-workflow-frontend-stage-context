# FloorRelay validation

The production relay has one external function, no storage and no constructor
arguments. It checks the exact canonical ABI envelope before accessing dynamic
calldata, checks every narrow integer, uses OpenZeppelin's non-reverting
`ECDSA.tryRecover`, checks the caller-domain hash and recovers the fixed IMD
key from the zero-consumer digest. Rejected payloads return `0xffffffff`.
Normal EVM gas limits and well-formed outer ABI calls remain prerequisites;
no Solidity function can promise success for out-of-gas or malformed dispatch.

PawnShop and MilestoneBurn source and their canonical oracle library are
unchanged. Their OpenZeppelin SignatureChecker already calls ERC-1271. The
new relay adds no privileged path around question, quorum, expiry, one-time
burn or strictly increasing floor timestamps. The deployed burn follows the
shop's delayed signer rotation, including during the burn call itself.

Tests include authentic zero-consumer IMD signatures through both inherited
consumer verifiers, a full burn using an explicitly isolated test question,
a full floor sequence using a deterministic test signer in a test-local copy
of the relay bytecode, another signer, mismatched struct/hash, wrong caller,
wrong chain, every truncation of a valid envelope, malformed offset/length and
narrow-integer fuzzing, arbitrary-payload fuzzing and malformed ECDSA signatures.
See [fixture provenance and limitations](../test/fixtures/README.md). The real
captured floor's 24-hour validity remains rejected by the full PawnShop path.

The browser and bundled keeper share the same verifier and packer. A frozen
packed vector is compared byte-for-byte in JavaScript and Solidity and is
accepted by both consumer verifiers. Unit checks also cover client-side signer,
domain and question-hash failures, invalid UUIDs, public GET-only fetching and
the deployed 26-hour minimum. Existing keeper profit, simulation, auction and
alert behavior remains covered by its tests.

The compiler remains the existing pinned Solidity 0.8.26, optimizer 200,
via IR, Cancun. Foundry uses vendored dependencies and no network, filesystem
cheatcodes, environment-dependent tests or FFI. The web's existing locked
build dependencies were installed in `/tmp` for checks; repository manifests,
lockfiles and dependency directories were not modified. Production `dist/`
and `keeper/runtime.mjs` include everything they need as ordinary files.

Check output and publication evidence are in `docs/frontend/floor-relay/`.
The same-name publishing command was refused by the hosting service with
`503 member_sites_closed: this plane names no member sites`. No new CID or
live-asset confirmation is claimed. No contracts were deployed and no wallet
transaction or notification was sent.

This is local implementation validation, not an independent security audit.
An independent contributor should review the relay and governance activation
before funds rely on it. Operators still must obtain compatible question hashes
and 26-hour floor answers, deploy the relay, complete the governed switch,
fund gas and reserves, and operate the keeper. See
[Setup and keeper](SETUP-AND-KEEPER.md).

## Results

- `forge build`: passed with the pinned 0.8.26 compiler (existing lint warnings remain).
- `forge test`: **105 passed, 0 failed**, including 11 FloorRelay tests and the existing invariant suites.
- `forge fmt --check`: passed.
- Web TypeScript check, **17 unit tests**, production Vite build and export inventory/ABI checks: passed.
- Keeper: **9 tests passed** using its committed offline runtime.
- Browser: **6 Setup/request-id scenarios and 7 owner-state scenarios passed**, including responsive views and the owner-state accessibility scan. Chromium and missing system libraries were supplied only in an isolated temporary test environment.
- Publication: attempted under `pawn.site.identitymd.eth`; service refused with `503 member_sites_closed`. The export is ready but not published by this task.

No protected build/dependency configuration or existing contract source was changed.
