import assert from "node:assert/strict";
import { beforeEach, describe, it, after } from "node:test";

import { network } from "hardhat";

// TODO fix @warptoad/gigabridge-js why it doesn't automatically gets @aztec/aztec.js
import { deployPoseidon2Huff } from "@warptoad/gigabridge-js"
import { fromHex, padHex, Hash, parseEventLogs, recoverPublicKey, toHex, Hex, getAddress, hashMessage, hexToBytes, toPrefixedMessage, keccak256, toBytes, GetContractReturnType, getContract } from "viem";
import { poseidon2Hash } from "@zkpassport/poseidon2"

import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import { extractPubKeyFromSig, getPrivateAccount, hashAccountNote, hashNullifier, hashPow, hashTotalReceivedLeaf, signPrivateTransfer } from "../src/hashing.js";
import { POW_DIFFICULTY, SELF_RELAY_FEE_DATA } from "../src/constants.js";
import { getTree, syncPrivateAccountData } from "../src/syncing.js";
import { noir_test_main_self_relay, noir_verify_sig } from "../src/noirtests.js";
import { FeeData, MerkleData, UnformattedPrivateProofInputs, UnformattedPublicProofInputs } from "../src/types.js";
import { treasure } from "viem/chains";
import { formatProofInputs, generateProof, getAccountNoteMerkle, getBackend, getMerkleProofs, getProofInputs, getTotalReceivedMerkle, verifyProof } from "../src/proving.js";
import { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";
import { makePrivateTx } from "../src/transact.js";

console.log({ POW_DIFFICULTY: padHex(toHex(POW_DIFFICULTY), { size: 32, dir: "left" }) })

const logNoirTests = false

const WormholeTokenContractName = "WormholeToken"
const leanIMTPoseidon2ContractName = "leanIMTPoseidon2"
const PrivateTransferVerifierContractName = "PrivateTransferVerifier"
const ZKTranscriptLibContractName = "ZKTranscriptLib"
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
    const [deployer, alice, bob, carol] = await viem.getWalletClients()

    beforeEach(async function () {
        await deployPoseidon2Huff(publicClient, deployer, padHex("0x00", { size: 32 }))
        leanIMTPoseidon2 = await viem.deployContract(leanIMTPoseidon2ContractName, [], { libraries: {} });
        const ZKTranscriptLib = await viem.deployContract(ZKTranscriptLibContractName, [], { libraries: {} });
        PrivateTransferVerifier = await viem.deployContract(PrivateTransferVerifierContractName, [], { client: { wallet: deployer }, libraries: { ZKTranscriptLib: ZKTranscriptLib.address } });
        //PrivateTransferVerifier = await viem.deployContract(PrivateTransferVerifierContractName, [], { client: { wallet: deployer }, libraries: { } });
        wormholeToken = await viem.deployContract(WormholeTokenContractName, [PrivateTransferVerifier.address], { client: { wallet: deployer }, libraries: { leanIMTPoseidon2: leanIMTPoseidon2.address } },);
        let root = await wormholeToken.read.root()
        const amountFreeTokens = await wormholeToken.read.amountFreeTokens()
        // for (const wallet of [alice, bob]) {
        //     await wormholeToken.write.getFreeTokens([wallet.account.address]) //sends 1_000_000n token

        //     const preimg = [fromHex(wallet.account.address, "bigint"), amountFreeTokens]
        //     const leafJs = poseidon2Hash(preimg)
        //     root = await wormholeToken.read.root()
        // }
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
            const alicePrivate = await getPrivateAccount({ wallet: alice })

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
            const { viewingKey, powNonce, pubKey } = await getPrivateAccount({ wallet: alice })
            const powHash = hashPow({ pubKeyX: pubKey.x, powNonce: powNonce });
            assert(powHash < POW_DIFFICULTY, `powHash:${powHash} not smaller then POW_DIFFICULTY:${POW_DIFFICULTY} with powNonce:${powNonce} and pubKeyX:${pubKey.x}`)
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
            if (logNoirTests) { console.log(noir_verify_sig({ pubKeyXHex, pubKeyYHex, rawSigHex, hash })) }
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

        it("should make a noir test that for a private tx by self relaying and verify a proof for carol", async function () {
            const carolPrivate = await getPrivateAccount({ wallet: carol })
            await wormholeToken.write.getFreeTokens([carolPrivate.burnAddress]) //sends 1_000_000n token

            const amountToReMint = 69n
            const reMintRecipient = (await bob.getAddresses())[0]

            const alicePrivateSynced = await syncPrivateAccountData({ wormholeToken: wormholeToken, privateWallet: carolPrivate })
            const formattedProofInputs = await getProofInputs({
                wormholeToken: wormholeToken,
                syncedPrivateWallet: alicePrivateSynced,
                publicClient: publicClient,
                amountToReMint: amountToReMint,
                recipient: reMintRecipient,
                feeData: SELF_RELAY_FEE_DATA
            })
            if (logNoirTests) { console.log(noir_test_main_self_relay(formattedProofInputs)) }
        })

        it("should make a proof for a self relayed tx and verify it in js", async function () {
            const carolPrivate = await getPrivateAccount({ wallet: carol })
            await wormholeToken.write.getFreeTokens([carolPrivate.burnAddress]) //sends 1_000_000n token

            const amountToReMint = 69n
            const reMintRecipient = (await bob.getAddresses())[0]

            const carolPrivateSynced = await syncPrivateAccountData({ wormholeToken: wormholeToken, privateWallet: carolPrivate })
            const formattedProofInputs = await getProofInputs({
                wormholeToken: wormholeToken,
                syncedPrivateWallet: carolPrivateSynced,
                publicClient: publicClient,
                amountToReMint: amountToReMint,
                recipient: reMintRecipient,
                feeData: SELF_RELAY_FEE_DATA
            })
            const proof = await generateProof({ proofInputs: formattedProofInputs, backend: circuitBackend })
            const isValid = await verifyProof({ proof, backend: circuitBackend })
            assert(isValid, "proof invalid")
        })

        it("should make private tx and self relay it", async function () {
            const wormholeTokenAlice = getContract({ client: {public:publicClient, wallet:alice}, abi: wormholeToken.abi, address: wormholeToken.address });
            const amountFreeTokens = await wormholeTokenAlice.read.amountFreeTokens()
            await wormholeTokenAlice.write.getFreeTokens([alice.account.address]) //sends 1_000_000n token
        
            const alicePrivate = await getPrivateAccount({ wallet: alice })
            const amountToBurn = 420n;
            await wormholeTokenAlice.write.transfer([alicePrivate.burnAddress, amountToBurn]) //sends 1_000_000n token

            const amountToReMint = 69n
            const reMintRecipient = bob.account.address
            let alicePrivateSynced = await syncPrivateAccountData({ wormholeToken: wormholeTokenAlice, privateWallet: alicePrivate })
            const reMintTx1 = await makePrivateTx({
                wormholeToken: wormholeTokenAlice,
                syncedPrivateWallet: alicePrivateSynced,
                publicClient,
                amount: amountToReMint,
                recipient: reMintRecipient,
                backend: circuitBackend
            })

            const balanceAlicePublic = await wormholeTokenAlice.read.balanceOf([alice.account.address])
            const burnedBalanceAlicePrivate = await wormholeTokenAlice.read.balanceOf([alicePrivate.burnAddress])
            let balanceBobPublic = await wormholeTokenAlice.read.balanceOf([bob.account.address])

            assert.equal(burnedBalanceAlicePrivate, amountToBurn, "alicePrivate.burnAddress didn't burn the expected amount of tokens")
            assert.equal(balanceAlicePublic, amountFreeTokens - amountToBurn, "alice didn't burn the expected amount of tokens")
            assert.equal(balanceBobPublic, amountToReMint, "bob didn't receive the expected amount of re-minted tokens")

            // sync for the next tx, TODO make it auto detect if it needs to sync wallet based on if that account nonce is nullified
            alicePrivateSynced = await syncPrivateAccountData({ wormholeToken: wormholeTokenAlice, privateWallet: alicePrivate })
            console.log({alicePrivateSynced})
            // we should be able to do it again!!!
            // TODO add input for a pre-synced tree so we don't resync every time
            const reMintTx2 = await makePrivateTx({
                wormholeToken: wormholeTokenAlice,
                syncedPrivateWallet: alicePrivateSynced,
                publicClient,
                amount: amountToReMint,
                recipient: reMintRecipient,
                backend: circuitBackend
            })
            balanceBobPublic = await wormholeTokenAlice.read.balanceOf([bob.account.address])
            assert.equal(balanceBobPublic, amountToReMint*2n, "bob didn't receive the expected amount of re-minted tokens")

            // one more time
            alicePrivateSynced = await syncPrivateAccountData({ wormholeToken: wormholeTokenAlice, privateWallet: alicePrivate })
            const reMintTx3 = await makePrivateTx({
                wormholeToken: wormholeTokenAlice,
                syncedPrivateWallet: alicePrivateSynced,
                publicClient,
                amount: amountToReMint,
                recipient: reMintRecipient,
                backend: circuitBackend
            })
            balanceBobPublic = await wormholeTokenAlice.read.balanceOf([bob.account.address])
            assert.equal(balanceBobPublic, amountToReMint*3n, "bob didn't receive the expected amount of re-minted tokens")
        })
    })
})