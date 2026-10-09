// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {PawnTestBase} from "./helpers/PawnTestBase.sol";
import {PawnShop} from "../src/PawnShop.sol";
import {OracleAttestation} from "../src/OracleAttestation.sol";

/// @notice Reproduced scope decisions retained for the independent reviewer.
contract ReviewScopeTest is PawnTestBase {
    function test_newWindowHashRejected() public {
        vm.warp(vm.getBlockTimestamp() + 24 hours);
        OracleAttestation.Attestation memory a = _attestation(keccak256("fresh resolved window"), 1 ether);
        bytes memory sig = _signature(shop, a);
        vm.expectRevert(PawnShop.InvalidAttestation.selector);
        shop.submitFloor(address(nft), a, sig);
        vm.warp(vm.getBlockTimestamp() + 2 hours + 1);
        assertFalse(shop.floorFresh(address(nft)));
    }

    function test_ownerValuationCanBorrowAllIdle() public {
        vm.warp(vm.getBlockTimestamp() + 1);
        _floor(1e27);
        vm.expectRevert(PawnShop.ShareExceeded.selector);
        shop.pawn(address(nft), 1, 0, 0, type(uint256).max);
        vm.warp(vm.getBlockTimestamp() + 1);
        // A genuine signature over an unsuitable owner-selected question/value can support all idle liquidity.
        _floor(12.5 ether);
        uint256 id = _pawn(1, 0);
        assertEq(shop.getLoan(id).principal, 5 ether);
        assertEq(shop.claimable(alice), 4.85 ether);
    }

    function test_bountyCopied() public {
        shop.fundBounties{value: 0.2 ether}();
        vm.warp(vm.getBlockTimestamp() + 25 hours);
        OracleAttestation.Attestation memory a = _attestation(FLOOR_QUESTION, 1 ether);
        bytes memory sig = _signature(shop, a);
        vm.prank(buyer);
        shop.submitFloor(address(nft), a, sig);
        assertEq(shop.claimable(buyer), 0.001 ether);
        vm.expectRevert(PawnShop.InvalidAttestation.selector);
        shop.submitFloor(address(nft), a, sig);
    }

    function test_fixedMaximumPrincipal() public {
        vm.prank(bob);
        pool.withdrawETH(4.7 ether, bob, bob);
        // Existing collection-share check rejects the computed 0.4 ETH before the cash check.
        vm.expectRevert(PawnShop.ShareExceeded.selector);
        shop.pawn(address(nft), 1, 0, 0, type(uint256).max);
    }

    function test_underwaterExtensions() public {
        vm.warp(vm.getBlockTimestamp() + 1);
        _floor(10 ether);
        uint256 id = _pawn(1, 1);
        uint256 due = shop.getLoan(id).due;
        for (uint256 i; i < 52; ++i) {
            vm.warp(vm.getBlockTimestamp() + 1 days);
            _floor(1 ether);
            vm.prank(alice);
            shop.extend{value: 0.04 ether}(id, 1);
        }
        assertEq(shop.getLoan(id).due, due + 364 days);
        assertEq(shop.getLoan(id).principal, 4 ether);
    }
}
