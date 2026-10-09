// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PawnTestBase} from "./helpers/PawnTestBase.sol";
import {PawnShop} from "src/PawnShop.sol";
import {CollateralVault} from "src/CollateralVault.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {PullPayments} from "src/PullPayments.sol";
import {MockNFT, RejectETH} from "./helpers/Mocks.sol";

contract VaultCustodyHandler is Test {
    PawnShop public shop;
    LaunchToken public token;
    MockNFT public nft;
    RejectETH public reject;
    address[3] public actors;
    CollateralVault[3] public vaults;
    uint256[3] public funded;
    uint256[3] public pending;
    uint256[3] public paid;
    uint256[3] public tokenFunding;
    uint256[3] public tokenPaid;
    bytes32[3] public digests;
    uint64[3] public expiry;
    PawnShop.Status[3] public states;
    address[3] public releasedTo;
    uint256 private nonce;

    constructor(PawnShop shop_, LaunchToken token_, MockNFT nft_) {
        shop = shop_;
        token = token_;
        nft = nft_;
        reject = new RejectETH();
        vm.deal(address(this), 10_000 ether);
        for (uint256 i; i < 3; ++i) {
            PawnShop.Loan memory loan = shop.getLoan(i + 1);
            actors[i] = loan.borrower;
            vaults[i] = CollateralVault(payable(loan.vault));
            states[i] = PawnShop.Status.Active;
        }
    }

    function fund(uint256 who, uint256 seed, bool native) external {
        uint256 i = who % 3;
        if (native) {
            uint256 amount = bound(seed, 1, 1 ether);
            (bool ok,) = address(vaults[i]).call{value: amount}("");
            assertTrue(ok);
            funded[i] += amount;
        } else {
            uint256 available = token.balanceOf(address(this));
            if (available == 0) return;
            uint256 amount = bound(seed, 1, available);
            token.transfer(address(vaults[i]), amount);
            tokenFunding[i] += amount;
        }
    }

    function withdraw(uint256 who, uint256 seed, bool native) external {
        uint256 i = who % 3;
        if (native) {
            uint256 amount = bound(seed, 0, funded[i] - paid[i] - pending[i]);
            vm.prank(actors[i]);
            vaults[i].withdrawETH(amount);
            pending[i] += amount;
        } else {
            uint256 amount = bound(seed, 0, tokenFunding[i] - tokenPaid[i]);
            vm.prank(actors[i]);
            vaults[i].withdrawToken(address(token), amount);
            tokenPaid[i] += amount;
        }
    }

    function claim(uint256 who, uint256 recipient, bool rejectPayment) external {
        uint256 i = who % 3;
        uint256 amount = pending[i];
        if (amount == 0) {
            vm.prank(actors[i]);
            vm.expectRevert(PullPayments.NothingToClaim.selector);
            vaults[i].claim(payable(actors[i]));
            return;
        }
        if (rejectPayment) {
            vm.prank(actors[i]);
            vm.expectRevert(PullPayments.ETHTransferFailed.selector);
            vaults[i].claim(payable(address(reject)));
        } else {
            address receiver = actors[recipient % 3];
            uint256 beforeETH = receiver.balance;
            vm.prank(actors[i]);
            assertEq(vaults[i].claim(payable(receiver)), amount);
            assertEq(receiver.balance - beforeETH, amount);
            pending[i] = 0;
            paid[i] += amount;
        }
    }

    function authorize(uint256 who, uint256 durationSeed) external {
        uint256 i = who % 3;
        CollateralVault.WorkerAuthorization memory m = CollateralVault.WorkerAuthorization({
            deviceKey: keccak256("invariant device"),
            wallet: address(vaults[i]),
            tokenId: i + 1,
            nonce: bytes32(++nonce),
            expiresAt: uint64(vm.getBlockTimestamp() + bound(durationSeed, 1, 30 days)),
            relayOrigin: "https://api.imd.fun"
        });
        vm.prank(actors[i]);
        if (states[i] != PawnShop.Status.Active) vm.expectRevert(CollateralVault.InactiveLoan.selector);
        vaults[i].authorizeWorker(m);
        if (states[i] == PawnShop.Status.Active) {
            digests[i] = vaults[i].workerAuthorizationDigest(m);
            expiry[i] = m.expiresAt;
        }
    }

    function revoke(uint256 who) external {
        uint256 i = who % 3;
        vm.prank(actors[i]);
        vaults[i].revokeWorker();
        digests[i] = bytes32(0);
        expiry[i] = 0;
    }

    function advance(uint256 seed) external {
        vm.warp(vm.getBlockTimestamp() + bound(seed, 0, 40 days));
    }

    function close(uint256 who, uint256 recipient, bool auction) external {
        uint256 i = who % 3;
        uint256 id = i + 1;
        PawnShop.Loan memory loan = shop.getLoan(id);
        if (states[i] == PawnShop.Status.Active) {
            if (auction) {
                if (vm.getBlockTimestamp() <= loan.due + 3 days) {
                    vm.expectRevert(PawnShop.GracePeriod.selector);
                    shop.startAuction(id);
                } else if (!shop.floorFresh(address(nft))) {
                    // Audit F1: auctions need a fresh floor.
                    vm.expectRevert(PawnShop.StaleFloor.selector);
                    shop.startAuction(id);
                } else {
                    shop.startAuction(id);
                    states[i] = PawnShop.Status.Auction;
                }
                return;
            }
            shop.repay{value: loan.principal}(id);
            states[i] = PawnShop.Status.Repaid;
            releasedTo[i] = actors[i];
        } else if (states[i] == PawnShop.Status.Auction) {
            uint256 price = shop.auctionPrice(id);
            address receiver = actors[recipient % 3];
            shop.buyAuction{value: price}(id, receiver);
            states[i] = PawnShop.Status.Sold;
            releasedTo[i] = receiver;
        } else {
            vm.expectRevert(PawnShop.InvalidLoan.selector);
            shop.repay{value: loan.principal}(id);
            return;
        }
        digests[i] = bytes32(0);
        expiry[i] = 0;
    }

    function rejectTheft(uint256 who) external {
        uint256 i = who % 3;
        address attacker = actors[(i + 1) % 3];
        vm.startPrank(attacker);
        vm.expectRevert(CollateralVault.Unauthorized.selector);
        vaults[i].withdrawETH(1);
        vm.expectRevert(CollateralVault.Unauthorized.selector);
        vaults[i].withdrawToken(address(token), 1);
        vm.expectRevert(CollateralVault.Unauthorized.selector);
        vaults[i].revokeWorker();
        vm.expectRevert(CollateralVault.Unauthorized.selector);
        vaults[i].release(attacker);
        vm.expectRevert(PullPayments.NothingToClaim.selector);
        vaults[i].claim(payable(attacker));
        vm.stopPrank();
        uint256 unavailable = funded[i] - paid[i] - pending[i] + 1;
        vm.prank(actors[i]);
        vm.expectRevert(PullPayments.NothingToClaim.selector);
        vaults[i].withdrawETH(unavailable);
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 80
/// forge-config: default.invariant.fail-on-revert = true
contract VaultCustodyInvariantTest is PawnTestBase {
    VaultCustodyHandler handler;

    function setUp() public override {
        super.setUp();
        address[3] memory borrowers = [alice, bob, buyer];
        for (uint256 i; i < 3; ++i) {
            nft.mint(borrowers[i], i + 1);
            vm.startPrank(borrowers[i]);
            nft.approve(address(shop), i + 1);
            shop.pawn(address(nft), i + 1, 1, 0, type(uint256).max);
            vm.stopPrank();
        }
        handler = new VaultCustodyHandler(shop, token, nft);
        token.transfer(address(handler), 100_000_000 ether);
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.fund.selector;
        selectors[1] = handler.withdraw.selector;
        selectors[2] = handler.claim.selector;
        selectors[3] = handler.authorize.selector;
        selectors[4] = handler.revoke.selector;
        selectors[5] = handler.advance.selector;
        selectors[6] = handler.close.selector;
        selectors[7] = handler.rejectTheft.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_vaultRewardsAndCreditsRemainBorrowerProperty() public view {
        uint256 totalTokens = token.balanceOf(address(handler));
        for (uint256 i; i < 3; ++i) {
            CollateralVault vault = handler.vaults(i);
            address borrower = handler.actors(i);
            assertEq(address(vault).balance, handler.funded(i) - handler.paid(i));
            assertEq(vault.totalClaimable(), handler.pending(i));
            assertEq(vault.claimable(borrower), handler.pending(i));
            assertLe(vault.totalClaimable(), address(vault).balance);
            assertEq(token.balanceOf(address(vault)), handler.tokenFunding(i) - handler.tokenPaid(i));
            assertEq(token.balanceOf(borrower), handler.tokenPaid(i));
            totalTokens += token.balanceOf(address(vault)) + token.balanceOf(borrower);
        }
        assertEq(totalTokens, 100_000_000 ether);
    }

    function invariant_custodyAndWorkerAuthorizationFollowTerminalState() public view {
        uint256 debt;
        for (uint256 i; i < 3; ++i) {
            CollateralVault vault = handler.vaults(i);
            PawnShop.Status status = handler.states(i);
            assertEq(uint256(shop.getLoan(i + 1).status), uint256(status));
            bool closed = status == PawnShop.Status.Repaid || status == PawnShop.Status.Sold;
            assertEq(vault.released(), closed);
            assertEq(nft.ownerOf(i + 1), closed ? handler.releasedTo(i) : address(vault));
            if (!closed) debt += 0.4 ether;
            bytes32 digest = handler.digests(i);
            bool valid =
                status == PawnShop.Status.Active && digest != bytes32(0) && block.timestamp <= handler.expiry(i);
            assertEq(vault.isValidSignature(digest, ""), valid ? bytes4(0x1626ba7e) : bytes4(0xffffffff));
            assertEq(vault.isValidSignature(keccak256("unregistered sell order"), ""), bytes4(0xffffffff));
        }
        assertEq(pool.totalBorrowed(), debt);
        assertEq(shop.collectionDebt(address(nft)), debt);
        assertEq(address(shop).balance, shop.totalClaimable() + shop.bountyReserve());
    }

    function afterInvariant() public {
        for (uint256 i; i < 3; ++i) {
            handler.close(i, i, false);
            handler.withdraw(i, handler.funded(i) - handler.paid(i) - handler.pending(i), true);
            handler.claim(i, i, false);
            handler.withdraw(i, handler.tokenFunding(i) - handler.tokenPaid(i), false);
            assertEq(address(handler.vaults(i)).balance, 0);
            assertEq(token.balanceOf(address(handler.vaults(i))), 0);
        }
        invariant_vaultRewardsAndCreditsRemainBorrowerProperty();
        invariant_custodyAndWorkerAuthorizationFollowTerminalState();
        assertEq(pool.totalBorrowed(), 0);
    }
}
