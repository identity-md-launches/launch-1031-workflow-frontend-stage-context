// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice The largest open commitment is locked, rather than the sum of commitments.
contract LockDiscount is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error Unauthorized();
    error InvalidAmount();
    error Committed();
    error InvalidLoan();

    address public immutable pawnToken;
    address public immutable pawnShop;
    mapping(address => uint256) public locked;
    mapping(address => mapping(uint8 => uint256)) public tierCount;

    struct Commitment {
        address borrower;
        uint8 tier;
    }
    mapping(uint256 => Commitment) public commitments;

    event Locked(address indexed borrower, uint256 amount);
    event Unlocked(address indexed borrower, uint256 amount);
    event CommittedTier(uint256 indexed loanId, address indexed borrower, uint8 tier);
    event Released(uint256 indexed loanId);

    constructor(address token_, address shop_) {
        if (token_ == address(0) || shop_ == address(0)) revert Unauthorized();
        pawnToken = token_;
        pawnShop = shop_;
    }

    modifier onlyShop() {
        if (msg.sender != pawnShop) revert Unauthorized();
        _;
    }

    function tierAmount(uint8 tier) public pure returns (uint256) {
        if (tier == 3) return 20_000_000 ether;
        if (tier == 2) return 5_000_000 ether;
        if (tier == 1) return 1_000_000 ether;
        return 0;
    }

    function tierOf(address borrower) public view returns (uint8) {
        uint256 amount = locked[borrower];
        if (amount >= tierAmount(3)) return 3;
        if (amount >= tierAmount(2)) return 2;
        if (amount >= tierAmount(1)) return 1;
        return 0;
    }

    function committed(address borrower) public view returns (uint256) {
        for (uint8 i = 3; i > 0; --i) {
            if (tierCount[borrower][i] != 0) return tierAmount(i);
        }
        return 0;
    }

    function unlockable(address borrower) external view returns (uint256) {
        return locked[borrower] - committed(borrower);
    }

    function lock(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        locked[msg.sender] += amount;
        IERC20(pawnToken).safeTransferFrom(msg.sender, address(this), amount);
        emit Locked(msg.sender, amount);
    }

    function unlock(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (amount > locked[msg.sender] - committed(msg.sender)) revert Committed();
        locked[msg.sender] -= amount;
        IERC20(pawnToken).safeTransfer(msg.sender, amount);
        emit Unlocked(msg.sender, amount);
    }

    function commit(uint256 loanId, address borrower, uint256 baseFee) external onlyShop returns (uint256) {
        Commitment memory old = commitments[loanId];
        if (borrower == address(0) || (old.borrower != address(0) && old.borrower != borrower)) revert InvalidLoan();
        if (old.tier != 0) --tierCount[borrower][old.tier];
        uint8 tier = tierOf(borrower);
        commitments[loanId] = Commitment(borrower, tier);
        if (tier != 0) ++tierCount[borrower][tier];
        uint256 discount = tier == 3 ? 5000 : tier == 2 ? 3333 : tier == 1 ? 2000 : 0;
        emit CommittedTier(loanId, borrower, tier);
        return Math.mulDiv(baseFee, 10_000 - discount, 10_000, Math.Rounding.Ceil);
    }

    function release(uint256 loanId) external onlyShop {
        Commitment memory c = commitments[loanId];
        if (c.borrower == address(0)) revert InvalidLoan();
        delete commitments[loanId];
        if (c.tier != 0) --tierCount[c.borrower][c.tier];
        emit Released(loanId);
    }
}
