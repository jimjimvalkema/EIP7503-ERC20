import { Address, getAddress, getContract, Hex, PublicClient, toBytes, toHex, WalletClient, zeroAddress } from "viem";
import { WormholeTokenTest } from "../test/1inRemint.test.js";
import { BurnAccount, FeeData, PreSyncedTree, PrivateWallet, RelayerInputs, SyncedBurnAccount, SyncedPrivateWallet, UnsyncedPrivateWallet, WormholeToken } from "./types.js";
import { EMPTY_FEE_DATA } from "./constants.js";
import { formatProofInputs, generateProof, getSpendableBalanceProof, getProofInputs, getPubInputs, getPrivInputs, BurnAccountProof } from "./proving.js";
import { ProofData, UltraHonkBackend } from "@aztec/bb.js";
import { getSyncedMerkleTree, getDeploymentBlock, syncMultipleBurnAccounts } from "./syncing.js";
import { toBigInt } from "@aztec/aztec.js";
import { hashNullifier, hashTotalBurnedLeaf, hashTotalSpentLeaf, signPrivateTransfer } from "./hashing.js";
import { getSyncTree } from "@warptoad/gigabridge-js";
//import { noir_test_main_self_relay } from "./noirtests.js";

export function getTransactionInputs({ pubProofInputs, zkProof, claimedAmounts, unformattedFeeData, unformattedPubInputs }: { unformattedPubInputs: UnformattedProofInputsPublic, unformattedFeeData: FeeData, zkProof: ProofData, pubProofInputs: FormattedBurnAddressProofDataPublic[], claimedAmounts: bigint[] }) {
    const feeData = {
        relayerAddress: getAddress(unformattedFeeData.relayerAddress),
        priorityFee: BigInt(unformattedFeeData.priorityFee),
        conversionRate: BigInt(unformattedFeeData.conversionRate),
        maxFee: BigInt(unformattedFeeData.maxFee),
        feeToken: getAddress(unformattedFeeData.feeToken)
    };

    const inputs: [bigint, Hex, typeof feeData, bigint[], bigint[], bigint[], bigint, Hex] = [
        BigInt(unformattedPubInputs.amount),
        getAddress(unformattedPubInputs.recipient_address),
        feeData,
        (pubProofInputs.burn_address_public_proof_data.map((v) => BigInt(v.account_note_hash))),
        (pubProofInputs.burn_address_public_proof_data.map((v) => BigInt(v.account_note_nullifier))),
        claimedAmounts,
        BigInt(unformattedPubInputs.root),
        toHex(zkProof.proof) as Hex
    ]
    return inputs
}

export async function estimateGasUsed() {

}

// TODO check if syncedPrivateWallet.accountNonce is not nullified, if it is resync the wallet!!!
export async function createRelayerInputs(
    { wormholeToken, privateWallets, amountsToClaim, publicClient, amount, recipient, proofInputs, feeData, backend }:
        {
            wormholeToken: WormholeToken | WormholeTokenTest, privateWallets: SyncedPrivateWallet[] | UnsyncedPrivateWallet[], amountsToClaim: bigint[], publicClient: PublicClient, recipient: Address, amount: bigint, feeData?: FeeData, backend?: UltraHonkBackend
        }
) {
    // checks if accountNonce is not already nullified, if it is it find the next nonce that isn't, and updates total amount spend
    const syncedPrivateWallets: SyncedPrivateWallet[] = []
    for (const privateWallet of privateWallets) {
        const syncedWallet = await syncPrivateWallet({ wormholeToken, privateWallet })
        syncedPrivateWallets.push(syncedWallet)

    }
    // TODO handle case if users want to pay relayer
    if (feeData) {
        //set default values if not set
        //feeData.conversionRateInputs.estimatedGasUsed = feeData.conversionRateInputs.estimatedGasUsed ?? Number(await estimateGasUsage({wormholeToken, wallet:privateWallet.viem.wallet}))
    }

    //const conversionRate = feeData.conversionRateInputs ? BigInt(Math.round(feeData.conversionRateInputs.estimatedGasUsed * feeData.conversionRateInputs.tokenPriceInEth * feeData.conversionRateInputs.relayerBonusFactor)) : 0n;
    const unformattedProofInputs = await getProofInputs({
        wormholeToken, privateWallets: syncedPrivateWallets, amountsToClaim: amountsToClaim, publicClient, amountToReMint: amount, recipient, feeData: {
            relayerAddress: feeData.relayerAddress,
            priorityFee: feeData.priorityFee,
            conversionRate: conversionRate,
            feeToken: wormholeToken.address,
            maxFee: feeData.maxFee,
        }
    })
    //console.log("formattedProofInputs",formattedProofInputs)
    console.log({ circuitSize })
    const zkProof = await generateProof({ proofInputs: proofInputs, backend })
    const relayerInputs: RelayerInputs = {
        pubInputs: formattedProofInputs.burn_address_public_proof_data,
        feeData: unformattedProofInputs.publicInputs.feeData,
        zkProof: zkProof,
        claimedAmounts: amountsToClaim

    }
    return relayerInputs
}

