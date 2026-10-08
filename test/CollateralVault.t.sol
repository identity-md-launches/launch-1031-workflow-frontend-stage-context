// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PawnTestBase} from "./helpers/PawnTestBase.sol";
import {PawnShop} from "../src/PawnShop.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {RewardTarget, MockNFT} from "./helpers/Mocks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CollateralVaultTest is PawnTestBase {
    function _message(CollateralVault vault) private view returns (CollateralVault.WorkerAuthorization memory) {
        return CollateralVault.WorkerAuthorization(
            keccak256("test device"),
            address(vault),
            1,
            keccak256("test pairing nonce"),
            uint64(vm.getBlockTimestamp() + 15 minutes),
            "https://api.imd.fun"
        );
    }

    function test_onlyRegisteredTypedWorkerDigestValidAndExpires() public {
        uint256 id = _pawn(1, 0);
        CollateralVault vault = CollateralVault(payable(shop.getLoan(id).vault));
        CollateralVault.WorkerAuthorization memory m = _message(vault);
        bytes32 digest = vault.workerAuthorizationDigest(m);
        assertEq(vault.isValidSignature(digest, ""), bytes4(0xffffffff));
        vm.prank(alice);
        vault.authorizeWorker(m);
        assertEq(vault.isValidSignature(digest, ""), bytes4(0x1626ba7e));
        assertEq(vault.isValidSignature(keccak256("NFT sell order"), ""), bytes4(0xffffffff));
        m.nonce = keccak256("other pairing");
        assertEq(vault.isValidSignature(vault.workerAuthorizationDigest(m), ""), bytes4(0xffffffff));
        vm.warp(vm.getBlockTimestamp() + 15 minutes + 1);
        assertEq(vault.isValidSignature(digest, ""), bytes4(0xffffffff));
    }

    function test_revokeAndCloseDisableAuthorization() public {
        uint256 id = _pawn(1, 0);
        CollateralVault vault = CollateralVault(payable(shop.getLoan(id).vault));
        CollateralVault.WorkerAuthorization memory m = _message(vault);
        vm.prank(alice);
        vault.authorizeWorker(m);
        bytes32 digest = vault.workerDigest();
        vm.prank(alice);
        vault.revokeWorker();
        assertEq(vault.isValidSignature(digest, ""), bytes4(0xffffffff));
        vm.prank(alice);
        vault.authorizeWorker(m);
        shop.repay{value: 0.4 ether}(id);
        assertEq(vault.isValidSignature(digest, ""), bytes4(0xffffffff));
        vm.prank(alice);
        vm.expectRevert(CollateralVault.InactiveLoan.selector);
        vault.authorizeWorker(m);
    }

    function test_authorizationCannotNameBorrowerOtherTokenOrNonSeat() public {
        uint256 id = _pawn(1, 0);
        CollateralVault vault = CollateralVault(payable(shop.getLoan(id).vault));
        CollateralVault.WorkerAuthorization memory m = _message(vault);
        vm.expectRevert(CollateralVault.Unauthorized.selector);
        vault.authorizeWorker(m);
        m.wallet = alice;
        vm.prank(alice);
        vm.expectRevert(CollateralVault.InvalidAuthorization.selector);
        vault.authorizeWorker(m);
        m.wallet = address(vault);
        m.tokenId = 2;
        vm.prank(alice);
        vm.expectRevert(CollateralVault.InvalidAuthorization.selector);
        vault.authorizeWorker(m);

        // Governance's non-seat flag is snapshotted in the vault; it never authorizes workers.
        CollateralVault nonSeat = new CollateralVault();
        nonSeat.initialize(alice, address(nft), 1, id, address(pool), false);
        m.wallet = address(nonSeat);
        m.tokenId = 1;
        assertEq(nonSeat.isValidSignature(nonSeat.workerAuthorizationDigest(m), ""), bytes4(0xffffffff));
    }

    function test_callForRewardsWithdrawalsAndBlockedTargets() public {
        uint256 id = _pawn(1, 0);
        CollateralVault vault = CollateralVault(payable(shop.getLoan(id).vault));
        RewardTarget rewards = new RewardTarget();
        token.transfer(address(rewards), 100 ether);
        vm.prank(alice);
        vault.callFor(address(rewards), abi.encodeCall(rewards.reward, (IERC20(address(token)), 100 ether)));
        assertEq(token.balanceOf(address(vault)), 100 ether);
        vm.prank(alice);
        vault.withdrawToken(address(token), 100 ether);
        assertEq(token.balanceOf(alice), 100 ether);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertTrue(ok);
        vm.prank(alice);
        vault.withdrawETH(1 ether);
        vm.prank(alice);
        vault.claim(payable(alice));
        assertEq(address(vault).balance, 0);
        address[4] memory targets = [address(nft), address(shop), address(pool), address(vault)];
        for (uint256 i; i < 4; ++i) {
            vm.prank(alice);
            vm.expectRevert(CollateralVault.ForbiddenTarget.selector);
            vault.callFor(targets[i], "");
        }
        vm.prank(alice);
        vm.expectRevert(CollateralVault.CallFailed.selector);
        vault.callFor(address(rewards), abi.encodeCall(rewards.fail, ()));
        assertEq(nft.ownerOf(1), address(vault));
    }

    function test_indirectCollateralRemovalRollsBackAndNFTOnlyLeavesViaShop() public {
        uint256 id = _pawn(1, 0);
        CollateralVault vault = CollateralVault(payable(shop.getLoan(id).vault));
        RewardTarget evil = new RewardTarget();
        vm.prank(alice);
        vm.expectRevert(CollateralVault.CollateralMissing.selector);
        vault.callFor(address(evil), abi.encodeCall(evil.steal, (nft, 1)));
        assertEq(nft.ownerOf(1), address(vault));
        vm.prank(alice);
        vm.expectRevert(CollateralVault.Unauthorized.selector);
        vault.release(alice);
        vm.prank(alice);
        vm.expectRevert(CollateralVault.ForbiddenTarget.selector);
        vault.withdrawToken(address(nft), 1);
        vm.prank(address(shop));
        vm.expectRevert(CollateralVault.AlreadyInitialized.selector);
        vault.initialize(alice, address(nft), 1, id, address(pool), true);
        MockNFT other = new MockNFT();
        other.mint(alice, 9);
        vm.prank(alice);
        vm.expectRevert(CollateralVault.UnexpectedNFT.selector);
        other.safeTransferFrom(alice, address(vault), 9);
    }

    function test_auctionStopsCallsButBorrowerRetainsRewardWithdrawals() public {
        uint256 id = _pawn(1, 0);
        CollateralVault vault = CollateralVault(payable(shop.getLoan(id).vault));
        RewardTarget rewards = new RewardTarget();
        token.transfer(address(vault), 1 ether);
        vm.warp(shop.getLoan(id).due + 4 days);
        shop.startAuction(id);
        vm.prank(alice);
        vm.expectRevert(CollateralVault.InactiveLoan.selector);
        vault.callFor(address(rewards), "");
        vm.prank(alice);
        vault.withdrawToken(address(token), 1 ether);
        assertEq(token.balanceOf(alice), 1 ether);
    }
}
