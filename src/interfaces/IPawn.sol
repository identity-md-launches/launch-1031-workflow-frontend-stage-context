// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IPawnShop {
    function loanActive(uint256 loanId) external view returns (bool);
    function owner() external view returns (address);
    function oracleSigner() external view returns (address);
    function pawnToken() external view returns (address);
}

interface IDiscountModule {
    function pawnShop() external view returns (address);
    function pawnToken() external view returns (address);
    function commit(uint256 loanId, address borrower, uint256 baseFee) external returns (uint256 fee);
    function release(uint256 loanId) external;
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}