export async function relayTx({ relayerInputs, ethWallet, publicClient, wormholeToken }: { relayerInputs: RelayerInputs, ethWallet: WalletClient, publicClient: PublicClient, wormholeToken: WormholeToken | WormholeTokenTest }) {
    // set relayer address and check it
    let relayerAddress = relayerInputs.feeData.relayerAddress;
    const walletAddress = ethWallet.account?.address as Address//(await ethWallet.getAddresses())[0]
    relayerAddress = relayerAddress === zeroAddress ? walletAddress : relayerAddress
    if (relayerAddress !== walletAddress) {
        throw new Error(`you are not the relayer. You are: ${walletAddress} but the relayer is: ${relayerInputs.feeData.relayerAddress}`)
    }

    const wormholeTokenRelayer = getContract({ client: { public: publicClient, wallet: ethWallet }, abi: wormholeToken.abi, address: wormholeToken.address });
    const transactionInputs = getTransactionInputs({ feeData: relayerInputs.feeData, pubProofInputs: relayerInputs.pubInputs, zkProof: relayerInputs.zkProof, claimedAmounts: relayerInputs.claimedAmounts })
    //console.log({transactionInputs})
    // const formattedProofInputsOnChain = await wormholeToken.read._formatPublicInputs([
    //     relayerInputs.pubInputs.amount,
    //     toHex(relayerInputs.pubInputs.signature_hash),
    //     relayerInputs.pubInputs.burn_address_public_proof_data[0].account_note_hash,  
    //     relayerInputs.pubInputs.burn_address_public_proof_data[0].account_note_nullifier,
    //     relayerInputs.pubInputs.root
    // ])
    // console.log({
    //     formattedProofInputsOnChain,
    //     bbjsPubInputs______________: relayerInputs.zkProof.publicInputs
    // })
    console.log({ transactionInputs })
    return await wormholeTokenRelayer.write.privateReMint(transactionInputs, { account: ethWallet.account?.address as Address, chain: publicClient.chain })
}


