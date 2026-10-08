// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {LockDiscount} from "../src/LockDiscount.sol";

contract LockDiscountTest is Test {
    LaunchToken token;
    LockDiscount discount;
    address alice = makeAddr("alice");

    function setUp() public {
        token = new LaunchToken();
        discount = new LockDiscount(address(token), address(this));
        token.transfer(alice, 30_000_000 ether);
        vm.prank(alice);
        token.approve(address(discount), 30_000_000 ether);
    }

    function test_tiersLargestCommitmentAndRelease() public {
        assertEq(discount.commit(1, alice, 10_000), 10_000);
        vm.prank(alice);
        discount.lock(1_000_000 ether);
        assertEq(discount.commit(1, alice, 10_000), 8000);
        vm.prank(alice);
        discount.lock(4_000_000 ether);
        assertEq(discount.commit(2, alice, 10_000), 6667);
        vm.prank(alice);
        discount.lock(15_000_000 ether);
        assertEq(discount.commit(3, alice, 10_000), 5000);
        assertEq(discount.committed(alice), 20_000_000 ether);
        discount.release(3);
        assertEq(discount.committed(alice), 5_000_000 ether);
        vm.prank(alice);
        discount.unlock(15_000_000 ether);
        discount.release(2);
        assertEq(discount.committed(alice), 1_000_000 ether);
        discount.release(1);
        vm.prank(alice);
        discount.unlock(5_000_000 ether);
        assertEq(token.balanceOf(alice), 30_000_000 ether);
        vm.expectRevert(LockDiscount.InvalidLoan.selector);
        discount.release(1);
    }

    function test_manySameTierLoansDoNotMultiplyCommitment() public {
        vm.prank(alice);
        discount.lock(2_000_000 ether);
        for (uint256 i; i < 50; ++i) {
            discount.commit(i, alice, 1000);
        }
        assertEq(discount.committed(alice), 1_000_000 ether);
        vm.prank(alice);
        discount.unlock(1_000_000 ether);
        for (uint256 i; i < 49; ++i) {
            discount.release(i);
        }
        assertEq(discount.committed(alice), 1_000_000 ether);
        discount.release(49);
        assertEq(discount.committed(alice), 0);
    }

    function test_unauthorizedAndInsufficientLockedActions() public {
        vm.prank(alice);
        vm.expectRevert(LockDiscount.Unauthorized.selector);
        discount.commit(1, alice, 100);
        vm.prank(alice);
        vm.expectRevert(LockDiscount.Unauthorized.selector);
        discount.release(1);
        vm.prank(alice);
        vm.expectRevert(LockDiscount.Committed.selector);
        discount.unlock(1);
        vm.prank(alice);
        vm.expectRevert(LockDiscount.InvalidAmount.selector);
        discount.lock(0);
    }

    function testFuzz_discountRoundsUpAndNeverExceedsBase(uint256 base, uint8 tier) public {
        base = bound(base, 1, 1e30);
        tier = uint8(bound(tier, 0, 3));
        uint256 amount = discount.tierAmount(tier);
        if (amount != 0) {
            vm.prank(alice);
            discount.lock(amount);
        }
        uint256 fee = discount.commit(1, alice, base);
        uint256 off = tier == 3 ? 5000 : tier == 2 ? 3333 : tier == 1 ? 2000 : 0;
        assertGe(fee * 10000, base * (10000 - off));
        assertLt(fee * 10000 - base * (10000 - off), 10000);
        assertLe(fee, base);
    }
}
