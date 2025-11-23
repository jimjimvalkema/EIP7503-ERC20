import { hexToBytes, Hex, Address, PublicClient, toHex } from "viem"
import { SignatureData, SyncedPrivateWallet, WormholeToken } from "./types.js"
import { MAX_TREE_DEPTH, EMPTY_FEE_DATA } from "./constants.js"
import { hashAccountNote, hashNullifier, hashTotalReceivedLeaf, signPrivateTransfer } from "./hashing.js"
import { LeanIMT } from "@zk-kit/lean-imt"
import { WormholeTokenTest } from "../test/1inRemint.test.js"
import { getTree } from "./syncing.js"
import { ProofData, UltraHonkBackend } from '@aztec/bb.js';
import { CompiledCircuit, InputMap, Noir } from "@noir-lang/noir_js"
import privateTransfer1InCircuit from '../circuits/privateTransfer1In/target/privateTransfer1In.json';
import privateTransfer41InCircuit from '../circuits/privateTransfer4In/target/privateTransfer4In.json';

import { FeeData, FormattedBurnAddressProofDataPrivate, FormattedBurnAddressProofDataPublic, FormattedProofInputs, FormattedSignatureData, UnFormattedBurnAddressProofDataPrivate, UnFormattedBurnAddressProofDataPublic, UnFormattedMerkleData, UnformattedProofInputs, UnformattedProofInputsPrivate, UnformattedProofInputsPublic } from "./proofInputsTypes.js"
import { Fr } from "@aztec/aztec.js"


export function formatProofInputs({ publicInputs, privateInputs }: UnformattedProofInputs) {
    const circuitSize = publicInputs.burn_address_public_proof_data.length > 1 ? 4 : 1 // we only have 2 circuits
    const burnAddressPublicProofDataFormatted: FormattedBurnAddressProofDataPublic[] = []
    const burnAddressPrivateProofDataFormatted: FormattedBurnAddressProofDataPrivate[] = []
    for (let index = 0; index < circuitSize; index++) {
        const publicBurnProof = publicInputs.burn_address_public_proof_data[index];
        const privateBurnProof = privateInputs.burn_address_private_proof_data[index];

        const publicProofData: FormattedBurnAddressProofDataPublic = publicBurnProof !== undefined ? {
            account_note_hash: toHex(publicBurnProof.account_note_hash),
            account_note_nullifier: toHex(publicBurnProof.account_note_nullifier),
        } : {
            account_note_hash: toHex(Fr.random().toBigInt()),
            account_note_nullifier: toHex(Fr.random().toBigInt())

        }

        const privateProofData: FormattedBurnAddressProofDataPrivate = privateBurnProof !== undefined ? {
            total_received: toHex(privateBurnProof.total_received),
            prev_total_spent: toHex(privateBurnProof.prev_total_spent),
            prev_account_nonce: toHex(privateBurnProof.prev_account_nonce),
            prev_account_note_merkle: {
                siblings: padArray({ arr: privateBurnProof.prev_account_note_merkle.siblings, size: MAX_TREE_DEPTH }).map((v) => toHex(v)),
                indices: padArray({ arr: privateBurnProof.prev_account_note_merkle.indices, size: MAX_TREE_DEPTH }).map((v) => toHex(v)),
                depth: toHex(privateBurnProof.prev_account_note_merkle.depth),
            },
            total_received_merkle: {
                siblings: padArray({ arr: privateBurnProof.total_received_merkle.siblings, size: MAX_TREE_DEPTH }).map((v) => toHex(v)),
                indices: padArray({ arr: privateBurnProof.total_received_merkle.indices, size: MAX_TREE_DEPTH }).map((v) => toHex(v)),
                depth: toHex(privateBurnProof.total_received_merkle.depth),
            },
            amount: toHex(privateBurnProof.amount),
            shared_secret: toHex(privateBurnProof.shared_secret)
        } : { // @TODO move to constants
            total_received: toHex(0n),
            prev_total_spent: toHex(0n),
            prev_account_nonce: toHex(0n),
            prev_account_note_merkle: {
                siblings: padArray({ arr: [0n], size: MAX_TREE_DEPTH }).map((v) => toHex(v)),
                indices: padArray({ arr: [0n], size: MAX_TREE_DEPTH }).map((v) => toHex(v)),
                depth: toHex(0n),
            },
            total_received_merkle: {
                siblings: padArray({ arr: [0n], size: MAX_TREE_DEPTH }).map((v) => toHex(v)),
                indices: padArray({ arr: [0n], size: MAX_TREE_DEPTH }).map((v) => toHex(v)),
                depth: toHex(0n),
            },
            amount: toHex(0n),
            shared_secret: toHex(0n)
        }

        burnAddressPublicProofDataFormatted.push(publicProofData)
        burnAddressPrivateProofDataFormatted.push(privateProofData)
    }
    console.log({burnAddressPublicProofDataFormatted})
    const SignatureDataFormatted: FormattedSignatureData = {
        public_key_x: padArray({ size: 32, dir: "left", arr: [...hexToBytes(privateInputs.signature_data.publicKeyX)].map((v) => toHex(v)) }),
        public_key_y: padArray({ size: 32, dir: "left", arr: [...hexToBytes(privateInputs.signature_data.publicKeyY, { size: 32 })].map((v) => toHex(v)) }),
        signature: padArray({ size: 64, dir: "left", arr: [...hexToBytes(privateInputs.signature_data.signature.slice(0, 2 + 128) as Hex)].map((v) => toHex(v)) }), // we need to skip the last byte
    };
    const proofInputs: FormattedProofInputs = {
        root: toHex(publicInputs.root),
        amount: toHex(publicInputs.amount),
        signature_hash: padArray({ size: 32, dir: "left", arr: [...hexToBytes(toHex(publicInputs.signature_hash))].map((v) => toHex(v)) }),
        burn_address_public_proof_data: burnAddressPublicProofDataFormatted,
        signature_data: SignatureDataFormatted,
        viewing_key: toHex(privateInputs.viewing_key),
        burn_address_private_proof_data: burnAddressPrivateProofDataFormatted,
        amount_burn_addresses: toHex(privateInputs.amount_burn_addresses)
    }
    return {proofInputs, circuitSize}
}

