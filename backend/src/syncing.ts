import { queryEventInChunks } from "@warptoad/gigabridge-js/viem-utils"
import { LeanIMTHashFunction, LeanIMT } from "@zk-kit/lean-imt"
import { PublicClient } from "viem"
import { WormholeTokenTest } from "../test/1inRemint.test.js"
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
    const isValidRoot = await wormholeToken.read.roots([tree.root])
    console.log({isValidRoot})
    if(isValidRoot === false){
        throw new Error("getTree synced but got invalid root")
    }
    return tree
}

//you can event scan or just iter over the nullifier mapping!
// TODO add actual balance
export async function syncPrivateWallet(
    {wormholeToken,privateWallet}
    :{privateWallet:UnsyncedPrivateWallet|SyncedPrivateWallet, wormholeToken:WormholeToken|WormholeTokenTest}
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
    const totalReceived = await wormholeToken.read.balanceOf([privateWallet.burnAddress]);
    const syncedPrivateWallet = {...privateWallet} as SyncedPrivateWallet
    syncedPrivateWallet.totalSpent = totalSpent;
    syncedPrivateWallet.accountNonce = accountNonce;
    syncedPrivateWallet.totalReceived = totalReceived
    syncedPrivateWallet.spendableBalance = totalReceived - totalSpent
    return syncedPrivateWallet
}

export async function isSyncedPrivateWallet({privateWallet, wormholeToken}:{privateWallet: SyncedPrivateWallet|UnsyncedPrivateWallet, wormholeToken: WormholeToken | WormholeTokenTest}) {
    if ("accountNonce" in privateWallet) {
        const nextNullifier = hashNullifier({accountNonce: (privateWallet as SyncedPrivateWallet).accountNonce, viewingKey:privateWallet.viewingKey});
        const res = await wormholeToken.read.nullifiers([nextNullifier]);
        return !Boolean(res); //0n === not spend, any other amount = spend
    } else {
        return false
    }
}
