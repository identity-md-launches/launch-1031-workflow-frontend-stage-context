// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PullPayments} from "./PullPayments.sol";
import {IWETH} from "./interfaces/IPawn.sol";

/// @notice WETH shares backed by idle WETH and outstanding principal, less segregated funds.
contract LendingPool is ERC4626, Ownable2Step, PullPayments {
    error OnlyPawnShop();
    error InvalidAmount();
    error InsufficientIdle();
    error CapExceeded();
    error TimelockPending();
    error DirectETHDisabled();
    error RenounceDisabled();

    uint256 public constant DELAY = 48 hours;
    uint256 public constant VESTING = 7 days;
    address public immutable pawnShop;
    uint256 public totalBorrowed;
    uint256 public shortfallReserve;
    uint256 public depositCap = 10 ether;
    uint256 public pendingCap;
    uint256 public pendingCapAt;
    uint256 public cumulativeLoanFees;
    uint256 public cumulativeDonations;
    uint256 public cumulativeLoss;

    struct DonationCheckpoint {
        uint64 start;
        uint256 cumulativeAmount;
        uint256 cumulativeUnlockWeight;
    }
    DonationCheckpoint[] public donationCheckpoints;

    event Borrowed(uint256 amount);
    event Settled(uint256 principal, uint256 paid, uint256 reserveUsed, uint256 loss);
    event FeeReceived(uint256 amount);
    event ReserveAdded(uint256 amount);
    event Donated(address indexed donor, uint256 amount, uint256 slot);
    event CapQueued(uint256 cap, uint256 executableAt);
    event CapRaised(uint256 cap);

    constructor(address owner_, address weth_, address shop_)
        ERC20("Pawn Lending Share", "pETH")
        ERC4626(IERC20(weth_))
        Ownable(owner_)
    {
        if (weth_ == address(0) || shop_ == address(0)) revert InvalidRecipient();
        pawnShop = shop_;
    }

    modifier onlyShop() {
        if (msg.sender != pawnShop) revert OnlyPawnShop();
        _;
    }

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function donationCount() external view returns (uint256) {
        return donationCheckpoints.length;
    }

    /// @notice Sum independent linear tranches with a binary search over cumulative checkpoints.
    /// @dev Dust cannot reset vesting or exhaust a fixed queue. Lookup cost is logarithmic.
    function unvestedDonations() public view returns (uint256) {
        uint256 count = donationCheckpoints.length;
        if (count == 0) return 0;
        uint256 low;
        uint256 high = count;
        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (uint256(donationCheckpoints[mid].start) + VESTING <= block.timestamp) low = mid + 1;
            else high = mid;
        }
        if (low == count) return 0;
        DonationCheckpoint memory last = donationCheckpoints[count - 1];
        uint256 amount = last.cumulativeAmount;
        uint256 weight = last.cumulativeUnlockWeight;
        if (low != 0) {
            DonationCheckpoint memory expired = donationCheckpoints[low - 1];
            amount -= expired.cumulativeAmount;
            weight -= expired.cumulativeUnlockWeight;
        }
        return Math.ceilDiv(weight - amount * block.timestamp, VESTING);
    }

    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + totalBorrowed - shortfallReserve - unvestedDonations();
    }

    function idleAssets() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) - shortfallReserve - unvestedDonations();
    }

    function maxDeposit(address) public view override returns (uint256) {
        uint256 assets = totalAssets();
        return assets >= depositCap ? 0 : depositCap - assets;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return convertToShares(maxDeposit(receiver));
    }

    function maxWithdraw(address account) public view override returns (uint256) {
        return Math.min(super.maxWithdraw(account), idleAssets());
    }

    function maxRedeem(address account) public view override returns (uint256) {
        return Math.min(balanceOf(account), convertToShares(idleAssets()));
    }

    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256) {
        if (assets == 0 || previewDeposit(assets) == 0) revert InvalidAmount();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256) {
        if (shares == 0) revert InvalidAmount();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address account)
        public
        override
        nonReentrant
        returns (uint256)
    {
        return super.withdraw(assets, receiver, account);
    }

    function redeem(uint256 shares, address receiver, address account) public override nonReentrant returns (uint256) {
        return super.redeem(shares, receiver, account);
    }

    function depositETH(address receiver) external payable nonReentrant returns (uint256 shares) {
        if (msg.value == 0) revert InvalidAmount();
        if (msg.value > maxDeposit(receiver)) revert CapExceeded();
        shares = previewDeposit(msg.value);
        if (shares == 0) revert InvalidAmount();
        IWETH(asset()).deposit{value: msg.value}();
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, msg.value, shares);
    }

    function withdrawETH(uint256 assets, address receiver, address account)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (assets > maxWithdraw(account)) revert InsufficientIdle();
        shares = previewWithdraw(assets);
        _withdrawNative(assets, shares, receiver, account);
    }

    function redeemETH(uint256 shares, address receiver, address account)
        external
        nonReentrant
        returns (uint256 assets)
    {
        if (shares > maxRedeem(account)) revert InsufficientIdle();
        assets = previewRedeem(shares);
        _withdrawNative(assets, shares, receiver, account);
    }

    function _withdrawNative(uint256 assets, uint256 shares, address receiver, address account) private {
        if (receiver == address(0)) revert InvalidRecipient();
        if (assets == 0) revert InvalidAmount();
        if (msg.sender != account) _spendAllowance(account, msg.sender, shares);
        _burn(account, shares);
        IWETH(asset()).withdraw(assets);
        _credit(receiver, assets);
        emit Withdraw(msg.sender, receiver, account, assets, shares);
    }

    function borrow(uint256 amount) external onlyShop nonReentrant {
        if (amount > idleAssets()) revert InsufficientIdle();
        totalBorrowed += amount;
        IWETH(asset()).withdraw(amount);
        (bool ok,) = pawnShop.call{value: amount}("");
        if (!ok) revert ETHTransferFailed();
        emit Borrowed(amount);
    }

    /// @notice On auction loss the reserve changes classification, making it available to shares.
    function settle(uint256 principal) external payable onlyShop nonReentrant {
        if (msg.value > principal || principal > totalBorrowed) revert InvalidAmount();
        uint256 gap = principal - msg.value;
        uint256 covered = Math.min(gap, shortfallReserve);
        shortfallReserve -= covered;
        totalBorrowed -= principal;
        cumulativeLoss += gap - covered;
        if (msg.value != 0) IWETH(asset()).deposit{value: msg.value}();
        emit Settled(principal, msg.value, covered, gap - covered);
    }

    function receiveFee() external payable onlyShop nonReentrant {
        cumulativeLoanFees += msg.value;
        IWETH(asset()).deposit{value: msg.value}();
        emit FeeReceived(msg.value);
    }

    function addReserve() external payable onlyShop nonReentrant {
        shortfallReserve += msg.value;
        IWETH(asset()).deposit{value: msg.value}();
        emit ReserveAdded(msg.value);
    }

    function donate() external payable nonReentrant {
        if (msg.value == 0 || msg.value > type(uint128).max || block.timestamp > type(uint64).max) {
            revert InvalidAmount();
        }
        uint256 count = donationCheckpoints.length;
        uint256 amount = msg.value;
        uint256 weight = msg.value * (block.timestamp + VESTING);
        if (count != 0) {
            DonationCheckpoint storage last = donationCheckpoints[count - 1];
            amount += last.cumulativeAmount;
            weight += last.cumulativeUnlockWeight;
            if (last.start == block.timestamp) {
                last.cumulativeAmount = amount;
                last.cumulativeUnlockWeight = weight;
            } else {
                donationCheckpoints.push(DonationCheckpoint(uint64(block.timestamp), amount, weight));
            }
        } else {
            donationCheckpoints.push(DonationCheckpoint(uint64(block.timestamp), amount, weight));
        }
        cumulativeDonations += msg.value;
        IWETH(asset()).deposit{value: msg.value}();
        emit Donated(msg.sender, msg.value, donationCheckpoints.length - 1);
    }

    function queueDepositCap(uint256 cap) external onlyOwner {
        if (cap <= depositCap) revert InvalidAmount();
        pendingCap = cap;
        pendingCapAt = block.timestamp + DELAY;
        emit CapQueued(cap, pendingCapAt);
    }

    function executeDepositCap() external {
        if (pendingCapAt == 0 || block.timestamp < pendingCapAt) revert TimelockPending();
        depositCap = pendingCap;
        delete pendingCap;
        delete pendingCapAt;
        emit CapRaised(depositCap);
    }

    receive() external payable {
        if (msg.sender != asset()) revert DirectETHDisabled();
    }
}