export function padArray<T>({ arr, size, value, dir }: { arr: T[], size: number, value?: T, dir?: "left" | "right" }): T[] {
    dir = dir ?? "right"
    if (value === undefined) {
        if (typeof arr[0] === 'string' && arr[0].startsWith('0x')) {
            value = "0x00" as T
        } else if (typeof arr[0] === "bigint") {
            value = 0n as T
        } else {//if (typeof arr[0] === "number") {
            value = 0 as T
        }
    }

    const padding = (new Array(size - arr.length)).fill(value)
    return dir === "left" ? [...padding, ...arr] : [...arr, ...padding]
}

export function getAccountNoteMerkle({ prevTotalSpent, prevAccountNonce, privateWallet, tree }: { tree: LeanIMT<bigint>, prevTotalSpent: bigint, prevAccountNonce: bigint, privateWallet: { viewingKey: bigint } }) {
    //console.log("proving",{ totalSpent: prevTotalSpent, accountNonce: prevAccountNonce, viewingKey: privateWallet.viewingKey })
    const prevAccountNoteHash = hashAccountNote({ totalSpent: prevTotalSpent, accountNonce: prevAccountNonce, viewingKey: privateWallet.viewingKey })
    let prevAccountNoteMerkle: UnFormattedMerkleData;
    if (prevAccountNonce !== 0n) {
        const prevAccountNoteHashIndex = tree.indexOf(prevAccountNoteHash)
        const prevAccountNoteMerkleProof = tree.generateProof(prevAccountNoteHashIndex)
        const depth = BigInt(prevAccountNoteMerkleProof.siblings.length)
        prevAccountNoteMerkle = {
            depth: depth, // TODO double check this
            indices: padArray({ arr: prevAccountNoteMerkleProof.index.toString(2).split('').reverse().map((v) => BigInt(v)), dir: "right", size: Number(depth) }), // todo slice this in the right size. Maybe it need reverse?
            siblings: prevAccountNoteMerkleProof.siblings
        }
    } else {
        prevAccountNoteMerkle = {
            depth: 0n,
            indices: [],
            siblings: []
        }
    }
    return prevAccountNoteMerkle
}


export function getTotalReceivedMerkle({ totalReceived, privateWallet, tree }: { tree: LeanIMT<bigint>, totalReceived: bigint, privateWallet: { burnAddress: Address } }) {
    const totalReceivedLeaf = hashTotalReceivedLeaf({ privateAddress: privateWallet.burnAddress, totalReceived: totalReceived })
    const totalReceivedIndex = tree.indexOf(totalReceivedLeaf)
    const totalReceivedMerkleProof = tree.generateProof(totalReceivedIndex)
    const depth = BigInt(totalReceivedMerkleProof.siblings.length)
    const totalReceivedMerkle: UnFormattedMerkleData = {
        depth: depth,
        indices: padArray({ arr: totalReceivedMerkleProof.index.toString(2).split('').reverse().map((v) => BigInt(v)), dir: "right", size: Number(depth) }),
        siblings: totalReceivedMerkleProof.siblings
    }
    return totalReceivedMerkle
}

