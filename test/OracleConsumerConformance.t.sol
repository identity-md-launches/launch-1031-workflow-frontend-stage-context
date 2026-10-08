// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PawnShop} from "../src/PawnShop.sol";
import {MilestoneBurn} from "../src/MilestoneBurn.sol";
import {OracleAttestation} from "../src/OracleAttestation.sol";
import {MockWETH} from "./helpers/Mocks.sol";
import {LaunchToken} from "../src/LaunchToken.sol";

/// @dev Test-only exposure of the application's inherited canonical verifier.
contract PawnOracleProbe is PawnShop {
    constructor(address owner_, address token_, address weth_, address signer_)
        PawnShop(owner_, token_, weth_, signer_)
    {}

    function verify(OracleAttestation.Attestation calldata a, bytes calldata signature) external view {
        _verifyAttestation(a, signature);
    }
}

/// @notice Protocol vector copied from the supplied OracleConsumerConformance.t.sol reference.
/// Callback tests do not apply: PAWN explicitly accepts permissionless signed submissions.
contract OracleConsumerConformanceTest is Test {
    uint256 constant VECTOR_CHAIN = 11155111;
    address constant VECTOR_CONSUMER = 0x0000000000000000000000000000000000002748;
    bytes32 constant VECTOR_DIGEST = 0x95fefa8b7c529852f4e2b6aec888930eb2bf5078e6443a85808e36df19e1325c;
    bytes constant VECTOR_SIGNATURE =
        hex"a26b14918607eb565af126beb54d3c5d19e923c41506def500b3521a4f9aa6d603ab44fd22f15dd2191732961a7131e4641244add8b0f09f20e6ae64381be8481b";
    address constant SIGNER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    uint256 constant SIGNER_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint64 constant ISSUED_AT = 1800000000;
    uint64 constant EXPIRES_AT = 1800003600;
    PawnOracleProbe consumer;
    LaunchToken token;

    function setUp() public {
        vm.chainId(VECTOR_CHAIN);
        vm.warp(ISSUED_AT);
        token = new LaunchToken();
        MockWETH weth = new MockWETH();
        deployCodeTo(
            "OracleConsumerConformance.t.sol:PawnOracleProbe",
            abi.encode(address(this), address(token), address(weth), SIGNER),
            VECTOR_CONSUMER
        );
        consumer = PawnOracleProbe(payable(VECTOR_CONSUMER));
    }

    function vector() internal pure returns (OracleAttestation.Attestation memory a) {
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = bytes32(uint256(1));
        a = OracleAttestation.Attestation({
            requestId: 0x0000000000004000800000000000000100000000000000000000000000000000,
            chainId: 1,
            questionHash: 0x2117f4362ebfa37aa8a8c0fed548604fe09ac46faf8ae7559cd64780f26a46fb,
            answerType: OracleAttestation.ANSWER_BYTES32_LIST,
            answer: abi.encode(ids),
            figure: 12345,
            fromBlock: 100,
            toBlock: 200,
            blockHash: bytes32(uint256(7)),
            panelJobId: 0x0000000000004000800000000000000200000000000000000000000000000000,
            panelSize: 5,
            quorum: 4,
            agreed: 5,
            issuedAt: ISSUED_AT,
            expiresAt: EXPIRES_AT
        });
    }

    function test_digestMatchesTheProtocol() public view {
        assertEq(consumer.attestationDigest(vector()), VECTOR_DIGEST);
    }

    function test_acceptsTheProtocolSignature() public view {
        consumer.verify(vector(), VECTOR_SIGNATURE);
    }

    function test_acceptsFreshUintSignatureFromVectorKey() public {
        OracleAttestation.Attestation memory a = vector();
        a.answerType = 3;
        a.answer = abi.encode(1 ether);
        a.expiresAt = a.issuedAt + 26 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, consumer.attestationDigest(a));
        address collection = consumer.IDENTITY_COLLECTION();
        consumer.setQuestionHashOnce(collection, a.questionHash);
        // Permissionless submission, including from a caller unrelated to an intake.
        vm.prank(makeAddr("submitter"));
        consumer.submitFloor(collection, a, abi.encodePacked(r, s, v));
        assertTrue(consumer.consumed(a.requestId));
    }

    function test_burnConsumerDigestMatchesTheProtocol() public {
        MockWETH weth = new MockWETH();
        PawnShop source = new PawnShop(address(this), address(token), address(weth), SIGNER);
        deployCodeTo(
            "MilestoneBurn.sol:MilestoneBurn",
            abi.encode(address(token), address(this), SIGNER, address(source)),
            VECTOR_CONSUMER
        );
        MilestoneBurn burnVault = MilestoneBurn(VECTOR_CONSUMER);
        assertEq(burnVault.attestationDigest(vector()), VECTOR_DIGEST);
    }
}
