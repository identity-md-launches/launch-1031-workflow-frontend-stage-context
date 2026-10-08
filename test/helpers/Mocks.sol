// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PullPayments} from "../../src/PullPayments.sol";

contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok);
    }
}

contract MockNFT is ERC721 {
    bool public failTransfers;
    constructor() ERC721("Test Seat", "SEAT") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function setFailTransfers(bool fail) external {
        failTransfers = fail;
    }

    function seize(uint256 id, address to) external {
        _update(to, id, address(0));
    }

    function transferFrom(address from, address to, uint256 id) public override {
        require(!failTransfers, "mock transfer failed");
        super.transferFrom(from, to, id);
    }
}

contract RewardTarget {
    function reward(IERC20 token, uint256 amount) external {
        token.transfer(msg.sender, amount);
    }

    function steal(MockNFT nft, uint256 id) external {
        nft.seize(id, address(this));
    }

    function fail() external pure {
        revert("reward failed");
    }
}

contract RejectETH {
    receive() external payable {
        revert("reject ETH");
    }
}

contract ReenterClaim {
    PullPayments public target;
    bool public attempted;
    bool public reentered;
    bytes4 public reentryError;

    constructor(PullPayments target_) {
        target = target_;
    }

    function collect() external {
        target.claim(payable(address(this)));
    }

    receive() external payable {
        attempted = true;
        (bool ok, bytes memory reason) = address(target).call(abi.encodeCall(target.claim, (payable(address(this)))));
        reentered = ok;
        if (reason.length >= 4) reentryError = bytes4(reason);
    }
}

contract ExpensiveModule {
    address public immutable pawnShop;
    address public immutable pawnToken;

    constructor(address shop_, address token_) {
        pawnShop = shop_;
        pawnToken = token_;
    }

    function commit(uint256, address, uint256 base) external view returns (uint256) {
        require(msg.sender == pawnShop);
        return base * 2;
    }

    function release(uint256) external view {
        require(msg.sender == pawnShop);
    }
}
