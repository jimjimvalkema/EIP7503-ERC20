import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { network } from "hardhat";
import { WormholeToken$Type } from "../artifacts/contracts/WormholeToken.sol/artifacts.js";
import { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";
// TODO fix @warptoad/gigabridge-js why it doesn't automattically gets @aztec/aztec.js
import {deployPoseidon2Huff} from "@warptoad/gigabridge-js"
import { fromHex, Hex, Hex, padBytes, padHex } from "viem";
import { poseidon2Hash } from "@zkpassport/poseidon2"


const WormholeTokenContractName = "WormholeToken"
const leanIMTPoseidon2ContractName = "leanIMTPoseidon2"
const PrivateTransferVerifierContractName = "PrivateTransferVerifier"

describe("Token", async function () {
    const SNARK_SCALAR_FIELD = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617")
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    let wormholeToken: ContractReturnType<typeof WormholeTokenContractName>;
    let PrivateTransferVerifier: ContractReturnType<typeof PrivateTransferVerifierContractName>;
    let leanIMTPoseidon2: ContractReturnType<typeof leanIMTPoseidon2ContractName>;
    const [deployer, alice, bob] = await viem.getWalletClients()

    beforeEach(async function () {
        await deployPoseidon2Huff(publicClient,deployer,padHex("0x00",{size:32}))
        leanIMTPoseidon2 = await viem.deployContract(leanIMTPoseidon2ContractName, [],{libraries:{}}); 
        PrivateTransferVerifier = await viem.deployContract(PrivateTransferVerifierContractName, [],{libraries:{}}); 
        wormholeToken = await viem.deployContract(WormholeTokenContractName, [PrivateTransferVerifier.address] ,{libraries:{leanIMTPoseidon2:leanIMTPoseidon2.address}});
        let _______root = await wormholeToken.read.root()
        for (const wallet of [alice, bob]) {
            await wormholeToken.write.getFreeTokens([wallet.account.address, 1_000_000n])

            const _______preimg = [fromHex(wallet.account.address,"bigint"),1_000_000n]
            const _______leaf = poseidon2Hash(_______preimg)
            _______root = await wormholeToken.read.root()
            const onChainLeaf = await wormholeToken.read.testLeaf()
            const onChainPreimg0 = await wormholeToken.read.onChainPreimg([0n])
            const onChainPreimg1 = await wormholeToken.read.onChainPreimg([1n])
            const onChainPreimg = [onChainPreimg0, onChainPreimg1]
            console.log({_______root, _______leaf,onChainLeaf,onChainPreimg,  _______preimg})
        }
    })

    describe("Token", async function ()  {
        it("Should transfer", async function () {
            console.log({wormholeToken})
            //await wormholeToken.write.transfer([alice.account.address, 420n])
        })
    })
})