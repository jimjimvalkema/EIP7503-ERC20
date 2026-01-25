import assert from "node:assert/strict";
import { beforeEach, describe, it, after } from "node:test";

import { network } from "hardhat";

// TODO fix @warptoad/gigabridge-js why it doesn't automatically gets @aztec/aztec.js
import { deployPoseidon2Huff } from "@warptoad/gigabridge-js"
import { padHex, Hash, recoverPublicKey, toHex, Hex, hashMessage, toPrefixedMessage, keccak256, getContract, getAddress, Address } from "viem";
import { poseidon2Hash } from "@zkpassport/poseidon2"

import { getPrivateAccount, hashPow } from "../src/hashing.js";
import { POW_DIFFICULTY, EMPTY_FEE_DATA, WormholeTokenContractName, PrivateTransfer1InVerifierContractName, leanIMTPoseidon2ContractName, ZKTranscriptLibContractName, PrivateTransfer4InVerifierContractName } from "../src/constants.js";
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
    let PrivateTransferVerifier1In: ContractReturnType<typeof PrivateTransfer1InVerifierContractName>;
    let PrivateTransferVerifier4In: ContractReturnType<typeof PrivateTransfer4InVerifierContractName>;
    let leanIMTPoseidon2: ContractReturnType<typeof leanIMTPoseidon2ContractName>;
    const circuitBackend = await getBackend(1,provingThreads);
    const [deployer, alice, bob, carol, relayer, feeEstimator] = await viem.getWalletClients()
    let feeEstimatorRelayerInputs: RelayerInputs;
    let feeEstimatorPrivate: UnsyncedPrivateWallet


    beforeEach(async function () {
        const poseidon2Create2Salt = padHex("0x00", { size: 32 })
        await deployPoseidon2Huff(publicClient, deployer, poseidon2Create2Salt)
        leanIMTPoseidon2 = await viem.deployContract(leanIMTPoseidon2ContractName, [], { libraries: {} });
        const ZKTranscriptLib = await viem.deployContract(ZKTranscriptLibContractName, [], { libraries: {} });
        PrivateTransferVerifier1In = await viem.deployContract(PrivateTransfer1InVerifierContractName, [], { client: { wallet: deployer }, libraries: { ZKTranscriptLib: ZKTranscriptLib.address } });
        PrivateTransferVerifier4In = await viem.deployContract(PrivateTransfer4InVerifierContractName, [], { client: { wallet: deployer }, libraries: { ZKTranscriptLib: ZKTranscriptLib.address } });
        //PrivateTransferVerifier = await viem.deployContract(PrivateTransferVerifierContractName, [], { client: { wallet: deployer }, libraries: { } });
        wormholeToken = await viem.deployContract(WormholeTokenContractName, [PrivateTransferVerifier1In.address, PrivateTransferVerifier4In.address], { client: { wallet: deployer }, libraries: { leanIMTPoseidon2: leanIMTPoseidon2.address } },);

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
        it("should make private tx and self relay it", async function () {
            const wormholeTokenAlice = getContract({ client: { public: publicClient, wallet: alice }, abi: wormholeToken.abi, address: wormholeToken.address });
            const amountFreeTokens = await wormholeTokenAlice.read.amountFreeTokens()
            await wormholeTokenAlice.write.getFreeTokens([alice.account.address]) //sends 1_000_000n token

            const sharedSecret1 = 1n
            const sharedSecret2 = 2n
            const alicePrivate1 = await getPrivateAccount({ wallet: alice, sharedSecret:sharedSecret1 })
            const alicePrivate2 = await getPrivateAccount({ wallet: alice, sharedSecret:sharedSecret2 })
            const alicePrivateWallets = [alicePrivate1, alicePrivate2]
            const amountToBurn = 20n;
            await wormholeTokenAlice.write.transfer([alicePrivate1.burnAddress, amountToBurn]) //sends 1_000_000n token
            await wormholeTokenAlice.write.transfer([alicePrivate2.burnAddress, amountToBurn]) //sends 1_000_000n token

            const amountToReMint = 30n
            const reMintRecipient = bob.account.address
            //let alicePrivateSynced = await syncPrivateAccountData({ wormholeToken: wormholeTokenAlice, privateWallet: alicePrivate })
            const amountsToClaim = [20n, 10n] // adds up to amountToReMint (30n)
            const reMintTx1 = await proofAndSelfRelay({
                wormholeToken: wormholeTokenAlice,
                privateWallets: alicePrivateWallets,
                publicClient,
                amount: amountToReMint,
                recipient: reMintRecipient,
                backend: circuitBackend,
                amountsToClaim:amountsToClaim
            })


            // ----------TODO---------------------
            // const balanceAlicePublic = await wormholeTokenAlice.read.balanceOf([alice.account.address])
            // const burnedBalanceAlicePrivate = await wormholeTokenAlice.read.balanceOf([alicePrivate.burnAddress])
            // let balanceBobPublic = await wormholeTokenAlice.read.balanceOf([bob.account.address])

            // assert.equal(burnedBalanceAlicePrivate, amountToBurn, "alicePrivate.burnAddress didn't burn the expected amount of tokens")
            // assert.equal(balanceAlicePublic, amountFreeTokens - amountToBurn, "alice didn't burn the expected amount of tokens")
            // assert.equal(balanceBobPublic, amountToReMint, "bob didn't receive the expected amount of re-minted tokens")
        })
    })
})