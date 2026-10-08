// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {MockWETH, RejectETH} from "./helpers/Mocks.sol";
import {PullPayments} from "../src/PullPayments.sol";

contract LendingPoolTest is Test {
    MockWETH weth;
    LendingPool pool;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.deal(address(this), 100 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        weth = new MockWETH();
        pool = new LendingPool(address(this), address(weth), address(this));
    }

    function test_erc4626DepositMintWithdrawRedeemAndNativeClaim() public {
        assertEq(pool.decimals(), 24);
        vm.startPrank(alice);
        weth.deposit{value: 2 ether}();
        weth.approve(address(pool), 2 ether);
        uint256 shares = pool.deposit(1 ether, alice);
        assertEq(shares, 1e24);
        assertEq(pool.mint(1e24, alice), 1 ether);
        assertEq(pool.withdraw(0.5 ether, alice, alice), 0.5e24);
        assertEq(pool.redeem(0.5e24, alice, alice), 0.5 ether);
        pool.withdrawETH(0.5 ether, alice, alice);
        pool.redeemETH(0.5e24, alice, alice);
        assertEq(pool.claimable(alice), 1 ether);
        assertEq(pool.totalAssets(), 0);
        pool.claim(payable(alice));
        vm.stopPrank();
        assertEq(address(pool).balance, 0);
        assertEq(pool.totalSupply(), 0);
    }

    function test_nativeWithdrawRequiresShareAllowance() public {
        vm.prank(alice);
        pool.depositETH{value: 2 ether}(alice);
        vm.prank(bob);
        vm.expectRevert();
        pool.withdrawETH(1 ether, bob, alice);
        vm.prank(alice);
        pool.approve(bob, 1e24);
        vm.prank(bob);
        pool.withdrawETH(1 ether, bob, alice);
        assertEq(pool.claimable(bob), 1 ether);
        assertEq(pool.balanceOf(alice), 1e24);
    }

    function test_donationVestsExactlyAndDoesNotResetOnNewDonation() public {
        vm.prank(alice);
        pool.depositETH{value: 2 ether}(alice);
        uint256 start = vm.getBlockTimestamp();
        pool.donate{value: 7 ether}();
        assertEq(pool.totalAssets(), 2 ether);
        assertEq(pool.idleAssets(), 2 ether);
        vm.warp(start + 3 days);
        assertEq(pool.totalAssets(), 5 ether);
        pool.donate{value: 7 ether}();
        assertEq(pool.totalAssets(), 5 ether);
        vm.warp(start + 7 days);
        assertEq(pool.unvestedDonations(), 3 ether);
        assertEq(pool.totalAssets(), 13 ether);
        assertEq(pool.maxDeposit(alice), 0);
        vm.warp(start + 10 days);
        assertEq(pool.unvestedDonations(), 0);
        assertEq(pool.totalAssets(), 16 ether);
    }

    function test_dustDonationsCannotBlockDonationsOrWithdrawals() public {
        pool.depositETH{value: 1 ether}(alice);
        for (uint256 i; i < 64; ++i) {
            vm.warp(vm.getBlockTimestamp() + 1);
            pool.donate{value: 1}();
        }
        pool.donate{value: 1}();
        assertEq(pool.donationCount(), 64);
        vm.prank(alice);
        pool.withdraw(0.5 ether, alice, alice);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        pool.donate{value: 1 ether}();
        assertEq(pool.unvestedDonations(), 1 ether);
    }

    function test_shortfallReserveExcludedAndConsumedBeforeShares() public {
        pool.depositETH{value: 5 ether}(alice);
        pool.addReserve{value: 1 ether}();
        pool.donate{value: 1 ether}();
        assertEq(pool.totalAssets(), 5 ether);
        assertEq(pool.idleAssets(), 5 ether);
        pool.borrow(4 ether);
        assertEq(pool.totalAssets(), 5 ether);
        assertEq(pool.idleAssets(), 1 ether);
        vm.expectRevert(LendingPool.InsufficientIdle.selector);
        pool.borrow(1 ether + 1);
        vm.prank(alice);
        vm.expectRevert();
        pool.withdraw(2 ether, alice, alice);
        pool.settle{value: 1 ether}(2 ether);
        assertEq(pool.shortfallReserve(), 0);
        assertEq(pool.totalAssets(), 5 ether);
        pool.settle{value: 1 ether}(2 ether);
        assertEq(pool.totalAssets(), 4 ether);
        assertEq(pool.cumulativeLoss(), 1 ether);
        assertEq(pool.totalBorrowed(), 0);
    }

    function test_accessCapAndFailedClaim() public {
        vm.prank(alice);
        vm.expectRevert(LendingPool.OnlyPawnShop.selector);
        pool.borrow(1);
        vm.prank(alice);
        vm.expectRevert(LendingPool.OnlyPawnShop.selector);
        pool.settle{value: 1}(1);
        pool.depositETH{value: 10 ether}(alice);
        vm.expectRevert(LendingPool.CapExceeded.selector);
        pool.depositETH{value: 1}(bob);
        vm.prank(alice);
        pool.withdrawETH(1 ether, alice, alice);
        RejectETH reject = new RejectETH();
        vm.prank(alice);
        vm.expectRevert(PullPayments.ETHTransferFailed.selector);
        pool.claim(payable(address(reject)));
        assertEq(pool.claimable(alice), 1 ether);
        assertEq(pool.totalAssets(), 9 ether);
    }

    function testFuzz_roundTripNeverCreatesAssets(uint256 amount) public {
        amount = bound(amount, 1, 10 ether);
        uint256 shares = pool.depositETH{value: amount}(alice);
        uint256 maxAssets = pool.maxWithdraw(alice);
        assertLe(maxAssets, amount);
        vm.prank(alice);
        uint256 assets = pool.redeem(shares, alice, alice);
        assertLe(assets, amount);
        assertEq(weth.balanceOf(alice) + weth.balanceOf(address(pool)), amount);
    }

    function test_directDonationInflationCannotStealVictimDeposit() public {
        pool.depositETH{value: 1}(alice);
        weth.deposit{value: 1 ether}();
        weth.transfer(address(pool), 1 ether);
        vm.prank(bob);
        uint256 shares = pool.depositETH{value: 1 ether}(bob);
        assertGt(shares, 0);
        uint256 attackerShares = pool.balanceOf(alice);
        vm.prank(alice);
        uint256 attackerProceeds = pool.redeem(attackerShares, alice, alice);
        assertLt(attackerProceeds, 1 ether + 1);
        assertGt(pool.maxWithdraw(bob), 0.99 ether);
    }

    receive() external payable {}
}
