// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {NFTFaxCollectibleV3} from "../src/NFTFaxCollectibleV3.sol";

/// @notice Deploys NFTFaxCollectibleV3 to Base mainnet with production config.
/// @dev Run with:
///   forge script script/DeployNFTFaxV3.s.sol:DeployNFTFaxV3 \
///     --rpc-url $BASE_RPC_URL \
///     --broadcast \
///     --verify \
///     --etherscan-api-key $BASESCAN_API_KEY \
///     -i
/// Environment vars (via --interactive or .env):
///   DEPLOYER_PRIVATE_KEY — deployer wallet (becomes initial owner)
///   MINT_PRICE_ETH       — mint price in ETH (default: 0.002)
///   CHONKS_CONTRACT      — ChonksMain address on Base (set post-deploy)
///   BASE_URI             — fallback base token URI for metadata (used when
///                          a token has no per-token IPFS URI set)
contract DeployNFTFaxV3 is Script {
    /// ChonksMain on Base mainnet.
    address constant CHONKS_MAIN = 0x07152bfde079b5319e5308C43fB1Dbc9C76cb4F9;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        uint256 mintPrice = vm.envOr("MINT_PRICE_ETH", uint256(0.002 ether));

        vm.startBroadcast(deployerPrivateKey);

        NFTFaxCollectibleV3 fax = new NFTFaxCollectibleV3(
            "NFTFax Collectible",
            "FAX",
            mintPrice,
            deployer
        );

        fax.setChonksContract(CHONKS_MAIN);

        string memory baseUri = vm.envOr("BASE_URI", string(""));
        if (bytes(baseUri).length > 0) {
            fax.setBaseURI(baseUri);
        }

        string memory contractUri = vm.envOr("CONTRACT_URI", string("https://maroon-double-woodpecker-487.mypinata.cloud/ipfs/bafkreiajnt3wrskbcmsychunhuytxymjfwqesrtm2b6dhi7zahvlfi3xke"));
        fax.setContractURI(contractUri);

        vm.stopBroadcast();

        console.log("NFTFaxCollectibleV3 deployed at:", address(fax));
        console.log("Owner:", deployer);
        console.log("Mint price (wei):", mintPrice);
        console.log("Chonks contract set to:", CHONKS_MAIN);
    }
}
