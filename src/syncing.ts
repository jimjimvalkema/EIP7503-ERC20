import { queryEventInChunks } from "@warptoad/gigabridge-js"
import { LeanIMTHashFunction, LeanIMT } from "@zk-kit/lean-imt"
import { Address, PublicClient } from "viem"
import { WormholeTokenTest } from "../test/Token.test.js"
import { WORMHOLE_TOKEN_DEPLOYMENT_BLOCK } from "./constants.js"
import { SyncedPrivateWallet, UnsyncedPrivateWallet, WormholeToken } from "./types.js"
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { hashNullifier } from "./hashing.js"

export function getWormholeTokenDeploymentBlock(chainId: number) {
    if (Number(chainId) in WORMHOLE_TOKEN_DEPLOYMENT_BLOCK) {
        return WORMHOLE_TOKEN_DEPLOYMENT_BLOCK[chainId]
    } else {
        //console.warn(`no deployment block found for chainId: ${chainId.toString()}, defaulted to 0n`)
        return 0n
    }
}

export const poseidon2IMTHashFunc: LeanIMTHashFunction = (a: bigint, b: bigint) => poseidon2Hash([a, b])

export async function getTree(
    { wormholeToken, publicClient, deploymentBlock, blocksPerGetLogsReq }:
        { publicClient: PublicClient, wormholeToken: WormholeToken | WormholeTokenTest, deploymentBlock?: bigint, blocksPerGetLogsReq?: bigint }
) {
    deploymentBlock ??= getWormholeTokenDeploymentBlock(await publicClient.getChainId())

    const events = await queryEventInChunks({
        publicClient: publicClient,
        contract: wormholeToken as WormholeToken,
        eventName: "NewLeaf",
        firstBlock: deploymentBlock,
        chunkSize: blocksPerGetLogsReq,
    })
    const sortedEvents = events.sort((a: any, b: any) => Number(a.args.index - b.args.index))
    const leafs = sortedEvents.map((event) => event.args.leaf)
    const tree = new LeanIMT(poseidon2IMTHashFunc, leafs)
    return tree
}

//you can event scan or just iter over the nullifier mapping!
export async function syncPrivateAccountData(
    {wormholeToken,privateWallet}
    :{privateWallet:UnsyncedPrivateWallet, wormholeToken:WormholeToken|WormholeTokenTest}
):Promise<SyncedPrivateWallet> {
    let accountNonce = privateWallet.accountNonce ?? 0n
    let totalSpent = privateWallet.totalSpent ?? 0n
    let isNullified = true;
    while (isNullified) {
        const nullifier = hashNullifier({accountNonce,viewingKey:privateWallet.viewingKey})
        const res = await wormholeToken.read.nullifiers([nullifier])
        isNullified = res > 0n
        if (!isNullified) {
            break
        }
        // the mapping stores nullifiers[nullifier] + amount + 1
        // +1 so when amount is 0 something is still stored and nullifier is still nullified when checking require(nullifiers[_accountNoteNullifier] == uint256(0), "nullifier already exist");
        accountNonce+=1n
        totalSpent+=res-1n 
    }

    const syncedPrivateWallet = {...privateWallet}
    syncedPrivateWallet.totalSpent = totalSpent;
    syncedPrivateWallet.accountNonce = accountNonce;
    syncedPrivateWallet.totalReceived = await wormholeToken.read.balanceOf([privateWallet.burnAddress]);
    return syncedPrivateWallet as SyncedPrivateWallet
}
