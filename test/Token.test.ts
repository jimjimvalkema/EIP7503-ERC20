import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { network } from "hardhat";
import { WormholeToken$Type } from "../artifacts/contracts/WormholeToken.sol/artifacts.js";
import WormholeTokenArtifact from "../artifacts/contracts/WormholeToken.sol/WormholeToken.json" //with {type:"json"};
import { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";
// TODO fix @warptoad/gigabridge-js why it doesn't automatically gets @aztec/aztec.js
import { deployPoseidon2Huff, queryEventInChunks } from "@warptoad/gigabridge-js"
import { fromHex, GetContractReturnType, Hex, padBytes, padHex, PublicClient, WalletClient, Hash, parseEventLogs, ParseEventLogsParameters, ParseEventLogsReturnType, Abi, AbiEvent, Log, RpcLog, ContractEventName, Address, SignMessageReturnType, hexToBigInt, recoverPublicKey, toBytes, Signature, Account, hashMessage, toHex, SignableMessage } from "viem";
import { Poseidon2, poseidon2Hash } from "@zkpassport/poseidon2"
import { LeanIMT, LeanIMTHashFunction } from "@zk-kit/lean-imt";

import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import privateTransferCircuit from '../circuits/privateTransfer/target/private_transfer.json';


const WormholeTokenContractName = "WormholeToken"
const leanIMTPoseidon2ContractName = "leanIMTPoseidon2"
const PrivateTransferVerifierContractName = "PrivateTransferVerifier"
const ZKTranscriptLibContractName = "ZKTranscriptLib"

const PRIVATE_ADDRESS_TYPE = 0x5a4b574f524d484f4c45n as const; //"0x" + [...new TextEncoder().encode("zkwormhole")].map(b=>b.toString(16)).join('') as Hex
const FIELD_LIMIT = 21888242871839275222246405745257275088548364400416034343698204186575808495616n;
const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const POW_LEADING_ZEROS = 3n;
const POW_DIFFICULTY = 16n ** (64n - POW_LEADING_ZEROS) - 1n;
console.log({ POW_DIFFICULTY: padHex(toHex(POW_DIFFICULTY), { size: 32, dir: "left" }) })


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
        const ZKTranscriptLib = await viem.deployContract(ZKTranscriptLibContractName, [], { libraries: {} });
        PrivateTransferVerifier = await viem.deployContract(PrivateTransferVerifierContractName, [], { client: { wallet: deployer }, libraries: { ZKTranscriptLib: ZKTranscriptLib.address } });
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
            const startIndex = 2
            for (let index = startIndex; index < 3; index++) {
                //it("Should transfer", async function () {
                const amountFreeTokens = await wormholeToken.read.amountFreeTokens()
                await wormholeToken.write.getFreeTokens([deployer.account.address]) //sends 1_000_000n token

                let transferTx: Hash = "0x00"
                const amountTransfers = 2 ** index + Math.floor(Math.random() * startIndex - startIndex / 2);// a bit of noise is always good!
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
            const gasString = JSON.stringify(gas, (key, value) => typeof value === 'bigint' ? Number(value) : value, 2)
        })

        it("should make keys", async function () {
            const { viewingKey, powNonce, pubKey } = await getKeys({ wallet: deployer })
            const powHash = hashPow({ pubKeyX: pubKey.x, powNonce: powNonce });
            console.log({
                powHash_______: padHex(toHex(powHash), { size: 32, dir: "left" }),
                POW_DIFFICULTY: padHex(toHex(POW_DIFFICULTY), { size: 32, dir: "left" })
            })
            assert(powHash < POW_DIFFICULTY, `powHash:${powHash} not smaller then POW_DIFFICULTY:${POW_DIFFICULTY} with powNonce:${powNonce} and pubKeyX:${pubKey.x}`)
            //console.log({ viewingKey, powNonce, pubKey })
            //@ts-ignore idk why it works tho
            //const noir = new Noir(privateTransferCircuit);
        })
        it("should make me a test to verify a signature in noir", async function () {
            // there is an extra byte in this?
            const poseidonHash = padHex("0x420690", { size: 32 });
            const signature = await deployer.request({
                method: 'eth_sign',
                params: [deployer.account.address, poseidonHash],
            });
            const publicKey = await recoverPublicKey({
                hash: poseidonHash,
                signature: signature
            });
            // first byte is cringe
            const pubKeyXHex = "0x" + publicKey.slice(4).slice(0, 64)
            const pubKeyYHex = "0x" + publicKey.slice(4).slice(64, 128)
            const rawSigHex = "0x" + signature.slice(2).slice(0, 128)
            console.log(`
                #[test]
                fn verify_sig() {
                    let signature_data:SignatureData = SignatureData {
                        public_key_x: [${[...toBytes(pubKeyXHex)].toString()}],
                        public_key_y: [${[...toBytes(pubKeyYHex)].toString()}],
                        signature: [${[...toBytes(rawSigHex)].toString()}]
                    };
                    let message_hash:[u8;32] = ${poseidonHash}.to_be_bytes();

                    let valid_signature: bool = std::ecdsa_secp256k1::verify_signature(
                        signature_data.public_key_x,
                        signature_data.public_key_y,
                        signature_data.signature,
                        message_hash,
                    );

                    assert(valid_signature, "invalid signature");
                }
            `)

        })
    })
})

