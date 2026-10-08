// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {PawnShop} from "../src/PawnShop.sol";
import {MilestoneBurn} from "../src/MilestoneBurn.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {MockWETH} from "./helpers/Mocks.sol";
import {PawnTestBase} from "./helpers/PawnTestBase.sol";

/// @dev Test-only stand-in for the external factory. There is no production deploy/broadcast script.
contract FactoryFixture {
    LaunchToken public token;
    PawnShop public shop;
    MilestoneBurn public burnVault;

    constructor(address owner, address weth, address signer) {
        token = new LaunchToken();
        shop = new PawnShop(owner, address(token), weth, signer);
        burnVault = new MilestoneBurn(address(token), owner, signer, address(shop));
    }
}

contract DeploymentTest is PawnTestBase {
    function test_factoryDeploymentPreservesSupplyAndExplicitOwner() public {
        FactoryFixture factory = new FactoryFixture(owner, address(weth), vm.addr(KEY));
        assertEq(factory.token().balanceOf(address(factory)), 1e27);
        assertEq(factory.token().totalSupply(), 1e27);
        assertEq(factory.shop().owner(), owner);
        assertEq(factory.shop().lendingPool().owner(), owner);
        assertEq(factory.shop().lendingPool().pawnShop(), address(factory.shop()));
        assertTrue(factory.shop().newLoansPaused());
        assertEq(factory.burnVault().questionSetter(), owner);
        assertEq(factory.burnVault().questionHash(), bytes32(0));
    }

    function test_allRuntimeTypesMeetSizeAndForbiddenOpcodeFloor() public {
        uint256 id = _pawn(1, 0);
        MilestoneBurn burnVault = new MilestoneBurn(address(token), owner, vm.addr(KEY), address(shop));
        _check(address(token));
        _check(address(shop));
        _check(address(pool));
        _check(address(discount));
        _check(shop.getLoan(id).vault);
        _check(address(burnVault));
        // Init-code maximum imposed by EIP-3860, including the four static constructor arguments.
        assertLe(type(PawnShop).creationCode.length + 128, 49_152);
    }

    function _check(address target) private view {
        bytes memory code = target.code;
        assertGt(code.length, 0);
        assertLe(code.length, 24_576);
        for (uint256 j; j < code.length; ++j) {
            uint8 op = uint8(code[j]);
            if (op >= 0x60 && op <= 0x7f) {
                j += op - 0x5f;
                continue;
            }
            assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff, "forbidden project opcode");
        }
    }
}
