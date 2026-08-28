// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FaxTray} from "../src/FaxTray.sol";

/// @notice Deploys FaxTray to Gnosis Chain (chain 100).
/// Usage:
///   forge script script/DeployFaxTray.s.sol \
///     --rpc-url https://rpc.gnosischain.com \
///     --broadcast --verify \
///     --etherscan-api-key $ETHERSCAN_API_KEY
contract DeployFaxTray is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        FaxTray tray = new FaxTray("Fax Tray", "FAXTRAY", deployer);

        string memory baseUri = vm.envOr("GNOSIS_BASE_URI", string(""));
        if (bytes(baseUri).length > 0) {
            tray.setBaseURI(baseUri);
        }

        vm.stopBroadcast();

        console2.log("FaxTray deployed at:", address(tray));
        console2.log("Owner:", deployer);
    }
}