function verifyPowNonce({ pubKeyX, powNonce, difficulty = POW_DIFFICULTY }: { pubKeyX: Hex, powNonce: bigint, difficulty?: bigint }) {
    const powHash = hashPow({ pubKeyX, powNonce });
    return powHash > difficulty
}

async function extractPubKeyFromSig({ hash, signature }: { hash: Hash, signature: Signature | Hex }) {
    const publicKey = await recoverPublicKey({
        hash: hash,
        signature: signature
    });
    // first byte is cringe
    const pubKeyX = "0x" + publicKey.slice(4).slice(0, 64) as Hex
    const pubKeyY = "0x" + publicKey.slice(4).slice(64, 128) as Hex
    // const rawSigHex = signature.r + signature.s.slice(2)
    return { pubKeyX, pubKeyY }
}

const VIEWING_KEY_SIG_MESSAGE = `
You are about to create your viewing key for your zkwormhole account! \n
Yay! :D Becarefull signing this on untrusted websites.
Here is some salt: TODO
`
async function getKeys({ wallet, message = VIEWING_KEY_SIG_MESSAGE }: { wallet: WalletClient & { account: Account }, message?: string }) {
    const signature = await wallet.signMessage({ message: message, account: wallet.account })
    const hash = hashMessage(message);
    const { pubKeyX, pubKeyY } = await extractPubKeyFromSig({ hash: hash, signature: signature })
    const viewingKey = getViewingKey({ signature: signature })
    const powNonce = findPoWNonce({ pubKeyX: pubKeyX, viewingKey: viewingKey })
    return { viewingKey, powNonce, pubKey: { x: pubKeyX, y: pubKeyY } }
}

function getViewingKey({ signature }: { signature: Hex }) {
    // deterministically create a viewing key from a signature
    // sigR is split in 2 and hashed since it can be larger then the field limit (could do modulo but didn't feel like worrying about bias)
    const sigR = signature.slice(0, 2 + 128)
    const sigRLow = hexToBigInt(sigR.slice(0, 2 + 32) as Hex)
    const sigRHigh = hexToBigInt("0x" + sigR.slice(2 + 32, 2 + 64) as Hex)
    const viewingKey = poseidon2Hash([sigRLow, sigRHigh])
    return viewingKey
}

function hashAddress({ pubKeyX, powNonce }: { pubKeyX: Hex, powNonce: bigint }) {
    const pubKeyField = hexToBigInt(pubKeyX) % FIELD_MODULUS
    const addressHash = poseidon2Hash([pubKeyField, powNonce, PRIVATE_ADDRESS_TYPE]);
    return addressHash
}

function hashPow({ pubKeyX, powNonce }: { pubKeyX: Hex, powNonce: bigint }) {
    const addressHash = hashAddress({ pubKeyX, powNonce })
    const powHash = poseidon2Hash([powNonce, addressHash]);
    return powHash
}

