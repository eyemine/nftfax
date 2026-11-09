// Cryptographics mainnet contracts (DecenterApps, deployed ~block 6450000, Oct 2018)
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

export const ASSET_MANAGER = '0x80d774ffd99ad3321497064a2713bf2f89eeb5d6';
export const DIGITAL_PRINT_IMAGE = '0xb80776700778e7415da08ef65fa389f75737fb95';
export const GETTER = '0x87e911929709b3b1f308905cc5427813ca7846d5';
export const MARKETPLACE = '0x00685230359bdb9e16704e1d3918b553e9a015e2';
export const FUNCTIONS = '0x858e56589a5f49c6020ee86a14b3f84e26e0356c';

export const rpc = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ETH_RPC || 'https://ethereum-rpc.publicnode.com'),
});

export const assetManagerAbi = [
  {
    name: 'getNumberOfAssetPacks',
    type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getNumberOfAssets',
    type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    // returns (packCover b32, creator, price, assetIds[], attributes[], ipfsHashes b32[],
    //          packMetadataIpfs b32, creatorUsername, creatorProfilePic)
    // NOTE: the trailing username/profilePic fields from UserManager aren't valid
    // ABI strings — declare only the first 7 outputs; trailing data is ignored.
    name: 'getAssetPackData',
    type: 'function', stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      { type: 'bytes32' }, { type: 'address' }, { type: 'uint256' },
      { type: 'uint256[]' }, { type: 'uint256[]' }, { type: 'bytes32[]' },
      { type: 'bytes32' },
    ],
  },
  {
    name: 'getBoughtAssetPacks',
    type: 'function', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'getAssetPacksUserCreated',
    type: 'function', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'checkHasPermissionForPack',
    type: 'function', stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }],
  },
];
