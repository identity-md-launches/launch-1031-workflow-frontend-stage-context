// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LendingPool} from "src/LendingPool.sol";
import {MockWETH} from "./helpers/Mocks.sol";

/// @dev Independent cash-flow ledger. Only the handler is the pool's authorized shop.
contract PoolAccountingHandler is Test {
    LendingPool public pool;
    MockWETH public weth;
    address[3] public actors;
    uint256 public deposits;
    uint256 public withdrawals;
    uint256 public donations;
    uint256 public fees;
    uint256 public reservesAdded;
    uint256 public borrowed;
    uint256 public recovered;
    uint256 public debt;
    uint256 public reserve;
    uint256 public loss;
    uint256 public directWeth;
    uint256 public reclassifiedToReserve;
    uint256[3] public credits;
    uint256[3] public claimed;
    uint256[] public donatedAmounts;
    uint256[] public donatedAt;

    constructor() {
        weth = new MockWETH();
        pool = new LendingPool(address(this), address(weth), address(this));
        vm.deal(address(this), 100_000 ether);
        for (uint256 i; i < 3; ++i) {
            actors[i] = makeAddr(string.concat("pool actor ", vm.toString(i)));
            vm.deal(actors[i], 100_000 ether);
            vm.prank(actors[i]);
            weth.approve(address(pool), type(uint256).max);
        }
    }

    function deposit(uint256 who, uint256 seed, bool native) public {
        address actor = actors[who % 3];
        uint256 room = pool.maxDeposit(actor);
        if (room == 0) return;
        uint256 amount = bound(seed, 1, room);
        if (pool.previewDeposit(amount) == 0) return;
        vm.startPrank(actor);
        if (native) {
            pool.depositETH{value: amount}(actor);
        } else {
            weth.deposit{value: amount}();
            pool.deposit(amount, actor);
        }
        vm.stopPrank();
        deposits += amount;
    }

    function withdraw(uint256 who, uint256 seed, bool native) external {
        uint256 index = who % 3;
        address actor = actors[index];
        uint256 available = pool.maxWithdraw(actor);
        if (available == 0) return;
        uint256 amount = bound(seed, 1, available);
        uint256 beforeWeth = weth.balanceOf(actor);
        vm.prank(actor);
        if (native) {
            pool.withdrawETH(amount, actor, actor);
            credits[index] += amount;
        } else {
            pool.withdraw(amount, actor, actor);
            assertEq(weth.balanceOf(actor) - beforeWeth, amount);
        }
        withdrawals += amount;
        _retireEmptyPool();
    }

    function redeem(uint256 who, uint256 seed, bool native) external {
        uint256 index = who % 3;
        address actor = actors[index];
        uint256 available = pool.maxRedeem(actor);
        if (available == 0) return;
        uint256 shares = bound(seed, 1, available);
        // ERC-4626 redemption can retire worthless shares; the native helper
        // explicitly rejects zero assets.
        if (native && pool.previewRedeem(shares) == 0) return;
        uint256 beforeShares = pool.balanceOf(actor);
        uint256 beforeWeth = weth.balanceOf(actor);
        uint256 amount;
        vm.prank(actor);
        if (native) {
            amount = pool.redeemETH(shares, actor, actor);
            credits[index] += amount;
        } else {
            amount = pool.redeem(shares, actor, actor);
            assertEq(weth.balanceOf(actor) - beforeWeth, amount);
        }
        assertEq(beforeShares - pool.balanceOf(actor), shares);
        withdrawals += amount;
        _retireEmptyPool();
    }

    function transferShares(uint256 from, uint256 to, uint256 seed) external {
        address sender = actors[from % 3];
        uint256 amount = bound(seed, 0, pool.balanceOf(sender));
        vm.prank(sender);
        pool.transfer(actors[to % 3], amount);
    }

    function donate(uint256 seed, bool direct) external {
        uint256 amount = bound(seed, 1, 1 ether);
        if (direct) {
            weth.deposit{value: amount}();
            weth.transfer(address(pool), amount);
            directWeth += amount;
        } else {
            if (pool.totalSupply() == 0) {
                vm.expectRevert(LendingPool.InvalidAmount.selector);
                pool.donate{value: amount}();
                return;
            }
            pool.donate{value: amount}();
            donations += amount;
            donatedAmounts.push(amount);
            donatedAt.push(vm.getBlockTimestamp());
        }
    }

    function advance(uint256 seed) external {
        vm.warp(vm.getBlockTimestamp() + bound(seed, 0, 8 days));
    }

    function borrow(uint256 seed) external {
        uint256 available = pool.idleAssets();
        if (available == 0) return;
        uint256 amount = bound(seed, 1, available);
        uint256 beforeETH = address(this).balance;
        pool.borrow(amount);
        assertEq(address(this).balance - beforeETH, amount);
        borrowed += amount;
        debt += amount;
    }

    function settle(uint256 principalSeed, uint256 paidSeed) external {
        if (debt == 0) return;
        uint256 principal = bound(principalSeed, 1, debt);
        uint256 paid = bound(paidSeed, 0, principal);
        uint256 gap = principal - paid;
        uint256 covered = gap < reserve ? gap : reserve;
        pool.settle{value: paid}(principal);
        recovered += paid;
        debt -= principal;
        reserve -= covered;
        loss += gap - covered;
        _retireEmptyPool();
    }

    function feeOrReserve(uint256 seed, bool isReserve) external {
        uint256 amount = bound(seed, 1, 0.2 ether);
        if (isReserve) {
            pool.addReserve{value: amount}();
            reservesAdded += amount;
            reserve += amount;
        } else {
            pool.receiveFee{value: amount}();
            fees += amount;
            if (pool.totalSupply() == 0) {
                reserve += amount;
                reclassifiedToReserve += amount;
            } else {
                donatedAmounts.push(amount);
                donatedAt.push(vm.getBlockTimestamp());
            }
        }
    }

    /// @dev At the last-share exit, leftover cash and unvested income belong
    /// to the reserve. Derive the amount from cash flows, never the pool getter.
    function _retireEmptyPool() private {
        if (pool.totalSupply() != 0) return;
        uint256 cash = deposits + donations + fees + reservesAdded + recovered + directWeth - borrowed - withdrawals;
        reclassifiedToReserve += cash - reserve;
        reserve = cash;
        delete donatedAmounts;
        delete donatedAt;
    }

    function claim(uint256 who, uint256 destination) external {
        uint256 index = who % 3;
        uint256 amount = credits[index];
        if (amount == 0) return;
        address receiver = actors[destination % 3];
        uint256 beforeETH = receiver.balance;
        vm.prank(actors[index]);
        assertEq(pool.claim(payable(receiver)), amount);
        assertEq(receiver.balance - beforeETH, amount);
        credits[index] = 0;
        claimed[index] += amount;
    }

    function unauthorizedShopCalls(uint256 who, uint256 seed) external {
        address actor = actors[who % 3];
        uint256 amount = bound(seed, 0, 1 ether);
        vm.startPrank(actor);
        vm.expectRevert(LendingPool.OnlyPawnShop.selector);
        pool.borrow(amount);
        vm.expectRevert(LendingPool.OnlyPawnShop.selector);
        pool.settle{value: amount}(amount);
        vm.expectRevert(LendingPool.OnlyPawnShop.selector);
        pool.receiveFee{value: amount}();
        vm.expectRevert(LendingPool.OnlyPawnShop.selector);
        pool.addReserve{value: amount}();
        vm.stopPrank();
    }

    /// @dev Slow linear reference over original tranches, independent of the pool's
    /// merged cumulative checkpoints and binary search. Round only the final sum.
    function expectedUnvested() public view returns (uint256) {
        uint256 numerator;
        for (uint256 i; i < donatedAmounts.length; ++i) {
            uint256 age = block.timestamp - donatedAt[i];
            if (age < 7 days) numerator += donatedAmounts[i] * (7 days - age);
        }
        return numerator / 7 days + (numerator % 7 days == 0 ? 0 : 1);
    }

    receive() external payable {}
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 80
/// forge-config: default.invariant.fail-on-revert = true
contract PoolAccountingInvariantTest is Test {
    PoolAccountingHandler handler;
    LendingPool pool;
    MockWETH weth;

    function setUp() public {
        vm.warp(1_800_000_000);
        handler = new PoolAccountingHandler();
        pool = handler.pool();
        weth = handler.weth();
        for (uint256 i; i < 3; ++i) {
            handler.deposit(i, 1 ether, true);
        }
        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.withdraw.selector;
        selectors[2] = handler.redeem.selector;
        selectors[3] = handler.transferShares.selector;
        selectors[4] = handler.donate.selector;
        selectors[5] = handler.advance.selector;
        selectors[6] = handler.borrow.selector;
        selectors[7] = handler.settle.selector;
        selectors[8] = handler.feeOrReserve.selector;
        selectors[9] = handler.claim.selector;
        selectors[10] = handler.unauthorizedShopCalls.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_cashDebtReservesAndVestingMatchIndependentLedger() public view {
        uint256 incoming = handler.deposits() + handler.donations() + handler.fees() + handler.reservesAdded()
            + handler.recovered() + handler.directWeth();
        uint256 outgoing = handler.borrowed() + handler.withdrawals();
        assertEq(weth.balanceOf(address(pool)), incoming - outgoing, "cash flows");
        assertEq(pool.totalBorrowed(), handler.debt(), "debt");
        assertEq(pool.shortfallReserve(), handler.reserve(), "protected reserve");
        assertEq(pool.cumulativeLoss(), handler.loss(), "uncovered loss");
        assertEq(pool.cumulativeLoanFees(), handler.fees(), "fees");
        assertEq(pool.cumulativeDonations(), handler.donations(), "donations");
        uint256 unvested = handler.expectedUnvested();
        assertEq(pool.unvestedDonations(), unvested, "linear tranche vesting");
        // Audit F10: sum every addition before subtracting, so an intermediate value can never underflow.
        uint256 additions = handler.deposits() + handler.donations() + handler.fees() + handler.directWeth();
        uint256 deductions = handler.withdrawals() + handler.loss() + handler.reclassifiedToReserve() + unvested;
        assertEq(pool.totalAssets(), additions - deductions, "share backing");
        assertEq(pool.idleAssets() + handler.reserve() + unvested, weth.balanceOf(address(pool)));
    }

    function invariant_allShareBalancesAndPullCreditsAreAccountedFor() public view {
        uint256 shares;
        uint256 credits;
        for (uint256 i; i < 3; ++i) {
            address actor = handler.actors(i);
            shares += pool.balanceOf(actor);
            credits += handler.credits(i);
            assertEq(pool.claimable(actor), handler.credits(i), "individual credit");
            assertLe(pool.maxWithdraw(actor), pool.idleAssets());
            assertLe(pool.previewRedeem(pool.maxRedeem(actor)), pool.idleAssets());
        }
        assertEq(pool.totalSupply(), shares);
        assertEq(pool.totalClaimable(), credits);
        assertEq(address(pool).balance, credits);
    }

    /// @dev Reconcile after debt settlement, complete vesting, full share exits
    /// and credit claims. The corrected redemption limit must allow every exit.
    function afterInvariant() public {
        uint256 outstanding = handler.debt();
        if (outstanding != 0) handler.settle(outstanding, outstanding);
        handler.advance(8 days);
        for (uint256 i; i < 3; ++i) {
            address actor = handler.actors(i);
            uint256 shares = pool.balanceOf(actor);
            assertEq(pool.maxRedeem(actor), shares, "all shares redeemable after settlement");
            handler.redeem(i, shares, false);
            assertEq(pool.balanceOf(actor), 0, "full exit");
            assertEq(pool.maxWithdraw(actor), 0, "no stranded entitlement");
            handler.claim(i, i);
        }
        invariant_cashDebtReservesAndVestingMatchIndependentLedger();
        invariant_allShareBalancesAndPullCreditsAreAccountedFor();
        assertEq(pool.totalBorrowed(), 0);
        assertEq(pool.totalClaimable(), 0);
        assertEq(pool.totalSupply(), 0);
        assertEq(pool.totalAssets(), 0);
    }

    function test_partialLossAndFinalSettlementReconcileLedger() public {
        handler.borrow(3 ether);
        handler.settle(1 ether, 0.9 ether);
        assertEq(pool.totalAssets(), 2.9 ether);
        afterInvariant();
        assertEq(handler.withdrawals() + handler.reserve(), 2.9 ether);
    }

    function test_feesAndDonationsVestAsIndependentTranches() public {
        handler.feeOrReserve(0.2 ether, false);
        handler.advance(3.5 days);
        handler.donate(0.7 ether, false);
        assertEq(pool.totalAssets(), 3.1 ether);
        invariant_cashDebtReservesAndVestingMatchIndependentLedger();
        handler.advance(3.5 days);
        assertEq(pool.unvestedDonations(), 0.35 ether);
        assertEq(pool.totalAssets(), 3.55 ether);
        invariant_cashDebtReservesAndVestingMatchIndependentLedger();
        afterInvariant();
    }

    function test_lastShareExitRetiresIncomeAndSameTimestampReentryStartsNewVesting() public {
        handler.feeOrReserve(0.2 ether, false);
        handler.donate(0.5 ether, false);
        for (uint256 i = 1; i < 3; ++i) {
            handler.transferShares(i, 0, pool.balanceOf(handler.actors(i)));
        }
        handler.redeem(0, pool.balanceOf(handler.actors(0)), false);
        assertEq(pool.totalSupply(), 0);
        assertEq(pool.shortfallReserve(), 0.7 ether);
        assertEq(pool.unvestedDonations(), 0);
        handler.donate(1 ether, false); // Assert rejection at zero share supply.
        handler.feeOrReserve(0.1 ether, false);
        assertEq(pool.shortfallReserve(), 0.8 ether);
        invariant_cashDebtReservesAndVestingMatchIndependentLedger();

        handler.deposit(1, 1 ether, true);
        handler.donate(1 ether, false);
        assertEq(pool.totalAssets(), 1 ether);
        assertEq(pool.unvestedDonations(), 1 ether);
        invariant_cashDebtReservesAndVestingMatchIndependentLedger();
        afterInvariant();
    }
}