function findPoWNonce({ pubKeyX, viewingKey, difficulty = POW_DIFFICULTY }: { pubKeyX: Hex, viewingKey: bigint, difficulty?: bigint }) {
    let powNonce: bigint = viewingKey;
    let powHash: bigint = hashPow({ pubKeyX, powNonce });
    let hashingRounds = 0
    console.log("doing PoW")
    do {
        if (powHash < difficulty) {
            break;
        }
        powNonce = powHash;
        powHash = hashPow({ pubKeyX, powNonce })
        hashingRounds += 1
    } while (powHash >= difficulty)
    return powNonce
}

interface MerkleData {
    depth: bigint,
    indices: bigint[],
    siblings: bigint[],
}

interface FeeData {
    relayerAddress: Address,
    priorityFee: bigint,
    conversionRate: bigint,
    maxFee: bigint,
    feeToken: Address,
}

interface FormattedProofInputs {
    amount: bigint;
    recipient_address: bigint;
    fee_data: {
        relayer_address: bigint;
        priority_fee: bigint;
        conversion_rate: bigint;
        max_fee: bigint;
        fee_token: bigint;
    };
    account_note_hash: bigint;
    account_note_nullifier: bigint;
    root: bigint;
    signature_data: {
        public_key_x: bigint[];
        public_key_y: bigint[];
        signature: bigint[];
    };
    pow_nonce: bigint;
    received_total: bigint;
    prev_spent_total: bigint;
    viewing_key: bigint;
    account_nonce: bigint;
    prev_account_note_merkle: {
        depth: bigint;
        indices: bigint[];
        siblings: bigint[];
    };
    received_total_merkle: {
        depth: bigint;
        indices: bigint[];
        siblings: bigint[];
    };
}

function formatProofInputs(
    {
        pubInputs: {
            amount,
            recipientAddress,
            feeData,
            accountNoteHash,
            accountNoteNullifier,
            root,
        },
        privInputs: {
            signatureData,
            powNonce,
            receivedTotal,
            prevSpentTotal,
            viewingKey,
            accountNonce,
            prevAccountNoteMerkle,
            receivedTotalMerkle,
        }
    }:
        {
            //public
            pubInputs: {
                amount: bigint,
                recipientAddress: Address,
                feeData: FeeData,
                accountNoteHash: bigint,
                accountNoteNullifier: bigint,
                root: bigint,
            },
            privInputs: {
                signatureData: {
                    publicKeyX: Hex,
                    publicKeyY: Hex,
                    signature: SignMessageReturnType
                },
                powNonce: bigint,
                receivedTotal: bigint,
                prevSpentTotal: bigint,
                viewingKey: bigint,
                accountNonce: bigint,
                prevAccountNoteMerkle: {
                    depth: bigint,
                    indices: bigint[],
                    siblings: bigint[],
                },
                receivedTotalMerkle: MerkleData,
            }
        }
) {
    const proofInputs = {
        //----- public inputs
        amount: amount,
        recipient_address: hexToBigInt(recipientAddress),
        fee_data: {
            relayer_address: hexToBigInt(feeData.relayerAddress),
            priority_fee: feeData.priorityFee,
            conversion_rate: feeData.conversionRate,
            max_fee: feeData.maxFee,
            fee_token: hexToBigInt(feeData.feeToken),
        },
        account_note_hash: accountNoteHash,
        account_note_nullifier: accountNoteNullifier,
        root: root,
        //-----very privacy sensitive data -----
        signature_data: {
            public_key_x: hexToBigInt(signatureData.publicKeyX),    // TODO recover from signatureData
            public_key_y: hexToBigInt(signatureData.publicKeyY),
            signature: hexToBigInt(signatureData.signature),        // TODO check if this is correct
        },
        pow_nonce: powNonce,
        received_total: receivedTotal,
        prev_spent_total: prevSpentTotal,
        viewing_key: viewingKey,
        account_nonce: accountNonce,
        prev_account_note_merkle: prevAccountNoteMerkle,
        received_total_merkle: receivedTotalMerkle,
    }
    return proofInputs
}

// async function generateProof({proofInputs}:{proofInputs:FormattedProofInputs}) {
//     const noir = new Noir(privateTransferCircuit);

// }

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