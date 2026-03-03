import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { toHex } from "viem";
import type { WormholeTokenTest } from "../test/remint2.test.ts";
import type { CreateRelayerInputsOpts, FakeBurnAccount, FeeData, NotOwnedBurnAccount, PreSyncedTree, ProofInputs1n, ProofInputs4n, PublicProofInputs, RelayInputs, SelfRelayInputs, SignatureInputs, SignatureInputsWithFee, SyncedBurnAccount, UnsyncedBurnAccount, WormholeToken } from "./types.ts";
import { generateProof, getSpendableBalanceProof, getPubInputs, getPrivInputs, padArray, randomBN254FieldElement } from "./proving.ts";
import type { BurnAccountProof, FakeBurnAccountProof } from "./proving.ts";
import type { ProofData } from "@aztec/bb.js";
import { UltraHonkBackend } from "@aztec/bb.js";
import { getSyncedMerkleTree, getDeploymentBlock, syncMultipleBurnAccounts, encryptTotalSpend } from "./syncing.ts";
import { getBurnAddress, getBurnAddressSafe, hashBlindedAddressData, hashFakeLeaf, hashFakeNullifier, hashNullifier, hashTotalBurnedLeaf, hashTotalSpentLeaf, padWithRandomHex, signPrivateTransfer, signPrivateTransferWithFee } from "./hashing.ts";
import { BurnWallet } from "./BurnWallet.ts";
import { EAS_BYTE_LEN_OVERHEAD, ENCRYPTED_TOTAL_SPENT_PADDING, GAS_LIMIT_TX } from "./constants.ts";


