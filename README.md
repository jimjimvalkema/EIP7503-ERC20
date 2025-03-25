# THIS REPO IS WORK IN PROGRESS

# An erc20 with EIP7503, partial spends and reusable address
An erc20 token with [EIP7503](https://eips.ethereum.org/EIPS/eip-7503) (zkwormholes) with a in-contract merkle tree to make it compatible with any EVM chain. It also has a new nullifier scheme to enable partial spends and reusable private addresses.  
*More info in [docs/notes.md](https://github.com/jimjimvalkema/scrollZkWormholes/blob/main/docs/notes.md#L1)*

<!-- **Try it out here: https://scrollzkwormholes.jimjim.dev/**  
<!-- TODO -> *Or on ipfs: https://bafybeia3aeuhou4jwtoakvds7ya5qxe5hwjqchmabvvvuwvd6thnqubgzm.ipfs.dweb.link/* -->


<!-- ![ui](./screenshots/2privates1privateTransferui.png)   -->

<!-- ### deployment on scroll sepolia
https://sepolia.scrollscan.com/address/0x6A0e54612253d97Fd2c3dbb73BDdBAFfca531A9B


## WARNING WORK IN PROGRESS
The code here in barely tested and has 3 inflation bugs.  
These are: anyone can call `setTrustedStorageRoot` and `mint`.  
Also EOA<->zkwormhole address collisions can be created.  
*More info in [docs/notes.md](https://github.com/jimjimvalkema/scrollZkWormholes/blob/main/docs/notes.md#L8)* -->

# TODO
1. make  it work
1. ~~encrypt nullifier value instead of hashing. `nullifierValue=encrypt([amount],publicKey)`~~ just keep nullifierValue as a hash. Just allow a extra data field in the event to help people sync a old wallet. Hashing is far cheaper in circuit anyway. 
1. make js to generate a viewing from the signature.
1. change the circuit to support a relayer. Prob by just adding a extra data field to public inputs
1. `secret` should not be used. Instead the private-addresses should be derived from the same seed-phrase as the users ethereum wallet. Prob should do `address=poseidon(public_key, chainId, "zkwormholes)`


# future plans
1. consider using eip712 for signing spends. (maybe also viewing keys?)
1. actually create a implementation of a relayer
1. make verifier in solidity so people can recover in case they accidentally sent > privateTransferLimit
1. change circuit and contract to allow input multiple roots from other chains to make it [toadnado](https://github.com/nodestarQ/toadnado) style 😎  '
1. consider using a per spend public key. But tbh i would just use built a offchain POI system like railgun instead.
ex: `assert(publicInputs.chainId == block.chainId)`   
and `root = poseidon([...allOtherChainRoots])`  


## install
### js
```shell
yarn install;
yarn install-vite;
```
### Install noir
nargo  
https://noir-lang.org/docs/getting_started/quick_start#noir
```shell
noirup -v 1.0.0-beta.2;
```
barretenberg  
https://noir-lang.org/docs/getting_started/quick_start#proving-backend  
```shell
bbup -nv 1.0.0-beta.2;
```
<!-- ```shell
bbup -v 1.0.0-beta.1;
``` -->

## Run ui locally
```shell
yarn dev
```

## Build static site locally
```shell
yarn build
```

## Deploy
### Set environment variables
```shell
yarn hardhat vars set PRIVATE_KEY; #<=deployment key
yarn hardhat vars set ETHERSCAN_KEY;
yarn compile-contracts;
```

### Deploy contracts
<!-- TODO dont do recompile circuits in scripts/deploy.cjs  -->
```shell
rm -fr ignition/deployments;
yarn hardhat run scripts/deploy.cjs --network sepolia;
cp artifacts/contracts/Token.sol/Token.json website/abis/Token.json;
yarn hardhat ignition deploy ignition/modules/Token.cjs --network sepolia --verify 
```
you need to manually change the contract address:  
ui: [website/main.js](https://github.com/jimjimvalkema/scrollZkWormholes/blob/main/) at line 22     
ui: [scripts/proofAndprivateTransfer.js](https://github.com/jimjimvalkema/scrollZkWormholes/blob/main/scripts/proofAndprivateTransfer.js#L213) at line 213    


## Test
### set privateTransferer privatekey 
(can be same as deployer)
```shell
yarn hardhat vars set RECIPIENT_PRIVATE_KEY;
```  
  
### do privateTransfer
```shell
yarn hardhat run scripts/proofAndprivateTransfer.js 
```


### test circuit
```shell
cd circuits/privateTransferProver;
nargo test;
```

### Compile circuit (verifier contracts are created in `scripts/deploy.cjs`)
```shell
yarn compile-circuits 
```
### get storage slots layout
```shell
forge inspect contracts/Token.sol:Token storage --pretty > contracts/storagelayouts/Token.txt
```