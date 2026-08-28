// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// Mock ChonksMain: ERC721 + a settable tokenIdToTBAAccountAddress mapping,
/// mirroring the real on-chain getter used for backpack resolution.
contract MockChonksMain is ERC721 {
    mapping(uint256 => address) public tokenIdToTBAAccountAddress;

    constructor() ERC721("MockChonks", "MCHONK") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function setBackpack(uint256 tokenId, address backpack) external {
        tokenIdToTBAAccountAddress[tokenId] = backpack;
    }
}
