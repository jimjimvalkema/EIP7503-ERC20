import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { network } from "hardhat";
import { WormholeToken$Type } from "../artifacts/contracts/WormholeToken.sol/artifacts.js";
import { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";
// TODO fix @warptoad/gigabridge-js why it doesn't automattically gets @aztec/aztec.js
import {deployPoseidon2Huff} from "@warptoad/gigabridge-js"
import { fromHex, Hex, padBytes, padHex } from "viem";
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
        let root = await wormholeToken.read.root()
        console.log({root})
        const amountFreeTokens = await wormholeToken.read.amountFreeTokens()
        for (const wallet of [alice, bob]) {
            await wormholeToken.write.getFreeTokens([wallet.account.address]) //sends 1_000_000n token

            const preimg = [fromHex(wallet.account.address,"bigint"),amountFreeTokens]
            const leafJs = poseidon2Hash(preimg)
            root = await wormholeToken.read.root()
            console.log({root: root,leaf: leafJs,preimg})
        }
    })

    describe("Token", async function ()  {
        it("Should transfer", async function () {
            console.log({wormholeToken})
            //await wormholeToken.write.transfer([alice.account.address, 420n])
        })
    })
})