//TODO add a pres-synced tree object
export async function getMerkleProofs(
    { privateWallets, wormholeToken, publicClient }:
        { privateWallets: SyncedPrivateWallet[], wormholeToken: WormholeToken | WormholeTokenTest, publicClient: PublicClient }) {
    const tree = await getTree({ wormholeToken, publicClient })
    const prevAccountNoteMerkleProofs: UnFormattedMerkleData[] = []
    const totalReceivedMerkleProofs: UnFormattedMerkleData[] = []
    for (const privateWallet of privateWallets) {
        const prevAccountNonce = privateWallet.accountNonce
        const prevTotalSpent = privateWallet.totalSpent
        const totalReceived = privateWallet.totalReceived
        const prevAccountNoteMerkle = getAccountNoteMerkle({ privateWallet, tree, prevAccountNonce, prevTotalSpent })
        const totalReceivedMerkle = getTotalReceivedMerkle({ privateWallet, tree, totalReceived })
        prevAccountNoteMerkleProofs.push(prevAccountNoteMerkle)
        totalReceivedMerkleProofs.push(totalReceivedMerkle)

    }

    return {
        prevAccountNoteMerkleProofs: prevAccountNoteMerkleProofs,
        totalReceivedMerkleProofs: totalReceivedMerkleProofs,
        root: tree.root
    }
}

export function getPubInputs(
    { amountsToClaim,amountToReMint, syncedPrivateWallets, root, signatureHash, recipient, feeData }:
        {amountsToClaim:bigint[], amountToReMint: bigint, syncedPrivateWallets: SyncedPrivateWallet[], root: bigint, signatureHash: bigint, recipient: Address, feeData?: FeeData }) {
    //console.log("inserting:",{ totalSpent: totalSpent, accountNonce: nextAccountNonce, viewingKey: syncedPrivateWallet.viewingKey })

    ///-----------
    feeData = feeData ?? EMPTY_FEE_DATA
    const burn_address_public_proof_data: UnFormattedBurnAddressProofDataPublic[] = []
    for (let index = 0; index < syncedPrivateWallets.length; index++) {
        const privateWallet = syncedPrivateWallets[index];
        const amountToClaim = amountsToClaim[index]
        const prevAccountNonce = privateWallet.accountNonce
        const prevTotalSpent = privateWallet.totalSpent
        const totalSpent = prevTotalSpent + amountToClaim
        const nextAccountNonce = prevAccountNonce + 1n
        const accountNoteHash = hashAccountNote({ totalSpent: totalSpent, accountNonce: nextAccountNonce, viewingKey: privateWallet.viewingKey })
        const accountNoteNullifier = hashNullifier({ accountNonce: prevAccountNonce, viewingKey: privateWallet.viewingKey })
        const publicBurnPoofData: UnFormattedBurnAddressProofDataPublic = {
            account_note_hash: accountNoteHash,
            account_note_nullifier: accountNoteNullifier,
        }
        burn_address_public_proof_data.push(publicBurnPoofData)
    }
    const pubInputs: UnformattedProofInputsPublic = {
        amount: amountToReMint,
        signature_hash: signatureHash,
        recipient_address: recipient,
        feeData: feeData,
        burn_address_public_proof_data: burn_address_public_proof_data,
        root: root,
    }
    return pubInputs
}


/**
 * Notice: assumes the merkle proofs are in the same order as syncedPrivateWallets and amountsToClaim
 * @param param0 
 * @returns 
 */
export function getPrivInputs(
    { amountToReMint, signatureData, syncedPrivateWallets, amountsToClaim, prevAccountNoteMerkleProofs, totalReceivedMerkleProofs }:
        { signatureData: SignatureData, amountToReMint: bigint, amountsToClaim: bigint[], recipient: Address, syncedPrivateWallets: SyncedPrivateWallet[], prevAccountNoteMerkleProofs: UnFormattedMerkleData[], totalReceivedMerkleProofs: UnFormattedMerkleData[] }) {

    const burn_address_private_proof_data: UnFormattedBurnAddressProofDataPrivate[] = [];
    for (let index = 0; index < syncedPrivateWallets.length; index++) {
        const privateWallet = syncedPrivateWallets[index];
        const prevAccountNoteMerkleProof = prevAccountNoteMerkleProofs[index];
        const totalReceivedMerkleProof = totalReceivedMerkleProofs[index];
        const amountToClaim = amountsToClaim[index]


        const prevAccountNonce = privateWallet.accountNonce
        const prevTotalSpent = privateWallet.totalSpent
        const totalReceived = privateWallet.totalReceived
        const totalSpent = prevTotalSpent + amountToReMint
        const nextAccountNonce = prevAccountNonce + 1n
        const privateBurnData: UnFormattedBurnAddressProofDataPrivate = {
            total_received: totalReceived,
            prev_total_spent: prevTotalSpent,
            prev_account_nonce: prevAccountNonce,
            prev_account_note_merkle: prevAccountNoteMerkleProof,
            total_received_merkle: totalReceivedMerkleProof,
            amount: amountToClaim,
            shared_secret: privateWallet.sharedSecret,
        }
        burn_address_private_proof_data.push(privateBurnData)
    }
    const privInputs: UnformattedProofInputsPrivate = {
        burn_address_private_proof_data: burn_address_private_proof_data,
        // for now we assume they all use the same viewing key!
        viewing_key: syncedPrivateWallets[0].viewingKey,
        signature_data: signatureData,
        amount_burn_addresses: BigInt(syncedPrivateWallets.length)
    }
    console.log({len:syncedPrivateWallets.length, syncedPrivateWallets})
    return privInputs
}