export function getHashedInputs(
    { burnAccount, claimAmount, syncedTree, maxTreeDepth }:
        { burnAccount: SyncedBurnAccount, claimAmount: bigint, syncedTree: PreSyncedTree, maxTreeDepth: number }) {

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

export function getCircuitSize(amountBurnAddresses: number, circuitSizes: number[]) {
    return circuitSizes.find((v) => v >= amountBurnAddresses) as number
}

/**
 * checks that at least the PoW nonce is correct,
 * that the merkle tree is not full and the balance of the recipient wont exceed reMintLimit
 * @notice does not check that the blindedAddressDataHash is correct!
 * TODO maybe put max tree depth in contract
 * @param burnAccount 
 * @param wormholeToken 
 * @param amount 
 * @param maxTreeDepth 
 * @param difficulty 
 * @returns 
 */
export async function burn(
    burnAddress: Address, amount: bigint, wormholeToken: WormholeTokenTest, account: Address, fullNode: PublicClient,
    { difficulty, reMintLimit, maxTreeDepth }: { difficulty?: bigint, reMintLimit?: bigint, maxTreeDepth?: number } = {}
) {
    difficulty ??= BigInt(await wormholeToken.read.POW_DIFFICULTY())
    reMintLimit ??= BigInt(await wormholeToken.read.RE_MINT_LIMIT())
    maxTreeDepth ??= await wormholeToken.read.MAX_TREE_DEPTH()
    // nvm this wont result in anything dangerous
    // const nonce = await fullNode.getTransactionCount({address: burnAddress})
    // if (nonce !== 0) { throw new Error("This address has an account nonce that is not 0. This is a EOA. Please do a regular transfer instead")}
    const balance = await wormholeToken.read.balanceOf([burnAddress])
    const newBurnBalance = balance + amount
    const treeSize = await wormholeToken.read.treeSize()
    const safeDistanceFromFullTree = (35_000n / 10n) * 60n * 60n // 35_000 burn tx's for 1 hour.  assumes a 35_000 tps chain and burn txs being 10x expensive
    const fullTreeSize = 2n ** BigInt(maxTreeDepth)
    if (treeSize >= fullTreeSize) { throw new Error("Tree is FULL this tx WILL RESULT IS LOSS OF ALL FUNDS SEND. DO NOT SEND ANY BURN TRANSACTION!!!") }
    if (treeSize + safeDistanceFromFullTree >= fullTreeSize) { throw new Error("Tree is almost full and the risk is high this burn tx will result in loss of all funds send") }
    if (newBurnBalance < reMintLimit === false) { throw new Error(`This transfer will cause the balance to go over the RE_MINT_LIMIT. This wil result in LOSS OF ALL FUNDS OVER THE LIMIT!! DO NOT SEND THIS TRANSACTION!!\n new balance: ${newBurnBalance} \n limit:       ${reMintLimit}`) }
    return await (wormholeToken as WormholeTokenTest).write.transfer([burnAddress, amount], { account: account })

}

/**
 * checks that at least the PoW nonce is correct,
 * that the merkle tree is not full and the balance of the recipient wont exceed reMintLimit
 * @notice does not check that the blindedAddressDataHash is correct!
 * TODO maybe put max tree depth in contract
 * @param burnAccount 
 * @param wormholeToken 
 * @param amount 
 * @param maxTreeDepth 
 * @param difficulty 
 * @returns 
 */
export async function safeBurn(
    burnAccount: UnsyncedBurnAccount | SyncedBurnAccount, amount: bigint, wormholeToken: WormholeTokenTest, account: Address,
    { difficulty, reMintLimit, maxTreeDepth }: { difficulty?: bigint, reMintLimit?: bigint, maxTreeDepth?: number } = {}
) {
    difficulty ??= BigInt(await wormholeToken.read.POW_DIFFICULTY())
    reMintLimit ??= BigInt(await wormholeToken.read.RE_MINT_LIMIT())
    maxTreeDepth ??= await wormholeToken.read.MAX_TREE_DEPTH()
    const burnAddress = getBurnAddressSafe({ blindedAddressDataHash: BigInt(burnAccount.blindedAddressDataHash), powNonce: BigInt(burnAccount.powNonce), difficulty: difficulty })
    const balance = await wormholeToken.read.balanceOf([burnAddress])
    const newBurnBalance = balance + amount
    const treeSize = await wormholeToken.read.treeSize()
    const safeDistanceFromFullTree = (35_000n / 10n) * 60n * 60n // 35_000 burn tx's for 1 hour.  assumes a 35_000 tps chain and burn txs being 10x expensive
    const fullTreeSize = 2n ** BigInt(maxTreeDepth)
    if (treeSize >= fullTreeSize) { throw new Error("Tree is FULL this tx WILL RESULT IS LOSS OF ALL FUNDS SEND. DO NOT SEND ANY BURN TRANSACTION!!!") }
    if (treeSize + safeDistanceFromFullTree >= fullTreeSize) { throw new Error("Tree is almost full and the risk is high this burn tx will result in loss of all funds send") }
    if (newBurnBalance < reMintLimit === false) { throw new Error(`This transfer will cause the balance to go over the RE_MINT_LIMIT. This wil result in LOSS OF ALL FUNDS OVER THE LIMIT!! DO NOT SEND THIS TRANSACTION!!\n new balance: ${newBurnBalance} \n limit:       ${reMintLimit}`) }
    return await (wormholeToken as WormholeTokenTest).write.transfer([burnAddress, amount], { account: account })
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
export async function superSafeBurn(
    burnAccount: UnsyncedBurnAccount | SyncedBurnAccount, amount: bigint, wormholeToken: WormholeTokenTest, account: Address,
    { difficulty, reMintLimit, maxTreeDepth }: { difficulty?: bigint, reMintLimit?: bigint, maxTreeDepth?: number } = {}
) {
    difficulty ??= BigInt(await wormholeToken.read.POW_DIFFICULTY())
    reMintLimit ??= BigInt(await wormholeToken.read.RE_MINT_LIMIT())
    maxTreeDepth ??= await wormholeToken.read.MAX_TREE_DEPTH()
    const blindedAddressDataHash = hashBlindedAddressData({ spendingPubKeyX: burnAccount.spendingPubKeyX, viewingKey: BigInt(burnAccount.viewingKey), chainId: BigInt(burnAccount.chainId) })
    const burnAddress = getBurnAddressSafe({ blindedAddressDataHash: blindedAddressDataHash, powNonce: BigInt(burnAccount.powNonce), difficulty: difficulty })
    const balance = await wormholeToken.read.balanceOf([burnAddress])
    const newBurnBalance = balance + amount
    const treeSize = await wormholeToken.read.treeSize()
    const safeDistanceFromFullTree = (35_000n / 10n) * 60n * 60n // 35_000 burn tx's for 1 hour.  assumes a 35_000 tps chain and burn txs being 10x expensive
    const fullTreeSize = 2n ** BigInt(maxTreeDepth)
    if (treeSize >= fullTreeSize) { throw new Error("Tree is FULL this tx WILL RESULT IS LOSS OF ALL FUNDS SEND. DO NOT SEND ANY BURN TRANSACTION!!!") }
    if (treeSize + safeDistanceFromFullTree >= fullTreeSize) { throw new Error("Tree is almost full and the risk is high this burn tx will result in loss of all funds send") }
    if (newBurnBalance < reMintLimit === false) { throw new Error(`This transfer will cause the balance to go over the RE_MINT_LIMIT. This wil result in LOSS OF ALL FUNDS OVER THE LIMIT!! DO NOT SEND THIS TRANSACTION!!\n new balance: ${newBurnBalance} \n limit:       ${reMintLimit}`) }
    return await (wormholeToken as WormholeTokenTest).write.transfer([burnAddress, amount], { account: account })
}

export async function prepareBurnAccountsForSpend({ burnAccounts, selectBurnAddresses, amount, largestCircuitSize }: { largestCircuitSize: number, burnAccounts: SyncedBurnAccount[], selectBurnAddresses: Address[], amount: bigint }) {
    const sortedBurnAccounts = burnAccounts.sort((a, b) => Number(b.spendableBalance) - Number(a.spendableBalance))
    const encryptedTotalMinted: Hex[] = []
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
            encryptedTotalMinted.push(await encryptTotalSpend({ viewingKey: BigInt(burnAccount.viewingKey), amount: newTotalSpent }))
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
        throw new Error(`not enough balances in selected burn accounts, short of ${Number(amountLeft)}, selected burn accounts: ${sortedBurnAccounts}`)
    }

    console.log(`burn accounts selected: \n${burnAccountsAndAmounts.map((b) => `${b.burnAccount.burnAddress},spendable:${b.burnAccount.spendableBalance},burned:${b.burnAccount.totalBurned},amountToBeClaimed:${b.amountToClaim}\n`)}`)
    if (burnAccountsAndAmounts.length > largestCircuitSize) {
        throw new Error(`need to consume more than LARGEST_CIRCUIT_SIZE of: ${largestCircuitSize}, but need to consume: ${burnAccountsAndAmounts.length} burnAccount to make the transaction. Please consolidate balance to make this tx`)
    }
    return { burnAccountsAndAmounts, encryptedTotalMinted }
}

export async function getCircuitSizesFromContract(wormholeToken: WormholeToken | WormholeTokenTest) {
    const AMOUNT_OF_VERIFIERS = await wormholeToken.read.AMOUNT_OF_VERIFIERS()
    const sizes = await Promise.all(new Array(AMOUNT_OF_VERIFIERS).fill(0).map((v, index) => wormholeToken.read.VERIFIER_SIZES([BigInt(index)])))
    return sizes
}

// Overload 1: feeData provided → RelayInputs
export async function createRelayerInputs(
    recipient: Address,
    amount: bigint,
    privateWallet: BurnWallet,
    wormholeToken: WormholeToken | WormholeTokenTest,
    archiveClient: PublicClient,
    opts: CreateRelayerInputsOpts & { feeData: FeeData }
): Promise<{ relayInputs: RelayInputs, syncedData: { syncedTree: PreSyncedTree, syncedPrivateWallet: BurnWallet } }>;

// Overload 2: feeData omitted → SelfRelayInputs
export async function createRelayerInputs(
    recipient: Address,
    amount: bigint,
    privateWallet: BurnWallet,
    wormholeToken: WormholeToken | WormholeTokenTest,
    archiveClient: PublicClient,
    opts?: CreateRelayerInputsOpts & { feeData?: undefined }
): Promise<{ relayInputs: SelfRelayInputs, syncedData: { syncedTree: PreSyncedTree, syncedPrivateWallet: BurnWallet } }>;

/**
 * Creates the inputs needed to relay a private transfer (either self-relay or via a relayer).
 *
 * Syncs burn accounts, prepares encrypted spend data, signs the transfer, generates a Merkle
 * inclusion proof for each burn account, and produces a ZK proof over all inputs.
 *
 * Returns `SelfRelayInputs` when no `feeData` is provided, or `RelayInputs` when it is.
 *
 * @note chainId is not yet constrained in the circuit — included for future cross-chain support.
 *
 * @param amount              - Amount to re-mint (required).
 * @param recipient           - Address that will receive the re-minted tokens (required).
 * @param privateWallet       - The caller's private wallet containing burn accounts and signing keys (required).
 * @param wormholeToken       - Contract instance for the WormholeToken (required).
 * @param archiveClient       - Archive-node viem PublicClient used for syncing and log queries (required).
 *
 * --- Defaults via RPC call if not set ---
 * @param powDifficulty       - Proof-of-work difficulty. Defaults to on-chain value from `wormholeToken.POW_DIFFICULTY()`.
 * @param reMintLimit - Max cumulative re-mint cap. Defaults to on-chain value from `wormholeToken.RE_MINT_LIMIT()`.
 * @param chainId             - (@NOTICE not constrained rn) ChainId for the cross-chain transfer. Defaults to `archiveClient.getChainId()`.
 * @param circuitSizes         - sorted array of available circuit sizes. Sorted from smallest to highest.
 * @param maxTreeDepth        - Maximum Merkle tree depth. Defaults to `MAX_TREE_DEPTH`. Changing this produces invalid proofs.
 * 
 * --- Defaults without RPC call ---
 * @param feeData             - If provided, produces `RelayInputs` (third-party relay); omit for `SelfRelayInputs`.
 * @param callData            - Arbitrary calldata forwarded after re-mint. Defaults to `"0x"` (none).
 * @param callValue           - Native value forwarded with the call. Defaults to `0`.
 * @param callCanFail         - Whether a revert in the forwarded call is tolerated. Defaults to `true`.
 * @param burnAddresses       - Subset of burn addresses to spend from. Defaults to every address in `privateWallet`.
 * @param circuitSize         - Circuit size (number of burn-account slots). Defaults to the minimum size that fits the spend (e.g. 2 or 100).
 * @param encryptedBlobLen    - Byte length of each encrypted total-spend blob. Defaults to `ENCRYPTED_TOTAL_SPENT_PADDING + EAS_BYTE_LEN_OVERHEAD`. Changing this makes the transaction distinguishable and reduces anonymity.
 *
 * --- Performance / caching ---
 * @param threads             - Number of worker threads for proof generation. Defaults to max available.
 * @param deploymentBlock     - Block number the contract was deployed at. Defaults to the value in `src/constants.ts`.
 * @param preSyncedTree       - A previously synced Merkle tree to avoid re-syncing from scratch.
 * @param blocksPerGetLogsReq - Max block range per `eth_getLogs` request. Defaults to 19 999.
 * @param backend             - Pre-initialized prover backend; omit to create one internally.
 *
 * --- Circuit constants (do not change unless you know what you're doing) ---
 */
export async function createRelayerInputs(
    recipient: Address,
    amount: bigint,
    privateWallet: BurnWallet,
    wormholeToken: WormholeToken | WormholeTokenTest,
    archiveClient: PublicClient,
    { circuitSizes, threads, chainId, callData = "0x", callValue = 0n, callCanFail = false, feeData, burnAddresses, preSyncedTree, backend, deploymentBlock, blocksPerGetLogsReq, circuitSize, powDifficulty, reMintLimit, maxTreeDepth, encryptedBlobLen = ENCRYPTED_TOTAL_SPENT_PADDING + EAS_BYTE_LEN_OVERHEAD }:
        CreateRelayerInputsOpts & { feeData?: FeeData } = {}
): Promise<{ relayInputs: RelayInputs, syncedData: { syncedTree: PreSyncedTree, syncedPrivateWallet: BurnWallet } } | { relayInputs: SelfRelayInputs, syncedData: { syncedTree: PreSyncedTree, syncedPrivateWallet: BurnWallet } }> {
    // set defaults
    burnAddresses ??= privateWallet.privateData.burnAccounts.map((b) => b.burnAddress)
    powDifficulty ??= await wormholeToken.read.POW_DIFFICULTY()
    reMintLimit ??= await wormholeToken.read.RE_MINT_LIMIT();
    circuitSizes ??= await getCircuitSizesFromContract(wormholeToken);
    chainId ??= BigInt(await archiveClient.getChainId());
    maxTreeDepth ??= await wormholeToken.read.MAX_TREE_DEPTH()
    const largestCircuitSize = circuitSizes[circuitSizes.length - 1]

    // start this asap so we can resolve once we need it
    const syncedTreePromise = getSyncedMerkleTree({
        wormholeToken,
        publicClient: archiveClient,
        //optional inputs
        preSyncedTree,
        deploymentBlock,
        blocksPerGetLogsReq
    })

    // sync burn accounts
    const syncedPrivateWallet = await syncMultipleBurnAccounts({
        wormholeToken: wormholeToken,
        archiveNode: archiveClient,
        privateWallet: privateWallet,
        burnAddressesToSync: burnAddresses //@notice, only syncs these addresses!
    })
    const burnAccounts = privateWallet.privateData.burnAccounts as SyncedBurnAccount[]

    // select burn accounts for spend. Takes highest balances first
    const { burnAccountsAndAmounts, encryptedTotalMinted } = await prepareBurnAccountsForSpend({ burnAccounts, selectBurnAddresses: burnAddresses, amount, largestCircuitSize: largestCircuitSize })
    circuitSize ??= getCircuitSize(burnAccountsAndAmounts.length, circuitSizes)

    // format inputs that wil be signed
    const signatureInputs: SignatureInputs | SignatureInputsWithFee = {
        recipient: recipient,
        amountToReMint: toHex(amount),
        callData: callData,
        callCanFail: callCanFail,
        callValue: toHex(callValue),
        // remember if you do not do padWithRandomHex you reveal how many address you consumed!
        encryptedTotalMinted: padWithRandomHex({ arr: encryptedTotalMinted, len: circuitSize, hexSize: encryptedBlobLen, dir: "right" }),
        feeData,
    }


    // as promise so we allow some extra time for syncedTreePromise to resolve
    let allSignatureDataPromise;
    if (feeData !== undefined) {
        allSignatureDataPromise = signPrivateTransferWithFee({
            privateWallet: privateWallet,
            signatureInputs: signatureInputs as SignatureInputsWithFee,
            chainId: Number(chainId),
            tokenAddress: wormholeToken.address,
        })

    } else {
        allSignatureDataPromise = signPrivateTransfer({
            privateWallet: privateWallet,
            signatureInputs: signatureInputs as SignatureInputs,
            chainId: Number(chainId),
            tokenAddress: wormholeToken.address
        })

    }

    const syncedTree = await syncedTreePromise;
    const { signatureData, signatureHash } = await allSignatureDataPromise;
    privateWallet = syncedPrivateWallet
    //----------------------------------------------------------------------

    // ----- collect proof inputs from the burn accounts -----
    // nullifiers, noteHashes, merkle proofs
    const nullifiers: bigint[] = []
    const noteHashes: bigint[] = []
    const burnAccountProofs: (BurnAccountProof|FakeBurnAccountProof)[] = []
    // TODO @Warptoad: check chainId matches burn account. remove burn account with different chainId
    for (let index = 0; index < circuitSize; index++) {
        if (index < burnAccountsAndAmounts.length) {
            const { burnAccount, amountToClaim } = burnAccountsAndAmounts[index];
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
        } else {
            const fakeBurnAccount: FakeBurnAccount = {viewingKey:toHex(randomBN254FieldElement())} 
            const burnAccountProof: FakeBurnAccountProof = {
                burnAccount: fakeBurnAccount,
            }
            const nullifier = hashFakeNullifier({viewingKey:BigInt(fakeBurnAccount.viewingKey)})
            const nextTotalSpendNoteHash = hashFakeLeaf({viewingKey:BigInt(fakeBurnAccount.viewingKey)})
            burnAccountProofs.push(burnAccountProof)

            nullifiers.push(nullifier)
            noteHashes.push(nextTotalSpendNoteHash)
        }
    }

    // final formatting proofs so noir can use them!
    const publicInputs = getPubInputs({
        amountToReMint: amount,
        root: syncedTree.tree.root,
        chainId: chainId,
        signatureHash: signatureHash,
        nullifiers: nullifiers,
        noteHashes: noteHashes,
        circuitSize: circuitSize,
        powDifficulty: powDifficulty,
        reMintLimit: reMintLimit,
        circuitSizes: circuitSizes,
        burnAccountProofs: burnAccountProofs
    })
    const privateInputs = getPrivInputs({
        burnAccountsProofs: burnAccountProofs,
        signatureData: signatureData,
        maxTreeDepth: maxTreeDepth,
        circuitSize: circuitSize,
        circuitSizes: circuitSizes
    })
    const proofInputs = { ...publicInputs, ...privateInputs } as ProofInputs1n | ProofInputs4n

    // make proof!
    const zkProof = await generateProof({ proofInputs: proofInputs, backend: backend, threads: threads, circuitSizes: circuitSizes })
    if (feeData) {
        return {
            relayInputs:
                {
                    publicInputs: publicInputs,
                    proof: toHex(zkProof.proof),
                    signatureInputs: signatureInputs as SignatureInputsWithFee,
                } as RelayInputs,
            syncedData: {
                syncedTree,
                syncedPrivateWallet
            }
        };
    } else {
        return {
            relayInputs: {
                publicInputs: publicInputs,
                proof: toHex(zkProof.proof),
                signatureInputs: signatureInputs as SignatureInputs,
            } as SelfRelayInputs,
            syncedData: {
                syncedTree,
                syncedPrivateWallet
            }
        };
    }
}
/**
 * Generates a ZK proof and submits a self-relay transaction in one call.
 *
 * Wraps {@link createRelayerInputs} (with no `feeData`) and then submits via {@link selfRelayTx}.
 *
 * @param amount              - Amount to re-mint (required).
 * @param recipient           - Address that will receive the re-minted tokens (required).
 * @param privateWallet       - The caller's private wallet containing burn accounts and signing keys (required).
 * @param burnAddresses       - Burn addresses to spend from (required).
 * @param wormholeToken       - Contract instance for the WormholeToken (required).
 * @param archiveClient       - Archive-node viem PublicClient used for syncing and log queries (required).
 *
 * --- Defaults via RPC call if not set ---
 * @param powDifficulty       - Proof-of-work difficulty. Defaults to on-chain value from `wormholeToken.POW_DIFFICULTY()`.
 * @param reMintLimit - Max cumulative re-mint cap. Defaults to on-chain value from `wormholeToken.RE_MINT_LIMIT()`.
 * @param fullNodeClient      - Full-node client for chainId lookup. Defaults to `archiveClient`.
 *
 * --- Defaults without RPC call ---
 * @param callData            - Arbitrary calldata forwarded after re-mint. Defaults to `"0x"` (none).
 * @param callValue           - Native value forwarded with the call. Defaults to `0`.
 * @param callCanFail         - Whether a revert in the forwarded call is tolerated. Defaults to `false`.
 * @param circuitSize         - Circuit size (number of burn-account slots). Defaults to the minimum size that fits the spend.
 * @param encryptedBlobLen    - Byte length of each encrypted total-spend blob. Defaults to `ENCRYPTED_TOTAL_SPENT_PADDING + EAS_BYTE_LEN_OVERHEAD`.
 *
 * --- Performance / caching ---
 * @param threads             - Number of worker threads for proof generation. Defaults to max available.
 * @param deploymentBlock     - Block number the contract was deployed at. Defaults to the value in `src/constants.ts`.
 * @param preSyncedTree       - A previously synced Merkle tree to avoid re-syncing from scratch.
 * @param blocksPerGetLogsReq - Max block range per `eth_getLogs` request. Defaults to 19 999.
 * @param backend             - Pre-initialized prover backend; omit to create one internally.
 *
 * --- Circuit constants (do not change unless you know what you're doing) ---
 * @param maxTreeDepth        - Maximum Merkle tree depth. Defaults to `MAX_TREE_DEPTH`. Changing this produces invalid proofs.
 */
export async function proofAndSelfRelay(
    recipient: Address,
    amount: bigint,
    privateWallet: BurnWallet,
    wormholeToken: WormholeToken | WormholeTokenTest,
    archiveClient: PublicClient,
    { burnAddresses, threads, callData = "0x", callValue = 0n, callCanFail = false, preSyncedTree, backend, deploymentBlock, blocksPerGetLogsReq, circuitSize, maxTreeDepth, encryptedBlobLen = ENCRYPTED_TOTAL_SPENT_PADDING + EAS_BYTE_LEN_OVERHEAD, powDifficulty, reMintLimit }:
        { burnAddresses?: Address[], threads?: number, callData?: Hex, callCanFail?: boolean, callValue?: bigint, preSyncedTree?: PreSyncedTree, backend?: UltraHonkBackend, deploymentBlock?: bigint, blocksPerGetLogsReq?: bigint, circuitSize?: number, maxTreeDepth?: number, encryptedBlobLen?: number, powDifficulty?: Hex, reMintLimit?: Hex } = {}
) {
    const chainId = BigInt(await archiveClient.getChainId())
    deploymentBlock ??= getDeploymentBlock(Number(chainId))

    const { relayInputs: selfRelayInputs } = await createRelayerInputs(
        recipient,
        amount,
        privateWallet,
        wormholeToken,
        archiveClient,
        {
            powDifficulty,
            reMintLimit,
            chainId,
            callData,
            callValue,
            callCanFail,
            burnAddresses,
            circuitSize,
            encryptedBlobLen,
            threads,
            deploymentBlock,
            preSyncedTree,
            blocksPerGetLogsReq,
            backend,
            maxTreeDepth,
        }
    )

    return await selfRelayTx(
        selfRelayInputs,
        privateWallet.viemWallet,
        wormholeToken as WormholeTokenTest,
    )
}

/**
 * Submits a self-relay `reMint` transaction.
 *
 * @param selfRelayInputs       - JSON-serializable relay inputs (all values are Hex strings).
 * @param wallet                - Viem WalletClient that signs and sends the transaction.
 * @param wormholeTokenContract - WormholeToken contract instance with write access.
 */
export async function selfRelayTx(selfRelayInputs: SelfRelayInputs, wallet: WalletClient, wormholeTokenContract: WormholeTokenTest) {
    const _accountNoteHashes = selfRelayInputs.publicInputs.burn_data_public.map((v) => BigInt(v.total_minted_leaf))
    const _accountNoteNullifiers = selfRelayInputs.publicInputs.burn_data_public.map((v) => BigInt(v.nullifier))
    const _root = BigInt(selfRelayInputs.publicInputs.root)
    const _snarkProof = selfRelayInputs.proof
    const _signatureInputs =
    {
        amountToReMint: BigInt(selfRelayInputs.signatureInputs.amountToReMint),
        recipient: selfRelayInputs.signatureInputs.recipient,
        callData: selfRelayInputs.signatureInputs.callData,
        encryptedTotalMinted: selfRelayInputs.signatureInputs.encryptedTotalMinted,
        callCanFail: selfRelayInputs.signatureInputs.callCanFail,
        callValue: BigInt(selfRelayInputs.signatureInputs.callValue)

    }
    return await wormholeTokenContract.write.reMint([
        _accountNoteHashes,
        _accountNoteNullifiers,
        _root,
        _snarkProof,
        _signatureInputs
        // estimation is some time so high it goes over the per tx limit on sepolia
        // to not scare users. we wont set the gas limit super high when the amount of _accountNoteHashes is only 2 (circuit size)
    ], { account: wallet.account?.address as Address, gas: _accountNoteHashes.length > 32 ? GAS_LIMIT_TX : undefined })
}

/**
 * Submits a relayer-paid `reMintRelayer` transaction.
 * @TODO does not check profitability
 *
 * @param relayInputs           - JSON-serializable relay inputs (all values are Hex strings).
 * @param wallet                - Viem WalletClient that signs and sends the transaction (the relayer).
 * @param wormholeTokenContract - WormholeToken contract instance with write access.
 */
export async function relayTx(relayInputs: RelayInputs, wallet: WalletClient, wormholeTokenContract: WormholeTokenTest) {
    const _accountNoteHashes = relayInputs.publicInputs.burn_data_public.map((v) => BigInt(v.total_minted_leaf))
    const _accountNoteNullifiers = relayInputs.publicInputs.burn_data_public.map((v) => BigInt(v.nullifier))
    const _root = BigInt(relayInputs.publicInputs.root)
    const _snarkProof = relayInputs.proof
    const _signatureInputs =
    {
        amountToReMint: BigInt(relayInputs.signatureInputs.amountToReMint),
        recipient: relayInputs.signatureInputs.recipient,
        callData: relayInputs.signatureInputs.callData,
        encryptedTotalMinted: relayInputs.signatureInputs.encryptedTotalMinted,
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
    return await wormholeTokenContract.write.reMintRelayer([
        _accountNoteHashes,
        _accountNoteNullifiers,
        _root,
        _snarkProof,
        _signatureInputs,
        feeData
        // estimation is some time so high it goes over the per tx limit on sepolia
        // to not scare users. we wont set the gas limit super high when the amount of _accountNoteHashes is only 2 (circuit size)
    ], { account: wallet.account?.address as Address, gas: _accountNoteHashes.length > 32 ? GAS_LIMIT_TX : undefined })
}
export async function getFreshBurnAccount(privateWallet: BurnWallet, wormholeToken: WormholeTokenTest | WormholeToken) {
    const neverUsedBurnAccounts = privateWallet.privateData.burnAccounts.filter(async (b) => await wormholeToken.read.balanceOf([b.burnAddress]) === 0n)
}