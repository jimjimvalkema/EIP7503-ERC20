## deploy
setup secrets:  
`yarn hardhat keystore set SEPOLIA_RPC_URL`  
`yarn hardhat keystore set SEPOLIA_PRIVATE_KEY`  
`yarn hardhat keystore set ETHERSCAN_API_KEY`  

deploy main contracts:  
*TODO this doesn't verify shit*
```shell
yarn hardhat ignition deploy ignition/modules/wormtoken.ts --verify --network sepolia
```  

deploy poseidon2 hasher with create2 (if it's not deployed yet)
```shell
yarn hardhat run scripts/deployPoseidon2.ts --network sepolia
```

## deployed addresses
### sepolia 
WormholeToken - [0x67Cc5Ac2029aaA9FD56F7D036d61f2d80A034c10](https://sepolia.etherscan.io/address/0x67Cc5Ac2029aaA9FD56F7D036d61f2d80A034c10)  


PrivateTransferVerifier - [0x342149C7108bb2b0052624f61629f5813B9B9466](https://sepolia.etherscan.io/address/0x342149C7108bb2b0052624f61629f5813B9B9466)  
ZKTranscriptLib - [0x8F961e056967DD2A1170dBeCd9e5E51CA815B0D9](https://sepolia.etherscan.io/address/0x8F961e056967DD2A1170dBeCd9e5E51CA815B0D9)  
leanIMTPoseidon2 - [0xcbf45ce9650A8F4E51933A13857016B1A44c3d94](https://sepolia.etherscan.io/address/0xcbf45ce9650A8F4E51933A13857016B1A44c3d94)  
