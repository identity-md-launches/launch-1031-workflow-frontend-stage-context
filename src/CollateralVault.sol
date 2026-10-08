// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {PullPayments} from "./PullPayments.sol";
import {IPawnShop} from "./interfaces/IPawn.sol";

/// @notice A standalone vault per loan; no proxy, delegatecall, approvals, or owner escape hatch.
contract CollateralVault is IERC721Receiver, PullPayments {
    using SafeERC20 for IERC20;

    error Unauthorized();
    error AlreadyInitialized();
    error InactiveLoan();
    error InvalidAuthorization();
    error ForbiddenTarget();
    error CallFailed();
    error CollateralMissing();
    error UnexpectedNFT();

    bytes32 public constant WORKER_TYPEHASH = keccak256(
        "WorkerAuthorization(bytes32 deviceKey,address wallet,uint256 tokenId,bytes32 nonce,uint64 expiresAt,string relayOrigin)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    address public immutable pawnShop;
    address public borrower;
    address public collection;
    address public lendingPool;
    uint256 public tokenId;
    uint256 public loanId;
    bool public isSeat;
    bool public initialized;
    bool public released;
    bytes32 public workerDigest;
    uint64 public workerExpiresAt;

    struct WorkerAuthorization {
        bytes32 deviceKey;
        address wallet;
        uint256 tokenId;
        bytes32 nonce;
        uint64 expiresAt;
        string relayOrigin;
    }

    event Initialized(address indexed borrower, address indexed collection, uint256 indexed tokenId, uint256 loanId);
    event WorkerAuthorized(bytes32 indexed digest, uint64 expiresAt);
    event WorkerRevoked();
    event Called(address indexed target, bytes4 selector);
    event Released(address indexed receiver);
    event CollateralUnavailable(address indexed collection, uint256 indexed tokenId);
    event TokenWithdrawn(address indexed token, uint256 amount);

    constructor() {
        pawnShop = msg.sender;
    }

    modifier onlyBorrower() {
        if (msg.sender != borrower) revert Unauthorized();
        _;
    }

    function initialize(
        address borrower_,
        address collection_,
        uint256 tokenId_,
        uint256 loanId_,
        address pool_,
        bool seat_
    ) external {
        if (msg.sender != pawnShop) revert Unauthorized();
        if (initialized) revert AlreadyInitialized();
        if (borrower_ == address(0) || collection_ == address(0) || pool_ == address(0)) revert InvalidRecipient();
        initialized = true;
        borrower = borrower_;
        collection = collection_;
        tokenId = tokenId_;
        loanId = loanId_;
        lendingPool = pool_;
        isSeat = seat_;
        emit Initialized(borrower_, collection_, tokenId_, loanId_);
    }

    function workerAuthorizationDigest(WorkerAuthorization calldata m) public view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("IdentityMD Worker"), keccak256("2"), block.chainid, collection)
        );
        bytes32 message = keccak256(
            abi.encode(
                WORKER_TYPEHASH, m.deviceKey, m.wallet, m.tokenId, m.nonce, m.expiresAt, keccak256(bytes(m.relayOrigin))
            )
        );
        return MessageHashUtils.toTypedDataHash(domain, message);
    }

    function authorizeWorker(WorkerAuthorization calldata m) external onlyBorrower {
        _requireActive();
        if (
            !isSeat || m.wallet != address(this) || m.tokenId != tokenId || m.deviceKey == bytes32(0)
                || m.nonce == bytes32(0) || m.expiresAt <= block.timestamp || bytes(m.relayOrigin).length == 0
                || bytes(m.relayOrigin).length > 256
        ) revert InvalidAuthorization();
        workerDigest = workerAuthorizationDigest(m);
        workerExpiresAt = m.expiresAt;
        emit WorkerAuthorized(workerDigest, m.expiresAt);
    }

    function revokeWorker() external onlyBorrower {
        delete workerDigest;
        delete workerExpiresAt;
        emit WorkerRevoked();
    }

    function isValidSignature(bytes32 hash, bytes calldata) external view returns (bytes4) {
        if (
            !isSeat || released || workerDigest == bytes32(0) || hash != workerDigest
                || block.timestamp > workerExpiresAt || !IPawnShop(pawnShop).loanActive(loanId)
                || IERC721(collection).ownerOf(tokenId) != address(this)
        ) return 0xffffffff;
        return 0x1626ba7e;
    }

    function callFor(address target, bytes calldata data)
        external
        onlyBorrower
        nonReentrant
        returns (bytes memory result)
    {
        _requireActive();
        if (
            target == collection || target == pawnShop || target == lendingPool || target == address(this)
                || target.code.length == 0
        ) revert ForbiddenTarget();
        bool ok;
        (ok, result) = target.call(data);
        if (!ok) revert CallFailed();
        if (IERC721(collection).ownerOf(tokenId) != address(this)) revert CollateralMissing();
        emit Called(target, bytes4(data));
    }

    /// @notice Move free ETH to a pull credit; this remains available after the NFT leaves.
    function withdrawETH(uint256 amount) external onlyBorrower nonReentrant {
        if (amount > address(this).balance - totalClaimable) revert NothingToClaim();
        _credit(borrower, amount);
    }

    function withdrawToken(address token, uint256 amount) external onlyBorrower nonReentrant {
        if (token == collection) revert ForbiddenTarget();
        IERC20(token).safeTransfer(borrower, amount);
        if (!released && IERC721(collection).ownerOf(tokenId) != address(this)) revert CollateralMissing();
        emit TokenWithdrawn(token, amount);
    }

    function release(address receiver) external nonReentrant {
        if (msg.sender != pawnShop) revert Unauthorized();
        if (released) revert InactiveLoan();
        released = true;
        delete workerDigest;
        delete workerExpiresAt;
        // Plain transfer avoids letting a recipient's callback hold a repayment hostage.
        if (holdsCollateral()) IERC721(collection).transferFrom(address(this), receiver, tokenId);
        else emit CollateralUnavailable(collection, tokenId);
        emit Released(receiver);
    }

    /// @notice Collection revocation or burning must not prevent financial settlement.
    function holdsCollateral() public view returns (bool) {
        try IERC721(collection).ownerOf(tokenId) returns (address holder) {
            return holder == address(this);
        } catch {
            return false;
        }
    }

    function _requireActive() private view {
        if (released || !IPawnShop(pawnShop).loanActive(loanId)) revert InactiveLoan();
        if (IERC721(collection).ownerOf(tokenId) != address(this)) revert CollateralMissing();
    }

    function onERC721Received(address operator, address, uint256 id, bytes calldata) external view returns (bytes4) {
        if (!initialized || released || msg.sender != collection || id != tokenId || operator != pawnShop) {
            revert UnexpectedNFT();
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}
