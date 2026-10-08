// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

abstract contract PullPayments is ReentrancyGuard {
    error InvalidRecipient();
    error NothingToClaim();
    error ETHTransferFailed();

    mapping(address => uint256) public claimable;
    uint256 public totalClaimable;

    event Credited(address indexed account, uint256 amount);
    event Claimed(address indexed account, address indexed receiver, uint256 amount);

    function _credit(address account, uint256 amount) internal {
        if (amount == 0) return;
        claimable[account] += amount;
        totalClaimable += amount;
        emit Credited(account, amount);
    }

    /// @notice Pull only your own credit; redirect it if your wallet cannot receive ETH.
    function claim(address payable receiver) external nonReentrant returns (uint256 amount) {
        if (receiver == address(0)) revert InvalidRecipient();
        amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        delete claimable[msg.sender];
        totalClaimable -= amount;
        (bool ok,) = receiver.call{value: amount}("");
        if (!ok) revert ETHTransferFailed();
        emit Claimed(msg.sender, receiver, amount);
    }
}
