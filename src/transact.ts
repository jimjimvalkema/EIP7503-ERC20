import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { toHex } from "viem";
import type { WormholeTokenTest } from "../test/2inRemint.test.ts";
import type { CreateRelayerInputsOpts, FeeData, NotOwnedBurnAccount, PreSyncedTree, ProofInputs1n, ProofInputs4n, PublicProofInputs, RelayInputs, SelfRelayInputs, SignatureInputs, SignatureInputsWithFee, SyncedBurnAccount, UnsyncedBurnAccount, WormholeToken } from "./types.ts";
import { generateProof, getSpendableBalanceProof, getPubInputs, getPrivInputs, padArray } from "./proving.ts";
import type { BurnAccountProof } from "./proving.ts";
import type { ProofData } from "@aztec/bb.js";
import { UltraHonkBackend } from "@aztec/bb.js";
import { getSyncedMerkleTree, getDeploymentBlock, syncMultipleBurnAccounts, encryptTotalSpend } from "./syncing.ts";
import { getBurnAddress, getBurnAddressSafe, hashBlindedAddressData, hashNullifier, hashTotalBurnedLeaf, hashTotalSpentLeaf, padWithRandomHex, signPrivateTransfer, signPrivateTransferWithFee } from "./hashing.ts";
import { PrivateWallet } from "./PrivateWallet.ts";
import { CIRCUIT_SIZES, EAS_BYTE_LEN_OVERHEAD, ENCRYPTED_TOTAL_SPENT_PADDING, LARGEST_CIRCUIT_SIZE, MAX_TREE_DEPTH } from "./constants.ts";


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
export async function safeBurn(
    burnAccount: NotOwnedBurnAccount | UnsyncedBurnAccount | SyncedBurnAccount, wormholeToken: WormholeToken | WormholeTokenTest, amount: bigint,
    { difficulty, maxTotalReMintLimit, maxTreeDepth = MAX_TREE_DEPTH }: { difficulty?: bigint, maxTotalReMintLimit?: bigint, maxTreeDepth?: number } = {}
) {
    difficulty ??= BigInt(await wormholeToken.read.POW_DIFFICULTY())
    maxTotalReMintLimit ??= BigInt(await wormholeToken.read.MAX_TOTAL_RE_MINT_LIMIT())
    const balance = await wormholeToken.read.balanceOf([burnAccount.burnAddress])
    const newBurnBalance = balance + amount
    const burnAddress = getBurnAddressSafe({ blindedAddressDataHash: BigInt(burnAccount.blindedAddressDataHash), powNonce: BigInt(burnAccount.powNonce), difficulty: difficulty })
    const treeSize = await wormholeToken.read.treeSize()
    const safeDistanceFromFullTree = (35_000n / 10n) * 60n * 60n // 35_000 burn tx's for 1 hour.  assumes a 35_000 tps chain and burn txs being 10x expensive
    const fullTreeSize = 2n ** BigInt(maxTreeDepth)
    if (treeSize >= fullTreeSize) { throw new Error("Tree is FULL this tx WILL RESULT IS LOSS OF ALL FUNDS SEND. DO NOT SEND ANY BURN TRANSACTION!!!") }
    if (treeSize + safeDistanceFromFullTree >= fullTreeSize) { throw new Error("Tree is almost full and the risk is high this burn tx will result in loss of all funds send") }
    if (newBurnBalance < maxTotalReMintLimit === false) { throw new Error(`This transfer will cause the balance to go over the MAX_TOTAL_RE_MINT_LIMIT. This wil result in LOSS OF ALL FUNDS OVER THE LIMIT!! DO NOT SEND THIS TRANSACTION!!\n new balance: ${newBurnBalance} \n limit:       ${maxTotalReMintLimit}`) }
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
export async function superSafeBurn(
    burnAccount: UnsyncedBurnAccount | SyncedBurnAccount, wormholeToken: WormholeToken | WormholeTokenTest, amount: bigint,
    { difficulty, maxTotalReMintLimit, maxTreeDepth = MAX_TREE_DEPTH }: { difficulty?: bigint, maxTotalReMintLimit?: bigint, maxTreeDepth?: number } = {}
) {
    difficulty ??= BigInt(await wormholeToken.read.POW_DIFFICULTY())
    maxTotalReMintLimit ??= BigInt(await wormholeToken.read.MAX_TOTAL_RE_MINT_LIMIT())
    const balance = await wormholeToken.read.balanceOf([burnAccount.burnAddress])
    const newBurnBalance = balance + amount
    const blindedAddressDataHash = hashBlindedAddressData({ spendingPubKeyX: burnAccount.spendingPubKeyX, viewingKey: BigInt(burnAccount.viewingKey), chainId: BigInt(burnAccount.chainId) })
    const burnAddress = getBurnAddressSafe({ blindedAddressDataHash: blindedAddressDataHash, powNonce: BigInt(burnAccount.powNonce), difficulty: difficulty })
    const treeSize = await wormholeToken.read.treeSize()
    const safeDistanceFromFullTree = (35_000n / 10n) * 60n * 60n // 35_000 burn tx's for 1 hour.  assumes a 35_000 tps chain and burn txs being 10x expensive
    const fullTreeSize = 2n ** BigInt(maxTreeDepth)
    if (treeSize >= fullTreeSize) { throw new Error("Tree is FULL this tx WILL RESULT IS LOSS OF ALL FUNDS SEND. DO NOT SEND ANY BURN TRANSACTION!!!") }
    if (treeSize + safeDistanceFromFullTree >= fullTreeSize) { throw new Error("Tree is almost full and the risk is high this burn tx will result in loss of all funds send") }
    if (newBurnBalance < maxTotalReMintLimit === false) { throw new Error(`This transfer will cause the balance to go over the MAX_TOTAL_RE_MINT_LIMIT. This wil result in LOSS OF ALL FUNDS OVER THE LIMIT!! DO NOT SEND THIS TRANSACTION!!\n new balance: ${newBurnBalance} \n limit:       ${maxTotalReMintLimit}`) }
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
        throw new Error(`not enough balances in selected burn accounts, short of ${Number(amountLeft)}, selected burn accounts: ${sortedBurnAccounts}`)
    }

    console.log(`burn accounts selected: \n${burnAccountsAndAmounts.map((b) => `${b.burnAccount.burnAddress},spendable:${b.burnAccount.spendableBalance},burned:${b.burnAccount.totalBurned},amountToBeClaimed:${b.amountToClaim}\n`)}`)
    if (burnAccountsAndAmounts.length > LARGEST_CIRCUIT_SIZE) {
        throw new Error(`need to consume more than LARGEST_CIRCUIT_SIZE of: ${LARGEST_CIRCUIT_SIZE}, but need to consume: ${burnAccountsAndAmounts.length} burnAccount to make the transaction. Please consolidate balance to make this tx`)
    }
    return { burnAccountsAndAmounts, encryptedTotalSpends }
}

