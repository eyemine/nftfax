// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal interface for delegate.xyz's DelegateRegistry v2, deployed at the
/// same canonical address across chains: 0x00000000000000447e69651d841bD8D104Bed493
interface IDelegateRegistryV2 {
    /// Returns true if `to` has been granted ERC-721 delegation rights for
    /// `contract_`/`tokenId` by `from` (the vault/owner), for the given
    /// `rights` scope (bytes32(0) = default/all rights).
    function checkDelegateForERC721(
        address to,
        address from,
        address contract_,
        uint256 tokenId,
        bytes32 rights
    ) external view returns (bool);
}
