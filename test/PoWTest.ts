import assert from "node:assert/strict";
import { beforeEach, describe, it, after } from "node:test";

import { network } from "hardhat";

// TODO fix @warptoad/gigabridge-js why it doesn't automatically gets @aztec/aztec.js
import { deployPoseidon2Huff } from "@warptoad/gigabridge-js"

import { FIELD_LIMIT, WormholeTokenContractName, PrivateTransfer2InVerifierContractName, leanIMTPoseidon2ContractName, ZKTranscriptLibContractName100in, PrivateTransfer100InVerifierContractName } from "../src/constants.js";
import { getSyncedMerkleTree } from "../src/syncing.js";
//import { noir_test_main_self_relay, noir_verify_sig } from "../src/noirtests.js";
import { getBackend } from "../src/proving.js";
import type { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";
import { proofAndSelfRelay, safeBurn, superSafeBurn } from "../src/transact.js";
import type { BurnAccount, UnsyncedBurnAccount } from "../src/types.js";
import { PrivateWallet } from "../src/PrivateWallet.js";
import { getContract, padHex, parseEventLogs, type Hash, type Hex } from "viem";

const provingThreads = 1;//1 //1; //undefined  // giving the backend more threads makes it hang and impossible to debug // set to undefined to use max threads available

export type WormholeTokenTest = ContractReturnType<typeof WormholeTokenContractName>

const CIRCUIT_SIZE = 100

let gas: any = { "transfers": {} }
describe("Token", async function () {
    const SNARK_SCALAR_FIELD = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617")

    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    let wormholeToken: ContractReturnType<typeof WormholeTokenContractName>;
    let PrivateTransferVerifier1In: ContractReturnType<typeof PrivateTransfer2InVerifierContractName>;
    let PrivateTransferVerifier100In: ContractReturnType<typeof PrivateTransfer100InVerifierContractName>;
    let leanIMTPoseidon2: ContractReturnType<typeof leanIMTPoseidon2ContractName>;
    const circuitBackend = await getBackend(CIRCUIT_SIZE, provingThreads);
    const [deployer, alice, bob, carol, relayer, feeEstimator] = await viem.getWalletClients()
    //let feeEstimatorPrivate: UnsyncedPrivateWallet


    beforeEach(async function () {
        const poseidon2Create2Salt = padHex("0x00", { size: 32 })
        await deployPoseidon2Huff(publicClient, deployer, poseidon2Create2Salt)
        leanIMTPoseidon2 = await viem.deployContract(leanIMTPoseidon2ContractName, [], { libraries: {} });
        const ZKTranscriptLib = await viem.deployContract(ZKTranscriptLibContractName100in, [], { libraries: {} });
        PrivateTransferVerifier1In = await viem.deployContract(PrivateTransfer2InVerifierContractName, [], { client: { wallet: deployer }, libraries: { ZKTranscriptLib: ZKTranscriptLib.address } });
        PrivateTransferVerifier100In = await viem.deployContract(PrivateTransfer100InVerifierContractName, [], { client: { wallet: deployer }, libraries: { ZKTranscriptLib: ZKTranscriptLib.address } });
        //PrivateTransferVerifier = await viem.deployContract(PrivateTransferVerifierContractName, [], { client: { wallet: deployer }, libraries: { } });
        wormholeToken = await viem.deployContract(WormholeTokenContractName, [PrivateTransferVerifier1In.address, PrivateTransferVerifier100In.address], { client: { wallet: deployer }, libraries: { leanIMTPoseidon2: leanIMTPoseidon2.address } },);

        //feeEstimatorPrivate = await getPrivateAccount({ wallet: feeEstimator, sharedSecret })
        //await wormholeToken.write.getFreeTokens([feeEstimatorPrivate.burnAddress])
    })

    after(function () {
        if (provingThreads != 1) {
            console.log("if a test is skipped comment out process.exit(0) to see the error")
            //bb's wasm fucks with node not closing
            //process.exit(0);
        }
    })

    describe("Token", async function () {
        it("make 10 accounts in parallel", async function () {
            const wormholeTokenAlice = getContract({ client: { public: publicClient, wallet: alice }, abi: wormholeToken.abi, address: wormholeToken.address });
            const amountFreeTokens = await wormholeTokenAlice.read.amountFreeTokens()
            await wormholeTokenAlice.write.getFreeTokens([alice.account.address]) //sends 1_000_000n token

            const alicePrivate = new PrivateWallet(alice, { acceptedChainIds: [BigInt(await publicClient.getChainId())] })
            const amountBurnAddresses = 10

            const burnAccounts:UnsyncedBurnAccount[] = await alicePrivate.createBurnAccounts(amountBurnAddresses,{async:true})
        })
    })


})