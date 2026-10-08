// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {OracleAttestation} from "./OracleAttestation.sol";

/// @notice Immutable ERC-1271 adapter for IdentityMD answers bought without a consumer.
/// @dev Only adapts the signing domain. The calling consumer enforces question, freshness,
/// consensus and replay policy. No owner, storage, constructor arguments or other entry points.
contract FloorRelay {
    address internal constant IMD_ATTESTER = 0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982;
    uint256 internal constant CHAIN = 1;
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @param sig Canonical abi.encode(OracleAttestation.Attestation, bytes imdSignature).
    /// @dev Reject malformed payloads without abi.decode's reverting error paths. ECDSA
    /// signatures use the oracle's canonical 65-byte, low-s encoding. As with any EVM call,
    /// the caller must supply sufficient gas and ABI-encode the outer function arguments.
    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        // Two outer offsets, 15 struct words, two dynamic lengths, and a padded signature.
        if (sig.length < 704) return 0xffffffff;
        uint256 answerLength;
        uint256 signatureOffset;
        bool valid;
        assembly ("memory-safe") {
            answerLength := calldataload(add(sig.offset, 544))
            signatureOffset := calldataload(add(sig.offset, 32))
            valid := and(eq(calldataload(sig.offset), 64), eq(calldataload(add(sig.offset, 192)), 480))
        }
        if (!valid || answerLength > sig.length - 704) return 0xffffffff;
        uint256 paddedAnswer = (answerLength + 31) & ~uint256(31);
        if (signatureOffset != 576 + paddedAnswer || sig.length != 704 + paddedAnswer) return 0xffffffff;
        assembly ("memory-safe") {
            valid := eq(calldataload(add(sig.offset, signatureOffset)), 65)
            // All narrow integers must be canonical, never silently truncated.
            valid := and(valid, iszero(shr(8, calldataload(add(sig.offset, 160)))))
            valid := and(valid, iszero(shr(64, calldataload(add(sig.offset, 256)))))
            valid := and(valid, iszero(shr(64, calldataload(add(sig.offset, 288)))))
            valid := and(valid, iszero(shr(16, calldataload(add(sig.offset, 384)))))
            valid := and(valid, iszero(shr(16, calldataload(add(sig.offset, 416)))))
            valid := and(valid, iszero(shr(16, calldataload(add(sig.offset, 448)))))
            valid := and(valid, iszero(shr(64, calldataload(add(sig.offset, 480)))))
            valid := and(valid, iszero(shr(64, calldataload(add(sig.offset, 512)))))
        }
        if (!valid) return 0xffffffff;
        OracleAttestation.Attestation calldata a;
        assembly ("memory-safe") {
            a := add(sig.offset, 64)
        }
        bytes32 structHash = OracleAttestation.hashStruct(a);
        bytes32 nameHash = keccak256(bytes(OracleAttestation.DOMAIN_NAME));
        bytes32 versionHash = keccak256(bytes(OracleAttestation.DOMAIN_VERSION));
        bytes32 callerDomain = keccak256(abi.encode(DOMAIN_TYPEHASH, nameHash, versionHash, CHAIN, msg.sender));
        if (keccak256(abi.encodePacked(hex"1901", callerDomain, structHash)) != hash) return 0xffffffff;
        bytes32 zeroDomain = keccak256(abi.encode(DOMAIN_TYPEHASH, nameHash, versionHash, CHAIN, address(0)));
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", zeroDomain, structHash));
        (address recovered, ECDSA.RecoverError err,) =
            ECDSA.tryRecover(digest, sig[signatureOffset + 32:signatureOffset + 97]);
        return err == ECDSA.RecoverError.NoError && recovered == IMD_ATTESTER ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
