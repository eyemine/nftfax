// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";

import {IChonksMain} from "./interfaces/IChonksMain.sol";
import {IDelegateRegistryV2} from "./interfaces/IDelegateRegistryV2.sol";

/// @title NFTFaxCollectibleV3
/// @notice V3 of the Base mint for the NFTfax chain-letter game — removes
/// per-token URI support (setTokenURI, mintFaxOnChainWithURI,
/// mintFaxDirectWithURI, tokenURI override) so metadata/images can be
/// pinned to IPFS at mint time instead of relying solely on a centralized
/// baseURI API endpoint. All V1 behavior (Community enum, on-chain Chonk
/// resolution, delegate.xyz checks, prize draw, single-claim, mint caps,
/// Pausable, ERC-2981 royalties) is unchanged.
///
/// Base-only launch: Chonks is Base-native, so its mint path
/// (`mintFaxOnChain`) resolves the recipient ENTIRELY on-chain from
/// (sourceTokenId) — the frontend/caller has zero ability to redirect where
/// a Chonk mint lands.
///
///   - CHONK -> chonksMain.tokenIdToTBAAccountAddress(tokenId) (the deployed
///     ERC-6551 backpack). Falls back to ownerOf(tokenId) only if the
///     backpack getter returns the zero address.
///   - Authorization: msg.sender must be the on-chain owner of tokenId on
///     the Chonks contract, OR a delegate.xyz-approved hot wallet for that
///     owner/token (checked against the canonical DelegateRegistry v2).
///
/// DeadFellaz / Normies / POW NFT are Ethereum-mainnet collections. This
/// Base contract cannot call ownerOf/delegate-registry on Ethereum without a
/// bridge/oracle, so — until a bridging solution exists — those communities
/// go through `mintFaxDirect`, which takes an explicit `to` address. This is
/// an accepted, deliberate trust boundary, not an oversight:
///   - The frontend has already verified ownerOf() on Ethereum at least once
///     (to grant the fax mailbox identity) before a player ever reaches mint.
///   - Bypassing the frontend to call this directly yields a bare ERC-721
///     with no canvas metadata/provenance/chain-log entry — a hollow token.
///   - Mint price vs. a randomly-distributed prize pool (see the draw/
///     distribute mechanism below) means self-minting to bypass verification
///     has no positive expected value — you pay, and the prize goes to
///     someone else.
/// On-chain mitigations: an optional global per-address mint cap and
/// Pausable. Single-claim-per-chain is enforced off-chain by the worker.
/// A caller can bypass that gate, but the economic/game design makes doing
/// so net-negative (see above).
///
/// Prize draw (commit/reveal on a future Base block hash):
///   1. Owner calls `commitDrawBlock(futureBlock)` — published in advance,
///      publicly visible via the `DrawCommitted` event, before the winner
///      selection happens. `futureBlock` must not have been mined yet.
///   2. Once that block is mined, anyone can call `captureDrawSeed(round)`
///      to permanently record `blockhash(futureBlock)` on-chain as the
///      random seed for that round (must be called within ~256 blocks of
///      `futureBlock`, a limitation of the EVM's `BLOCKHASH` opcode).
///   3. The seed + minter list are fully public, so anyone can independently
///      recompute the winner selection off-chain and verify it against what
///      the owner submits.
///   4. Owner calls `distributePrizes(round, winners, amounts)` to pay out.
///      Reverts if the seed for that round wasn't captured first, or if the
///      round was already finalized — so a payout can't happen without a
///      publicly verifiable seed on record.
contract NFTFaxCollectibleV3 is ERC721, ERC2981, Ownable, Pausable, ReentrancyGuard {
    /// Default royalty: 5% (500 basis points out of the 10_000 denominator).
    uint96 public constant DEFAULT_ROYALTY_BPS = 500;
    enum Community {
        NONE,
        CHONK,
        DEADFELLAZ,
        POW,
        NORMIE
    }

    /// Canonical delegate.xyz DelegateRegistry v2 — same address on every chain.
    IDelegateRegistryV2 public constant DELEGATE_REGISTRY =
        IDelegateRegistryV2(0x00000000000000447e69651d841bD8D104Bed493);

    uint256 public constant MAX_SUPPLY = 2222;

    uint256 public mintPrice;
    uint256 public totalMinted;
    string private _baseTokenURI;
    string private _contractURI;

    /// Per-token URI storage. If set, tokenURI(id) returns this instead of
    /// baseURI + id. Enables per-token IPFS metadata pinned at mint time.
    mapping(uint256 => string) private _tokenURIs;

    /// Optional global cap on mints landing at a single address, across all
    /// communities. 0 = uncapped. A lightweight anti-sybil backstop; per-chain
    /// single-claim is enforced off-chain by the worker.
    uint256 public maxMintsPerAddress;

    /// The Base-native Chonks contract used to resolve CHONK mint recipients
    /// (ownerOf + ERC-6551 backpack lookup). DeadFellaz/Normie/POW have no
    /// on-chain resolution path yet (see contract-level docs), so there is
    /// no equivalent admin surface for them.
    address public chonksContract;

    /// Running count of mints that landed at a given address.
    mapping(address => uint256) public mintsReceived;

    /// A single prize draw round: the future block committed for
    /// randomness, its captured hash once available, and finalization state.
    struct DrawRound {
        uint256 blockNumber;
        bytes32 seed;
        bool seedCaptured;
        bool finalized;
    }

    /// round number => draw round record. Round numbers start at 1;
    /// `currentRound == 0` means no draw has ever been committed.
    mapping(uint256 => DrawRound) public draws;
    uint256 public currentRound;

    event ChonksContractSet(address contractAddress);
    event MintPriceSet(uint256 price);
    event MaxMintsPerAddressSet(uint256 maxMints);
    event TokenURISet(uint256 indexed tokenId, string uri);
    event FaxMinted(
        uint256 indexed mintedTokenId,
        address indexed to,
        Community community,
        uint256 sourceTokenId,
        string trayId
    );
    event DrawCommitted(uint256 indexed round, uint256 blockNumber);
    event DrawSeedCaptured(uint256 indexed round, bytes32 seed);
    event PrizeSent(uint256 indexed round, address indexed winner, uint256 amount);
    event PrizesDistributed(uint256 indexed round, bytes32 seed, uint256 winnerCount, uint256 totalPaid);

    error MaxSupplyReached();
    error InsufficientPayment();
    error UnknownCommunity();
    error NotAuthorized();
    error CommunityNotConfigured();
    error MaxMintsPerAddressReached();
    error ZeroAddress();
    error InvalidCommitBlock();
    error DrawNotCommitted();
    error DrawBlockNotReached();
    error BlockHashExpired();
    error SeedAlreadyCaptured();
    error SeedNotCaptured();
    error RoundAlreadyFinalized();
    error ArrayLengthMismatch();
    error InsufficientBalance();
    error PrizeTransferFailed();
    error NonexistentToken();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 mintPrice_,
        address initialOwner
    ) ERC721(name_, symbol_) Ownable(initialOwner) {
        mintPrice = mintPrice_;
        _setDefaultRoyalty(initialOwner, DEFAULT_ROYALTY_BPS);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setChonksContract(address contractAddress) external onlyOwner {
        chonksContract = contractAddress;
        emit ChonksContractSet(contractAddress);
    }

    function setMintPrice(uint256 price) external onlyOwner {
        mintPrice = price;
        emit MintPriceSet(price);
    }

    function setMaxMintsPerAddress(uint256 maxMints) external onlyOwner {
        maxMintsPerAddress = maxMints;
        emit MaxMintsPerAddressSet(maxMints);
    }

    /// @notice Updates the default ERC-2981 royalty. `feeBps` is in basis
    /// points (100 = 1%), enforced by ERC2981 to be < 10_000 (< 100%).
    function setDefaultRoyalty(address receiver, uint96 feeBps) external onlyOwner {
        _setDefaultRoyalty(receiver, feeBps);
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
    }

    /// @notice Sets/updates the per-token URI for an already-minted token,
    /// e.g. to point it at IPFS-pinned metadata JSON. Overrides baseURI for
    /// this token only.
    function setTokenURI(uint256 tokenId, string calldata uri) external onlyOwner {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken();
        _tokenURIs[tokenId] = uri;
        emit TokenURISet(tokenId, uri);
    }

    /// @notice Sets the contract-level metadata URI used by OpenSea for the
    /// collection storefront (name, description, image, external link).
    /// Should point to a JSON file following the OpenSea collection metadata
    /// schema: { name, description, image, external_link, seller_fee_basis_points, fee_recipient }
    function setContractURI(string calldata newContractURI) external onlyOwner {
        _contractURI = newContractURI;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdraw(address payable to) external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        (bool ok, ) = to.call{value: balance}("");
        require(ok, "withdraw failed");
    }

    // ---------------------------------------------------------------------
    // Prize draw (commit/reveal on a future block hash)
    // ---------------------------------------------------------------------

    /// @notice Starts a new draw round by committing to a future block whose
    /// hash will be used as the random seed. Must be published before the
    /// winner selection is computed off-chain, so the seed can't be chosen
    /// after the fact.
    /// @param futureBlock A block number strictly greater than the current one.
    function commitDrawBlock(uint256 futureBlock) external onlyOwner returns (uint256 round) {
        if (futureBlock <= block.number) revert InvalidCommitBlock();
        round = ++currentRound;
        draws[round] = DrawRound({blockNumber: futureBlock, seed: bytes32(0), seedCaptured: false, finalized: false});
        emit DrawCommitted(round, futureBlock);
    }

    /// @notice Permanently records blockhash(committed block) as the random
    /// seed for a round. Callable by anyone (not just the owner) so the
    /// capture can't be delayed or censored, but only succeeds once the
    /// committed block has actually been mined and while it's still within
    /// the EVM's 256-block BLOCKHASH window.
    /// @param round The round to capture the seed for.
    function captureDrawSeed(uint256 round) external {
        DrawRound storage d = draws[round];
        if (d.blockNumber == 0) revert DrawNotCommitted();
        if (d.seedCaptured) revert SeedAlreadyCaptured();
        if (block.number <= d.blockNumber) revert DrawBlockNotReached();

        bytes32 hash = blockhash(d.blockNumber);
        if (hash == bytes32(0)) revert BlockHashExpired();

        d.seed = hash;
        d.seedCaptured = true;
        emit DrawSeedCaptured(round, hash);
    }

    /// @notice Pays out prizes for a round. Requires the round's seed to
    /// have already been captured on-chain, so winners can be independently
    /// recomputed and verified by anyone off-chain before this is called.
    /// @param round The round being paid out.
    /// @param winners Winner addresses, in any order.
    /// @param amounts Prize amount for each winner, matched by index.
    function distributePrizes(
        uint256 round,
        address[] calldata winners,
        uint256[] calldata amounts
    ) external onlyOwner nonReentrant {
        DrawRound storage d = draws[round];
        if (!d.seedCaptured) revert SeedNotCaptured();
        if (d.finalized) revert RoundAlreadyFinalized();
        if (winners.length != amounts.length) revert ArrayLengthMismatch();

        uint256 total = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }
        if (total > address(this).balance) revert InsufficientBalance();

        d.finalized = true;

        for (uint256 i = 0; i < winners.length; i++) {
            (bool ok, ) = winners[i].call{value: amounts[i]}("");
            if (!ok) revert PrizeTransferFailed();
            emit PrizeSent(round, winners[i], amounts[i]);
        }

        emit PrizesDistributed(round, d.seed, winners.length, total);
    }

    // ---------------------------------------------------------------------
    // Mint
    // ---------------------------------------------------------------------

    /// @notice Trustless mint for Chonks (Base-native). Recipient is resolved
    /// ENTIRELY on-chain from sourceTokenId — msg.sender cannot supply or
    /// influence the destination address.
    /// @param sourceTokenId The Chonk token ID being played/claimed.
    /// @param trayId Off-chain fax tray ID this mint corresponds to (event indexing only).
    function mintFaxOnChain(
        uint256 sourceTokenId,
        string calldata trayId
    ) external payable whenNotPaused nonReentrant returns (uint256 mintedTokenId) {
        return _mintChonk(sourceTokenId, trayId, "");
    }

    /// @notice Same as `mintFaxOnChain` but also sets the per-token IPFS URI
    /// at mint time, so the metadata is decentralized from the start.
    /// @param tokenURI_ IPFS URI for this token's metadata JSON (e.g. "ipfs://...").
    function mintFaxOnChainWithURI(
        uint256 sourceTokenId,
        string calldata trayId,
        string calldata tokenURI_
    ) external payable whenNotPaused nonReentrant returns (uint256 mintedTokenId) {
        return _mintChonk(sourceTokenId, trayId, tokenURI_);
    }

    function _mintChonk(
        uint256 sourceTokenId,
        string calldata trayId,
        string memory tokenURI_
    ) internal returns (uint256 mintedTokenId) {
        if (msg.value < mintPrice) revert InsufficientPayment();
        if (totalMinted >= MAX_SUPPLY) revert MaxSupplyReached();

        address to = _resolveChonkRecipient(sourceTokenId);
        _checkMintCap(to);

        mintsReceived[to] += 1;
        mintedTokenId = ++totalMinted;
        _safeMint(to, mintedTokenId);
        if (bytes(tokenURI_).length > 0) {
            _tokenURIs[mintedTokenId] = tokenURI_;
            emit TokenURISet(mintedTokenId, tokenURI_);
        }

        emit FaxMinted(mintedTokenId, to, Community.CHONK, sourceTokenId, trayId);
    }

    /// @notice Direct mint for Ethereum-native communities (DeadFellaz,
    /// Normies, POW NFT) that this Base contract cannot verify ownership for
    /// on-chain until a bridging solution exists. `to` is caller-supplied;
    /// the frontend has already verified Ethereum ownership/delegation
    /// before reaching this call. See contract-level docs for the accepted
    /// trust model and economic rationale.
    /// @param to Recipient, resolved off-chain by the frontend.
    /// @param community Which Ethereum-native community sourceTokenId belongs to.
    /// @param sourceTokenId The token ID within that community's contract.
    /// @param trayId Off-chain fax tray ID this mint corresponds to (event indexing only).
    function mintFaxDirect(
        address to,
        Community community,
        uint256 sourceTokenId,
        string calldata trayId
    ) external payable whenNotPaused nonReentrant returns (uint256 mintedTokenId) {
        return _mintDirect(to, community, sourceTokenId, trayId, "");
    }

    /// @notice Same as `mintFaxDirect` but also sets the per-token IPFS URI
    /// at mint time.
    /// @param tokenURI_ IPFS URI for this token's metadata JSON.
    function mintFaxDirectWithURI(
        address to,
        Community community,
        uint256 sourceTokenId,
        string calldata trayId,
        string calldata tokenURI_
    ) external payable whenNotPaused nonReentrant returns (uint256 mintedTokenId) {
        return _mintDirect(to, community, sourceTokenId, trayId, tokenURI_);
    }

    function _mintDirect(
        address to,
        Community community,
        uint256 sourceTokenId,
        string calldata trayId,
        string memory tokenURI_
    ) internal returns (uint256 mintedTokenId) {
        if (community == Community.NONE || community == Community.CHONK) revert UnknownCommunity();
        if (to == address(0)) revert ZeroAddress();
        if (msg.value < mintPrice) revert InsufficientPayment();
        if (totalMinted >= MAX_SUPPLY) revert MaxSupplyReached();
        _checkMintCap(to);


        mintsReceived[to] += 1;
        mintedTokenId = ++totalMinted;
        _safeMint(to, mintedTokenId);
        if (bytes(tokenURI_).length > 0) {
            _tokenURIs[mintedTokenId] = tokenURI_;
            emit TokenURISet(mintedTokenId, tokenURI_);
        }

        emit FaxMinted(mintedTokenId, to, community, sourceTokenId, trayId);
    }

    function _checkMintCap(address to) internal view {
        if (maxMintsPerAddress > 0 && mintsReceived[to] >= maxMintsPerAddress) {
            revert MaxMintsPerAddressReached();
        }
    }

    // ---------------------------------------------------------------------
    // Chonk recipient resolution (fully on-chain, zero trust in caller input)
    // ---------------------------------------------------------------------

    function _resolveChonkRecipient(uint256 sourceTokenId) internal view returns (address to) {
        address nftContract = chonksContract;
        if (nftContract == address(0)) revert CommunityNotConfigured();

        address owner = IERC721(nftContract).ownerOf(sourceTokenId);

        bool authorized = msg.sender == owner
            || DELEGATE_REGISTRY.checkDelegateForERC721(msg.sender, owner, nftContract, sourceTokenId, bytes32(0));
        if (!authorized) revert NotAuthorized();

        address backpack = IChonksMain(nftContract).tokenIdToTBAAccountAddress(sourceTokenId);
        return backpack == address(0) ? owner : backpack;
    }

    // ---------------------------------------------------------------------
    // Views / overrides
    // ---------------------------------------------------------------------

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /// @notice Returns the per-token URI if one was set (e.g. IPFS), otherwise
    /// falls back to the ERC721 default of baseURI + tokenId.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory uri = _tokenURIs[tokenId];
        if (bytes(uri).length > 0) return uri;
        return super.tokenURI(tokenId);
    }

    /// @notice OpenSea collection-level metadata URI.
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
