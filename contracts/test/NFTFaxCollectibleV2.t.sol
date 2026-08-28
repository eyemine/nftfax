// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NFTFaxCollectibleV2} from "../src/NFTFaxCollectibleV2.sol";
import {MockCommunityNFT} from "./mocks/MockCommunityNFT.sol";
import {MockChonksMain} from "./mocks/MockChonksMain.sol";

/// @notice Focused tests for the V2-only behavior: per-token URI storage,
/// setTokenURI, mintFaxOnChainWithURI, mintFaxDirectWithURI, tokenURI
/// fallback to baseURI. All V1 behavior is already covered by
/// NFTFaxCollectible.t.sol and is unchanged in V2 (same logic, copied as-is).
contract NFTFaxCollectibleV2Test is Test {
    NFTFaxCollectibleV2 fax;
    MockChonksMain chonks;
    MockCommunityNFT deadfellaz;

    address owner = address(0xA11CE);
    address vault = address(0xBEEF);
    address stranger = address(0xBAD1);

    uint256 constant PRICE = 0.01 ether;

    function setUp() public {
        fax = new NFTFaxCollectibleV2("NFTFax", "NFAX", PRICE, owner);
        chonks = new MockChonksMain();
        deadfellaz = new MockCommunityNFT("DeadFellaz", "DFZ");

        vm.prank(owner);
        fax.setChonksContract(address(chonks));

        vm.deal(owner, 10 ether);
        vm.deal(vault, 10 ether);
        vm.deal(stranger, 10 ether);
    }

    // ---------------------------------------------------------------------
    // Per-token URI set at mint time
    // ---------------------------------------------------------------------

    function test_mintFaxDirectWithURI_setsPerTokenURI() public {
        uint256 tokenId = 1;
        deadfellaz.mint(vault, tokenId);

        vm.prank(vault);
        uint256 minted = fax.mintFaxDirectWithURI{value: PRICE}(
            vault,
            NFTFaxCollectibleV2.Community.DEADFELLAZ,
            tokenId,
            "tray-1",
            "ipfs://bafkreiabc/metadata.json"
        );

        assertEq(fax.tokenURI(minted), "ipfs://bafkreiabc/metadata.json");
    }

    function test_mintFaxOnChainWithURI_setsPerTokenURI() public {
        uint256 sourceTokenId = 42;
        chonks.mint(vault, sourceTokenId);

        vm.prank(vault);
        uint256 minted = fax.mintFaxOnChainWithURI{value: PRICE}(
            sourceTokenId,
            "tray-2",
            "ipfs://bafkreidef/metadata.json"
        );

        assertEq(fax.tokenURI(minted), "ipfs://bafkreidef/metadata.json");
    }

    function test_mintWithoutURI_fallsBackToBaseURI() public {
        vm.prank(owner);
        fax.setBaseURI("https://fax.nftmail.box/api/metadata/");

        uint256 tokenId = 2;
        deadfellaz.mint(vault, tokenId);

        vm.prank(vault);
        uint256 minted = fax.mintFaxDirect{value: PRICE}(
            vault,
            NFTFaxCollectibleV2.Community.DEADFELLAZ,
            tokenId,
            "tray-3"
        );

        assertEq(fax.tokenURI(minted), string.concat("https://fax.nftmail.box/api/metadata/", vm.toString(minted)));
    }

    // ---------------------------------------------------------------------
    // setTokenURI (post-mint update)
    // ---------------------------------------------------------------------

    function test_ownerCanSetTokenURIAfterMint() public {
        uint256 tokenId = 3;
        deadfellaz.mint(vault, tokenId);

        vm.prank(vault);
        uint256 minted = fax.mintFaxDirect{value: PRICE}(
            vault,
            NFTFaxCollectibleV2.Community.DEADFELLAZ,
            tokenId,
            "tray-4"
        );

        vm.prank(owner);
        fax.setTokenURI(minted, "ipfs://bafkreighi/metadata.json");

        assertEq(fax.tokenURI(minted), "ipfs://bafkreighi/metadata.json");
    }

    function test_setTokenURIRevertsForNonexistentToken() public {
        vm.prank(owner);
        vm.expectRevert(NFTFaxCollectibleV2.NonexistentToken.selector);
        fax.setTokenURI(999, "ipfs://bafkreixxx/metadata.json");
    }

    function test_onlyOwnerCanSetTokenURI() public {
        uint256 tokenId = 4;
        deadfellaz.mint(vault, tokenId);

        vm.prank(vault);
        uint256 minted = fax.mintFaxDirect{value: PRICE}(
            vault,
            NFTFaxCollectibleV2.Community.DEADFELLAZ,
            tokenId,
            "tray-5"
        );

        vm.prank(stranger);
        vm.expectRevert();
        fax.setTokenURI(minted, "ipfs://bafkreizzz/metadata.json");
    }

    function test_setTokenURIEmitsEvent() public {
        uint256 tokenId = 5;
        deadfellaz.mint(vault, tokenId);

        vm.prank(vault);
        uint256 minted = fax.mintFaxDirect{value: PRICE}(
            vault,
            NFTFaxCollectibleV2.Community.DEADFELLAZ,
            tokenId,
            "tray-6"
        );

        vm.expectEmit(true, false, false, true);
        emit NFTFaxCollectibleV2.TokenURISet(minted, "ipfs://bafkreiaaa/metadata.json");

        vm.prank(owner);
        fax.setTokenURI(minted, "ipfs://bafkreiaaa/metadata.json");
    }

    function test_tokenURIRevertsForNonexistentToken() public {
        vm.expectRevert();
        fax.tokenURI(999);
    }
}
