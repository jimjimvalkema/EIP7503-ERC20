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
import { formatUnits, getContract, padHex, parseEventLogs, parseUnits, toHex, type Hash, type Hex } from "viem";
import type { FeeData, RelayInputs } from "../src/types.ts";

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
        it("reMint 1x from 1 burn account with relayer", async function () {
            const wormholeTokenAlice = getContract({ client: { public: publicClient, wallet: alice }, abi: wormholeToken.abi, address: wormholeToken.address });
            const amountFreeTokens = await wormholeTokenAlice.read.amountFreeTokens()
            await wormholeTokenAlice.write.getFreeTokens([alice.account.address]) //sends 1_000_000n token

            const chainId = BigInt(await publicClient.getChainId())
            const alicePrivate = new PrivateWallet(alice, { acceptedChainIds: [chainId] })
            const aliceBurnAccount = await alicePrivate.createNewBurnAccount()
            const aliceRefundBurnAccount = await alicePrivate.createNewBurnAccount()
            const decimalsToken = await wormholeToken.read.decimals()
            const amountToBurn = parseUnits("42069", decimalsToken);
            await safeBurn(aliceBurnAccount, wormholeTokenAlice, amountToBurn)

            const decimalsTokenPrice = 8;
            // 1 eth will give you 69 token. the eth price of token is 0.0144 eth (1/69)
            const tokensPerEthPrice = parseUnits("69", decimalsTokenPrice)
            const maxFee = parseUnits("5", decimalsToken)
            const amountForRecipient = parseUnits("420", decimalsToken)
            const reMintAmount = amountForRecipient + maxFee
            const relayerBonus = parseUnits("1", decimalsToken)
            const estimatedGasCost = 3_092_125n
            const estimatedPriorityFee = await publicClient.estimateMaxPriorityFeePerGas()
            const feeData: FeeData = {
                tokensPerEthPrice: toHex(tokensPerEthPrice),
                maxFee: toHex(maxFee),
                amountForRecipient: toHex(amountForRecipient),
                relayerBonus: toHex(relayerBonus),
                estimatedGasCost: toHex(estimatedGasCost),
                estimatedPriorityFee: toHex(estimatedPriorityFee),
                refundAddress: aliceRefundBurnAccount.burnAddress,
                relayerAddress: relayer.account.address,
            }

            const reMintRecipient = bob.account.address
            const relayerInputs = await createRelayerInputs({
                chainId: chainId,
                amount: reMintAmount,
                recipient: reMintRecipient,
                //callData, 
                privateWallet: alicePrivate,
                //burnAddresses: [aliceBurnAccount.burnAddress],
                wormholeToken: wormholeToken,
                archiveClient: publicClient,
                //fullNodeClient, 
                //preSyncedTree, 
                backend: circuitBackend,
                //deploymentBlock,
                //blocksPerGetLogsReq,
                feeData: feeData

            })
            const reMintTx = await relayTx({ relayInputs: relayerInputs as RelayInputs, wallet: alice, wormholeTokenContract: wormholeTokenAlice })
            const recipientBalance = await wormholeToken.read.balanceOf([bob.account.address])
            const refundAddressBalance = await wormholeToken.read.balanceOf([aliceRefundBurnAccount.burnAddress])
            const relayerBalance = await wormholeToken.read.balanceOf([relayer.account.address])

            const txReceipt = await publicClient.getTransactionReceipt({ hash: reMintTx });
            console.log({ 
                gasCost: txReceipt.gasUsed, 
                effectiveGasPrice: txReceipt.effectiveGasPrice, 
                estimatedPriorityFee, estimatedGasCost 
            })
            console.log({
                recipientBalance____: formatUnits(recipientBalance, decimalsToken),
                refundAddressBalance: formatUnits(refundAddressBalance, decimalsToken),
                relayerBalance______: formatUnits(relayerBalance, decimalsToken),
            })
            const totalReMinted = relayerBalance + refundAddressBalance + recipientBalance
            assert.equal(totalReMinted, reMintAmount, "amount reMinted not matched");
            assert.equal(recipientBalance, amountForRecipient, "recipient did not receive enough tokens");
            assert(relayerBalance > relayerBonus, "relayer did not receive enough tokens");
            assert.equal(refundAddressBalance, maxFee - relayerBalance, "refund is not equal to maxFee - relayerBalance")
        })

    })


})