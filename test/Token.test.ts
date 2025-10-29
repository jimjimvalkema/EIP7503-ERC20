import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { network } from "hardhat";
import { WormholeToken$Type } from "../artifacts/contracts/WormholeToken.sol/artifacts.js";
import WormholeTokenArtifact from "../artifacts/contracts/WormholeToken.sol/WormholeToken.json" //with {type:"json"};
import { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";
// TODO fix @warptoad/gigabridge-js why it doesn't automattically gets @aztec/aztec.js
import { deployPoseidon2Huff, queryEventInChunks } from "@warptoad/gigabridge-js"
import { fromHex, GetContractReturnType, Hex, padBytes, padHex, PublicClient, WalletClient, Hash, parseEventLogs, ParseEventLogsParameters, ParseEventLogsReturnType, Abi, AbiEvent, Log, RpcLog, ContractEventName } from "viem";
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { LeanIMT, LeanIMTHashFunction } from "@zk-kit/lean-imt";


const WormholeTokenContractName = "WormholeToken"
const leanIMTPoseidon2ContractName = "leanIMTPoseidon2"
const PrivateTransferVerifierContractName = "PrivateTransferVerifier"

let gas: any = { "transfers": {} }
describe("Token", async function () {
    const SNARK_SCALAR_FIELD = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617")
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    let wormholeToken: ContractReturnType<typeof WormholeTokenContractName>;
    let PrivateTransferVerifier: ContractReturnType<typeof PrivateTransferVerifierContractName>;
    let leanIMTPoseidon2: ContractReturnType<typeof leanIMTPoseidon2ContractName>;
    const [deployer, alice, bob] = await viem.getWalletClients()

    beforeEach(async function () {
        await deployPoseidon2Huff(publicClient, deployer, padHex("0x00", { size: 32 }))
        leanIMTPoseidon2 = await viem.deployContract(leanIMTPoseidon2ContractName, [], { libraries: {} });
        PrivateTransferVerifier = await viem.deployContract(PrivateTransferVerifierContractName, [], { client: { wallet: deployer }, libraries: {} });
        wormholeToken = await viem.deployContract(WormholeTokenContractName, [PrivateTransferVerifier.address], { client: { wallet: deployer }, libraries: { leanIMTPoseidon2: leanIMTPoseidon2.address } },);
        let root = await wormholeToken.read.root()
        const amountFreeTokens = await wormholeToken.read.amountFreeTokens()
        for (const wallet of [alice, bob]) {
            await wormholeToken.write.getFreeTokens([wallet.account.address]) //sends 1_000_000n token

            const preimg = [fromHex(wallet.account.address, "bigint"), amountFreeTokens]
            const leafJs = poseidon2Hash(preimg)
            root = await wormholeToken.read.root()
        }
    })

    describe("Token", async function () {
        it("Should transfer", async function () {
            let totalAmountInserts = 0
            for (let index = 8; index < 10; index++) {
                //it("Should transfer", async function () {
                const amountFreeTokens = await wormholeToken.read.amountFreeTokens()
                await wormholeToken.write.getFreeTokens([deployer.account.address]) //sends 1_000_000n token

                let transferTx: Hash = "0x00"
                const amountTransfers = 2 ** index + Math.floor(Math.random() * 64) - 32; // a bit of noise is always good!
                totalAmountInserts += amountTransfers + 1
                const firstTransferTx = await wormholeToken.write.transfer([alice.account.address, 420n])
                for (let index = 0; index < amountTransfers; index++) {
                    transferTx = await wormholeToken.write.transfer([alice.account.address, 420n])
                }
                // if deployer send to it self. tx.origin == recipient, and the merkle insertion is skipped!
                // warm the slot
                await wormholeToken.write.transfer([deployer.account.address, 420n])
                const transferWithoutMerkleTx = await wormholeToken.write.transfer([deployer.account.address, 420n])
                const transferWithoutMerkleReceipt = await publicClient.getTransactionReceipt({ hash: transferWithoutMerkleTx })
                const firstTransferWithMerkleReceipt = await publicClient.getTransactionReceipt({ hash: firstTransferTx })

                const transferWithoutMerkleEvents = parseEventLogs({
                    abi: wormholeToken.abi,
                    eventName: 'Transfer',
                    logs: transferWithoutMerkleReceipt.logs,
                })

                const tree = await getTree({ wormholeToken, publicClient })
                const jsRoot = tree.root
                const onchainRoot = await wormholeToken.read.root()
                assert.equal(jsRoot, onchainRoot, "jsRoot doesn't match onchainRoot")
                const transferWithMerkleReceipt = await publicClient.getTransactionReceipt({ hash: transferTx })
                gas["transfers"][index] = {
                    totalAmountInserts,
                    // dangling node inserts are cheaper so we take 2 measurements to hopefully catch a non dangling insert? @TODO find better method
                    transferWithoutMerkle: { high: transferWithoutMerkleReceipt.gasUsed, low: transferWithoutMerkleReceipt.gasUsed },
                    transferWithMerkle___: { high: transferWithMerkleReceipt.gasUsed, low: firstTransferWithMerkleReceipt.gasUsed },
                    depth: (await wormholeToken.read.tree())[1]

                }
            }
            const gasString = JSON.stringify(gas, (key, value) => typeof value === 'bigint' ? Number(value) : value, 2);
            console.log("gas", gasString)
        })
    })
})

// TODO move this else where!!
const WORMHOLE_TOKEN_DEPLOYMENT_BLOCK: { [chainId: number]: bigint; } = {

}

function getWormholeTokenDeploymentBlock(chainId: number) {
    if (Number(chainId) in WORMHOLE_TOKEN_DEPLOYMENT_BLOCK) {
        return WORMHOLE_TOKEN_DEPLOYMENT_BLOCK[chainId]
    } else {
        //console.warn(`no deployment block found for chainId: ${chainId.toString()}, defaulted to 0n`)
        return 0n
    }
}

export const poseidon2IMTHashFunc: LeanIMTHashFunction = (a: bigint, b: bigint) => poseidon2Hash([a, b])

export type WormholeTokenTest = ContractReturnType<typeof WormholeTokenContractName>
export type WormholeToken = GetContractReturnType<WormholeToken$Type["abi"], Required<{ public?: PublicClient; wallet?: WalletClient; }>>
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



// using parseEventLogs now works and return .args??
/**
 * wrapper for parseEventLogs, so it extracts
 * @param { abi, eventName, logs }
 * @returns
 */
// export function parseEventLogsWithTypes<
//     const TAbi extends Abi,
//     TEventName extends ContractEventName<TAbi> | ContractEventName<TAbi>[] | undefined = undefined,
//     TStrict extends boolean | undefined = true,
// >(
//     { abi, eventName, logs, strict }: ParseEventLogsParameters<TAbi, TEventName, TStrict>
// ): ParseEventLogsReturnType<TAbi, TEventName, TStrict> {
//     return parseEventLogs({
//         abi,
//         eventName,
//         logs,
//         strict
//     });
// }