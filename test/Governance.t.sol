// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PawnTestBase} from "./helpers/PawnTestBase.sol";
import {PawnShop} from "../src/PawnShop.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {MockNFT} from "./helpers/Mocks.sol";
import {OracleAttestation, OracleAttestationConsumer} from "../src/OracleAttestation.sol";

contract GovernanceTest is PawnTestBase {
    function test_nonSeatLoanAndInsufficientIdleRollBackCustody() public {
        uint256 seatLoan = _pawn(1, 0);
        MockNFT other = new MockNFT();
        PawnShop.Collection memory c = PawnShop.Collection(4000, 4000, 2500, false, true, FLOOR_QUESTION);
        vm.prank(owner);
        shop.queueCollection(address(other), c);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        shop.executeCollection(address(other), c);
        OracleAttestation.Attestation memory a = _attestation(FLOOR_QUESTION, 0.1 ether);
        shop.submitFloor(address(other), a, _signature(shop, a));
        vm.prank(bob);
        pool.withdraw(4.6 ether, bob, bob);
        other.mint(alice, 8);
        vm.prank(alice);
        other.approve(address(shop), 8);
        uint256 nextId = shop.nextLoanId();
        vm.prank(alice);
        vm.expectRevert(LendingPool.InsufficientIdle.selector);
        shop.pawn(address(other), 8, 0);
        assertEq(other.ownerOf(8), alice);
        assertEq(shop.nextLoanId(), nextId);
        assertEq(shop.collectionDebt(address(other)), 0);
        shop.repay{value: 0.4 ether}(seatLoan);
        vm.prank(alice);
        uint256 id = shop.pawn(address(other), 8, 0);
        CollateralVault vault = CollateralVault(payable(shop.getLoan(id).vault));
        assertFalse(vault.isSeat());
        CollateralVault.WorkerAuthorization memory m = CollateralVault.WorkerAuthorization(
            keccak256("device"),
            address(vault),
            8,
            keccak256("nonce"),
            uint64(vm.getBlockTimestamp() + 15 minutes),
            "https://api.imd.fun"
        );
        vm.prank(alice);
        vm.expectRevert(CollateralVault.InvalidAuthorization.selector);
        vault.authorizeWorker(m);
        shop.repay{value: 0.04 ether}(id);
        assertEq(other.ownerOf(8), alice);
    }

    function test_explicitOwnershipTwoStepAndNoRenounce() public {
        assertEq(shop.owner(), owner);
        assertEq(pool.owner(), owner);
        vm.expectRevert();
        shop.setNewLoansPaused(true);
        vm.prank(owner);
        shop.transferOwnership(alice);
        assertEq(shop.owner(), owner);
        vm.prank(alice);
        shop.acceptOwnership();
        assertEq(shop.owner(), alice);
        vm.prank(alice);
        vm.expectRevert(PawnShop.RenounceDisabled.selector);
        shop.renounceOwnership();
    }

    function test_allChangesWait48HoursAndCancel() public {
        vm.startPrank(owner);
        shop.queueFeeRecipient(buyer);
        shop.queueAttester(alice);
        pool.queueDepositCap(20 ether);
        vm.stopPrank();
        vm.expectRevert(PawnShop.TimelockPending.selector);
        shop.executeFeeRecipient(buyer);
        vm.expectRevert(PawnShop.TimelockPending.selector);
        shop.executeAttester(alice);
        vm.expectRevert(LendingPool.TimelockPending.selector);
        pool.executeDepositCap();
        vm.warp(vm.getBlockTimestamp() + 48 hours - 1);
        vm.expectRevert(PawnShop.TimelockPending.selector);
        shop.executeAttester(alice);
        vm.warp(vm.getBlockTimestamp() + 1);
        shop.executeAttester(alice);
        shop.executeFeeRecipient(buyer);
        pool.executeDepositCap();
        assertEq(shop.oracleSigner(), alice);
        assertEq(shop.feeRecipient(), buyer);
        assertEq(pool.depositCap(), 20 ether);
        vm.prank(owner);
        vm.expectRevert(LendingPool.InvalidAmount.selector);
        pool.queueDepositCap(10 ether);
        vm.startPrank(owner);
        shop.queueTerm(0, 8 days, 200);
        shop.cancelChange(keccak256(abi.encode("term", uint8(0), uint32(8 days), uint16(200))));
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        vm.expectRevert(PawnShop.TimelockPending.selector);
        shop.executeTerm(0, 8 days, 200);
    }

    function test_collectionLimitsDisableAndHashInitialization() public {
        MockNFT other = new MockNFT();
        PawnShop.Collection memory c = PawnShop.Collection(4001, 0, 2500, false, true, bytes32(0));
        vm.startPrank(owner);
        vm.expectRevert(PawnShop.InvalidConfiguration.selector);
        shop.queueCollection(address(other), c);
        c.maxLoanBps0 = 4000;
        c.maxShareBps = 2501;
        vm.expectRevert(PawnShop.InvalidConfiguration.selector);
        shop.queueCollection(address(other), c);
        c.maxShareBps = 2500;
        shop.queueCollection(address(other), c);
        vm.stopPrank();
        vm.expectRevert(PawnShop.TimelockPending.selector);
        shop.executeCollection(address(other), c);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        shop.executeCollection(address(other), c);
        OracleAttestation.Attestation memory a = _attestation(FLOOR_QUESTION, 4 ether);
        bytes memory sig = _signature(shop, a);
        vm.expectRevert(PawnShop.NotConfigured.selector);
        shop.submitFloor(address(other), a, sig);
        vm.prank(owner);
        shop.setQuestionHashOnce(address(other), FLOOR_QUESTION);
        vm.prank(owner);
        vm.expectRevert(PawnShop.InvalidConfiguration.selector);
        shop.setQuestionHashOnce(address(other), keccak256("second"));
        shop.submitFloor(address(other), a, sig);
        vm.expectRevert(PawnShop.ShareExceeded.selector);
        shop.pawn(address(other), 1, 0);
        vm.expectRevert(PawnShop.CollectionDisabled.selector);
        shop.pawn(address(other), 1, 1);
        vm.prank(owner);
        shop.disableCollection(address(other));
        vm.expectRevert(PawnShop.CollectionDisabled.selector);
        shop.pawn(address(other), 1, 0);
    }

    function test_hashRotationInvalidatesFloorButKeepsAuctionPrice() public {
        uint256 id = _pawn(1, 1);
        PawnShop.Collection memory c =
            PawnShop.Collection(4000, 4000, 10000, true, true, keccak256("next canonical question"));
        vm.prank(owner);
        shop.queueCollection(address(nft), c);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        shop.executeCollection(address(nft), c);
        assertFalse(shop.floorFresh(address(nft)));
        (uint256 price,,,) = shop.floors(address(nft));
        assertEq(price, 1 ether);
        c.questionHash = bytes32(0);
        vm.prank(owner);
        vm.expectRevert(PawnShop.InvalidConfiguration.selector);
        shop.queueCollection(address(nft), c);
        vm.warp(shop.getLoan(id).due + 4 days);
        shop.startAuction(id);
        assertEq(shop.auctionPrice(id), 1 ether);
    }

    function test_hardBoundsAndNonzeroAddresses() public {
        vm.startPrank(owner);
        vm.expectRevert(PawnShop.InvalidTerm.selector);
        shop.queueTerm(2, 30 days, 300);
        vm.expectRevert(PawnShop.InvalidTerm.selector);
        shop.queueTerm(0, 6 days, 300);
        vm.expectRevert(PawnShop.InvalidTerm.selector);
        shop.queueTerm(0, 91 days, 300);
        vm.expectRevert(PawnShop.InvalidTerm.selector);
        shop.queueTerm(0, 30 days, 49);
        vm.expectRevert(PawnShop.InvalidTerm.selector);
        shop.queueTerm(0, 30 days, 1001);
        vm.expectRevert(PawnShop.InvalidConfiguration.selector);
        shop.queueAttester(address(0));
        vm.expectRevert(PawnShop.InvalidConfiguration.selector);
        shop.queueFeeRecipient(address(0));
        vm.expectRevert(PawnShop.InvalidConfiguration.selector);
        shop.queueDiscountModule(alice);
        vm.stopPrank();
    }
}
