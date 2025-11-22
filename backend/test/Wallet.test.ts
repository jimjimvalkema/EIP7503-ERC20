import assert from "node:assert/strict";
import { beforeEach, describe, it, after } from "node:test";

import { network } from "hardhat";

// TODO fix @warptoad/gigabridge-js why it doesn't automatically gets @aztec/aztec.js
import { deployPoseidon2Huff } from "@warptoad/gigabridge-js"
import { padHex, Hash, recoverPublicKey, toHex, Hex, hashMessage, toPrefixedMessage, keccak256, getContract, getAddress, Address } from "viem";
import { poseidon2Hash } from "@zkpassport/poseidon2"

import { getPrivateAccount, hashPow } from "../src/hashing.js";
import { POW_DIFFICULTY, EMPTY_FEE_DATA, WormholeTokenContractName, PrivateTransferVerifierContractName, leanIMTPoseidon2ContractName, ZKTranscriptLibContractName } from "../src/constants.js";
import { getTree, syncPrivateWallet } from "../src/syncing.js";
//import { noir_test_main_self_relay, noir_verify_sig } from "../src/noirtests.js";
import { formatProofInputs, generateProof, getBackend, getUnformattedProofInputs, verifyProof } from "../src/proving.js";
import { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";
import { createRelayerInputs, proofAndSelfRelay, relayTx } from "../src/transact.js";
import { RelayerInputs, UnsyncedPrivateWallet } from "../src/types.js";

const logNoirTests = false
const provingThreads = 1; //undefined  // giving the backend more threads makes it hang and impossible to debug // set to undefined to use max threads available

export type WormholeTokenTest = ContractReturnType<typeof WormholeTokenContractName>


let gas: any = { "transfers": {} }
describe("Token", async function () {
    const SNARK_SCALAR_FIELD = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617")

    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    let wormholeToken: ContractReturnType<typeof WormholeTokenContractName>;
    let PrivateTransferVerifier: ContractReturnType<typeof PrivateTransferVerifierContractName>;
    let leanIMTPoseidon2: ContractReturnType<typeof leanIMTPoseidon2ContractName>;
    const circuitBackend = await getBackend(provingThreads);
    const [deployer, alice, bob, carol, relayer, feeEstimator] = await viem.getWalletClients()
    let feeEstimatorRelayerInputs: RelayerInputs;
    let feeEstimatorPrivate: UnsyncedPrivateWallet


    beforeEach(async function () {
        const poseidon2Create2Salt = padHex("0x00", { size: 32 })
        await deployPoseidon2Huff(publicClient, deployer, poseidon2Create2Salt)
        leanIMTPoseidon2 = await viem.deployContract(leanIMTPoseidon2ContractName, [], { libraries: {} });
        const ZKTranscriptLib = await viem.deployContract(ZKTranscriptLibContractName, [], { libraries: {} });
        PrivateTransferVerifier = await viem.deployContract(PrivateTransferVerifierContractName, [], { client: { wallet: deployer }, libraries: { ZKTranscriptLib: ZKTranscriptLib.address } });
        //PrivateTransferVerifier = await viem.deployContract(PrivateTransferVerifierContractName, [], { client: { wallet: deployer }, libraries: { } });
        wormholeToken = await viem.deployContract(WormholeTokenContractName, [PrivateTransferVerifier.address], { client: { wallet: deployer }, libraries: { leanIMTPoseidon2: leanIMTPoseidon2.address } },);

        const sharedSecret = 0n
        feeEstimatorPrivate = await getPrivateAccount({ wallet: feeEstimator, sharedSecret })
        await wormholeToken.write.getFreeTokens([feeEstimatorPrivate.burnAddress])
    })

    after(function () {
        if (provingThreads != 1) {
            console.log("if a test is skipped comment out process.exit(0) to see the error")
            //bb's wasm fucks with node not closing
            process.exit(0);
        }
    })

    describe("Token", async function () {
        it("Should transfer", async function () {
            const sharedSecret = 0n
            const alicePrivate = await getPrivateAccount({ wallet: alice, sharedSecret })

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
                    transferTx = await wormholeToken.write.transfer([alicePrivate.burnAddress, 420n])
                }
                // if deployer send to it self. tx.origin == recipient, and the merkle insertion is skipped!
                // warm the slot
                await wormholeToken.write.transfer([deployer.account.address, 420n])
                const transferWithoutMerkleTx = await wormholeToken.write.transfer([deployer.account.address, 420n])
                const transferWithoutMerkleReceipt = await publicClient.getTransactionReceipt({ hash: transferWithoutMerkleTx })
                const firstTransferWithMerkleReceipt = await publicClient.getTransactionReceipt({ hash: firstTransferTx })

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
            const sharedSecret = 0n
            const { viewingKey, pubKey } = await getPrivateAccount({ wallet: alice, sharedSecret })
            const powHash = hashPow({ pubKeyX: pubKey.x, sharedSecret: sharedSecret });
            //assert(powHash < POW_DIFFICULTY, `powHash:${powHash} not smaller then POW_DIFFICULTY:${POW_DIFFICULTY} with sharedSecret:${sharedSecret} and pubKeyX:${pubKey.x}`)
        })

        // this does not create the "\x19Ethereum Signed Message:\n" prefix????
        // my poseidon hashes do in signPrivateTransfer() 
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
            const rawSigHex = "0x" + signature.slice(0, 2 + 128) as Hex
            //if (logNoirTests) { console.log(noir_verify_sig({ pubKeyXHex, pubKeyYHex, rawSigHex, hash })) }
        })

        it("should not matter what was signed to extract public key", async function () {
            const expectedPubKeyAlice = "0x04ba5734d8f7091719471e7f7ed6b9df170dc70cc661ca05e688601ad984f068b0d67351e5f06073092499336ab0839ef8a521afd334e53807205fa2f08eec74f4"
            const getKeys = async (message: string) => {
                const poseidonHash = toHex(poseidon2Hash([BigInt('0x' + new TextEncoder().encode(message).reduce((s, b) => s + b.toString(16).padStart(2, '0'), ''))]), { size: 32 });

                let signature = await alice.request({
                    method: 'eth_sign',
                    params: [alice.account.address, poseidonHash],
                });

                // note: hashMessage needs raw here since
                const preImageOfKeccak = toPrefixedMessage({ raw: poseidonHash })
                const KeccakWrappedPoseidonHash = keccak256(preImageOfKeccak);
                const publicKey1 = await recoverPublicKey({
                    hash: KeccakWrappedPoseidonHash,
                    signature: signature
                });

                const signatureOnRaw = await alice.signMessage({ message: { raw: toHex(message) }, account: alice.account });
                signature = await alice.signMessage({ message, account: alice.account });
                const keccakHash = hashMessage(message);
                const publicKey2 = await recoverPublicKey({
                    hash: keccakHash,
                    signature: signature
                });
                assert.equal(publicKey1, expectedPubKeyAlice)
                assert.equal(publicKey2, expectedPubKeyAlice)
            }
            await getKeys("hello!")
            await getKeys("hello again!")
        })
    })
})