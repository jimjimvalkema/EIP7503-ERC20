import { queryEventInChunks } from "@warptoad/gigabridge-js/viem-utils"
import { LeanIMTHashFunction, LeanIMT } from "@zk-kit/lean-imt"
import { Abi, AbiEvent, Address, bytesToHex, concatHex, Hex, hexToBytes, presignMessagePrefix, PublicClient, sliceHex, toBytes, toHex } from "viem"
import { WormholeTokenTest } from "../test/2inRemint.test.js"
import { ENCRYPTED_TOTAL_SPENT_PADDING, WORMHOLE_TOKEN_DEPLOYMENT_BLOCK } from "./constants.js"
import { BurnAccount, PreSyncedTree, SyncedBurnAccount, UnsyncedBurnAccount, WormholeToken } from "./types.js"
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { hashNullifier } from "./hashing.js"
import { PrivateWallet } from "./PrivateWallet.js"

export function getDeploymentBlock(chainId: number) {
    if (Number(chainId) in WORMHOLE_TOKEN_DEPLOYMENT_BLOCK) {
        return WORMHOLE_TOKEN_DEPLOYMENT_BLOCK[chainId]
    } else {
        //console.warn(`no deployment block found for chainId: ${chainId.toString()}, defaulted to 0n`)
        return 0n
    }
}

export const poseidon2IMTHashFunc: LeanIMTHashFunction = (a: bigint, b: bigint) => poseidon2Hash([a, b])

export async function getSyncedMerkleTree(
    { wormholeToken, publicClient, preSyncedTree, deploymentBlock, blocksPerGetLogsReq }:
        { publicClient: PublicClient, wormholeToken: WormholeToken | WormholeTokenTest, preSyncedTree?: PreSyncedTree, deploymentBlock?: bigint, blocksPerGetLogsReq?: bigint }
) {
    deploymentBlock ??= getDeploymentBlock(await publicClient.getChainId())
    let firstSyncBlock = deploymentBlock
    let originalStartSyncBlock = deploymentBlock
    let preSyncedLeaves: bigint[] = []

    if (preSyncedTree) {
        // check preSyncedTree 
        if (preSyncedTree.firstSyncedBlock > deploymentBlock) { throw new Error(`preSyncedTree is not synced from deployment block (${deploymentBlock}), this is not supported`) }
        if (preSyncedTree.firstSyncedBlock < deploymentBlock) { console.warn(`preSyncedTree has been synced from a block before deployment block. Is this the right tree?`) }
        const isValidRoot = await wormholeToken.read.roots([preSyncedTree.tree.root]);
        if (isValidRoot === false) { throw new Error(`preSyncedTrees root is not in the "roots" mapping of tree onchain. preSyncedTreeRoot: ${preSyncedTree.tree.root}, lastPreSyncedBlockNumber:${preSyncedTree.lastSyncedBlock}`) }

        // use preSyncedTree data
        firstSyncBlock = preSyncedTree.lastSyncedBlock + 1n
        originalStartSyncBlock = preSyncedTree.firstSyncedBlock
        preSyncedLeaves = preSyncedTree.tree.leaves
    }

    // sync it
    const lastSyncedBlock = await publicClient.getBlockNumber()
    const events = await queryEventInChunks({
        publicClient: publicClient,
        contract: wormholeToken as WormholeToken,
        eventName: "NewLeaf",
        firstBlock: firstSyncBlock,
        lastBlock: lastSyncedBlock,
        chunkSize: blocksPerGetLogsReq,
    })
    // formatting
    const sortedEvents = events.sort((a: any, b: any) => Number(a.args.index - b.args.index))
    const leafs = [...preSyncedLeaves, ...sortedEvents.map((event) => event.args.leaf)]
    const tree = new LeanIMT(poseidon2IMTHashFunc, leafs)

    // check root against chain
    const isValidRoot = await wormholeToken.read.roots([tree.root])
    if (isValidRoot === false) { throw new Error("getTree synced but got invalid root") }

    return { tree, lastSyncedBlock, firstSyncedBlock: deploymentBlock } as PreSyncedTree
}

async function encrypt({ plaintext, viewingKey, padding=ENCRYPTED_TOTAL_SPENT_PADDING }: { plaintext: string, viewingKey: Hex, padding?:number }): Promise<Hex> {
    if (plaintext.length > padding) {
        throw new Error(`Plaintext too long: ${plaintext.length} > ${padding}`)
    }
    const padded = plaintext.padEnd(padding, '\0')

    const iv = crypto.getRandomValues(new Uint8Array(12))

    const key = await crypto.subtle.importKey(
        'raw',
        hexToBytes(viewingKey).slice(),
        'AES-GCM',
        false,
        ['encrypt']
    )

    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(padded)
    )

    return concatHex([
        bytesToHex(iv),
        bytesToHex(new Uint8Array(encrypted))
    ])
}

