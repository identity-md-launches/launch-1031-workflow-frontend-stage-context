// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PawnTestBase} from "./helpers/PawnTestBase.sol";
import {MilestoneBurn} from "../src/MilestoneBurn.sol";
import {OracleAttestation, OracleAttestationConsumer} from "../src/OracleAttestation.sol";

contract MilestoneBurnTest is PawnTestBase {
    bytes32 constant BURN_QUESTION = keccak256("test-only FDV question");
    MilestoneBurn burnVault;

    function setUp() public override {
        super.setUp();
        burnVault = new MilestoneBurn(address(token), owner, vm.addr(KEY));
    }

    function _configure() private {
        vm.prank(owner);
        burnVault.setQuestionHashOnce(BURN_QUESTION);
    }

    function test_unsetOneTimeSetupAndThreshold() public {
        OracleAttestation.Attestation memory a = _attestation(BURN_QUESTION, 1_000_000 ether);
        bytes memory sig = _signature(burnVault, a);
        vm.expectRevert(MilestoneBurn.NotConfigured.selector);
        burnVault.burn(a, sig);
        vm.expectRevert(MilestoneBurn.Unauthorized.selector);
        burnVault.setQuestionHashOnce(BURN_QUESTION);
        _configure();
        vm.prank(owner);
        vm.expectRevert(MilestoneBurn.Unauthorized.selector);
        burnVault.setQuestionHashOnce(keccak256("changed"));
        vm.expectRevert(MilestoneBurn.EmptyVault.selector);
        burnVault.burn(a, sig);
        token.transfer(address(burnVault), 100 ether);
        a.answer = abi.encode(uint256(1_000_000 ether - 1));
        sig = _signature(burnVault, a);
        vm.expectRevert(MilestoneBurn.MilestoneNotReached.selector);
        burnVault.burn(a, sig);
        a.answer = abi.encode(uint256(1_000_000 ether));
        sig = _signature(burnVault, a);
        vm.prank(buyer);
        burnVault.burn(a, sig);
        assertTrue(burnVault.burned());
        assertEq(burnVault.burnedAmount(), 100 ether);
        assertEq(token.balanceOf(burnVault.BURN_DESTINATION()), 100 ether);
        assertEq(token.totalSupply(), 1e27); // A sink transfer never changes the fixed launch supply.
        token.transfer(address(burnVault), 1 ether);
        vm.expectRevert(MilestoneBurn.AlreadyBurned.selector);
        burnVault.burn(a, sig);
        assertEq(token.balanceOf(address(burnVault)), 1 ether);
    }

    function test_rejectsStaleExpiredWrongDomainAndInsufficientPanel() public {
        _configure();
        token.transfer(address(burnVault), 100 ether);
        OracleAttestation.Attestation memory a = _attestation(BURN_QUESTION, 1_000_000 ether);
        bytes memory sig = _signature(shop, a);
        vm.expectRevert(OracleAttestationConsumer.BadSignature.selector);
        burnVault.burn(a, sig);
        a.agreed = 3;
        sig = _signature(burnVault, a);
        vm.expectRevert(MilestoneBurn.InvalidAttestation.selector);
        burnVault.burn(a, sig);
        a.agreed = 4;
        a.expiresAt = uint64(vm.getBlockTimestamp() - 1);
        sig = _signature(burnVault, a);
        vm.expectRevert(abi.encodeWithSelector(OracleAttestationConsumer.AttestationExpired.selector, a.expiresAt));
        burnVault.burn(a, sig);
        a.expiresAt = uint64(vm.getBlockTimestamp() + 30 days);
        sig = _signature(burnVault, a);
        vm.warp(vm.getBlockTimestamp() + 26 hours + 1);
        vm.expectRevert(MilestoneBurn.InvalidAttestation.selector);
        burnVault.burn(a, sig);
    }
}
