// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PawnTestBase} from "./helpers/PawnTestBase.sol";
import {PawnShop} from "../src/PawnShop.sol";
import {MilestoneBurn} from "../src/MilestoneBurn.sol";
import {OracleAttestation} from "../src/OracleAttestation.sol";

contract SetupFlowsTest is PawnTestBase {
    function test_ownerPinsFloorThenPublicWalletPostsAndClaimsBounty() public {
        PawnShop fresh = new PawnShop(owner, address(token), address(weth), vm.addr(KEY));
        OracleAttestation.Attestation memory a = _attestation(FLOOR_QUESTION, 2 ether);
        bytes memory signature = _signature(fresh, a);
        vm.expectRevert(PawnShop.NotConfigured.selector);
        fresh.submitFloor(address(nft), a, signature);
        vm.prank(owner);
        fresh.setQuestionHashOnce(address(nft), a.questionHash);
        fresh.fundBounties{value: 0.01 ether}();
        vm.prank(alice);
        fresh.submitFloor(address(nft), a, signature);
        assertTrue(fresh.floorFresh(address(nft)));
        assertEq(fresh.claimable(alice), 0.001 ether);
        uint256 before = alice.balance;
        vm.prank(alice);
        fresh.claim(payable(alice));
        assertEq(alice.balance, before + 0.001 ether);
        assertEq(fresh.claimable(alice), 0);
        vm.expectRevert(PawnShop.InvalidAttestation.selector);
        fresh.submitFloor(address(nft), a, signature);
        vm.prank(owner);
        fresh.setNewLoansPaused(false);
        assertFalse(fresh.newLoansPaused());
    }

    function test_burnSetupRejectsLowCapAndForeignConsumerThenBurnsOnce() public {
        MilestoneBurn vault = new MilestoneBurn(address(token), owner, vm.addr(KEY), address(shop));
        token.transfer(address(vault), 10_000_000 ether);
        bytes32 capQuestion = keccak256("test market cap question");
        vm.prank(owner);
        vault.setQuestionHashOnce(capQuestion);
        OracleAttestation.Attestation memory a = _attestation(capQuestion, 999_999 ether);
        bytes memory signature = _signature(vault, a);
        vm.expectRevert(MilestoneBurn.MilestoneNotReached.selector);
        vault.burn(a, signature);
        a.answer = abi.encode(uint256(1_000_000 ether));
        signature = _signature(shop, a);
        vm.expectRevert();
        vault.burn(a, signature);
        signature = _signature(vault, a);
        vm.prank(alice);
        vault.burn(a, signature);
        assertTrue(vault.burned());
        assertEq(vault.burnedAmount(), 10_000_000 ether);
        assertEq(token.balanceOf(address(vault)), 0);
        vm.expectRevert(MilestoneBurn.AlreadyBurned.selector);
        vault.burn(a, signature);
    }
}
