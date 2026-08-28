// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title FaxTray
/// @notice Gnosis Chain permanence anchor for the NFTfax chain-letter game.
///         "Save to Gnosis" mints a simple ERC-721 here — no Chonks, no
///         ERC-6551, no community logic. Just a permanent on-chain record
///         with a per-token IPFS/Arweave URI. EOA-only minting.
contract FaxTray is ERC721, ERC2981, Ownable, Pausable, ReentrancyGuard {
    uint96 public constant DEFAULT_ROYALTY_BPS = 250; // 2.5%

    uint256 private _nextTokenId = 1;

    /// Per-token URI (ipfs:// or ar://). Falls back to baseURI if not set.
    mapping(uint256 => string) private _tokenURIs;

    /// Base URI fallback for tokens without a per-token URI.
    string private _fallbackBaseURI;

    /// Emitted when a fax is saved (minted) on Gnosis.
    event FaxSaved(uint256 indexed tokenId, address indexed to, string trayId);

    constructor(
        string memory name_,
        string memory symbol_,
        address initialOwner
    ) ERC721(name_, symbol_) Ownable(initialOwner) {
        _setDefaultRoyalty(initialOwner, DEFAULT_ROYALTY_BPS);
    }

    /// @notice Mints a fax tray NFT to an EOA with an optional per-token URI.
    /// @param to Recipient address (EOA only — no ERC-6551 resolution).
    /// @param trayId Off-chain fax tray ID for event indexing.
    /// @param tokenURI_ Optional IPFS/Arweave URI for this token's metadata.
    function saveFax(address to, string calldata trayId, string calldata tokenURI_)
        external
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        if (bytes(tokenURI_).length > 0) {
            _tokenURIs[tokenId] = tokenURI_;
        }
        emit FaxSaved(tokenId, to, trayId);
        return tokenId;
    }

    /// @notice Returns the URI for a token. Uses per-token URI if set,
    ///         otherwise falls back to baseURI + tokenId.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory uri = _tokenURIs[tokenId];
        if (bytes(uri).length > 0) return uri;
        string memory base = _fallbackBaseURI;
        if (bytes(base).length > 0) {
            return string(abi.encodePacked(base, Strings.toString(tokenId)));
        }
        return "";
    }

    /// @notice Sets a per-token URI (owner only). Used to upgrade existing
    ///         tokens to IPFS/Arweave URIs after pinning.
    function setTokenURI(uint256 tokenId, string calldata uri) external onlyOwner {
        _requireOwned(tokenId);
        _tokenURIs[tokenId] = uri;
    }

    /// @notice Sets the base URI fallback (owner only).
    function setBaseURI(string calldata base) external onlyOwner {
        _fallbackBaseURI = base;
    }

    /// @notice Returns the current base URI.
    function baseURI() external view returns (string memory) {
        return _fallbackBaseURI;
    }

    /// @notice Total number of saved faxes.
    function totalSaved() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    /// @notice Pauses minting (owner only).
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses minting (owner only).
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Sets contract-level royalty (owner only).
    function setDefaultRoyalty(address receiver, uint96 feeBps) external onlyOwner {
        _setDefaultRoyalty(receiver, feeBps);
    }

    /// @notice Withdraws any accumulated xDAI to the owner.
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool ok,) = payable(msg.sender).call{value: balance}("");
            require(ok, "Withdraw failed");
        }
    }

    function _increaseBalance(address account, uint128 value) internal override {
        ERC721._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC2981) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
