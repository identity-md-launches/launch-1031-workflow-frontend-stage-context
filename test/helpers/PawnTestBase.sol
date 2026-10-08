// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../../src/LaunchToken.sol";
import {PawnShop} from "../../src/PawnShop.sol";
import {LendingPool} from "../../src/LendingPool.sol";
import {LockDiscount} from "../../src/LockDiscount.sol";
import {CollateralVault} from "../../src/CollateralVault.sol";
import {OracleAttestation, OracleAttestationConsumer} from "../../src/OracleAttestation.sol";
import {MockWETH, MockNFT} from "./Mocks.sol";

abstract contract PawnTestBase is Test {
    uint256 internal constant KEY = 0xA11CE;
    bytes32 internal constant FLOOR_QUESTION = keccak256("test-only floor question");
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("borrower");
    address internal bob = makeAddr("lender");
    address internal buyer = makeAddr("auction buyer");
    LaunchToken internal token;
    MockWETH internal weth;
    MockNFT internal nft;
    PawnShop internal shop;
    LendingPool internal pool;
    LockDiscount internal discount;
    uint256 internal oracleNonce;

    function setUp() public virtual {
        vm.chainId(1);
        vm.warp(1_800_000_000);
        vm.deal(address(this), 1000 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(buyer, 100 ether);
        token = new LaunchToken();
        weth = new MockWETH();
        shop = new PawnShop(owner, address(token), address(weth), vm.addr(KEY));
        pool = shop.lendingPool();
        discount = LockDiscount(shop.discountModule());
        MockNFT template = new MockNFT();
        vm.etch(shop.IDENTITY_COLLECTION(), address(template).code);
        nft = MockNFT(shop.IDENTITY_COLLECTION());
        vm.prank(owner);
        shop.setQuestionHashOnce(address(nft), FLOOR_QUESTION);
        _floor(1 ether);
        vm.prank(owner);
        shop.setNewLoansPaused(false);
        vm.prank(bob);
        pool.depositETH{value: 5 ether}(bob);
    }

    function _attestation(bytes32 question, uint256 value) internal returns (OracleAttestation.Attestation memory a) {
        a.requestId = keccak256(abi.encode("test oracle", ++oracleNonce));
        a.chainId = 1;
        a.questionHash = question;
        a.answerType = 3;
        a.answer = abi.encode(value);
        a.figure = value;
        a.fromBlock = 100;
        a.toBlock = 200;
        a.blockHash = bytes32(uint256(7));
        a.panelJobId = keccak256("test panel");
        a.panelSize = 5;
        a.quorum = 4;
        a.agreed = 4;
        a.issuedAt = uint64(vm.getBlockTimestamp());
        a.expiresAt = uint64(vm.getBlockTimestamp() + 26 hours);
    }

    function _signature(OracleAttestationConsumer consumer, OracleAttestation.Attestation memory a)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, consumer.attestationDigest(a));
        return abi.encodePacked(r, s, v);
    }

    function _floor(uint256 price) internal {
        OracleAttestation.Attestation memory a = _attestation(FLOOR_QUESTION, price);
        shop.submitFloor(address(nft), a, _signature(shop, a));
    }

    function _pawn(uint256 tokenId, uint8 term) internal returns (uint256 id) {
        nft.mint(alice, tokenId);
        vm.startPrank(alice);
        nft.approve(address(shop), tokenId);
        id = shop.pawn(address(nft), tokenId, term);
        vm.stopPrank();
    }

    function _lock(uint256 amount) internal {
        token.transfer(alice, amount);
        vm.startPrank(alice);
        token.approve(address(discount), amount);
        discount.lock(amount);
        vm.stopPrank();
    }
}
