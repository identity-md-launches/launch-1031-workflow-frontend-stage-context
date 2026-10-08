# Vendored dependencies

- OpenZeppelin Contracts v5.5.0: source from `https://github.com/OpenZeppelin/openzeppelin-contracts/tree/v5.5.0`, extracted from the tag archive. License: `openzeppelin-contracts/LICENSE` (MIT). Needed for the canonical oracle consumer's `SignatureChecker.isValidSignatureNowCalldata` and for ERC-20, ERC-4626, ownership, safe transfer and guard primitives.
- forge-std v1.9.7: source from `https://github.com/foundry-rs/forge-std/tree/v1.9.7`, extracted from the tag archive. Licenses: `forge-std/LICENSE-MIT` and `forge-std/LICENSE-APACHE`.

Only ordinary source and license files are delivered. There are no submodules, package installers, dependency downloads at build time, or vendored compiler binaries. The oracle library in `src/OracleAttestation.sol` was copied unchanged from the supplied protocol reference and retains its MIT SPDX declaration.

The delivered subset contains the 57 transitive Solidity imports needed by the implementation and tests; unused upstream sources are omitted. Downloaded tag archive SHA-256 values:

```text
openzeppelin-contracts v5.5.0  95a4e1ff7a01da7d875e7872b6160337561efd7fb0a8751de76e837a10d90cbf
forge-std v1.9.7               45157353ab49eab01d294565866731e599b32401757229689ee459aa26b7ee94
```
