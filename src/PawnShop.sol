// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {OracleAttestation, OracleAttestationConsumer} from "./OracleAttestation.sol";
import {PullPayments} from "./PullPayments.sol";
import {LendingPool} from "./LendingPool.sol";
import {LockDiscount} from "./LockDiscount.sol";
import {CollateralVault} from "./CollateralVault.sol";
import {IDiscountModule} from "./interfaces/IPawn.sol";

/// @notice Fixed principal, no mark-to-market liquidation, permissionless expiry auctions.
contract PawnShop is Ownable2Step, PullPayments, OracleAttestationConsumer {
    error Paused();
    error InvalidConfiguration();
    error NotConfigured();
    error TimelockPending();
    error CollectionDisabled();
    error InvalidTerm();
    error StaleFloor();
    error InvalidAttestation();
    error LoanTooSmall();
    error ShareExceeded();
    error InvalidLoan();
    error Unauthorized();
    error IncorrectPayment();
    error GracePeriod();
    error NotAuctioning();
    error RenounceDisabled();

    address public constant IDENTITY_COLLECTION = 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D;
    uint256 public constant DELAY = 48 hours;
    uint256 public constant FLOOR_MAX_AGE = 26 hours;
    uint256 public constant FLOOR_BOUNTY_INTERVAL = 24 hours;
    uint256 public constant GRACE = 3 days;
    uint256 public constant MIN_LOAN = 0.01 ether;
    uint256 public constant BOUNTY_TARGET = 0.2 ether;
    uint256 public constant FLOOR_BOUNTY = 0.001 ether;
    uint256 public constant AUCTION_BOUNTY = 0.002 ether;

    LendingPool public immutable lendingPool;
    address public immutable pawnToken;
    address public discountModule;
    address public feeRecipient;
    bool public newLoansPaused = true;
    uint256 public nextLoanId = 1;
    uint256 public bountyReserve;

    struct Term {
        uint32 duration;
        uint16 feeBps;
    }
    Term[2] public terms;

    struct Collection {
        uint16 maxLoanBps0;
        uint16 maxLoanBps1;
        uint16 maxShareBps;
        bool isSeat;
        bool enabled;
        bytes32 questionHash;
    }

    struct Floor {
        uint256 price;
        uint64 issuedAt;
        uint64 expiresAt;
        uint64 lastBountyAt;
    }
    enum Status {
        None,
        Active,
        Auction,
        Repaid,
        Sold
    }

    struct Loan {
        address borrower;
        address collection;
        address vault;
        address module;
        uint256 tokenId;
        uint256 principal;
        uint256 due;
        uint256 auctionStarted;
        uint256 auctionFloor;
        Status status;
        Term[2] savedTerms;
    }
    mapping(address => Collection) public collections;
    mapping(address => Floor) public floors;
    mapping(address => uint256) public collectionDebt;
    mapping(uint256 => Loan) private _loans;
    mapping(bytes32 => uint256) public queuedAt;

    event PauseChanged(bool paused);
    event ChangeQueued(bytes32 indexed operation, uint256 executableAt);
    event ChangeCancelled(bytes32 indexed operation);
    event TermSet(uint8 indexed termId, uint32 duration, uint16 feeBps);
    event CollectionSet(address indexed collection, Collection config);
    event CollectionDisabledNow(address indexed collection);
    event QuestionHashSet(address indexed collection, bytes32 questionHash);
    event FeeRecipientSet(address indexed recipient);
    event DiscountModuleSet(address indexed module);
    event FloorSubmitted(address indexed collection, uint256 price, uint64 issuedAt, uint64 expiresAt);
    event Pawned(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed collection,
        uint256 tokenId,
        address vault,
        uint256 principal,
        uint256 fee,
        uint256 due
    );
    event Repaid(uint256 indexed loanId);
    event Extended(uint256 indexed loanId, uint8 termId, uint256 fee, uint256 due);
    event AuctionStarted(uint256 indexed loanId, uint256 floor, uint256 timestamp);
    event AuctionBought(uint256 indexed loanId, address indexed buyer, address indexed receiver, uint256 price);
    event BountyFunded(address indexed sender, uint256 amount);

    /// @dev Child contracts bind this shop in their constructors, avoiding circular manifest references.
    constructor(address owner_, address token_, address weth_, address attester_)
        Ownable(owner_)
        OracleAttestationConsumer(attester_)
    {
        if (token_ == address(0) || weth_ == address(0)) revert InvalidConfiguration();
        pawnToken = token_;
        feeRecipient = owner_;
        lendingPool = new LendingPool(owner_, weth_, address(this));
        discountModule = address(new LockDiscount(token_, address(this)));
        terms[0] = Term(30 days, 300);
        terms[1] = Term(7 days, 100);
        collections[IDENTITY_COLLECTION] = Collection(4000, 4000, 10000, true, true, bytes32(0));
    }

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    function getLoan(uint256 id) external view returns (Loan memory) {
        return _loans[id];
    }

    function loanActive(uint256 id) external view returns (bool) {
        return _loans[id].status == Status.Active;
    }

    function setNewLoansPaused(bool paused_) external onlyOwner {
        newLoansPaused = paused_;
        emit PauseChanged(paused_);
    }

    function _queue(bytes32 op) private {
        queuedAt[op] = block.timestamp + DELAY;
        emit ChangeQueued(op, queuedAt[op]);
    }

    function _execute(bytes32 op) private {
        if (queuedAt[op] == 0 || block.timestamp < queuedAt[op]) revert TimelockPending();
        delete queuedAt[op];
    }

    function cancelChange(bytes32 op) external onlyOwner {
        delete queuedAt[op];
        emit ChangeCancelled(op);
    }

    function queueTerm(uint8 id, uint32 duration, uint16 feeBps) external onlyOwner {
        _validateTerm(id, duration, feeBps);
        _queue(keccak256(abi.encode("term", id, duration, feeBps)));
    }

    function executeTerm(uint8 id, uint32 duration, uint16 feeBps) external {
        _execute(keccak256(abi.encode("term", id, duration, feeBps)));
        terms[id] = Term(duration, feeBps);
        emit TermSet(id, duration, feeBps);
    }

    function _validateTerm(uint8 id, uint32 duration, uint16 feeBps) private pure {
        if (id > 1 || duration < 7 days || duration > 90 days || feeBps < 50 || feeBps > 1000) revert InvalidTerm();
    }

    function queueCollection(address collection, Collection calldata config) external onlyOwner {
        if (
            collection == address(0) || config.maxLoanBps0 > 4000 || config.maxLoanBps1 > 4000
                || config.maxShareBps > 10000 || (!config.isSeat && config.maxShareBps > 2500)
        ) revert InvalidConfiguration();
        // A configured hash may rotate only to a real, timelocked hash, never back to the one-shot path.
        if (collections[collection].questionHash != bytes32(0) && config.questionHash == bytes32(0)) {
            revert InvalidConfiguration();
        }
        _queue(keccak256(abi.encode("collection", collection, config)));
    }

    function executeCollection(address collection, Collection calldata config) external {
        _execute(keccak256(abi.encode("collection", collection, config)));
        if (
            collection.code.length == 0
                || (collections[collection].questionHash != bytes32(0) && config.questionHash == bytes32(0))
        ) revert InvalidConfiguration();
        if (collections[collection].questionHash != config.questionHash) {
            // Keep the last price for default auctions, but require a newly signed floor for lending.
            floors[collection].expiresAt = 0;
        }
        collections[collection] = config;
        emit CollectionSet(collection, config);
    }

    function disableCollection(address collection) external onlyOwner {
        collections[collection].enabled = false;
        emit CollectionDisabledNow(collection);
    }

    function setQuestionHashOnce(address collection, bytes32 hash) external onlyOwner {
        Collection storage c = collections[collection];
        if (c.maxShareBps == 0 || c.questionHash != bytes32(0) || hash == bytes32(0)) revert InvalidConfiguration();
        c.questionHash = hash;
        emit QuestionHashSet(collection, hash);
    }

    function queueAttester(address signer) external onlyOwner {
        if (signer == address(0)) revert InvalidConfiguration();
        _queue(keccak256(abi.encode("attester", signer)));
    }

    function executeAttester(address signer) external {
        _execute(keccak256(abi.encode("attester", signer)));
        _setOracleSigner(signer);
    }

    function queueFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert InvalidConfiguration();
        _queue(keccak256(abi.encode("recipient", recipient)));
    }

    function executeFeeRecipient(address recipient) external {
        _execute(keccak256(abi.encode("recipient", recipient)));
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    function queueDiscountModule(address module) external onlyOwner {
        _validateModule(module);
        _queue(keccak256(abi.encode("module", module)));
    }

    function executeDiscountModule(address module) external {
        _execute(keccak256(abi.encode("module", module)));
        _validateModule(module);
        discountModule = module;
        emit DiscountModuleSet(module);
    }

    function _validateModule(address module) private view {
        if (
            module.code.length == 0 || IDiscountModule(module).pawnShop() != address(this)
                || IDiscountModule(module).pawnToken() != pawnToken
        ) revert InvalidConfiguration();
    }

    function submitFloor(address collection, OracleAttestation.Attestation calldata a, bytes calldata signature)
        external
        nonReentrant
    {
        bytes32 hash = collections[collection].questionHash;
        if (hash == bytes32(0)) revert NotConfigured();
        if (
            a.questionHash != hash || a.chainId != 1 || a.panelSize < 5 || a.quorum < 4 || a.agreed < a.quorum
                || a.agreed > a.panelSize || a.issuedAt > block.timestamp
                || block.timestamp - a.issuedAt > FLOOR_MAX_AGE || a.issuedAt <= floors[collection].issuedAt
        ) revert InvalidAttestation();
        _verifyAttestation(a, signature);
        uint256 price = decodeUint256(a);
        if (price == 0 || a.answer.length != 32) revert InvalidAttestation();
        _consume(a.requestId);
        Floor storage f = floors[collection];
        f.price = price;
        f.issuedAt = a.issuedAt;
        f.expiresAt = a.expiresAt;
        // The first valid update consumes the interval even if its reserve was empty.
        if (f.lastBountyAt == 0 || block.timestamp >= uint256(f.lastBountyAt) + FLOOR_BOUNTY_INTERVAL) {
            f.lastBountyAt = uint64(block.timestamp);
            _payBounty(msg.sender, FLOOR_BOUNTY);
        }
        emit FloorSubmitted(collection, price, a.issuedAt, a.expiresAt);
    }

    function floorFresh(address collection) public view returns (bool) {
        Floor memory f = floors[collection];
        return f.price != 0 && f.issuedAt <= block.timestamp && block.timestamp - f.issuedAt <= FLOOR_MAX_AGE
            && block.timestamp <= f.expiresAt;
    }

    function pawn(address collection, uint256 tokenId, uint8 termId) external nonReentrant returns (uint256 id) {
        if (newLoansPaused) revert Paused();
        if (termId > 1) revert InvalidTerm();
        Collection memory c = collections[collection];
        uint256 ltv = termId == 0 ? c.maxLoanBps0 : c.maxLoanBps1;
        if (!c.enabled || ltv == 0) revert CollectionDisabled();
        if (!floorFresh(collection)) revert StaleFloor();
        uint256 principal = Math.mulDiv(floors[collection].price, ltv, 10000);
        if (principal < MIN_LOAN) revert LoanTooSmall();
        if (collectionDebt[collection] + principal > Math.mulDiv(lendingPool.totalAssets(), c.maxShareBps, 10000)) {
            revert ShareExceeded();
        }

        id = nextLoanId++;
        CollateralVault vault = new CollateralVault();
        Loan storage loan = _loans[id];
        loan.borrower = msg.sender;
        loan.collection = collection;
        loan.vault = address(vault);
        loan.module = discountModule;
        loan.tokenId = tokenId;
        loan.principal = principal;
        loan.due = block.timestamp + terms[termId].duration;
        loan.status = Status.Active;
        loan.savedTerms[0] = terms[0];
        loan.savedTerms[1] = terms[1];
        collectionDebt[collection] += principal;

        uint256 fee = _commitFee(id, loan, termId);
        vault.initialize(msg.sender, collection, tokenId, id, address(lendingPool), c.isSeat);
        IERC721(collection).safeTransferFrom(msg.sender, address(vault), tokenId);
        if (IERC721(collection).ownerOf(tokenId) != address(vault)) revert InvalidLoan();
        lendingPool.borrow(principal);
        _credit(msg.sender, principal - fee);
        _distributeFee(fee);
        emit Pawned(id, msg.sender, collection, tokenId, address(vault), principal, fee, loan.due);
    }

    function repay(uint256 id) external payable nonReentrant {
        Loan storage loan = _active(id);
        if (msg.value != loan.principal) revert IncorrectPayment();
        loan.status = Status.Repaid;
        collectionDebt[loan.collection] -= loan.principal;
        lendingPool.settle{value: msg.value}(loan.principal);
        IDiscountModule(loan.module).release(id);
        CollateralVault(payable(loan.vault)).release(loan.borrower);
        emit Repaid(id);
    }

    function extend(uint256 id, uint8 termId) external payable nonReentrant {
        Loan storage loan = _active(id);
        if (msg.sender != loan.borrower) revert Unauthorized();
        if (termId > 1) revert InvalidTerm();
        if (!floorFresh(loan.collection)) revert StaleFloor();
        uint256 fee = _commitFee(id, loan, termId);
        if (msg.value != fee) revert IncorrectPayment();
        // Late extensions buy a complete new term; early extensions append to the existing due date.
        loan.due = Math.max(loan.due, block.timestamp) + loan.savedTerms[termId].duration;
        _distributeFee(fee);
        emit Extended(id, termId, fee, loan.due);
    }

    function _commitFee(uint256 id, Loan storage loan, uint8 termId) private returns (uint256) {
        uint256 base = Math.mulDiv(loan.principal, loan.savedTerms[termId].feeBps, 10000, Math.Rounding.Ceil);
        return Math.min(base, IDiscountModule(loan.module).commit(id, loan.borrower, base));
    }

    function _active(uint256 id) private view returns (Loan storage loan) {
        loan = _loans[id];
        if (loan.status != Status.Active) revert InvalidLoan();
    }

    function startAuction(uint256 id) external nonReentrant {
        Loan storage loan = _active(id);
        if (block.timestamp <= loan.due + GRACE) revert GracePeriod();
        loan.status = Status.Auction;
        loan.auctionStarted = block.timestamp;
        loan.auctionFloor = floors[loan.collection].price;
        _payBounty(msg.sender, AUCTION_BOUNTY);
        emit AuctionStarted(id, loan.auctionFloor, block.timestamp);
    }

    function auctionPrice(uint256 id) public view returns (uint256) {
        Loan storage loan = _loans[id];
        if (loan.status != Status.Auction) revert NotAuctioning();
        uint256 elapsed = block.timestamp - loan.auctionStarted;
        uint256 floor = loan.auctionFloor;
        // Continuous rational slopes, rounding the final price up in favor of the pool.
        if (elapsed <= 3 days) {
            return Math.mulDiv(floor, 10000 * 3 days - 3000 * elapsed, 10000 * 3 days, Math.Rounding.Ceil);
        }
        if (elapsed < 10 days) {
            return Math.mulDiv(floor, 7000 * 7 days - 2000 * (elapsed - 3 days), 10000 * 7 days, Math.Rounding.Ceil);
        }
        return Math.mulDiv(floor, 5000, 10000, Math.Rounding.Ceil);
    }

    /// @notice msg.value is a price ceiling; any excess becomes the buyer's pull credit.
    function buyAuction(uint256 id, address receiver) external payable nonReentrant {
        if (receiver == address(0)) revert InvalidRecipient();
        uint256 price = auctionPrice(id);
        if (msg.value < price) revert IncorrectPayment();
        Loan storage loan = _loans[id];
        loan.status = Status.Sold;
        collectionDebt[loan.collection] -= loan.principal;
        uint256 recovered = Math.min(price, loan.principal);
        lendingPool.settle{value: recovered}(loan.principal);
        _credit(loan.borrower, price - recovered);
        _credit(msg.sender, msg.value - price);
        IDiscountModule(loan.module).release(id);
        CollateralVault(payable(loan.vault)).release(receiver);
        emit AuctionBought(id, msg.sender, receiver, price);
    }

    function _distributeFee(uint256 fee) private {
        uint256 protocol = Math.mulDiv(fee, 1500, 10000);
        lendingPool.receiveFee{value: fee - protocol}();
        uint256 forBounty = Math.min(protocol, BOUNTY_TARGET > bountyReserve ? BOUNTY_TARGET - bountyReserve : 0);
        bountyReserve += forBounty;
        protocol -= forBounty;
        uint256 target = Math.mulDiv(lendingPool.totalAssets(), 500, 10000);
        uint256 reserve = lendingPool.shortfallReserve();
        uint256 forReserve = Math.min(protocol, target > reserve ? target - reserve : 0);
        if (forReserve != 0) lendingPool.addReserve{value: forReserve}();
        _credit(feeRecipient, protocol - forReserve);
    }

    function _payBounty(address recipient, uint256 amount) private {
        // Reserve exhaustion must never stop price updates or default resolution.
        if (bountyReserve < amount) return;
        bountyReserve -= amount;
        _credit(recipient, amount);
    }

    function fundBounties() external payable nonReentrant {
        bountyReserve += msg.value;
        emit BountyFunded(msg.sender, msg.value);
    }

    receive() external payable {
        if (msg.sender != address(lendingPool)) revert Unauthorized();
    }
}
