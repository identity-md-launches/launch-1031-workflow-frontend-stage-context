// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {PawnShop} from "../../src/PawnShop.sol";

/// @dev Test helper: the identity collection's hash is a constructor preset, so tests that pin a
/// different (vector) question rotate it through the governed queue and return to the original time.
library QuestionRotation {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function rotate(PawnShop shop, address collection, bytes32 hash) internal {
        if (collection.code.length == 0) vm.etch(collection, hex"00");
        (uint16 l0, uint16 l1, uint16 share, bool seat, bool enabled,) = shop.collections(collection);
        PawnShop.Collection memory config = PawnShop.Collection(l0, l1, share, seat, enabled, hash);
        uint256 start = vm.getBlockTimestamp();
        vm.prank(shop.owner());
        shop.queueCollection(collection, config);
        vm.warp(start + shop.DELAY());
        shop.executeCollection(collection, config);
        vm.warp(start);
    }
}
