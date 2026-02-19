import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { toHex } from "viem";
import type { WormholeTokenTest } from "../test/2inRemint.test.ts";
import type { FeeData, NotOwnedBurnAccount, PreSyncedTree, ProofInputs1n, ProofInputs4n, PublicProofInputs, RelayInputs, SelfRelayInputs, SignatureInputs, SignatureInputsWithFee, SyncedBurnAccount, UnsyncedBurnAccount, WormholeToken } from "./types.ts";
import { generateProof, getSpendableBalanceProof, getPubInputs, getPrivInputs, padArray } from "./proving.ts";
import type { BurnAccountProof } from "./proving.ts";
import type { ProofData } from "@aztec/bb.js";
import { UltraHonkBackend } from "@aztec/bb.js";
import { getSyncedMerkleTree, getDeploymentBlock, syncMultipleBurnAccounts, encryptTotalSpend } from "./syncing.ts";
import { getBurnAddress, getBurnAddressSafe, hashBlindedAddressData, hashNullifier, hashTotalBurnedLeaf, hashTotalSpentLeaf, padWithRandomHex, signPrivateTransfer, signPrivateTransferWithFee } from "./hashing.ts";
import { PrivateWallet } from "./PrivateWallet.ts";
import { CIRCUIT_SIZES, EAS_BYTE_LEN_OVERHEAD, ENCRYPTED_TOTAL_SPENT_PADDING, LARGEST_CIRCUIT_SIZE, MAX_TREE_DEPTH, POW_DIFFICULTY } from "./constants.ts";


