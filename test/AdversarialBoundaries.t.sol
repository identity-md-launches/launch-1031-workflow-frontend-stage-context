// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PawnTestBase} from "./helpers/PawnTestBase.sol";
import {PawnShop} from "src/PawnShop.sol";
import {LendingPool} from "src/LendingPool.sol";
import {MilestoneBurn} from "src/MilestoneBurn.sol";
import {OracleAttestation} from "src/OracleAttestation.sol";
import {PullPayments} from "src/PullPayments.sol";

contract AdversarialBoundariesTest is PawnTestBase {
    function _loanSnapshot(uint256 id) private view returns (bytes32) {
        PawnShop.Loan memory loan = shop.getLoan(id);
        (address borrower, uint8 tier) = discount.commitments(id);
        return keccak256(
            abi.encode(
                loan,
                nft.ownerOf(loan.tokenId),
                shop.nextLoanId(),
                shop.collectionDebt(address(nft)),
                pool.totalAssets(),
                pool.totalBorrowed(),
                pool.shortfallReserve(),
                pool.cumulativeLoss(),
                address(shop).balance,
                shop.totalClaimable(),
                shop.claimable(alice),
                shop.claimable(buyer),
                shop.bountyReserve(),
                borrower,
                tier,
                discount.committed(alice)
            )
        );
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_inexactRepaymentLeavesDebtCollateralAndCommitmentIntact(uint256 payment) public {
        _lock(5_000_000 ether);
        uint256 id = _pawn(1, 0);
        payment = bound(payment, 0, 0.8 ether);
        if (payment == 0.4 ether) ++payment;
        bytes32 beforeState = _loanSnapshot(id);
        uint256 payerBefore = buyer.balance;
        vm.prank(buyer);
        vm.expectRevert(PawnShop.IncorrectPayment.selector);
        shop.repay{value: payment}(id);
        assertEq(_loanSnapshot(id), beforeState);
        assertEq(buyer.balance, payerBefore);
        shop.repay{value: 0.4 ether}(id);
        assertEq(nft.ownerOf(1), alice);
        assertEq(discount.committed(alice), 0);
    }

    function test_failedExtensionRollsBackTheNewDiscountTier() public {
        _lock(1_000_000 ether);
        uint256 id = _pawn(1, 0);
        _lock(4_000_000 ether);
        uint256 dueBefore = shop.getLoan(id).due;
        bytes32 beforeState = _loanSnapshot(id);
        uint256 fee = 0.012 ether * 6667 / 10000;
        vm.prank(alice);
        vm.expectRevert(PawnShop.IncorrectPayment.selector);
        shop.extend{value: fee + 1}(id, 0);
        assertEq(_loanSnapshot(id), beforeState);
        assertEq(discount.tierCount(alice, 1), 1);
        assertEq(discount.tierCount(alice, 2), 0);
        vm.prank(buyer);
        vm.expectRevert(PawnShop.Unauthorized.selector);
        shop.extend{value: fee}(id, 0);
        assertEq(_loanSnapshot(id), beforeState);
        vm.prank(alice);
        shop.extend{value: fee}(id, 0);
        assertEq(shop.getLoan(id).due, dueBefore + 30 days);
        assertEq(discount.tierCount(alice, 1), 0);
        assertEq(discount.tierCount(alice, 2), 1);
    }

    function test_discountThresholdOneWeiAndMaximumFeeDoNotOverflow() public {
        _lock(1_000_000 ether - 1);
        vm.prank(address(shop));
        assertEq(discount.commit(99, alice, type(uint256).max), type(uint256).max);
        _lock(1);
        vm.prank(address(shop));
        // 2**256 - 1 is divisible by five: the 20% discount is exact.
        assertEq(discount.commit(99, alice, type(uint256).max), (type(uint256).max / 5) * 4);
        _lock(19_000_000 ether);
        vm.prank(address(shop));
        assertEq(discount.commit(99, alice, type(uint256).max), type(uint256).max / 2 + 1);
        vm.prank(address(shop));
        assertEq(discount.commit(99, alice, 1), 1, "one wei fee rounds toward the pool");
        vm.prank(address(shop));
        discount.release(99);
        vm.prank(alice);
        discount.unlock(20_000_000 ether);
        assertEq(token.balanceOf(alice), 20_000_000 ether);
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_auctionPriceIsMonotoneAndUnderbidRollsBack(uint256 elapsed, uint256 later) public {
        uint256 id = _pawn(1, 1);
        uint256 start = shop.getLoan(id).due + 3 days + 1;
        vm.warp(start);
        shop.startAuction(id);
        elapsed = bound(elapsed, 0, 30 days);
        later = bound(later, elapsed, 60 days);
        vm.warp(start + elapsed);
        uint256 first = shop.auctionPrice(id);
        vm.warp(start + later);
        uint256 second = shop.auctionPrice(id);
        assertGe(first, second);
        assertLe(first, 1 ether);
        assertGe(second, 0.5 ether);
        if (later >= 10 days) assertEq(second, 0.5 ether);
        bytes32 beforeState = _loanSnapshot(id);
        vm.prank(buyer);
        vm.expectRevert(PawnShop.IncorrectPayment.selector);
        shop.buyAuction{value: second - 1}(id, buyer);
        assertEq(_loanSnapshot(id), beforeState);
        vm.prank(buyer);
        vm.expectRevert(PullPayments.InvalidRecipient.selector);
        shop.buyAuction{value: second}(id, address(0));
        assertEq(_loanSnapshot(id), beforeState);
        vm.prank(buyer);
        shop.buyAuction{value: second + 1}(id, buyer);
        assertEq(shop.claimable(buyer), 1);
        assertEq(nft.ownerOf(1), buyer);
        assertEq(pool.totalBorrowed(), 0);
    }

    function test_floorChangesDoNotRepriceAnAuctionAlreadyStarted() public {
        uint256 id = _pawn(1, 1);
        vm.warp(shop.getLoan(id).due + 3 days + 1);
        shop.startAuction(id);
        uint256 priceBefore = shop.auctionPrice(id);
        _floor(100 ether);
        assertEq(shop.auctionPrice(id), priceBefore);
        vm.warp(vm.getBlockTimestamp() + 3 days);
        assertEq(shop.auctionPrice(id), 0.7 ether);
        _floor(1 wei);
        assertEq(shop.auctionPrice(id), 0.7 ether);
    }

    function test_minimumPrincipalAndOneWeiBelowIt() public {
        vm.warp(vm.getBlockTimestamp() + 1);
        _floor(0.025 ether - 1);
        nft.mint(alice, 1);
        vm.startPrank(alice);
        nft.approve(address(shop), 1);
        vm.expectRevert(PawnShop.LoanTooSmall.selector);
        shop.pawn(address(nft), 1, 0);
        vm.stopPrank();
        assertEq(nft.ownerOf(1), alice);
        assertEq(shop.nextLoanId(), 1);
        vm.warp(vm.getBlockTimestamp() + 1);
        _floor(0.025 ether);
        vm.prank(alice);
        uint256 id = shop.pawn(address(nft), 1, 0);
        assertEq(shop.getLoan(id).principal, 0.01 ether);
    }

    function test_claimZeroRecipientAndSecondClaimCannotSpendOtherCredits() public {
        _pawn(1, 0);
        uint256 amount = shop.claimable(alice);
        uint256 balanceBefore = address(shop).balance;
        vm.startPrank(alice);
        vm.expectRevert(PullPayments.InvalidRecipient.selector);
        shop.claim(payable(address(0)));
        assertEq(shop.claimable(alice), amount);
        shop.claim(payable(buyer));
        vm.expectRevert(PullPayments.NothingToClaim.selector);
        shop.claim(payable(buyer));
        vm.stopPrank();
        assertEq(address(shop).balance, balanceBefore - amount);
        assertEq(shop.totalClaimable(), 0);
        assertEq(address(shop).balance, shop.bountyReserve());
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_malformedSignedAnswersNeverConsumeRequests(uint256 length) public {
        length = bound(length, 0, 96);
        if (length == 32) length = 33;
        vm.warp(vm.getBlockTimestamp() + 1);
        OracleAttestation.Attestation memory a = _attestation(FLOOR_QUESTION, 2 ether);
        a.answer = new bytes(length);
        // Nonzero decoded value for long answers: rejection must be about the
        // malformed length, not merely a zero floor.
        if (length >= 32) a.answer[31] = 0x01;
        bytes memory sig = _signature(shop, a);
        (uint256 priceBefore, uint64 issuedBefore, uint64 expiresBefore, uint64 bountyBefore) =
            shop.floors(address(nft));
        vm.expectRevert(); // Short ABI payloads fail decoding; oversized ones fail validation.
        shop.submitFloor(address(nft), a, sig);
        assertFalse(shop.consumed(a.requestId));
        (uint256 price, uint64 issued, uint64 expires, uint64 bounty) = shop.floors(address(nft));
        assertEq(
            abi.encode(price, issued, expires, bounty),
            abi.encode(priceBefore, issuedBefore, expiresBefore, bountyBefore)
        );

        MilestoneBurn burnVault = new MilestoneBurn(address(token), owner, vm.addr(KEY));
        vm.prank(owner);
        burnVault.setQuestionHashOnce(FLOOR_QUESTION);
        token.transfer(address(burnVault), 1 ether);
        sig = _signature(burnVault, a);
        vm.expectRevert(MilestoneBurn.InvalidAttestation.selector);
        burnVault.burn(a, sig);
        assertFalse(burnVault.burned());
        assertFalse(burnVault.consumed(a.requestId));
        assertEq(token.balanceOf(address(burnVault)), 1 ether);
    }

    function test_nativeZeroOperationsAndInvalidSettlementAreAtomic() public {
        uint256 shares = pool.balanceOf(bob);
        vm.expectRevert(LendingPool.InvalidAmount.selector);
        pool.depositETH{value: 0}(bob);
        vm.expectRevert(LendingPool.InvalidAmount.selector);
        pool.mint(0, bob);
        vm.expectRevert(LendingPool.InvalidAmount.selector);
        pool.deposit(0, bob);
        vm.startPrank(bob);
        vm.expectRevert(LendingPool.InvalidAmount.selector);
        pool.withdrawETH(0, bob, bob);
        vm.expectRevert(LendingPool.InvalidAmount.selector);
        pool.redeemETH(0, bob, bob);
        vm.stopPrank();
        _pawn(1, 0);
        uint256 cash = weth.balanceOf(address(pool));
        vm.deal(address(shop), address(shop).balance + 1 ether);
        vm.startPrank(address(shop));
        vm.expectRevert(LendingPool.InvalidAmount.selector);
        pool.settle{value: 0.4 ether + 1}(0.4 ether);
        vm.expectRevert(LendingPool.InvalidAmount.selector);
        pool.settle(0.4 ether + 1);
        vm.stopPrank();
        assertEq(weth.balanceOf(address(pool)), cash);
        assertEq(pool.balanceOf(bob), shares);
        assertEq(pool.totalBorrowed(), 0.4 ether);
    }
}
