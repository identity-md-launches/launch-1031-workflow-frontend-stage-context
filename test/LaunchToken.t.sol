// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";

contract LaunchTokenTest is Test {
    function test_supplyMetadataAndTransfer() public {
        LaunchToken token = new LaunchToken();
        assertEq(token.name(), "Pawn");
        assertEq(token.symbol(), "PAWN");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(this)), 1e27);
        address recipient = makeAddr("recipient");
        token.transfer(recipient, 123 ether);
        assertEq(token.balanceOf(recipient), 123 ether);
        assertEq(token.balanceOf(address(this)), 1e27 - 123 ether);
        (bool ok,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", recipient, 1 ether));
        assertFalse(ok);
        assertEq(token.totalSupply(), 1e27);
        vm.prank(recipient);
        vm.expectRevert();
        token.transfer(address(this), 124 ether);
    }

    function testFuzz_exactTransfers(uint256 amount) public {
        LaunchToken token = new LaunchToken();
        amount = bound(amount, 0, 1e27);
        address recipient = makeAddr("recipient");
        token.transfer(recipient, amount);
        assertEq(token.balanceOf(recipient), amount);
        assertEq(token.balanceOf(address(this)) + token.balanceOf(recipient), token.totalSupply());
    }
}
