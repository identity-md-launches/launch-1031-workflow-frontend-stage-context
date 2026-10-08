// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {LockDiscount} from "src/LockDiscount.sol";
import {MilestoneBurn} from "src/MilestoneBurn.sol";
import {PawnShop} from "src/PawnShop.sol";
import {OracleAttestation} from "src/OracleAttestation.sol";
import {MockWETH} from "./helpers/Mocks.sol";

contract TokenCustodyHandler is Test {
    uint256 private constant KEY = 0xA11CE;
    bytes32 private constant QUESTION = keccak256("custody invariant FDV");
    LaunchToken public token;
    LockDiscount public discount;
    MilestoneBurn public burnVault;
    address[3] public actors;
    uint256[3] public wallets;
    uint256[3] public locks;
    uint256[24] public commitmentOwners; // zero = none, otherwise actor index + 1
    uint8[24] public commitmentTiers;
    uint256 public unsolicitedLocks;
    uint256 public donatedToBurn;
    uint256 public burned;
    bool public didBurn;
    uint256 private nonce;

    constructor() {
        token = new LaunchToken();
        discount = new LockDiscount(address(token), address(this));
        PawnShop signerSource = new PawnShop(address(this), address(token), address(new MockWETH()), vm.addr(KEY));
        burnVault = new MilestoneBurn(address(token), address(this), vm.addr(KEY), address(signerSource));
        burnVault.setQuestionHashOnce(QUESTION);
        for (uint256 i; i < 3; ++i) {
            actors[i] = makeAddr(string.concat("token actor ", vm.toString(i)));
            wallets[i] = 300_000_000 ether;
            token.transfer(actors[i], wallets[i]);
            vm.prank(actors[i]);
            token.approve(address(discount), type(uint256).max);
        }
    }

    function lock(uint256 who, uint256 seed) public {
        uint256 i = who % 3;
        if (wallets[i] == 0) return;
        uint256 amount = bound(seed, 1, wallets[i]);
        vm.prank(actors[i]);
        discount.lock(amount);
        wallets[i] -= amount;
        locks[i] += amount;
    }

    function unlock(uint256 who, uint256 seed) public {
        uint256 i = who % 3;
        uint256 available = locks[i] - expectedCommitment(i);
        if (available == 0) return;
        uint256 amount = bound(seed, 1, available);
        vm.prank(actors[i]);
        discount.unlock(amount);
        wallets[i] += amount;
        locks[i] -= amount;
    }

    function transfer(uint256 from, uint256 to, uint256 seed, bool delegated) external {
        uint256 i = from % 3;
        uint256 j = to % 3;
        uint256 amount = bound(seed, 0, wallets[i]);
        if (delegated) {
            vm.prank(actors[i]);
            token.approve(address(this), amount);
            token.transferFrom(actors[i], actors[j], amount);
            assertEq(token.allowance(actors[i], address(this)), 0);
        } else {
            vm.prank(actors[i]);
            token.transfer(actors[j], amount);
        }
        wallets[i] -= amount;
        wallets[j] += amount;
    }

    function commit(uint256 idSeed, uint256 who, uint256 feeSeed) public {
        uint256 id = idSeed % 24;
        uint256 i = commitmentOwners[id] == 0 ? who % 3 : commitmentOwners[id] - 1;
        uint8 tier =
            locks[i] >= 20_000_000 ether ? 3 : locks[i] >= 5_000_000 ether ? 2 : locks[i] >= 1_000_000 ether ? 1 : 0;
        uint256 baseFee = bound(feeSeed, 0, 1e30);
        uint256 fee = discount.commit(id, actors[i], baseFee);
        uint256 factor = tier == 3 ? 5000 : tier == 2 ? 6667 : tier == 1 ? 8000 : 10000;
        assertLe(fee, baseFee);
        assertGe(fee * 10000, baseFee * factor);
        assertLt(fee * 10000 - baseFee * factor, 10000);
        commitmentOwners[id] = i + 1;
        commitmentTiers[id] = tier;
    }

    function release(uint256 seed) public {
        uint256 id = seed % 24;
        if (commitmentOwners[id] == 0) {
            vm.expectRevert(LockDiscount.InvalidLoan.selector);
            discount.release(id);
        } else {
            discount.release(id);
            commitmentOwners[id] = 0;
            commitmentTiers[id] = 0;
        }
    }

    function rejectOverUnlock(uint256 who) external {
        uint256 i = who % 3;
        uint256 amount = locks[i] - expectedCommitment(i) + 1;
        vm.prank(actors[i]);
        vm.expectRevert(LockDiscount.Committed.selector);
        discount.unlock(amount);
    }

    function rejectUnauthorized(uint256 who, uint256 idSeed) external {
        uint256 id = idSeed % 24;
        address actor = actors[who % 3];
        vm.startPrank(actor);
        vm.expectRevert(LockDiscount.Unauthorized.selector);
        discount.commit(id, actor, 100);
        vm.expectRevert(LockDiscount.Unauthorized.selector);
        discount.release(id);
        vm.expectRevert(MilestoneBurn.Unauthorized.selector);
        burnVault.setQuestionHashOnce(keccak256("replacement"));
        vm.stopPrank();
        if (commitmentOwners[id] != 0) {
            address other = actors[commitmentOwners[id] % 3];
            vm.expectRevert(LockDiscount.InvalidLoan.selector);
            discount.commit(id, other, 100);
        }
    }

    function donate(uint256 who, uint256 seed, bool toBurn) external {
        uint256 i = who % 3;
        if (wallets[i] == 0) return;
        uint256 amount = bound(seed, 1, wallets[i]);
        vm.prank(actors[i]);
        token.transfer(toBurn ? address(burnVault) : address(discount), amount);
        wallets[i] -= amount;
        if (toBurn) donatedToBurn += amount;
        else unsolicitedLocks += amount;
    }

    function advance(uint256 seed) external {
        vm.warp(vm.getBlockTimestamp() + bound(seed, 0, 30 days));
    }

    function tryBurn(uint256 who, bool reachesMilestone) external {
        OracleAttestation.Attestation memory a;
        a.requestId = keccak256(abi.encode("burn invariant", ++nonce));
        a.chainId = 1;
        a.questionHash = QUESTION;
        a.answerType = 3;
        a.answer = abi.encode(reachesMilestone ? 1_000_000 ether : 1_000_000 ether - 1);
        a.panelSize = 5;
        a.quorum = 4;
        a.agreed = 4;
        a.issuedAt = uint64(vm.getBlockTimestamp());
        a.expiresAt = uint64(vm.getBlockTimestamp() + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, burnVault.attestationDigest(a));
        vm.prank(actors[who % 3]);
        if (didBurn) vm.expectRevert(MilestoneBurn.AlreadyBurned.selector);
        else if (!reachesMilestone) vm.expectRevert(MilestoneBurn.MilestoneNotReached.selector);
        else if (donatedToBurn == 0) vm.expectRevert(MilestoneBurn.EmptyVault.selector);
        burnVault.burn(a, abi.encodePacked(r, s, v));
        if (!didBurn && reachesMilestone && donatedToBurn != 0) {
            burned = donatedToBurn;
            didBurn = true;
            assertTrue(burnVault.consumed(a.requestId));
        } else {
            assertFalse(burnVault.consumed(a.requestId));
        }
    }

    function expectedCommitment(uint256 who) public view returns (uint256 largest) {
        for (uint256 id; id < 24; ++id) {
            if (commitmentOwners[id] != who + 1) continue;
            uint8 tier = commitmentTiers[id];
            uint256 amount =
                tier == 3 ? 20_000_000 ether : tier == 2 ? 5_000_000 ether : tier == 1 ? 1_000_000 ether : 0;
            if (amount > largest) largest = amount;
        }
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 80
/// forge-config: default.invariant.fail-on-revert = true
contract TokenCustodyInvariantTest is Test {
    TokenCustodyHandler handler;
    LaunchToken token;
    LockDiscount discount;
    MilestoneBurn burnVault;

    function setUp() public {
        vm.chainId(1);
        vm.warp(1_800_000_000);
        handler = new TokenCustodyHandler();
        token = handler.token();
        discount = handler.discount();
        burnVault = handler.burnVault();
        // Start with two distinct open commitments so isolation is exercised even
        // in sequences that choose withdrawals before the first random commit.
        handler.lock(0, 5_000_000 ether);
        handler.commit(0, 0, 300);
        handler.lock(1, 20_000_000 ether);
        handler.commit(1, 1, 300);
        bytes4[] memory selectors = new bytes4[](10);
        selectors[0] = handler.lock.selector;
        selectors[1] = handler.unlock.selector;
        selectors[2] = handler.transfer.selector;
        selectors[3] = handler.commit.selector;
        selectors[4] = handler.release.selector;
        selectors[5] = handler.rejectOverUnlock.selector;
        selectors[6] = handler.rejectUnauthorized.selector;
        selectors[7] = handler.donate.selector;
        selectors[8] = handler.advance.selector;
        selectors[9] = handler.tryBurn.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_fixedSupplyAndAllCustodyMatchTheLedger() public view {
        uint256 sum = token.balanceOf(address(handler));
        uint256 owed;
        assertEq(sum, 100_000_000 ether, "treasury cannot be spent through actor approvals");
        for (uint256 i; i < 3; ++i) {
            assertEq(token.balanceOf(handler.actors(i)), handler.wallets(i));
            assertEq(discount.locked(handler.actors(i)), handler.locks(i));
            sum += handler.wallets(i);
            owed += handler.locks(i);
        }
        assertEq(token.balanceOf(address(discount)), owed + handler.unsolicitedLocks());
        assertEq(token.balanceOf(address(burnVault)), handler.donatedToBurn() - handler.burned());
        assertEq(token.balanceOf(burnVault.BURN_DESTINATION()), handler.burned());
        sum += token.balanceOf(address(discount)) + token.balanceOf(address(burnVault))
        + token.balanceOf(burnVault.BURN_DESTINATION());
        assertEq(sum, 1_000_000_000 ether);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(burnVault.burned(), handler.didBurn());
        assertEq(burnVault.burnedAmount(), handler.burned());
    }

    function invariant_largestCommitmentAndEveryTierCountMatchOpenLoans() public view {
        for (uint256 i; i < 3; ++i) {
            uint256[4] memory counts;
            address actor = handler.actors(i);
            for (uint256 id; id < 24; ++id) {
                (address actualBorrower, uint8 actualTier) = discount.commitments(id);
                uint256 modelOwner = handler.commitmentOwners(id);
                assertEq(actualBorrower, modelOwner == 0 ? address(0) : handler.actors(modelOwner - 1));
                assertEq(actualTier, handler.commitmentTiers(id));
                if (modelOwner == i + 1) ++counts[handler.commitmentTiers(id)];
            }
            for (uint8 tier = 1; tier <= 3; ++tier) {
                assertEq(discount.tierCount(actor, tier), counts[tier]);
            }
            uint256 largest = handler.expectedCommitment(i);
            assertEq(discount.committed(actor), largest);
            assertGe(handler.locks(i), largest);
            assertEq(discount.unlockable(actor), handler.locks(i) - largest);
        }
    }

    function afterInvariant() public {
        for (uint256 id; id < 24; ++id) {
            handler.release(id);
        }
        for (uint256 i; i < 3; ++i) {
            handler.unlock(i, handler.locks(i));
            assertEq(discount.locked(handler.actors(i)), 0);
        }
        invariant_fixedSupplyAndAllCustodyMatchTheLedger();
        invariant_largestCommitmentAndEveryTierCountMatchOpenLoans();
    }
}