// Overload 1: feeData provided → RelayInputs
export async function createRelayerInputs(
    recipient: Address,
    amount: bigint,
    privateWallet: PrivateWallet,
    wormholeToken: WormholeToken | WormholeTokenTest,
    archiveClient: PublicClient,
    opts: CreateRelayerInputsOpts & { feeData: FeeData }
): Promise<{ relayInputs:RelayInputs, syncedData:{syncedTree:PreSyncedTree, syncedPrivateWallet:PrivateWallet } }>;

// Overload 2: feeData omitted → SelfRelayInputs
export async function createRelayerInputs(
    recipient: Address,
    amount: bigint,
    privateWallet: PrivateWallet,
    wormholeToken: WormholeToken | WormholeTokenTest,
    archiveClient: PublicClient,
    opts?: CreateRelayerInputsOpts & { feeData?: undefined }
): Promise<{ relayInputs:SelfRelayInputs, syncedData:{syncedTree:PreSyncedTree, syncedPrivateWallet:PrivateWallet } }>;

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
 * @param maxTotalReMintLimit - Max cumulative re-mint cap. Defaults to on-chain value from `wormholeToken.MAX_TOTAL_RE_MINT_LIMIT()`.
 * @param chainId             - (@NOTICE not constrained rn) ChainId for the cross-chain transfer. Defaults to `archiveClient.getChainId()`.
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
 * @param maxTreeDepth        - Maximum Merkle tree depth. Defaults to `MAX_TREE_DEPTH`. Changing this produces invalid proofs.
 */
