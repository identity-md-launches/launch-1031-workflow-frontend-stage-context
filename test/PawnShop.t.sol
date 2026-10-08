// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PawnTestBase} from "./helpers/PawnTestBase.sol";
import {PawnShop} from "../src/PawnShop.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {LockDiscount} from "../src/LockDiscount.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {PullPayments} from "../src/PullPayments.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {RejectETH, ReenterClaim, ExpensiveModule, MockNFT} from "./helpers/Mocks.sol";

contract PawnShopTest is PawnTestBase {
    function test_pawnRepayAndConservation() public {
        uint256 id = _pawn(1, 0);
        PawnShop.Loan memory loan = shop.getLoan(id);
        assertEq(loan.principal, 0.4 ether);
        assertEq(loan.due, vm.getBlockTimestamp() + 30 days);
        assertEq(nft.ownerOf(1), loan.vault);
        assertEq(pool.totalBorrowed(), 0.4 ether);
        assertEq(pool.totalAssets(), 5.0102 ether);
        assertEq(shop.bountyReserve(), 0.0018 ether);
        assertEq(shop.claimable(alice), 0.388 ether);
        assertEq(weth.balanceOf(address(pool)) + address(shop).balance, 5 ether);
        vm.prank(alice);
        shop.claim(payable(alice));
        vm.prank(buyer); // A third party may repay, but never receives the NFT.
        shop.repay{value: 0.4 ether}(id);
        assertEq(nft.ownerOf(1), alice);
        assertEq(pool.totalBorrowed(), 0);
        assertEq(shop.collectionDebt(address(nft)), 0);
        assertEq(pool.totalAssets(), 5.0102 ether);
        assertEq(discount.committed(alice), 0);
        vm.expectRevert(PawnShop.InvalidLoan.selector);
        shop.repay{value: 0.4 ether}(id);
    }

    function test_pauseStalenessAndInvalidActions() public {
        uint256 id = _pawn(1, 1);
        vm.prank(owner);
        shop.setNewLoansPaused(true);
        vm.expectRevert(PawnShop.Paused.selector);
        shop.pawn(address(nft), 2, 0);
        vm.prank(alice);
        shop.extend{value: 0.004 ether}(id, 1);
        vm.warp(vm.getBlockTimestamp() + 27 hours);
        vm.prank(alice);
        vm.expectRevert(PawnShop.StaleFloor.selector);
        shop.extend{value: 0.004 ether}(id, 1);
        vm.expectRevert(PawnShop.IncorrectPayment.selector);
        shop.repay{value: 1}(id);
        shop.repay{value: 0.4 ether}(id);
        assertEq(nft.ownerOf(1), alice);
        vm.prank(owner);
        shop.setNewLoansPaused(false);
        vm.expectRevert(PawnShop.StaleFloor.selector);
        shop.pawn(address(nft), 2, 0);
        vm.expectRevert(PawnShop.InvalidTerm.selector);
        shop.pawn(address(nft), 2, 2);
    }

    function test_termSnapshotAndLateExtension() public {
        uint256 id = _pawn(1, 0);
        vm.prank(owner);
        shop.queueTerm(1, 90 days, 1000);
        vm.expectRevert(PawnShop.TimelockPending.selector);
        shop.executeTerm(1, 90 days, 1000);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        shop.executeTerm(1, 90 days, 1000);
        _floor(1 ether);
        uint256 originalDue = shop.getLoan(id).due;
        vm.prank(alice);
        shop.extend{value: 0.004 ether}(id, 1);
        assertEq(shop.getLoan(id).due, originalDue + 7 days);
        vm.warp(shop.getLoan(id).due + 5 days);
        _floor(1 ether);
        vm.prank(alice);
        shop.extend{value: 0.004 ether}(id, 1);
        assertEq(shop.getLoan(id).due, vm.getBlockTimestamp() + 7 days);
        uint256 second = _pawn(2, 1);
        assertEq(shop.getLoan(second).due, vm.getBlockTimestamp() + 90 days);
    }

    function test_discountAndModuleChangeKeepOldCommitment() public {
        _lock(5_000_000 ether);
        uint256 id = _pawn(1, 0);
        uint256 fee = Math.mulDiv(0.012 ether, 6667, 10000, Math.Rounding.Ceil);
        assertEq(shop.claimable(alice), 0.4 ether - fee);
        assertEq(discount.committed(alice), 5_000_000 ether);
        vm.prank(alice);
        vm.expectRevert(LockDiscount.Committed.selector);
        discount.unlock(1);
        ExpensiveModule replacement = new ExpensiveModule(address(shop), address(token));
        vm.prank(owner);
        shop.queueDiscountModule(address(replacement));
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        shop.executeDiscountModule(address(replacement));
        _floor(1 ether);
        vm.prank(alice);
        shop.extend{value: fee}(id, 0);
        uint256 priorCredit = shop.claimable(alice);
        _pawn(2, 0);
        assertEq(shop.claimable(alice) - priorCredit, 0.388 ether); // module cannot surcharge
        shop.repay{value: 0.4 ether}(id);
        assertEq(discount.committed(alice), 0);
        vm.prank(alice);
        discount.unlock(5_000_000 ether);
    }

    function test_auctionCurveSurplusOverpaymentAndDuplicate() public {
        shop.fundBounties{value: 0.2 ether}();
        uint256 id = _pawn(1, 1);
        uint256 due = shop.getLoan(id).due;
        vm.warp(due + 3 days);
        vm.expectRevert(PawnShop.GracePeriod.selector);
        shop.startAuction(id);
        vm.warp(due + 3 days + 1);
        vm.prank(buyer);
        shop.startAuction(id);
        assertEq(shop.claimable(buyer), 0.002 ether);
        assertEq(shop.auctionPrice(id), 1 ether);
        vm.expectRevert(PawnShop.InvalidLoan.selector);
        shop.repay{value: 0.4 ether}(id);
        vm.warp(vm.getBlockTimestamp() + 3 days);
        assertEq(shop.auctionPrice(id), 0.7 ether);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        assertEq(shop.auctionPrice(id), 0.5 ether);
        vm.warp(vm.getBlockTimestamp() + 100 days);
        assertEq(shop.auctionPrice(id), 0.5 ether);
        vm.prank(buyer);
        shop.buyAuction{value: 0.55 ether}(id, buyer);
        assertEq(nft.ownerOf(1), buyer);
        assertEq(shop.claimable(alice), 0.396 ether + 0.1 ether);
        assertEq(shop.claimable(buyer), 0.052 ether);
        assertEq(pool.totalBorrowed(), 0);
        vm.expectRevert(PawnShop.NotAuctioning.selector);
        shop.buyAuction{value: 0.5 ether}(id, buyer);
    }

    function test_auctionUsesStoredStaleFloorAndSocializesGap() public {
        uint256 id = _pawn(1, 1);
        vm.warp(vm.getBlockTimestamp() + 1);
        _floor(0.2 ether);
        vm.warp(shop.getLoan(id).due + 4 days);
        assertFalse(shop.floorFresh(address(nft)));
        uint256 assetsBefore = pool.totalAssets();
        shop.startAuction(id);
        assertEq(shop.auctionPrice(id), 0.2 ether);
        shop.buyAuction{value: 0.2 ether}(id, buyer);
        assertEq(pool.totalAssets(), assetsBefore - 0.2 ether);
        assertEq(pool.cumulativeLoss(), 0.2 ether);
    }

    function test_failedNFTSettlementIsAtomic() public {
        uint256 id = _pawn(1, 0);
        nft.setFailTransfers(true);
        vm.expectRevert("mock transfer failed");
        shop.repay{value: 0.4 ether}(id);
        assertTrue(shop.loanActive(id));
        assertEq(pool.totalBorrowed(), 0.4 ether);
        vm.warp(shop.getLoan(id).due + 4 days);
        shop.startAuction(id);
        vm.expectRevert("mock transfer failed");
        shop.buyAuction{value: 1 ether}(id, buyer);
        assertEq(uint256(shop.getLoan(id).status), uint256(PawnShop.Status.Auction));
        assertEq(pool.totalBorrowed(), 0.4 ether);
        nft.setFailTransfers(false);
        shop.buyAuction{value: 1 ether}(id, buyer);
    }

    function test_claimFailureAndReentrancyPreserveLiabilities() public {
        _pawn(1, 0);
        RejectETH reject = new RejectETH();
        vm.prank(alice);
        vm.expectRevert(PullPayments.ETHTransferFailed.selector);
        shop.claim(payable(address(reject)));
        assertEq(shop.claimable(alice), 0.388 ether);
        ReenterClaim receiver = new ReenterClaim(PullPayments(address(shop)));
        vm.prank(alice);
        shop.claim(payable(address(receiver)));
        assertTrue(receiver.attempted());
        assertFalse(receiver.reentered());
        assertEq(receiver.reentryError(), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(address(receiver).balance, 0.388 ether);
        assertEq(shop.claimable(alice), 0);
        assertEq(address(shop).balance, shop.totalClaimable() + shop.bountyReserve());
    }

    function test_limitsIdleLiquidityAndDuplicateNFT() public {
        uint256 id = _pawn(1, 0);
        vm.prank(alice);
        vm.expectRevert();
        shop.pawn(address(nft), 1, 0);
        assertEq(pool.totalBorrowed(), 0.4 ether);
        vm.prank(bob);
        pool.withdraw(4.6 ether, bob, bob);
        vm.expectRevert(PawnShop.ShareExceeded.selector);
        shop.pawn(address(nft), 2, 0);
        shop.repay{value: 0.4 ether}(id);
        vm.warp(vm.getBlockTimestamp() + 1);
        _floor(0.001 ether);
        vm.expectRevert(PawnShop.LoanTooSmall.selector);
        shop.pawn(address(nft), 3, 0);
    }

    function test_feeWaterfallFillsBountyReserveThenShortfallThenRecipient() public {
        shop.fundBounties{value: 0.2 ether}();
        uint256 id = _pawn(1, 0);
        assertEq(pool.shortfallReserve(), 0.0018 ether);
        assertEq(pool.totalAssets(), 5.0102 ether);
        for (uint256 i; i < 160; ++i) {
            vm.prank(alice);
            shop.extend{value: 0.012 ether}(id, 0);
        }
        // As fees grow assets, the 5% target grows too; enough terms eventually overflow it.
        assertGt(pool.shortfallReserve(), 0.25 ether);
        for (uint256 i; i < 100; ++i) {
            vm.prank(alice);
            shop.extend{value: 0.012 ether}(id, 0);
        }
        assertGt(shop.claimable(owner), 0);
        assertEq(address(shop).balance, shop.totalClaimable() + shop.bountyReserve());
    }

    function testFuzz_principalFeeAndFundConservation(uint256 price, uint8 term) public {
        price = bound(price, 0.025 ether, 10 ether);
        term = uint8(bound(term, 0, 1));
        vm.warp(vm.getBlockTimestamp() + 1);
        _floor(price);
        uint256 id = _pawn(1, term);
        uint256 principal = price * 4000 / 10000;
        uint256 fee = Math.mulDiv(principal, term == 0 ? 300 : 100, 10000, Math.Rounding.Ceil);
        assertEq(shop.getLoan(id).principal, principal);
        assertEq(shop.claimable(alice), principal - fee);
        assertEq(pool.totalAssets(), 5 ether + fee - fee * 1500 / 10000);
        assertEq(weth.balanceOf(address(pool)) + address(shop).balance, 5 ether);
        shop.repay{value: principal}(id);
        assertEq(weth.balanceOf(address(pool)) + address(shop).balance, 5 ether + principal);
    }
}
