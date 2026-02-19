import assert from "node:assert/strict";
import { beforeEach, describe, it, after } from "node:test";

import { network } from "hardhat";

// TODO fix @warptoad/gigabridge-js why it doesn't automatically gets @aztec/aztec.js
import { deployPoseidon2Huff } from "@warptoad/gigabridge-js"

import { FIELD_LIMIT, WormholeTokenContractName, PrivateTransfer1InVerifierContractName, leanIMTPoseidon2ContractName, ZKTranscriptLibContractName, PrivateTransfer100InVerifierContractName } from "../src/constants.js";
import { getSyncedMerkleTree } from "../src/syncing.js";
//import { noir_test_main_self_relay, noir_verify_sig } from "../src/noirtests.js";
import { getBackend } from "../src/proving.js";
import type { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";
import { createRelayerInputs, proofAndSelfRelay, relayTx, safeBurn, superSafeBurn } from "../src/transact.js";
import { PrivateWallet } from "../src/PrivateWallet.js";
import { getContract, padHex, parseEventLogs, toHex, type Hash, type Hex } from "viem";
import type { RelayInputs } from "../src/types.ts";

const provingThreads = 1 //1; //undefined  // giving the backend more threads makes it hang and impossible to debug // set to undefined to use max threads available

export type WormholeTokenTest = ContractReturnType<typeof WormholeTokenContractName>


let gas: any = { "transfers": {} }
describe("Token", async function () {
    const SNARK_SCALAR_FIELD = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617")

    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    let wormholeToken: ContractReturnType<typeof WormholeTokenContractName>;
    let PrivateTransferVerifier1In: ContractReturnType<typeof PrivateTransfer1InVerifierContractName>;
    let PrivateTransferVerifier100In: ContractReturnType<typeof PrivateTransfer100InVerifierContractName>;
    let leanIMTPoseidon2: ContractReturnType<typeof leanIMTPoseidon2ContractName>;
    const circuitBackend = await getBackend(2, provingThreads);
    const [deployer, alice, bob, carol, relayer, feeEstimator] = await viem.getWalletClients()
    //let feeEstimatorPrivate: UnsyncedPrivateWallet


    beforeEach(async function () {
        const poseidon2Create2Salt = padHex("0x00", { size: 32 })
        await deployPoseidon2Huff(publicClient, deployer, poseidon2Create2Salt)
        leanIMTPoseidon2 = await viem.deployContract(leanIMTPoseidon2ContractName, [], { libraries: {} });
        const ZKTranscriptLib = await viem.deployContract(ZKTranscriptLibContractName, [], { libraries: {} });
        PrivateTransferVerifier1In = await viem.deployContract(PrivateTransfer1InVerifierContractName, [], { client: { wallet: deployer }, libraries: { ZKTranscriptLib: ZKTranscriptLib.address } });
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
            process.exit(0);
        }
    })

    describe("Token", async function () {
        it("reMint 3x from 1 burn account", async function () {
            const wormholeTokenAlice = getContract({ client: { public: publicClient, wallet: alice }, abi: wormholeToken.abi, address: wormholeToken.address });
            const amountFreeTokens = await wormholeTokenAlice.read.amountFreeTokens()
            await wormholeTokenAlice.write.getFreeTokens([alice.account.address]) //sends 1_000_000n token

            const chainId = BigInt(await publicClient.getChainId())
            const alicePrivate = new PrivateWallet(alice, { acceptedChainIds: [chainId] })
            const aliceBurnAccount = await alicePrivate.createNewBurnAccount()
            const amountToBurn = 100000n * 10n ** 18n;
            await safeBurn(aliceBurnAccount, wormholeTokenAlice, amountToBurn)

            const claimableBurnAddress = [aliceBurnAccount.burnAddress];
            const reMintRecipient = bob.account.address

            // reMint 3 times since the 1st tx needs no commitment inclusion proof, the 2nd one the total spend balance read only contains information of one spend
            const reMintAmounts = [69000n *10n**18n, 690000n *10n**18n, 42000n *10n**18n]
            const maxFee = BigInt(1 * 10**18)
            let expectedRecipientBalance = 0n
            let reMintTxs: Hex[] = []
            const estimatedGasCost = 3_000_0000n
            const estimatedPriorityFee = await publicClient.estimateMaxPriorityFeePerGas()

            // @TODO use relayer account to relay, use fresh burn account for refund
            for (const reMintAmount of reMintAmounts) {
                const feeData = {
                        ethPriceToken: toHex(1n),
                        maxFee: toHex(maxFee),
                        amountForRecipient: toHex(reMintAmount-maxFee),
                        estimatedGasCost: toHex(estimatedGasCost),
                        estimatedPriorityFee: toHex(estimatedPriorityFee),
                        refundAddress: bob.account.address,
                        relayerAddress: bob.account.address,
                };
                //@ts-ignore
                const feeDataBigInt = Object.fromEntries(Object.keys(feeData).map((k)=>[k,BigInt(feeData[k])]))
                console.log({feeDataBigInt, reMintAmount})
                const relayerInputs = await createRelayerInputs({
                    chainId : chainId,
                    amount: reMintAmount,
                    recipient: reMintRecipient,
                    //callData, 
                    privateWallet: alicePrivate,
                    burnAddresses: claimableBurnAddress,
                    wormholeToken: wormholeToken,
                    archiveClient: publicClient,
                    //fullNodeClient, 
                    //preSyncedTree, 
                    backend: circuitBackend,
                    //deploymentBlock,
                    //blocksPerGetLogsReq,
                    feeData: feeData

                })
                const reMintTx = await relayTx({ relayInputs:relayerInputs as RelayInputs, wallet:alice, wormholeTokenContract:wormholeTokenAlice })
                expectedRecipientBalance += reMintAmount
                reMintTxs.push(reMintTx)

                const balanceBobPublic = await wormholeTokenAlice.read.balanceOf([bob.account.address])

                assert.equal(balanceBobPublic, expectedRecipientBalance, "bob didn't receive the expected amount of re-minted tokens")
            }

            const receipts = await Promise.all(
                reMintTxs.map((tx) =>
                    publicClient.getTransactionReceipt({ hash: tx })
                )
            )
            const logs = receipts.flatMap((r) => r.logs)
            const nullifiedEvents = parseEventLogs({
                abi: wormholeToken.abi,
                logs: logs,
                eventName: "Nullified"
            })

            // first one is always real. The rest should be the same size as the real one
            const expectedEncryptedBlobByteLen = (nullifiedEvents[0].args.encryptedTotalSpends.length - 2) / 2 // remove 0x, divide by 2 because hex string len is double byte len
            for (const nullifiedEvent of nullifiedEvents) {
                const encryptedBlobByteLen = (nullifiedEvent.args.encryptedTotalSpends.length - 2) / 2
                assert.equal(encryptedBlobByteLen, expectedEncryptedBlobByteLen, "encrypted blob length is not consistent")
                assert.ok(nullifiedEvent.args.nullifier <= FIELD_LIMIT, `Nullifier exceeded the FIELD_LIMIT. expected ${nullifiedEvent.args.nullifier} to be less than ${FIELD_LIMIT}`)
                assert.notEqual(nullifiedEvent.args.nullifier, 0n, "nullifier not set")
            }

            // finally check if enough was burned
            const balanceAlicePublic = await wormholeTokenAlice.read.balanceOf([alice.account.address])
            const burnedBalanceAlicePrivate = await wormholeTokenAlice.read.balanceOf([claimableBurnAddress[0]])
            assert.equal(burnedBalanceAlicePrivate, amountToBurn, "alicePrivate.burnAddress didn't burn the expected amount of tokens")
            assert.equal(balanceAlicePublic, amountFreeTokens - amountToBurn, "alice didn't burn the expected amount of tokens")
        })

    })


})