export async function getUnformattedProofInputs(
    { wormholeToken, privateWallets, amountsToClaim, publicClient, amountToReMint, recipient, feeData }:
        { wormholeToken: WormholeToken | WormholeTokenTest, privateWallets: SyncedPrivateWallet[], amountsToClaim: bigint[], publicClient: PublicClient, recipient: Address, amountToReMint: bigint, feeData: FeeData }
) {
    const { signatureData, signatureHash, poseidonHash, preImageOfKeccak } = await signPrivateTransfer({
        recipientAddress: recipient,
        amount: amountToReMint,
        feeData: feeData,
        // all private wallets have the same viem wallet which is a eoa with the pubKey that is committed in `burnAddress=hash(pubKeyX,shared_secret,"ZKWORMHOLES")`
        privateWallet: privateWallets[0]
    })
    const contractFormattedPreFix = await wormholeToken.read._getMessageWithEthPrefix([poseidonHash]);
    // console.log({
    //     preImageOfKeccak_______:preImageOfKeccak,
    //     contractFormattedPreFix, isEqual: preImageOfKeccak===contractFormattedPreFix })
    const { prevAccountNoteMerkleProofs, totalReceivedMerkleProofs, root } = await getMerkleProofs({
        privateWallets: privateWallets,
        wormholeToken: wormholeToken,
        publicClient: publicClient,
    })

    const publicInputs = getPubInputs({
        amountsToClaim: amountsToClaim,
        amountToReMint: amountToReMint,
        signatureHash: signatureHash,
        recipient: recipient,
        syncedPrivateWallets: privateWallets,
        root: root,
    })

    const privateInputs = getPrivInputs({
        signatureData: signatureData,
        amountToReMint: amountToReMint,
        recipient: recipient,
        syncedPrivateWallets: privateWallets,
        prevAccountNoteMerkleProofs: prevAccountNoteMerkleProofs,
        totalReceivedMerkleProofs: totalReceivedMerkleProofs,
        amountsToClaim: amountsToClaim
    })

    const unformattedProofInputs: UnformattedProofInputs = { publicInputs, privateInputs }
    return unformattedProofInputs
}

export function getAvailableThreads() {
    if (typeof navigator !== undefined && 'hardwareConcurrency' in navigator) {
        return navigator.hardwareConcurrency ?? 1;
    } else {
        // TODO naively assumes that it runs on node if not in browser!
        return (process as any).availableParallelism()
    }
}

export async function getBackend(circuitSize:number, threads?: number) {
    console.log("initializing backend with circuit")
    threads = threads ?? getAvailableThreads()
    console.log({ threads })
    const byteCode = circuitSize===1 ? privateTransfer1InCircuit.bytecode :  privateTransfer41InCircuit.bytecode
    return new UltraHonkBackend(byteCode, { threads: threads }, { recursive: false });
}

export async function generateProof({ proofInputs, backend, circuitSize }: { proofInputs: FormattedProofInputs, backend?: UltraHonkBackend , circuitSize:number}) {
    backend = backend ?? await getBackend(circuitSize,undefined)

    const circuitJson = circuitSize===1 ? privateTransfer1InCircuit : privateTransfer41InCircuit;
    const noir = new Noir(circuitJson as CompiledCircuit);
    const { witness } = await noir.execute(proofInputs as InputMap);
    console.log("generating proof")
    const proof = await backend.generateProof(witness, { keccakZK: true });
    console.log("finished proving")
    return proof
}

export async function verifyProof({ proof, backend,circuitSize=1 }: { proof: ProofData, backend?: UltraHonkBackend, circuitSize?:number }) {
    backend = backend ?? await getBackend(circuitSize,undefined)
    return await backend.verifyProof(proof, { keccakZK: true })
}