export function getHashedInputs(
    { burnAccount, claimAmount, syncedTree }:
        { burnAccount: SyncedBurnAccount, claimAmount: bigint, syncedTree: PreSyncedTree }) {

    // --- inclusion proof ---
    // hash leafs
    const totalBurnedLeaf = hashTotalBurnedLeaf({
        burnAddress: burnAccount.burnAddress,
        totalBurned: BigInt(burnAccount.totalBurned)
    })
    const prevTotalSpendNoteHashLeaf = hashTotalSpentLeaf({
        totalSpent: BigInt(burnAccount.totalSpent),
        accountNonce: BigInt(burnAccount.accountNonce),
        viewingKey: BigInt(burnAccount.viewingKey)
    })
    // make merkle proofs
    const merkleProofs = getSpendableBalanceProof({
        tree: syncedTree.tree,
        totalSpendNoteHashLeaf: prevTotalSpendNoteHashLeaf,
        totalBurnedLeaf
    })

    // --- public circuit inputs ---
    // hash public hashes (nullifier, commitment)
    const nextTotalSpend = BigInt(burnAccount.totalSpent) + claimAmount
    const nextAccountNonce = BigInt(burnAccount.accountNonce) + 1n
    const nextTotalSpendNoteHashLeaf = hashTotalSpentLeaf({
        totalSpent: nextTotalSpend,
        accountNonce: nextAccountNonce,
        viewingKey: BigInt(burnAccount.viewingKey)
    })
    const nullifier = hashNullifier({
        accountNonce: nextAccountNonce,
        viewingKey: BigInt(burnAccount.viewingKey)
    })

    return { merkleProofs, nullifier, nextTotalSpendNoteHashLeaf }
}

export async function proofAndSelfRelay(
    { amount, recipient, callData, privateWallet, wormholeToken, archiveClient, fullNodeClient, preSyncedTree, backend, deploymentBlock, blocksPerGetLogsReq }:
        { amount: bigint, recipient: Address, callData?: Hex, privateWallet: PrivateWallet, wormholeToken: WormholeToken | WormholeTokenTest, archiveClient: PublicClient, fullNodeClient?: PublicClient, preSyncedTree?: PreSyncedTree, backend?: UltraHonkBackend, deploymentBlock?: bigint, blocksPerGetLogsReq?: bigint }
) {
    callData ??= "0x";
    fullNodeClient ??= archiveClient;
    deploymentBlock ??= getDeploymentBlock(await fullNodeClient.getChainId())
    const allSignatureDataPromise = signPrivateTransfer({
        recipientAddress: recipient,
        amount: amount,
        callData: callData,
        privateWallet: privateWallet
    })
    const syncedTreePromise = getSyncedMerkleTree({
        wormholeToken,
        publicClient: archiveClient,
        //optional inputs
        preSyncedTree,
        deploymentBlock,
        blocksPerGetLogsReq
    })
    const syncWalletPromise = syncMultipleBurnAccounts({
        wormholeToken: wormholeToken,
        archiveNode: archiveClient,
        privateWallet: privateWallet
    })

    const [
        syncedTree,
        { signatureData, signatureHash },
        syncedPrivateWallet
    ] = await Promise.all([syncedTreePromise, allSignatureDataPromise, syncWalletPromise])
    privateWallet = syncedPrivateWallet

    //TODO make this for loop-able
    const burnAccount = syncedPrivateWallet.privateData.burnAccounts[0] as SyncedBurnAccount
    const claimAmount = amount

    const { merkleProofs, nullifier, nextTotalSpendNoteHashLeaf } = getHashedInputs({
        burnAccount: burnAccount,
        claimAmount: claimAmount,
        syncedTree: syncedTree
    })

    // group all this private inclusion proof data
    const burnAccountProof: BurnAccountProof = {
        burnAccount: burnAccount,
        merkleProofs: merkleProofs,
        claimAmount: claimAmount
    }


    // add hashes to be revealed to public
    const nullifiers = [nullifier]
    const noteHashes = [nextTotalSpendNoteHashLeaf]

    const publicInputs = getPubInputs({
        amountToReMint: amount,
        root: syncedTree.tree.root,
        signatureHash: signatureHash,
        nullifiers: nullifiers,
        noteHashes: noteHashes,
    })

    const privateInputs = getPrivInputs({
        burnAccountsProofs: [burnAccountProof],
        signatureData: signatureData
    })

    // const contractFormattedPreFix = await wormholeToken.read._getMessageWithEthPrefix([poseidonHash]);
    // console.log({
    //     preImageOfKeccak_______:preImageOfKeccak,
    //     contractFormattedPreFix, isEqual: preImageOfKeccak===contractFormattedPreFix })

    // @TODO!!
    // const relayerInputs = await createRelayerInputs({ wormholeToken, privateWallets, signatureData, amountsToClaim, publicClient: archiveClient, amount, recipient, callData, backend })
    // return await relayTx({ relayerInputs, ethWallet, publicClient: archiveClient, wormholeToken })
}

