import { Address, Hex, PublicClient, toBytes, toHex, WalletClient, zeroAddress } from "viem";
import { WormholeTokenTest } from "../test/2inRemint.test.js";
import { PreSyncedTree, ProofInputs1n, ProofInputs4n, PublicProofInputs, SignatureInputs, SyncedBurnAccount, WormholeToken } from "./types.js";
import { generateProof, getSpendableBalanceProof, getPubInputs, getPrivInputs, BurnAccountProof, padArray } from "./proving.js";
import { ProofData, UltraHonkBackend } from "@aztec/bb.js";
import { getSyncedMerkleTree, getDeploymentBlock, syncMultipleBurnAccounts, encryptTotalSpend } from "./syncing.js";
import { hashNullifier, hashTotalBurnedLeaf, hashTotalSpentLeaf, signPrivateTransfer } from "./hashing.js";
import { PrivateWallet } from "./PrivateWallet.js";
import { CIRCUIT_SIZES, LARGEST_CIRCUIT_SIZE, MAX_TREE_DEPTH } from "./constants.js";


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

export function getCircuitSize(amountBurnAddresses: number) {
    return CIRCUIT_SIZES.find((v) => v >= amountBurnAddresses) as number
}

export async function proofAndSelfRelay(
    { amount, recipient, callData, privateWallet,burnAddresses, wormholeToken, archiveClient, fullNodeClient, preSyncedTree, backend, deploymentBlock, blocksPerGetLogsReq, circuitSize, maxTreeDepth=MAX_TREE_DEPTH }:
        { amount: bigint, recipient: Address, callData?: Hex, privateWallet: PrivateWallet,burnAddresses:Address[], wormholeToken: WormholeToken | WormholeTokenTest, archiveClient: PublicClient, fullNodeClient?: PublicClient, preSyncedTree?: PreSyncedTree, backend?: UltraHonkBackend, deploymentBlock?: bigint, blocksPerGetLogsReq?: bigint,circuitSize?:number, maxTreeDepth?:number }
) {
    callData ??= "0x";
    circuitSize ??= getCircuitSize(burnAddresses.length)
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
    const encryptedTotalSpends:Hex[] = []
    // man so many copy pasta of same array and big name!! Fix it i cant read this!!!!
    const burnAccountsAndAmounts:{burnAccount:SyncedBurnAccount, amountToClaim:bigint}[] = []
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
            const newTotalSpent = amountToClaim + BigInt(burnAccount.totalSpent)
            encryptedTotalSpends.push(await encryptTotalSpend({viewingKey:burnAccount.viewingKey, amount:newTotalSpent}))
            burnAccountsAndAmounts.push({
                burnAccount:burnAccount,
                amountToClaim:amountToClaim
            })
            if (amountLeft === 0n) {
                break
            }
        }
    }
    if (amountLeft !== 0n) {
        throw new Error("not enough balances in selected burn accounts")
    }

    // last circuit size is always largest
    if (burnAccountsAndAmounts.length > LARGEST_CIRCUIT_SIZE) {
        throw new Error(`need to consume more than LARGEST_CIRCUIT_SIZE of: ${LARGEST_CIRCUIT_SIZE}, but need to consume: ${burnAccountsAndAmounts.length} burnAccount to make the transaction. Please consolidate balance to make this tx`)
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
    for (const {burnAccount, amountToClaim} of burnAccountsAndAmounts) {
        const { merkleProofs, nullifier, nextTotalSpendNoteHashLeaf } = getHashedInputs({
            burnAccount: burnAccount,
            claimAmount: amountToClaim,
            syncedTree: syncedTree,
            maxTreeDepth: maxTreeDepth
        })

        // group all this private inclusion proof data
        const burnAccountProof: BurnAccountProof = {
            burnAccount: burnAccount,
            merkleProofs: merkleProofs,
            claimAmount: amountToClaim
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
    const zkProof = await generateProof({ proofInputs:proofInputs, backend:backend })
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