export function getHashedInputs(
    { burnAccount, claimAmount, syncedTree, maxTreeDepth = MAX_TREE_DEPTH }:
        { burnAccount: SyncedBurnAccount, claimAmount: bigint, syncedTree: PreSyncedTree, maxTreeDepth?: number }) {

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



/**
 * checks that at least the PoW nonce is correct
 * and that the merkle tree is not full
 * @notice does not check that the blindedAddressDataHash is correct!
 * TODO maybe put max tree depth in contract
 * @param burnAccount 
 * @param wormholeToken 
 * @param amount 
 * @param maxTreeDepth 
 * @param difficulty 
 * @returns 
 */
export async function safeBurn(burnAccount: NotOwnedBurnAccount | UnsyncedBurnAccount | SyncedBurnAccount, wormholeToken: WormholeToken | WormholeTokenTest, amount: bigint, maxTreeDepth = MAX_TREE_DEPTH, difficulty = POW_DIFFICULTY) {
    const burnAddress = getBurnAddressSafe({ blindedAddressDataHash: BigInt(burnAccount.blindedAddressDataHash), powNonce: BigInt(burnAccount.powNonce), difficulty: difficulty })
    const treeSize = await wormholeToken.read.treeSize()
    const safeDistanceFromFullTree = (35_000n / 10n) * 60n * 60n // 35_000 burn tx's for 1 hour.  assumes a 35_000 tps chain and burn txs being 10x expensive
    const fullTreeSize = 2n ** BigInt(maxTreeDepth)
    if (treeSize >= fullTreeSize) { throw new Error("Tree is FULL this tx WILL RESULT IS LOSS OF ALL FUNDS SEND. DO NOT SEND ANY BURN TRANSACTION!!!") }
    if (treeSize + safeDistanceFromFullTree >= fullTreeSize) { throw new Error("Tree is almost full and the risk is high this burn tx will result in loss of all funds send") }
    return await (wormholeToken as WormholeTokenTest).write.transfer([burnAddress, amount])
}


/**
 * checks that at least the PoW nonce is correct
 * and that the merkle tree is not full
 * does also check that the blindedAddressDataHash is correct!
 * @notice but can *only* be used by the one who has the viewing keys!
 * TODO maybe put max tree depth in contract
 * @param burnAccount 
 * @param wormholeToken 
 * @param amount 
 * @param maxTreeDepth 
 * @param difficulty 
 * @returns 
 */
export async function superSafeBurn(burnAccount: UnsyncedBurnAccount | SyncedBurnAccount, wormholeToken: WormholeToken | WormholeTokenTest, amount: bigint, maxTreeDepth = MAX_TREE_DEPTH, difficulty = POW_DIFFICULTY) {
    const blindedAddressDataHash = hashBlindedAddressData({ spendingPubKeyX: burnAccount.spendingPubKeyX, viewingKey: BigInt(burnAccount.viewingKey), chainId: BigInt(burnAccount.chainId) })
    const burnAddress = getBurnAddressSafe({ blindedAddressDataHash: blindedAddressDataHash, powNonce: BigInt(burnAccount.powNonce), difficulty: difficulty })
    const treeSize = await wormholeToken.read.treeSize()
    const safeDistanceFromFullTree = (35_000n / 10n) * 60n * 60n // 35_000 burn tx's for 1 hour.  assumes a 35_000 tps chain and burn txs being 10x expensive
    const fullTreeSize = 2n ** BigInt(maxTreeDepth)
    if (treeSize >= fullTreeSize) { throw new Error("Tree is FULL this tx WILL RESULT IS LOSS OF ALL FUNDS SEND. DO NOT SEND ANY BURN TRANSACTION!!!") }
    if (treeSize + safeDistanceFromFullTree >= fullTreeSize) { throw new Error("Tree is almost full and the risk is high this burn tx will result in loss of all funds send") }
    return await (wormholeToken as WormholeTokenTest).write.transfer([burnAddress, amount])
}

export async function prepareBurnAccountsForSpend({ burnAccounts, selectBurnAddresses, amount }: { burnAccounts: SyncedBurnAccount[], selectBurnAddresses: Address[], amount: bigint }) {
    const sortedBurnAccounts = burnAccounts.sort((a, b) => Number(b.spendableBalance) - Number(a.spendableBalance))
    const encryptedTotalSpends: Hex[] = []
    // man so many copy pasta of same array and big name!! Fix it i cant read this!!!!
    const burnAccountsAndAmounts: { burnAccount: SyncedBurnAccount, amountToClaim: bigint }[] = []
    let amountLeft = amount
    for (const burnAccount of sortedBurnAccounts) {
        if (selectBurnAddresses.includes(burnAccount.burnAddress)) {
            const spendableBalance = BigInt(burnAccount.spendableBalance)
            let amountToClaim = 0n
            if (spendableBalance <= amountLeft) {
                amountToClaim = spendableBalance
            } else {
                amountToClaim = amountLeft
            }
            amountLeft -= amountToClaim
            const newTotalSpent = amountToClaim + BigInt(burnAccount.totalSpent)
            encryptedTotalSpends.push(await encryptTotalSpend({ viewingKey: BigInt(burnAccount.viewingKey), amount: newTotalSpent }))
            burnAccountsAndAmounts.push({
                burnAccount: burnAccount,
                amountToClaim: amountToClaim
            })
            if (amountLeft === 0n) {
                break
            }
        }
    }
    if (amountLeft !== 0n) {
        throw new Error(`not enough balances in selected burn accounts, short of ${Number(amountLeft)}`)
    }

    // last circuit size is always largest
    console.log(`burn accounts selected: ${burnAccountsAndAmounts.map((b) => `${b.burnAccount.burnAddress},spendable:${b.burnAccount.spendableBalance},burned:${b.burnAccount.totalBurned},amountToBeClaimed:${b.amountToClaim}`)}`)
    if (burnAccountsAndAmounts.length > LARGEST_CIRCUIT_SIZE) {
        throw new Error(`need to consume more than LARGEST_CIRCUIT_SIZE of: ${LARGEST_CIRCUIT_SIZE}, but need to consume: ${burnAccountsAndAmounts.length} burnAccount to make the transaction. Please consolidate balance to make this tx`)
    }
    return { burnAccountsAndAmounts, encryptedTotalSpends }
}

/**
 * @notice chainId is not actually constrained in the circuit yet and is just here for future use when protocol becomes cross-chain
 * @param param0 
 * @returns 
 */
export async function createRelayerInputs(
    { chainId, amount, recipient, callData = "0x", callValue = 0n, callCanFail = true, feeData, privateWallet, burnAddresses, wormholeToken, archiveClient, preSyncedTree, backend, deploymentBlock, blocksPerGetLogsReq, circuitSize, maxTreeDepth = MAX_TREE_DEPTH, encryptedBlobLen = ENCRYPTED_TOTAL_SPENT_PADDING + EAS_BYTE_LEN_OVERHEAD }:
        { chainId: bigint, amount: bigint, recipient: Address, callData?: Hex, callCanFail?: boolean, callValue?: bigint, feeData?: FeeData, privateWallet: PrivateWallet, burnAddresses?: Address[], wormholeToken: WormholeToken | WormholeTokenTest, archiveClient: PublicClient, preSyncedTree?: PreSyncedTree, backend?: UltraHonkBackend, deploymentBlock?: bigint, blocksPerGetLogsReq?: bigint, circuitSize?: number, maxTreeDepth?: number, encryptedBlobLen?: number }
): Promise<SelfRelayInputs | RelayInputs> {
    burnAddresses ??= privateWallet.privateData.burnAccounts.map((b)=>b.burnAddress)
    const syncedPrivateWallet = await syncMultipleBurnAccounts({
        wormholeToken: wormholeToken,
        archiveNode: archiveClient,
        privateWallet: privateWallet,
        burnAddressesToSync: burnAddresses //@notice, only syncs these addresses!
    })

    // wrap in function
    const burnAccounts = privateWallet.privateData.burnAccounts as SyncedBurnAccount[]

    const { burnAccountsAndAmounts, encryptedTotalSpends } = await prepareBurnAccountsForSpend({ burnAccounts, selectBurnAddresses: burnAddresses, amount })
    circuitSize ??= getCircuitSize(burnAccountsAndAmounts.length)

    const signatureInputs: SignatureInputs | SignatureInputsWithFee = {
        recipient: recipient,
        amountToReMint: toHex(amount),
        callData: callData,
        callCanFail: callCanFail,
        callValue: toHex(callValue),
        encryptedTotalSpends: padWithRandomHex({ arr: encryptedTotalSpends, len: circuitSize, hexSize: encryptedBlobLen, dir: "right" }),
        feeData:feeData
    }

    // ---- do async stuff concurrently, signing, syncing ----
    let allSignatureDataPromise;
    if (feeData) {
        allSignatureDataPromise = signPrivateTransferWithFee({
            privateWallet: privateWallet,
            signatureInputs: signatureInputs as SignatureInputsWithFee,
            chainId: Number(chainId),
            tokenAddress: wormholeToken.address,
        })

    } else {
        allSignatureDataPromise = signPrivateTransfer({
            privateWallet: privateWallet,
            signatureInputs: signatureInputs,
            chainId: Number(chainId),
            tokenAddress: wormholeToken.address
        })

    }
    const syncedTreePromise = getSyncedMerkleTree({
        wormholeToken,
        publicClient: archiveClient,
        //optional inputs
        preSyncedTree,
        deploymentBlock,
        blocksPerGetLogsReq
    })

    const syncedTree = await syncedTreePromise;
    const { signatureData, signatureHash } = await allSignatureDataPromise;
    privateWallet = syncedPrivateWallet

    // ----- collect proof inputs from the burn accounts -----
    // nullifiers, noteHashes, merkle proofs
    const nullifiers: bigint[] = []
    const noteHashes: bigint[] = []
    const burnAccountProofs: BurnAccountProof[] = []
    // TODO @Warptoad: check chainId matches burn account. remove burn account with different chainId
    for (const { burnAccount, amountToClaim } of burnAccountsAndAmounts) {
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

    const proofInputs = { ...publicInputs, ...privateInputs } as ProofInputs1n | ProofInputs4n
    //console.log(JSON.stringify(proofInputs))
    //console.log({proofInputs})
    const zkProof = await generateProof({ proofInputs: proofInputs, backend: backend })
    // TODO make sure all these inputs are Hex so the can be a JSON
    if (feeData) {
        return {
            publicInputs: publicInputs,
            proof: toHex(zkProof.proof),
            signatureInputs: signatureInputs as SignatureInputsWithFee,
        } as RelayInputs;
    } else {
        return {
            publicInputs: publicInputs,
            proof: toHex(zkProof.proof),
            signatureInputs: signatureInputs as SignatureInputs,
        } as SelfRelayInputs;
    }

}

export async function proofAndSelfRelay(
    { amount, recipient, callData = "0x", callValue = 0n, callCanFail = true, privateWallet, burnAddresses, wormholeToken, archiveClient, fullNodeClient, preSyncedTree, backend, deploymentBlock, blocksPerGetLogsReq, circuitSize, maxTreeDepth = MAX_TREE_DEPTH, encryptedBlobLen = ENCRYPTED_TOTAL_SPENT_PADDING + EAS_BYTE_LEN_OVERHEAD }:
        { amount: bigint, recipient: Address, callData?: Hex, callCanFail?: boolean, callValue?: bigint, privateWallet: PrivateWallet, burnAddresses: Address[], wormholeToken: WormholeToken | WormholeTokenTest, archiveClient: PublicClient, fullNodeClient?: PublicClient, preSyncedTree?: PreSyncedTree, backend?: UltraHonkBackend, deploymentBlock?: bigint, blocksPerGetLogsReq?: bigint, circuitSize?: number, maxTreeDepth?: number, encryptedBlobLen?: number }
) {
    fullNodeClient ??= archiveClient;
    const chainId = BigInt(await fullNodeClient.getChainId())
    deploymentBlock ??= getDeploymentBlock(Number(chainId))
    burnAddresses ??= privateWallet.privateData.burnAccounts.map((b) => b.burnAddress)

    const selfRelayInputs = await createRelayerInputs({ amount, chainId, recipient, callData, callValue, callCanFail, privateWallet, burnAddresses, wormholeToken, archiveClient, preSyncedTree, backend, deploymentBlock, blocksPerGetLogsReq, circuitSize, maxTreeDepth, encryptedBlobLen })
    return await selfRelayTx({
        selfRelayInputs: selfRelayInputs,
        wallet: privateWallet.viemWallet,
        wormholeTokenContract: wormholeToken as WormholeTokenTest
    })
}

export async function selfRelayTx({ selfRelayInputs, wallet, wormholeTokenContract }: { selfRelayInputs: SelfRelayInputs, wallet: WalletClient, wormholeTokenContract: WormholeTokenTest }) {
    const _accountNoteHashes = selfRelayInputs.publicInputs.burn_data_public.map((v) => BigInt(v.account_note_hash))
    const _accountNoteNullifiers = selfRelayInputs.publicInputs.burn_data_public.map((v) => BigInt(v.account_note_nullifier))
    const _root = BigInt(selfRelayInputs.publicInputs.root)
    const _snarkProof = selfRelayInputs.proof
    const _signatureInputs =
    {
        amountToReMint: BigInt(selfRelayInputs.signatureInputs.amountToReMint),
        recipient: selfRelayInputs.signatureInputs.recipient,
        callData: selfRelayInputs.signatureInputs.callData,
        encryptedTotalSpends: selfRelayInputs.signatureInputs.encryptedTotalSpends,
        callCanFail: selfRelayInputs.signatureInputs.callCanFail,
        callValue: BigInt(selfRelayInputs.signatureInputs.callValue)

    }
    return await wormholeTokenContract.write.privateReMint([
        _accountNoteHashes,
        _accountNoteNullifiers,
        _root,
        _snarkProof,
        _signatureInputs
    ], { account: wallet.account?.address as Address })
}


export async function relayTx({ relayInputs, wallet, wormholeTokenContract }: { relayInputs: RelayInputs, wallet: WalletClient, wormholeTokenContract: WormholeTokenTest }) {
    const _accountNoteHashes = relayInputs.publicInputs.burn_data_public.map((v) => BigInt(v.account_note_hash))
    const _accountNoteNullifiers = relayInputs.publicInputs.burn_data_public.map((v) => BigInt(v.account_note_nullifier))
    const _root = BigInt(relayInputs.publicInputs.root)
    const _snarkProof = relayInputs.proof
    const _signatureInputs =
    {
        amountToReMint: BigInt(relayInputs.signatureInputs.amountToReMint),
        recipient: relayInputs.signatureInputs.recipient,
        callData: relayInputs.signatureInputs.callData,
        encryptedTotalSpends: relayInputs.signatureInputs.encryptedTotalSpends,
        callCanFail: relayInputs.signatureInputs.callCanFail,
        callValue: BigInt(relayInputs.signatureInputs.callValue)

    }
    const feeData = {
        tokensPerEthPrice: BigInt(relayInputs.signatureInputs.feeData.tokensPerEthPrice),
        maxFee: BigInt(relayInputs.signatureInputs.feeData.maxFee),
        amountForRecipient: BigInt(relayInputs.signatureInputs.feeData.amountForRecipient),
        relayerBonus: BigInt(relayInputs.signatureInputs.feeData.relayerBonus),
        estimatedGasCost: BigInt(relayInputs.signatureInputs.feeData.estimatedGasCost),
        estimatedPriorityFee: BigInt(relayInputs.signatureInputs.feeData.estimatedPriorityFee),
        refundAddress: relayInputs.signatureInputs.feeData.refundAddress,
        relayerAddress: relayInputs.signatureInputs.feeData.relayerAddress,

    }
    return await wormholeTokenContract.write.privateReMintRelayer([
        _accountNoteHashes,
        _accountNoteNullifiers,
        _root,
        _snarkProof,
        _signatureInputs,
        feeData
    ], { account: wallet.account?.address as Address })
}
export async function getFreshBurnAccount(privateWallet: PrivateWallet, wormholeToken: WormholeTokenTest | WormholeToken) {
    const neverUsedBurnAccounts = privateWallet.privateData.burnAccounts.filter(async (b) => await wormholeToken.read.balanceOf([b.burnAddress]) === 0n)
}