// export function convertRelayerInputsFromHex(relayerInputs:RelayerInputsHex):RelayerInputs {
//     return {
//         pubInputs:{
//                 amount: BigInt(relayerInputs.pubInputs.amount),
//                 signatureHash:BigInt(relayerInputs.pubInputs.signatureHash),
//                 recipientAddress: getAddress(relayerInputs.pubInputs.recipientAddress),
//                 feeData: {
//                     relayerAddress: getAddress(relayerInputs.pubInputs.feeData.relayerAddress),
//                     priorityFee: BigInt(relayerInputs.pubInputs.feeData.priorityFee),
//                     conversionRate: BigInt(relayerInputs.pubInputs.feeData.conversionRate),
//                     maxFee: BigInt(relayerInputs.pubInputs.feeData.maxFee),
//                     feeToken: getAddress(relayerInputs.pubInputs.feeData.feeToken),
//                 },
//                 accountNoteHash: BigInt(relayerInputs.pubInputs.accountNoteHash),
//                 accountNoteNullifier: BigInt(relayerInputs.pubInputs.accountNoteNullifier),
//                 root: BigInt(relayerInputs.pubInputs.root),
//         },
//         zkProof:{
//             proof: toBytes(relayerInputs.zkProof.proof),
//             publicInputs:relayerInputs.zkProof.publicInputs as string[]
//         }
//     }
// }

// export function convertRelayerInputsToHex(relayerInputs:RelayerInputs):RelayerInputsHex {
//     return {
//         pubInputs:{
//                 amount: toHex(relayerInputs.pubInputs.amount),
//                 recipientAddress: getAddress(relayerInputs.pubInputs.recipientAddress),
//                 signatureHash: toHex(relayerInputs.pubInputs.signatureHash),
//                 feeData: {
//                     relayerAddress: getAddress(relayerInputs.pubInputs.feeData.relayerAddress),
//                     priorityFee: toHex(relayerInputs.pubInputs.feeData.priorityFee),
//                     conversionRate: toHex(relayerInputs.pubInputs.feeData.conversionRate),
//                     maxFee: toHex(relayerInputs.pubInputs.feeData.maxFee),
//                     feeToken: getAddress(relayerInputs.pubInputs.feeData.feeToken),
//                 },
//                 accountNoteHash: toHex(relayerInputs.pubInputs.accountNoteHash),
//                 accountNoteNullifier: toHex(relayerInputs.pubInputs.accountNoteNullifier),
//                 root: toHex(relayerInputs.pubInputs.root),
//         },
//         zkProof:{
//             proof: toHex(relayerInputs.zkProof.proof),
//             publicInputs:relayerInputs.zkProof.publicInputs as Hex[]
//         }
//     }
// }


// This requires that account from FEE_ESTIMATOR_DATA had funds at one point and had the same root existed
// export async function estimateGasUsage({wormholeToken, wallet}:{wormholeToken:WormholeToken|WormholeTokenTest, wallet:WalletClient}) {
//     const relayerInputs = FEE_ESTIMATOR_DATA
//     relayerInputs.pubInputs.feeData.feeToken = wormholeToken.address
//     const rootNeeded = FEE_ESTIMATOR_DATA.pubInputs.root
//     const rootExist = Boolean(await wormholeToken.read.roots([rootNeeded]))
//     if (!rootExist) {throw new Error(`to estimate gas usage the contract needs to have root: ${rootNeeded}, but it was not found`) }
//     const txInputs = getTransactionInputs({ pubProofInputs: relayerInputs.pubInputs, zkProof: relayerInputs.zkProof })
//     const gas = await wormholeToken.estimateGas.privateTransfer(txInputs,{account: wallet.account?.address as Address})
//     return gas
// }