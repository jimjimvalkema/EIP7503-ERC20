import { Address, getAddress, getContract, Hex, hexToBytes, PublicClient, toBytes, toHex, WalletClient, zeroAddress } from "viem";
import { WormholeTokenTest } from "../test/2inRemint.test.js";
import { BurnAccount, FeeData, PreSyncedTree, ProofInputs, ProofInputs1n, ProofInputs4n, PublicProofInputs, RelayerInputs, SignatureInputs, SyncedBurnAccount, WormholeToken } from "./types.js";
import { generateProof, getSpendableBalanceProof, getPubInputs, getPrivInputs, BurnAccountProof, padArray } from "./proving.js";
import { ProofData, UltraHonkBackend } from "@aztec/bb.js";
import { getSyncedMerkleTree, getDeploymentBlock, syncMultipleBurnAccounts, encryptTotalSpend } from "./syncing.js";
import { toBigInt } from "@aztec/aztec.js";
import { hashNullifier, hashTotalBurnedLeaf, hashTotalSpentLeaf, signPrivateTransfer } from "./hashing.js";
import { getSyncTree } from "@warptoad/gigabridge-js";
import { PrivateWallet } from "./PrivateWallet.js";
import { CIRCUIT_SIZES, MAX_TREE_DEPTH } from "./constants.js";
//import { noir_test_main_self_relay } from "./noirtests.js";

// export function getTransactionInputs({ pubProofInputs, zkProof, claimedAmounts, unformattedFeeData, unformattedPubInputs }: { unformattedPubInputs: UnformattedProofInputsPublic, unformattedFeeData: FeeData, zkProof: ProofData, pubProofInputs: FormattedBurnAddressProofDataPublic[], claimedAmounts: bigint[] }) {
//     const feeData = {
//         relayerAddress: getAddress(unformattedFeeData.relayerAddress),
//         priorityFee: BigInt(unformattedFeeData.priorityFee),
//         conversionRate: BigInt(unformattedFeeData.conversionRate),
//         maxFee: BigInt(unformattedFeeData.maxFee),
//         feeToken: getAddress(unformattedFeeData.feeToken)
//     };

//     const inputs: [bigint, Hex, typeof feeData, bigint[], bigint[], bigint[], bigint, Hex] = [
//         BigInt(unformattedPubInputs.amount),
//         getAddress(unformattedPubInputs.recipient_address),
//         feeData,
//         (pubProofInputs.burn_address_public_proof_data.map((v) => BigInt(v.account_note_hash))),
//         (pubProofInputs.burn_address_public_proof_data.map((v) => BigInt(v.account_note_nullifier))),
//         claimedAmounts,
//         BigInt(unformattedPubInputs.root),
//         toHex(zkProof.proof) as Hex
//     ]
//     return inputs
// }

export async function estimateGasUsed() {

}

// TODO check if syncedPrivateWallet.accountNonce is not nullified, if it is resync the wallet!!!
// export async function createRelayerInputs(
//     { wormholeToken, privateWallets, amountsToClaim, publicClient, amount, recipient, proofInputs, feeData, backend }:
//         {
//             wormholeToken: WormholeToken | WormholeTokenTest, privateWallets: SyncedPrivateWallet[] | UnsyncedPrivateWallet[], amountsToClaim: bigint[], publicClient: PublicClient, recipient: Address, amount: bigint, feeData?: FeeData, backend?: UltraHonkBackend
//         }
// ) {
//     const relayerInputs: RelayerInputs = {
//         pubInputs: formattedProofInputs.burn_address_public_proof_data,
//         feeData: unformattedProofInputs.publicInputs.feeData,
//         zkProof: zkProof,
//         claimedAmounts: amountsToClaim

//     }
//     return relayerInputs
// }

// export async function relayTx({ relayerInputs, ethWallet, publicClient, wormholeToken }: { relayerInputs: RelayerInputs, ethWallet: WalletClient, publicClient: PublicClient, wormholeToken: WormholeToken | WormholeTokenTest }) {
//     // set relayer address and check it
//     let relayerAddress = relayerInputs.feeData.relayerAddress;
//     const walletAddress = ethWallet.account?.address as Address//(await ethWallet.getAddresses())[0]
//     relayerAddress = relayerAddress === zeroAddress ? walletAddress : relayerAddress
//     if (relayerAddress !== walletAddress) {
//         throw new Error(`you are not the relayer. You are: ${walletAddress} but the relayer is: ${relayerInputs.feeData.relayerAddress}`)
//     }

