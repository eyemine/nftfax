// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NFTFaxCollectible} from "../src/NFTFaxCollectible.sol";
import {MockCommunityNFT} from "./mocks/MockCommunityNFT.sol";
import {MockChonksMain} from "./mocks/MockChonksMain.sol";

contract NFTFaxCollectibleTest is Test {
    NFTFaxCollectible fax;
    MockChonksMain chonks;
    MockCommunityNFT deadfellaz;
    MockCommunityNFT normie;

    address owner = address(0xA11CE);
    address vault = address(0xBEEF);
    address hotWallet = address(0xCAFE);
    address stranger = address(0xBAD1);
    address delegateRegistry = 0x00000000000000447e69651d841bD8D104Bed493;

    uint256 constant PRICE = 0.01 ether;

    function setUp() public {
        fax = new NFTFaxCollectible("NFTFax", "NFAX", PRICE, owner);
        chonks = new MockChonksMain();
        deadfellaz = new MockCommunityNFT("DeadFellaz", "DFZ");
        normie = new MockCommunityNFT("Normie", "NORM");

        vm.prank(owner);
        fax.setChonksContract(address(chonks));

        vm.deal(owner, 10 ether);
        vm.deal(vault, 10 ether);
        vm.deal(hotWallet, 10 ether);
        vm.deal(stranger, 10 ether);
    }

    // ---------------------------------------------------------------------
    // Chonk backpack resolution
    // ---------------------------------------------------------------------

    function test_chonkMintsToBackpack() public {
        uint256 tokenId = 588;
        address backpack = address(0x2859085536aa0d9695D967fd201164120D7077bb);
        chonks.mint(vault, tokenId);
        chonks.setBackpack(tokenId, backpack);

        vm.prank(vault);
        uint256 minted = fax.mintFaxOnChain{value: PRICE}(tokenId, "tray-1");

        assertEq(fax.ownerOf(minted), backpack);
    }

    function test_chonkFallsBackToOwnerWhenNoBackpack() public {
        uint256 tokenId = 42;
        chonks.mint(vault, tokenId);
        // backpack left unset -> zero address

        vm.prank(vault);
        uint256 minted = fax.mintFaxOnChain{value: PRICE}(tokenId, "tray-2");

        assertEq(fax.ownerOf(minted), vault);
    }

    function test_chonkDelegateMintsToOwner() public {
        uint256 tokenId = 77;
        chonks.mint(vault, tokenId);

        vm.mockCall(
            delegateRegistry,
            abi.encodeWithSignature(
                "checkDelegateForERC721(address,address,address,uint256,bytes32)",
                hotWallet,
                vault,
                address(chonks),
                tokenId,
                bytes32(0)
            ),
            abi.encode(true)
        );

        vm.prank(hotWallet);
        uint256 minted = fax.mintFaxOnChain{value: PRICE}(tokenId, "tray-2b");

        assertEq(fax.ownerOf(minted), vault);
    }

    function test_chonkRevertsWhenNotOwnerOrDelegate() public {
        uint256 tokenId = 78;
        chonks.mint(vault, tokenId);

        vm.mockCall(
            delegateRegistry,
            abi.encodeWithSignature(
                "checkDelegateForERC721(address,address,address,uint256,bytes32)",
                stranger,
                vault,
                address(chonks),
                tokenId,
                bytes32(0)
            ),
            abi.encode(false)
        );

        vm.prank(stranger);
        vm.expectRevert(NFTFaxCollectible.NotAuthorized.selector);
        fax.mintFaxOnChain{value: PRICE}(tokenId, "tray-2c");
    }

    // ---------------------------------------------------------------------
    // Direct mint path (Ethereum-native: DeadFellaz / POW / Normie)
    // ---------------------------------------------------------------------

    function test_anyoneCanCallMintFaxDirectWithResolvedRecipient() public {
        uint256 tokenId = 7;
        deadfellaz.mint(vault, tokenId);

        // Frontend already verified `vault` owns tokenId on Ethereum before
        // reaching this call — msg.sender here is whichever wallet is
        // connected (could be vault itself or a relayer-less frontend flow).
        vm.prank(vault);
        uint256 minted = fax.mintFaxDirect{value: PRICE}(
            vault,
            NFTFaxCollectible.Community.DEADFELLAZ,
            tokenId,
            "tray-3"
        );

        assertEq(fax.ownerOf(minted), vault);
    }

    function test_mintsToVaultForDelegatedNormie() public {
        uint256 tokenId = 99;
        normie.mint(vault, tokenId);

        // Frontend independently verified via Ethereum RPC that hotWallet is
        // delegated by vault (delegate.ts's verifyOwnershipOrDelegate) and
        // resolved the recipient to the vault before calling.
        vm.prank(hotWallet);
        uint256 minted = fax.mintFaxDirect{value: PRICE}(
            vault,
            NFTFaxCollectible.Community.NORMIE,
            tokenId,
            "tray-4"
        );

        assertEq(fax.ownerOf(minted), vault);
    }

    function test_cannotUseDirectPathForChonk() public {
        vm.prank(vault);
        vm.expectRevert(NFTFaxCollectible.UnknownCommunity.selector);
        fax.mintFaxDirect{value: PRICE}(vault, NFTFaxCollectible.Community.CHONK, 1, "tray-5b");
    }

    function test_cannotMintToZeroAddress() public {
        vm.prank(vault);
        vm.expectRevert(NFTFaxCollectible.ZeroAddress.selector);
        fax.mintFaxDirect{value: PRICE}(address(0), NFTFaxCollectible.Community.DEADFELLAZ, 1, "tray-5c");
    }

    function test_maxMintsPerAddressCapEnforced() public {
        vm.prank(owner);
        fax.setMaxMintsPerAddress(1);

        deadfellaz.mint(vault, 200);
        deadfellaz.mint(vault, 201);

        vm.prank(vault);
        fax.mintFaxDirect{value: PRICE}(vault, NFTFaxCollectible.Community.DEADFELLAZ, 200, "tray-cap-1");

        vm.prank(vault);
        vm.expectRevert(NFTFaxCollectible.MaxMintsPerAddressReached.selector);
        fax.mintFaxDirect{value: PRICE}(vault, NFTFaxCollectible.Community.DEADFELLAZ, 201, "tray-cap-2");
    }

    function test_onlyOwnerCanSetMaxMintsPerAddress() public {
        vm.prank(stranger);
        vm.expectRevert();
        fax.setMaxMintsPerAddress(1);
    }

    // ---------------------------------------------------------------------
    // Anti-abuse: double claim, price, supply cap, unconfigured community
    // ---------------------------------------------------------------------

    function test_cannotClaimSameTokenTwice() public {
        uint256 tokenId = 1;
        deadfellaz.mint(vault, tokenId);

        vm.prank(vault);
        fax.mintFaxDirect{value: PRICE}(vault, NFTFaxCollectible.Community.DEADFELLAZ, tokenId, "tray-6");

        vm.prank(vault);
        vm.expectRevert(NFTFaxCollectible.AlreadyClaimed.selector);
        fax.mintFaxDirect{value: PRICE}(vault, NFTFaxCollectible.Community.DEADFELLAZ, tokenId, "tray-6b");
    }

    function test_revertsOnInsufficientPayment() public {
        uint256 tokenId = 2;
        deadfellaz.mint(vault, tokenId);

        vm.prank(vault);
        vm.expectRevert(NFTFaxCollectible.InsufficientPayment.selector);
        fax.mintFaxDirect{value: PRICE - 1}(vault, NFTFaxCollectible.Community.DEADFELLAZ, tokenId, "tray-7");
    }

    function test_revertsWhenChonkContractNotConfigured() public {
        NFTFaxCollectible freshFax = new NFTFaxCollectible("NFTFax", "NFAX", PRICE, owner);
        vm.deal(vault, PRICE);
        vm.prank(vault);
        vm.expectRevert(NFTFaxCollectible.CommunityNotConfigured.selector);
        freshFax.mintFaxOnChain{value: PRICE}(1, "tray-8");
    }

    function test_revertsAtMaxSupply() public {
        // Mint MAX_SUPPLY distinct claims using distinct tokenIds via the
        // direct path to avoid AlreadyClaimed interfering with the cap check.
        vm.deal(vault, (fax.MAX_SUPPLY() + 1) * PRICE);
        for (uint256 i = 1; i <= fax.MAX_SUPPLY(); i++) {
            deadfellaz.mint(vault, i);
            vm.prank(vault);
            fax.mintFaxDirect{value: PRICE}(vault, NFTFaxCollectible.Community.DEADFELLAZ, i, "tray-bulk");
        }

        uint256 overflowTokenId = fax.MAX_SUPPLY() + 1;
        deadfellaz.mint(vault, overflowTokenId);
        vm.prank(vault);
        vm.expectRevert(NFTFaxCollectible.MaxSupplyReached.selector);
        fax.mintFaxDirect{value: PRICE}(
            vault,
            NFTFaxCollectible.Community.DEADFELLAZ,
            overflowTokenId,
            "tray-overflow"
        );
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function test_onlyOwnerCanSetChonksContract() public {
        vm.prank(stranger);
        vm.expectRevert();
        fax.setChonksContract(address(0x1234));
    }

    function test_pauseBlocksMint() public {
        uint256 tokenId = 5;
        deadfellaz.mint(vault, tokenId);

        vm.prank(owner);
        fax.pause();

        vm.prank(vault);
        vm.expectRevert();
        fax.mintFaxDirect{value: PRICE}(vault, NFTFaxCollectible.Community.DEADFELLAZ, tokenId, "tray-9");
    }

    function test_withdraw() public {
        uint256 tokenId = 6;
        deadfellaz.mint(vault, tokenId);
        vm.prank(vault);
        fax.mintFaxDirect{value: PRICE}(vault, NFTFaxCollectible.Community.DEADFELLAZ, tokenId, "tray-10");

        uint256 before = owner.balance;
        vm.prank(owner);
        fax.withdraw(payable(owner));
        assertEq(owner.balance, before + PRICE);
    }

    // ---------------------------------------------------------------------
    // Prize draw (commit/reveal) and distribution
    // ---------------------------------------------------------------------

    function _fundPrizePool(uint256 amount) internal {
        vm.deal(address(fax), amount);
    }

    function test_commitDrawBlockRevertsOnPastOrCurrentBlock() public {
        vm.prank(owner);
        vm.expectRevert(NFTFaxCollectible.InvalidCommitBlock.selector);
        fax.commitDrawBlock(block.number);
    }

    function test_onlyOwnerCanCommitDrawBlock() public {
        vm.prank(stranger);
        vm.expectRevert();
        fax.commitDrawBlock(block.number + 5);
    }

    function test_captureDrawSeedRevertsBeforeBlockReached() public {
        vm.prank(owner);
        uint256 round = fax.commitDrawBlock(block.number + 5);

        vm.expectRevert(NFTFaxCollectible.DrawBlockNotReached.selector);
        fax.captureDrawSeed(round);
    }

    function test_captureDrawSeedRevertsForUncommittedRound() public {
        vm.expectRevert(NFTFaxCollectible.DrawNotCommitted.selector);
        fax.captureDrawSeed(999);
    }

    function test_captureDrawSeedSucceedsAfterBlockMinedAndIsCallableByAnyone() public {
        vm.prank(owner);
        uint256 round = fax.commitDrawBlock(block.number + 2);

        vm.roll(block.number + 3);

        vm.prank(stranger);
        fax.captureDrawSeed(round);

        (, bytes32 seed, bool seedCaptured, bool finalized) = fax.draws(round);
        assertTrue(seedCaptured);
        assertFalse(finalized);
        assertEq(seed, blockhash(block.number - 1));
    }

    function test_captureDrawSeedRevertsWhenAlreadyCaptured() public {
        vm.prank(owner);
        uint256 round = fax.commitDrawBlock(block.number + 2);
        vm.roll(block.number + 3);
        fax.captureDrawSeed(round);

        vm.expectRevert(NFTFaxCollectible.SeedAlreadyCaptured.selector);
        fax.captureDrawSeed(round);
    }

    function test_distributePrizesRevertsWithoutCapturedSeed() public {
        vm.prank(owner);
        uint256 round = fax.commitDrawBlock(block.number + 2);

        address[] memory winners = new address[](1);
        winners[0] = vault;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;

        vm.prank(owner);
        vm.expectRevert(NFTFaxCollectible.SeedNotCaptured.selector);
        fax.distributePrizes(round, winners, amounts);
    }

    function test_distributePrizesPaysWinnersAndFinalizesRound() public {
        _fundPrizePool(3 ether);

        vm.prank(owner);
        uint256 round = fax.commitDrawBlock(block.number + 2);
        vm.roll(block.number + 3);
        fax.captureDrawSeed(round);

        address[] memory winners = new address[](2);
        winners[0] = vault;
        winners[1] = hotWallet;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 2 ether;
        amounts[1] = 1 ether;

        uint256 vaultBefore = vault.balance;
        uint256 hotWalletBefore = hotWallet.balance;

        vm.prank(owner);
        fax.distributePrizes(round, winners, amounts);

        assertEq(vault.balance, vaultBefore + 2 ether);
        assertEq(hotWallet.balance, hotWalletBefore + 1 ether);

        (, , , bool finalized) = fax.draws(round);
        assertTrue(finalized);
    }

    function test_distributePrizesRevertsWhenAlreadyFinalized() public {
        _fundPrizePool(3 ether);

        vm.prank(owner);
        uint256 round = fax.commitDrawBlock(block.number + 2);
        vm.roll(block.number + 3);
        fax.captureDrawSeed(round);

        address[] memory winners = new address[](1);
        winners[0] = vault;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;

        vm.prank(owner);
        fax.distributePrizes(round, winners, amounts);

        vm.prank(owner);
        vm.expectRevert(NFTFaxCollectible.RoundAlreadyFinalized.selector);
        fax.distributePrizes(round, winners, amounts);
    }

    function test_distributePrizesRevertsOnArrayLengthMismatch() public {
        _fundPrizePool(3 ether);

        vm.prank(owner);
        uint256 round = fax.commitDrawBlock(block.number + 2);
        vm.roll(block.number + 3);
        fax.captureDrawSeed(round);

        address[] memory winners = new address[](2);
        winners[0] = vault;
        winners[1] = hotWallet;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;

        vm.prank(owner);
        vm.expectRevert(NFTFaxCollectible.ArrayLengthMismatch.selector);
        fax.distributePrizes(round, winners, amounts);
    }

    function test_distributePrizesRevertsWhenExceedingBalance() public {
        _fundPrizePool(1 ether);

        vm.prank(owner);
        uint256 round = fax.commitDrawBlock(block.number + 2);
        vm.roll(block.number + 3);
        fax.captureDrawSeed(round);

        address[] memory winners = new address[](1);
        winners[0] = vault;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2 ether;

        vm.prank(owner);
        vm.expectRevert(NFTFaxCollectible.InsufficientBalance.selector);
        fax.distributePrizes(round, winners, amounts);
    }

    function test_onlyOwnerCanDistributePrizes() public {
        _fundPrizePool(1 ether);

        vm.prank(owner);
        uint256 round = fax.commitDrawBlock(block.number + 2);
        vm.roll(block.number + 3);
        fax.captureDrawSeed(round);

        address[] memory winners = new address[](1);
        winners[0] = vault;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;

        vm.prank(stranger);
        vm.expectRevert();
        fax.distributePrizes(round, winners, amounts);
    }

    // ---------------------------------------------------------------------
    // ERC-2981 royalties
    // ---------------------------------------------------------------------

    function test_defaultRoyaltyIsFivePercentToOwner() public {
        uint256 tokenId = 1;
        deadfellaz.mint(vault, tokenId);
        vm.prank(vault);
        uint256 minted = fax.mintFaxDirect{value: PRICE}(vault, NFTFaxCollectible.Community.DEADFELLAZ, tokenId, "tray-r1");

        (address receiver, uint256 amount) = fax.royaltyInfo(minted, 1 ether);
        assertEq(receiver, owner);
        assertEq(amount, 0.05 ether);
    }

    function test_onlyOwnerCanSetDefaultRoyalty() public {
        vm.prank(stranger);
        vm.expectRevert();
        fax.setDefaultRoyalty(stranger, 1000);
    }

    function test_ownerCanUpdateDefaultRoyalty() public {
        uint256 tokenId = 2;
        deadfellaz.mint(vault, tokenId);
        vm.prank(vault);
        uint256 minted = fax.mintFaxDirect{value: PRICE}(vault, NFTFaxCollectible.Community.DEADFELLAZ, tokenId, "tray-r2");

        vm.prank(owner);
        fax.setDefaultRoyalty(hotWallet, 1000);

        (address receiver, uint256 amount) = fax.royaltyInfo(minted, 1 ether);
        assertEq(receiver, hotWallet);
        assertEq(amount, 0.1 ether);
    }

    function test_supportsERC2981Interface() public view {
        assertTrue(fax.supportsInterface(0x2a55205a));
    }
}
