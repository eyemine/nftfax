// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal interface for the Chonks main contract on Base.
/// tokenIdToTBAAccountAddress is the canonical getter that returns the
/// deployed ERC-6551 backpack (token-bound account) for a given Chonk.
/// Verified on-chain: tokenIdToTBAAccountAddress(588) on
/// 0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9 returns
/// 0x2859085536aa0d9695d967fd201164120d7077bb.
interface IChonksMain {
    function tokenIdToTBAAccountAddress(uint256 tokenId) external view returns (address);
    function ownerOf(uint256 tokenId) external view returns (address);
}