//     const wormholeTokenRelayer = getContract({ client: { public: publicClient, wallet: ethWallet }, abi: wormholeToken.abi, address: wormholeToken.address });
//     const transactionInputs = getTransactionInputs({ feeData: relayerInputs.feeData, pubProofInputs: relayerInputs.pubInputs, zkProof: relayerInputs.zkProof, claimedAmounts: relayerInputs.claimedAmounts })
//     //console.log({transactionInputs})
//     // const formattedProofInputsOnChain = await wormholeToken.read._formatPublicInputs([
//     //     relayerInputs.pubInputs.amount,
//     //     toHex(relayerInputs.pubInputs.signature_hash),
//     //     relayerInputs.pubInputs.burn_address_public_proof_data[0].account_note_hash,  
//     //     relayerInputs.pubInputs.burn_address_public_proof_data[0].account_note_nullifier,
//     //     relayerInputs.pubInputs.root
//     // ])
//     // console.log({
//     //     formattedProofInputsOnChain,
//     //     bbjsPubInputs______________: relayerInputs.zkProof.publicInputs
//     // })
//     console.log({ transactionInputs })
//     return await wormholeTokenRelayer.write.privateReMint(transactionInputs, { account: ethWallet.account?.address as Address, chain: publicClient.chain })
// }


export function getHashedInputs(
    { burnAccount, claimAmount, syncedTree, maxTreeDepth=MAX_TREE_DEPTH }:
        { burnAccount: SyncedBurnAccount, claimAmount: bigint, syncedTree: PreSyncedTree, maxTreeDepth?:number }) {

    // --- inclusion proof ---
    // hash leafs
    const totalBurnedLeaf = hashTotalBurnedLeaf({
        burnAddress: burnAccount.burnAddress,
        totalBurned: BigInt(burnAccount.totalBurned)
    })
    const prevTotalSpendNoteHashLeaf = BigInt(burnAccount.accountNonce) === 0n ? 0n : hashTotalSpentLeaf({
        totalSpent: BigInt(burnAccount.totalSpent),
        accountNonce: BigInt(burnAccount.accountNonce),
        blindedAddressDataHash: BigInt(burnAccount.blindedAddressDataHash),
        viewingKey: BigInt(burnAccount.viewingKey)
    })
    // make merkle proofs
    const merkleProofs = getSpendableBalanceProof({
        tree: syncedTree.tree,
        totalSpendNoteHashLeaf: prevTotalSpendNoteHashLeaf,
        totalBurnedLeaf,
        maxTreeDepth
    })

    // --- public circuit inputs ---
    // hash public hashes (nullifier, commitment)
    const nextTotalSpend = BigInt(burnAccount.totalSpent) + claimAmount
    const prevAccountNonce = BigInt(burnAccount.accountNonce)
    const nextAccountNonce = BigInt(burnAccount.accountNonce) + 1n
    const nextTotalSpendNoteHashLeaf = hashTotalSpentLeaf({
        totalSpent: nextTotalSpend,
        accountNonce: nextAccountNonce,
        blindedAddressDataHash: BigInt(burnAccount.blindedAddressDataHash),
        viewingKey: BigInt(burnAccount.viewingKey)
    })
    const nullifier = hashNullifier({
        accountNonce: prevAccountNonce,
        viewingKey: BigInt(burnAccount.viewingKey)
    })

    return { merkleProofs, nullifier, nextTotalSpendNoteHashLeaf }
}