export async function createRelayerInputs(
    recipient: Address,
    amount: bigint,
    privateWallet: PrivateWallet,
    wormholeToken: WormholeToken | WormholeTokenTest,
    archiveClient: PublicClient,
    { threads, chainId, callData = "0x", callValue = 0n, callCanFail = true, feeData, burnAddresses, preSyncedTree, backend, deploymentBlock, blocksPerGetLogsReq, circuitSize, powDifficulty, maxTotalReMintLimit, maxTreeDepth = MAX_TREE_DEPTH, encryptedBlobLen = ENCRYPTED_TOTAL_SPENT_PADDING + EAS_BYTE_LEN_OVERHEAD }:
        CreateRelayerInputsOpts & { feeData?: FeeData } = {}
): Promise<{ relayInputs:RelayInputs, syncedData:{syncedTree:PreSyncedTree, syncedPrivateWallet:PrivateWallet } } | { relayInputs:SelfRelayInputs,  syncedData:{syncedTree:PreSyncedTree, syncedPrivateWallet:PrivateWallet } }> {
    // set defaults
    burnAddresses ??= privateWallet.privateData.burnAccounts.map((b) => b.burnAddress)
    powDifficulty ??= await wormholeToken.read.POW_DIFFICULTY()
    maxTotalReMintLimit ??= await wormholeToken.read.MAX_TOTAL_RE_MINT_LIMIT();
    chainId ??= BigInt(await archiveClient.getChainId())

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
    console.log({burnAccounts})
    const { burnAccountsAndAmounts, encryptedTotalSpends } = await prepareBurnAccountsForSpend({ burnAccounts, selectBurnAddresses: burnAddresses, amount })
    circuitSize ??= getCircuitSize(burnAccountsAndAmounts.length)

    // format inputs that wil be signed
    const signatureInputs: SignatureInputs | SignatureInputsWithFee = {
        recipient: recipient,
        amountToReMint: toHex(amount),
        callData: callData,
        callCanFail: callCanFail,
        callValue: toHex(callValue),
        // remember if you do not do padWithRandomHex you reveal how many address you consumed!
        encryptedTotalSpends: padWithRandomHex({ arr: encryptedTotalSpends, len: circuitSize, hexSize: encryptedBlobLen, dir: "right" }),
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
        maxTotalReMintLimit: maxTotalReMintLimit
    })
    const privateInputs = getPrivInputs({
        burnAccountsProofs: burnAccountProofs,
        signatureData: signatureData,
        maxTreeDepth: maxTreeDepth,
        circuitSize: circuitSize
    })
    const proofInputs = { ...publicInputs, ...privateInputs } as ProofInputs1n | ProofInputs4n

    // make proof!
    const zkProof = await generateProof({ proofInputs: proofInputs, backend: backend, threads: threads })
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
 * @param maxTotalReMintLimit - Max cumulative re-mint cap. Defaults to on-chain value from `wormholeToken.MAX_TOTAL_RE_MINT_LIMIT()`.
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
    privateWallet: PrivateWallet,
    wormholeToken: WormholeToken | WormholeTokenTest,
    archiveClient: PublicClient,
    { burnAddresses, threads, callData = "0x", callValue = 0n, callCanFail = false, fullNodeClient, preSyncedTree, backend, deploymentBlock, blocksPerGetLogsReq, circuitSize, maxTreeDepth = MAX_TREE_DEPTH, encryptedBlobLen = ENCRYPTED_TOTAL_SPENT_PADDING + EAS_BYTE_LEN_OVERHEAD, powDifficulty, maxTotalReMintLimit }:
        { burnAddresses?: Address[], threads?: number, callData?: Hex, callCanFail?: boolean, callValue?: bigint, fullNodeClient?: PublicClient, preSyncedTree?: PreSyncedTree, backend?: UltraHonkBackend, deploymentBlock?: bigint, blocksPerGetLogsReq?: bigint, circuitSize?: number, maxTreeDepth?: number, encryptedBlobLen?: number, powDifficulty?: Hex, maxTotalReMintLimit?: Hex } = {}
) {
    fullNodeClient ??= archiveClient;
    const chainId = BigInt(await fullNodeClient.getChainId())
    deploymentBlock ??= getDeploymentBlock(Number(chainId))

    const {relayInputs:selfRelayInputs} = await createRelayerInputs(
        recipient,
        amount,
        privateWallet,
        wormholeToken,
        archiveClient,
        {
            powDifficulty,
            maxTotalReMintLimit,
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
 * Submits a self-relay `privateReMint` transaction.
 *
 * @param selfRelayInputs       - JSON-serializable relay inputs (all values are Hex strings).
 * @param wallet                - Viem WalletClient that signs and sends the transaction.
 * @param wormholeTokenContract - WormholeToken contract instance with write access.
 */
export async function selfRelayTx(selfRelayInputs: SelfRelayInputs, wallet: WalletClient, wormholeTokenContract: WormholeTokenTest) {
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

/**
 * Submits a relayer-paid `privateReMintRelayer` transaction.
 * @TODO does not check profitability
 *
 * @param relayInputs           - JSON-serializable relay inputs (all values are Hex strings).
 * @param wallet                - Viem WalletClient that signs and sends the transaction (the relayer).
 * @param wormholeTokenContract - WormholeToken contract instance with write access.
 */
export async function relayTx(relayInputs: RelayInputs, wallet: WalletClient, wormholeTokenContract: WormholeTokenTest) {
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