async function decrypt({ viewingKey, cipherText }: { viewingKey: Hex, cipherText: Hex }) {
    const iv = hexToBytes(sliceHex(cipherText, 0, 12)).slice()
    const encrypted = hexToBytes(sliceHex(cipherText, 12)).slice()

    const key = await crypto.subtle.importKey(
        'raw',
        hexToBytes(viewingKey, { size: 32 }).slice(),
        'AES-GCM',
        false,
        ['decrypt']
    )

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encrypted
    )

    return new TextDecoder().decode(decrypted).replace(/\0+$/, '')
}

export async function encryptTotalSpend({ viewingKey, amount }: { viewingKey: Hex, amount: bigint }):Promise<Hex> {
    const json = {totalSpend:toHex(amount, {size:32})}
    return await encrypt({plaintext:JSON.stringify(json), viewingKey})
}

export async function decryptTotalSpend({ viewingKey, totalSpentEncrypted }: { viewingKey: Hex, totalSpentEncrypted: Hex }):Promise<bigint> {
    const decryptedJson = JSON.parse(await decrypt({ viewingKey: viewingKey, cipherText: totalSpentEncrypted }))
    return BigInt(decryptedJson.totalSpend)
}



//you can event scan or just iter over the nullifier mapping!
// TODO add actual balance
export async function syncBurnAccount(
    { wormholeToken, burnAccount, archiveNode }
        : { wormholeToken: WormholeToken | WormholeTokenTest, burnAccount: BurnAccount, archiveNode: PublicClient }
): Promise<SyncedBurnAccount> {
    const viewingKey = BigInt(burnAccount.viewingKey)
    let accountNonce = BigInt(burnAccount.accountNonce ?? 0n)
    let totalSpent = BigInt(burnAccount.totalSpent ?? 0n)
    let isNullified = true;
    let lastSpendBlockNum: bigint = 0n
    while (isNullified) {
        const nullifier = hashNullifier({ accountNonce: accountNonce, viewingKey: viewingKey })
        const nullifiedAtBlock = await wormholeToken.read.nullifiers([nullifier])
        isNullified = nullifiedAtBlock > 0n
        if (!isNullified) {
            break
        }
        accountNonce += 1n
        lastSpendBlockNum = nullifiedAtBlock
    }

    const logs = await archiveNode.getContractEvents({
        address: wormholeToken.address,
        abi: wormholeToken.abi,
        eventName: "Nullified",
        fromBlock: lastSpendBlockNum,
        toBlock: lastSpendBlockNum,
    })
    // accountNonce not 0? we have spent before!
    if (accountNonce !== 0n) {
        const totalSpentEncrypted = logs[0].args.totalSpentEncrypted as Hex;
        totalSpent = await decryptTotalSpend({totalSpentEncrypted:totalSpentEncrypted, viewingKey:toHex(viewingKey)});
    }

    const totalReceived = await wormholeToken.read.balanceOf([burnAccount.burnAddress]);
    const syncedBurnAccount = burnAccount as SyncedBurnAccount
    syncedBurnAccount.totalSpent = toHex(totalSpent);
    syncedBurnAccount.accountNonce = toHex(accountNonce);
    syncedBurnAccount.totalBurned = toHex(totalReceived)
    syncedBurnAccount.spendableBalance = toHex(totalReceived - totalSpent)
    return syncedBurnAccount
}

/**
 * defaults to syncing all burn accounts
 * @notice sync concurrently all accounts, this might overwhelm rpcs
 * TODO use p-limit
 * @param param0 
 * @returns 
 */
export async function syncMultipleBurnAccounts({ wormholeToken, archiveNode, privateWallet, burnAddressesToSync }: { archiveNode: PublicClient, wormholeToken: WormholeToken, privateWallet: PrivateWallet, burnAddressesToSync?: Address[] }) {
    burnAddressesToSync ??= privateWallet.privateData.burnAccounts.map((v) => v.burnAddress)
    const syncedBurnAccounts = await Promise.all(privateWallet.privateData.burnAccounts.map((burnAccount) => {
        if (burnAddressesToSync.includes(burnAccount.burnAddress)) {
            return syncBurnAccount({ burnAccount, wormholeToken, archiveNode })
        } else {
            return burnAccount
        }
    }))
    privateWallet.privateData.burnAccounts = syncedBurnAccounts
    return privateWallet
}

// export async function isSyncedPrivateWallet({ privateWallet, wormholeToken }: { privateWallet: SyncedPrivateWallet | UnsyncedPrivateWallet, wormholeToken: WormholeToken | WormholeTokenTest }) {
//     if ("accountNonce" in privateWallet) {
//         const nextNullifier = hashNullifier({ accountNonce: (privateWallet as SyncedPrivateWallet).accountNonce, viewingKey: privateWallet.viewingKey });
//         const res = await wormholeToken.read.nullifiers([nextNullifier]);
//         return !Boolean(res); //0n === not spend, any other amount = spend
//     } else {
//         return false
//     }
// }