export async function proofAndSelfRelay(
    { amount, recipient, callData, privateWallet,burnAddresses, wormholeToken, archiveClient, fullNodeClient, preSyncedTree, backend, deploymentBlock, blocksPerGetLogsReq, circuitSize, maxTreeDepth=MAX_TREE_DEPTH }:
        { amount: bigint, recipient: Address, callData?: Hex, privateWallet: PrivateWallet,burnAddresses:Address[], wormholeToken: WormholeToken | WormholeTokenTest, archiveClient: PublicClient, fullNodeClient?: PublicClient, preSyncedTree?: PreSyncedTree, backend?: UltraHonkBackend, deploymentBlock?: bigint, blocksPerGetLogsReq?: bigint,circuitSize?:number, maxTreeDepth?:number }
) {
    callData ??= "0x";
    circuitSize ??= CIRCUIT_SIZES.find((v) => v >= burnAddresses.length) as number
    fullNodeClient ??= archiveClient;
    const chainId = BigInt(await fullNodeClient.getChainId())
    deploymentBlock ??= getDeploymentBlock(Number(chainId))
    burnAddresses ??= privateWallet.privateData.burnAccounts.map((b) => b.burnAddress)

    const syncedPrivateWallet = await syncMultipleBurnAccounts({
        wormholeToken: wormholeToken,
        archiveNode: archiveClient,
        privateWallet: privateWallet,
        burnAddressesToSync: burnAddresses //@notice, only syncs these addresses!
    })

    // wrap in function
    const burnAccounts = privateWallet.privateData.burnAccounts as SyncedBurnAccount[]
    const sortedBurnAccounts = burnAccounts.sort((a, b)=>Number(a.spendableBalance) - Number(b.spendableBalance))
    const amountsToClaim:bigint[] = []
    const encryptedTotalSpends:Hex[] = []
    let amountLeft = amount
    for (const burnAccount of sortedBurnAccounts) {
        if (burnAddresses.includes(burnAccount.burnAddress)) {
            const spendableBalance = BigInt(burnAccount.spendableBalance)
            let amountToClaim = 0n
            if (spendableBalance <= amountLeft) {
                amountToClaim = spendableBalance
            } else {
                amountToClaim = amountLeft
            }
            amountLeft -= amountToClaim
            amountsToClaim.push(amountToClaim)
            const newTotalSpent = amountToClaim + BigInt(burnAccount.totalSpent)
            encryptedTotalSpends.push(await encryptTotalSpend({viewingKey:burnAccount.viewingKey, amount:newTotalSpent}))
            if (amountLeft === 0n) {
                break
            }
        }
    }
    if (amountLeft !== 0n) {
        throw new Error("not enough balances in selected burn accounts")
    }


    const signatureInputs:SignatureInputs = {        
        recipientAddress: recipient,
        amount: amount,
        callData: callData,
        encryptedTotalSpends: encryptedTotalSpends
    }

    // ---- do async stuff concurrently, signing, syncing ----
    const allSignatureDataPromise = signPrivateTransfer({
        privateWallet: privateWallet,
        signatureInputs: signatureInputs
    })
    const syncedTreePromise = getSyncedMerkleTree({
        wormholeToken,
        publicClient: archiveClient,
        //optional inputs
        preSyncedTree,
        deploymentBlock,
        blocksPerGetLogsReq
    })

    const [
        syncedTree,
        { signatureData, signatureHash },
    ] = await Promise.all([syncedTreePromise, allSignatureDataPromise])
    privateWallet = syncedPrivateWallet

    // ----- collect proof inputs from the burn accounts -----
    // nullifiers, noteHashes, merkle proofs
    const nullifiers: bigint[] = []
    const noteHashes: bigint[] = []
    const burnAccountProofs: BurnAccountProof[] = []
    // TODO @Warptoad: check chainId matches burn account. remove burn account with different chainId
    {
        const burnAccount = syncedPrivateWallet.privateData.burnAccounts[0] as SyncedBurnAccount
        const claimAmount = amount

        const { merkleProofs, nullifier, nextTotalSpendNoteHashLeaf } = getHashedInputs({
            burnAccount: burnAccount,
            claimAmount: claimAmount,
            syncedTree: syncedTree,
            maxTreeDepth: maxTreeDepth
        })

        // group all this private inclusion proof data
        const burnAccountProof: BurnAccountProof = {
            burnAccount: burnAccount,
            merkleProofs: merkleProofs,
            claimAmount: claimAmount
        }
        burnAccountProofs.push(burnAccountProof)
        nullifiers.push(nullifier)
        noteHashes.push(nextTotalSpendNoteHashLeaf)
    }

    const publicInputs = getPubInputs({
        amountToReMint: amount,
        root: syncedTree.tree.root,
        chainId: chainId,
        signatureHash: signatureHash,
        nullifiers: nullifiers,
        noteHashes: noteHashes,
        circuitSize: circuitSize
    })

    const privateInputs = getPrivInputs({
        burnAccountsProofs: burnAccountProofs,
        signatureData: signatureData,
        maxTreeDepth: maxTreeDepth,
        circuitSize: circuitSize
    })

    const proofInputs = {...publicInputs, ...privateInputs} as ProofInputs1n | ProofInputs4n
    //console.log(JSON.stringify(proofInputs,undefined,2))
    console.log("proving")
    const zkProof = await generateProof({ proofInputs:proofInputs, backend:backend })
    console.log("done proving")
    // TODO make sure all these inputs are Hex so the can be a JSON
    return await freeRelayTx({
        publicInputs:publicInputs,
        proof:zkProof,
        signatureInputs:signatureInputs, 
        wallet:privateWallet.viemWallet, 
        wormholeTokenContract:wormholeToken as WormholeTokenTest
    })
}

export async function freeRelayTx({publicInputs,proof,signatureInputs, wallet, wormholeTokenContract}:{publicInputs:PublicProofInputs,proof:ProofData,signatureInputs:SignatureInputs, wallet:WalletClient, wormholeTokenContract:WormholeTokenTest}) {
    const _amount = BigInt(publicInputs.amount)
    const _to = signatureInputs.recipientAddress
    const _accountNoteHashes = publicInputs.burn_data_public.map((v)=>BigInt(v.account_note_hash))
    const _accountNoteNullifiers = publicInputs.burn_data_public.map((v)=>BigInt(v.account_note_nullifier))
    const _root = BigInt(publicInputs.root)
    const _snarkProof = toHex(proof.proof)
    const _callData = signatureInputs.callData
    const _totalSpentEncrypted = signatureInputs.encryptedTotalSpends
    
    return await wormholeTokenContract.write.privateReMint([
        _amount,
        _to,
        _accountNoteHashes,
        _accountNoteNullifiers,
        _root,
        _snarkProof,
        _callData,
        _totalSpentEncrypted
    ],{account:wallet.account?.address as Address})
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