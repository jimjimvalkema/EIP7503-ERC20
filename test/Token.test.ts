import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";
import { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";
// TODO fix @warptoad/gigabridge-js why it doesn't automatically gets @aztec/aztec.js
import { deployPoseidon2Huff } from "@warptoad/gigabridge-js"
import { fromHex, padHex, Hash, parseEventLogs, recoverPublicKey, toHex, Hex } from "viem";
import { poseidon2Hash } from "@zkpassport/poseidon2"

import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import privateTransferCircuit from '../circuits/privateTransfer/target/private_transfer.json';
import { getKeys, hashPow } from "../src/hashing.js";
import { POW_DIFFICULTY } from "../src/constants.js";
import { getTree } from "../src/syncing.js";
import { noir_verify_sig } from "../src/noirtests.js";

console.log({ POW_DIFFICULTY: padHex(toHex(POW_DIFFICULTY), { size: 32, dir: "left" }) })

const WormholeTokenContractName = "WormholeToken"
const leanIMTPoseidon2ContractName = "leanIMTPoseidon2"
const PrivateTransferVerifierContractName = "PrivateTransferVerifier"
const ZKTranscriptLibContractName = "ZKTranscriptLib"

export type WormholeTokenTest = ContractReturnType<typeof WormholeTokenContractName>


let gas: any = { "transfers": {} }
describe("Token", async function () {
    const SNARK_SCALAR_FIELD = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617")
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    let wormholeToken: ContractReturnType<typeof WormholeTokenContractName>;
    let PrivateTransferVerifier: ContractReturnType<typeof PrivateTransferVerifierContractName>;
    let leanIMTPoseidon2: ContractReturnType<typeof leanIMTPoseidon2ContractName>;
    const [deployer, alice, bob] = await viem.getWalletClients()

    beforeEach(async function () {
        await deployPoseidon2Huff(publicClient, deployer, padHex("0x00", { size: 32 }))
        leanIMTPoseidon2 = await viem.deployContract(leanIMTPoseidon2ContractName, [], { libraries: {} });
        const ZKTranscriptLib = await viem.deployContract(ZKTranscriptLibContractName, [], { libraries: {} });
        PrivateTransferVerifier = await viem.deployContract(PrivateTransferVerifierContractName, [], { client: { wallet: deployer }, libraries: { ZKTranscriptLib: ZKTranscriptLib.address } });
        wormholeToken = await viem.deployContract(WormholeTokenContractName, [PrivateTransferVerifier.address], { client: { wallet: deployer }, libraries: { leanIMTPoseidon2: leanIMTPoseidon2.address } },);
        let root = await wormholeToken.read.root()
        const amountFreeTokens = await wormholeToken.read.amountFreeTokens()
        for (const wallet of [alice, bob]) {
            await wormholeToken.write.getFreeTokens([wallet.account.address]) //sends 1_000_000n token

            const preimg = [fromHex(wallet.account.address, "bigint"), amountFreeTokens]
            const leafJs = poseidon2Hash(preimg)
            root = await wormholeToken.read.root()
        }
    })

    describe("Token", async function () {
        it("Should transfer", async function () {
            let totalAmountInserts = 0
            const startIndex = 2
            for (let index = startIndex; index < 3; index++) {
                //it("Should transfer", async function () {
                const amountFreeTokens = await wormholeToken.read.amountFreeTokens()
                await wormholeToken.write.getFreeTokens([deployer.account.address]) //sends 1_000_000n token

                let transferTx: Hash = "0x00"
                const amountTransfers = 2 ** index + Math.floor(Math.random() * startIndex - startIndex / 2);// a bit of noise is always good!
                totalAmountInserts += amountTransfers + 1
                const firstTransferTx = await wormholeToken.write.transfer([alice.account.address, 420n])
                for (let index = 0; index < amountTransfers; index++) {
                    transferTx = await wormholeToken.write.transfer([alice.account.address, 420n])
                }
                // if deployer send to it self. tx.origin == recipient, and the merkle insertion is skipped!
                // warm the slot
                await wormholeToken.write.transfer([deployer.account.address, 420n])
                const transferWithoutMerkleTx = await wormholeToken.write.transfer([deployer.account.address, 420n])
                const transferWithoutMerkleReceipt = await publicClient.getTransactionReceipt({ hash: transferWithoutMerkleTx })
                const firstTransferWithMerkleReceipt = await publicClient.getTransactionReceipt({ hash: firstTransferTx })

                const transferWithoutMerkleEvents = parseEventLogs({
                    abi: wormholeToken.abi,
                    eventName: 'Transfer',
                    logs: transferWithoutMerkleReceipt.logs,
                })

                const tree = await getTree({ wormholeToken, publicClient })
                const jsRoot = tree.root
                const onchainRoot = await wormholeToken.read.root()
                assert.equal(jsRoot, onchainRoot, "jsRoot doesn't match onchainRoot")
                const transferWithMerkleReceipt = await publicClient.getTransactionReceipt({ hash: transferTx })
                gas["transfers"][index] = {
                    totalAmountInserts,
                    // dangling node inserts are cheaper so we take 2 measurements to hopefully catch a non dangling insert? @TODO find better method
                    transferWithoutMerkle: { high: transferWithoutMerkleReceipt.gasUsed, low: transferWithoutMerkleReceipt.gasUsed },
                    transferWithMerkle___: { high: transferWithMerkleReceipt.gasUsed, low: firstTransferWithMerkleReceipt.gasUsed },
                    depth: (await wormholeToken.read.tree())[1]

                }
            }
            const gasString = JSON.stringify(gas, (key, value) => typeof value === 'bigint' ? Number(value) : value, 2)
        })

        it("should make keys", async function () {
            const { viewingKey, powNonce, pubKey } = await getKeys({ wallet: deployer })
            const powHash = hashPow({ pubKeyX: pubKey.x, powNonce: powNonce });
            console.log({
                powHash_______: padHex(toHex(powHash), { size: 32, dir: "left" }),
                POW_DIFFICULTY: padHex(toHex(POW_DIFFICULTY), { size: 32, dir: "left" })
            })
            assert(powHash < POW_DIFFICULTY, `powHash:${powHash} not smaller then POW_DIFFICULTY:${POW_DIFFICULTY} with powNonce:${powNonce} and pubKeyX:${pubKey.x}`)
            //console.log({ viewingKey, powNonce, pubKey })
            //@ts-ignore idk why it works tho
            //const noir = new Noir(privateTransferCircuit);
        })
        it("should make me a test to verify a signature in noir", async function () {
            // there is an extra byte in this?
            const hash = padHex("0x420690", { size: 32 });
            const signature = await deployer.request({
                method: 'eth_sign',
                params: [deployer.account.address, hash],
            });
            const publicKey = await recoverPublicKey({
                hash: hash,
                signature: signature
            });
            // first byte is cringe
            const pubKeyXHex = "0x" + publicKey.slice(4).slice(0, 64) as Hex
            const pubKeyYHex = "0x" + publicKey.slice(4).slice(64, 128) as Hex
            const rawSigHex = "0x" + signature.slice(0, 2+128) as Hex
            //console.log(noir_verify_sig({pubKeyXHex,pubKeyYHex, rawSigHex, hash}))
        })
    })
})