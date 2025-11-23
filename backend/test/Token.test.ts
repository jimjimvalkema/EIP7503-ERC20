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

//console.log({ POW_DIFFICULTY: padHex(toHex(POW_DIFFICULTY), { size: 32, dir: "left" }) })

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
            
        
        it("should make a proof for a self relayed tx and verify it in js", async function () {
            const sharedSecret = 0n
            const carolPrivate = await getPrivateAccount({ wallet: carol, sharedSecret })
            await wormholeToken.write.getFreeTokens([carolPrivate.burnAddress]) //sends 1_000_000n token

            const carolPrivateSynced = await syncPrivateWallet({ privateWallet: carolPrivate, wormholeToken })

            const amountToReMint = 69n
            const reMintRecipient = bob.account.address

            const unFormattedProofInputs = await getUnformattedProofInputs({
                wormholeToken: wormholeToken,
                privateWallet: carolPrivateSynced,
                publicClient: publicClient,
                amountToReMint: amountToReMint,
                recipient: reMintRecipient,
                feeData: EMPTY_FEE_DATA
            })
            const formattedProofInputs = formatProofInputs(unFormattedProofInputs)
            const proof = await generateProof({ proofInputs: formattedProofInputs, backend: circuitBackend })
            const isValid = await verifyProof({ proof, backend: circuitBackend })
            assert(isValid, "proof invalid")
        })
            
        
        it("should make private tx and self relay it", async function () {
            const wormholeTokenAlice = getContract({ client: { public: publicClient, wallet: alice }, abi: wormholeToken.abi, address: wormholeToken.address });
            const amountFreeTokens = await wormholeTokenAlice.read.amountFreeTokens()
            await wormholeTokenAlice.write.getFreeTokens([alice.account.address]) //sends 1_000_000n token

            const sharedSecret = 0n
            const alicePrivate = await getPrivateAccount({ wallet: alice, sharedSecret })
            const amountToBurn = 420n;
            await wormholeTokenAlice.write.transfer([alicePrivate.burnAddress, amountToBurn]) //sends 1_000_000n token

            const amountToReMint = 69n
            const reMintRecipient = bob.account.address
            //let alicePrivateSynced = await syncPrivateAccountData({ wormholeToken: wormholeTokenAlice, privateWallet: alicePrivate })
            
            const reMintTx1 = await proofAndSelfRelay({
                wormholeToken: wormholeTokenAlice,
                privateWallet: alicePrivate,
                publicClient,
                amount: amountToReMint,
                recipient: reMintRecipient,
                backend: circuitBackend
            })
            console.log("\n\n\n OGGEE \n\n\n")

            const balanceAlicePublic = await wormholeTokenAlice.read.balanceOf([alice.account.address])
            const burnedBalanceAlicePrivate = await wormholeTokenAlice.read.balanceOf([alicePrivate.burnAddress])
            let balanceBobPublic = await wormholeTokenAlice.read.balanceOf([bob.account.address])

            assert.equal(burnedBalanceAlicePrivate, amountToBurn, "alicePrivate.burnAddress didn't burn the expected amount of tokens")
            assert.equal(balanceAlicePublic, amountFreeTokens - amountToBurn, "alice didn't burn the expected amount of tokens")
            assert.equal(balanceBobPublic, amountToReMint, "bob didn't receive the expected amount of re-minted tokens")
        })

        /*
        it("should make private tx and self relay it 3 times", async function () {
            const wormholeTokenAlice = getContract({ client: { public: publicClient, wallet: alice }, abi: wormholeToken.abi, address: wormholeToken.address });
            const amountFreeTokens = await wormholeTokenAlice.read.amountFreeTokens()
            await wormholeTokenAlice.write.getFreeTokens([alice.account.address]) //sends 1_000_000n token

            const sharedSecret = 0n
            const alicePrivate = await getPrivateAccount({ wallet: alice, sharedSecret })
            const amountToBurn = 420n;
            await wormholeTokenAlice.write.transfer([alicePrivate.burnAddress, amountToBurn]) //sends 1_000_000n token

            const amountToReMint = 69n
            const reMintRecipient = bob.account.address
            //let alicePrivateSynced = await syncPrivateAccountData({ wormholeToken: wormholeTokenAlice, privateWallet: alicePrivate })
            //console.log("1111111")
            const reMintTx1 = await proofAndSelfRelay({
                wormholeToken: wormholeTokenAlice,
                privateWallet: alicePrivate,
                publicClient,
                amount: amountToReMint,
                recipient: reMintRecipient,
                backend: circuitBackend
            })

            //console.log("222222222")

            const balanceAlicePublic = await wormholeTokenAlice.read.balanceOf([alice.account.address])
            const burnedBalanceAlicePrivate = await wormholeTokenAlice.read.balanceOf([alicePrivate.burnAddress])
            let balanceBobPublic = await wormholeTokenAlice.read.balanceOf([bob.account.address])

            assert.equal(burnedBalanceAlicePrivate, amountToBurn, "alicePrivate.burnAddress didn't burn the expected amount of tokens")
            assert.equal(balanceAlicePublic, amountFreeTokens - amountToBurn, "alice didn't burn the expected amount of tokens")
            assert.equal(balanceBobPublic, amountToReMint, "bob didn't receive the expected amount of re-minted tokens")

            // we should be able to do it again!!!
            // TODO add input for a pre-synced tree so we don't resync every time
            const realRoot = await wormholeToken.read.root()
            const reMintTx2 = await proofAndSelfRelay({
                wormholeToken: wormholeTokenAlice,
                privateWallet: alicePrivate,
                publicClient,
                amount: amountToReMint,
                recipient: reMintRecipient,
                backend: circuitBackend
            })
            balanceBobPublic = await wormholeTokenAlice.read.balanceOf([bob.account.address])
            assert.equal(balanceBobPublic, amountToReMint * 2n, "bob didn't receive the expected amount of re-minted tokens")

            // one more time
            const reMintTx3 = await proofAndSelfRelay({
                wormholeToken: wormholeTokenAlice,
                privateWallet: alicePrivate,
                publicClient,
                amount: amountToReMint,
                recipient: reMintRecipient,
                backend: circuitBackend
            })
            balanceBobPublic = await wormholeTokenAlice.read.balanceOf([bob.account.address])
            assert.equal(balanceBobPublic, amountToReMint * 3n, "bob didn't receive the expected amount of re-minted tokens")
        })
            */
    })
})