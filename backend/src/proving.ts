import { hexToBytes, Hex, Address, PublicClient, toHex } from "viem"
import { FeeData, FormattedProofInputs, MerkleData, SignatureData, SyncedPrivateWallet, UnformattedPrivateProofInputs, UnformattedProofInputs, UnformattedPublicProofInputs, WormholeToken } from "./types.js"
import { MAX_TREE_DEPTH, EMPTY_FEE_DATA } from "./constants.js"
import { hashAccountNote, hashNullifier, hashTotalReceivedLeaf, signPrivateTransfer } from "./hashing.js"
import { LeanIMT } from "@zk-kit/lean-imt"
import { WormholeTokenTest } from "../test/Token.test.js"
import { getTree } from "./syncing.js"
import { ProofData, UltraHonkBackend } from '@aztec/bb.js';
import { CompiledCircuit, InputMap, Noir } from "@noir-lang/noir_js"
import privateTransferCircuit from '../circuits/privateTransfer/target/private_transfer.json';


export function formatProofInputs({ pubInputs, privInputs }: UnformattedProofInputs) {
    const proofInputs: FormattedProofInputs = {
        //----- public inputs
        amount: toHex(pubInputs.amount),
        signature_hash: padArray({ size: 32, dir: "left", arr: [...hexToBytes(toHex(pubInputs.signatureHash))].map((v) => toHex(v)) }),
        // recipient_address: pubInputs.recipientAddress,
        // fee_data: {
        //     relayer_address: pubInputs.feeData.relayerAddress,
        //     priority_fee: toHex(pubInputs.feeData.priorityFee),
        //     conversion_rate: toHex(pubInputs.feeData.conversionRate),
        //     max_fee: toHex(pubInputs.feeData.maxFee),
        //     fee_token: pubInputs.feeData.feeToken,
        // },
        account_note_hash: toHex(pubInputs.accountNoteHash),
        account_note_nullifier: toHex(pubInputs.accountNoteNullifier),
        root: toHex(pubInputs.root),
        //-----very privacy sensitive data -----
        signature_data: {
            public_key_x: padArray({ size: 32, dir: "left", arr: [...hexToBytes(privInputs.signatureData.publicKeyX)].map((v) => toHex(v)) }),
            public_key_y: padArray({ size: 32, dir: "left", arr: [...hexToBytes(privInputs.signatureData.publicKeyY, { size: 32 })].map((v) => toHex(v)) }),
            signature: padArray({ size: 64, dir: "left", arr: [...hexToBytes(privInputs.signatureData.signature.slice(0, 2 + 128) as Hex)].map((v) => toHex(v)) }), // we need to skip the last byte
        },
        shared_secret: toHex(privInputs.sharedSecret),
        total_received: toHex(privInputs.totalReceived),
        prev_total_spent: toHex(privInputs.prevTotalSpent),
        viewing_key: toHex(privInputs.viewingKey),
        prev_account_nonce: toHex(privInputs.accountNonce),
        prev_account_note_merkle: {
            depth: toHex(privInputs.prevAccountNoteMerkle.depth),
            indices: padArray({ arr: privInputs.prevAccountNoteMerkle.indices, size: MAX_TREE_DEPTH }).map((v) => toHex(v)),
            siblings: padArray({ arr: privInputs.prevAccountNoteMerkle.siblings, size: MAX_TREE_DEPTH }).map((v) => toHex(v)),
        },
        total_received_merkle: {
            depth: toHex(privInputs.totalReceivedMerkle.depth),
            indices: padArray({ arr: privInputs.totalReceivedMerkle.indices, size: MAX_TREE_DEPTH }).map((v) => toHex(v)),
            siblings: padArray({ arr: privInputs.totalReceivedMerkle.siblings, size: MAX_TREE_DEPTH }).map((v) => toHex(v)),
        }
    }
    return proofInputs
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
    let prevAccountNoteMerkle: MerkleData;
    if (prevAccountNonce !== 0n) {
        const prevAccountNoteHashIndex = tree.indexOf(prevAccountNoteHash)
        const prevAccountNoteMerkleProof = tree.generateProof(prevAccountNoteHashIndex)
        const depth = BigInt(prevAccountNoteMerkleProof.siblings.length)
        prevAccountNoteMerkle = {
            depth: depth, // TODO double check this
            indices: padArray({arr:prevAccountNoteMerkleProof.index.toString(2).split('').reverse().map((v) => BigInt(v)), dir:"right", size:Number(depth) }), // todo slice this in the right size. Maybe it need reverse?
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
    const totalReceivedMerkle: MerkleData = {
        depth: depth,
        indices: padArray({arr:totalReceivedMerkleProof.index.toString(2).split('').reverse().map((v) => BigInt(v)), dir:"right", size:Number(depth)}),
        siblings: totalReceivedMerkleProof.siblings
    }
    return totalReceivedMerkle
}

//TODO add a pres-synced tree object
export async function getMerkleProofs(
    { privateWallet, wormholeToken, publicClient, prevAccountNonce, prevTotalSpent, totalReceived }:
        { privateWallet: { burnAddress: Address, viewingKey: bigint }, wormholeToken: WormholeToken | WormholeTokenTest, publicClient: PublicClient, prevAccountNonce: bigint, prevTotalSpent: bigint, totalReceived: bigint }) {
    const tree = await getTree({ wormholeToken, publicClient })
    const prevAccountNoteMerkle = getAccountNoteMerkle({ privateWallet, tree, prevAccountNonce, prevTotalSpent })
    const totalReceivedMerkle = getTotalReceivedMerkle({ privateWallet, tree, totalReceived })
    return {
        prevAccountNoteMerkle,
        totalReceivedMerkle,
        root: tree.root
    }
}

export function getPubInputs(
    { amountToReMint, syncedPrivateWallet, prevAccountNonce, totalSpent, nextAccountNonce, root, signatureHash, recipient, feeData }:
        { amountToReMint: bigint, syncedPrivateWallet: SyncedPrivateWallet, prevAccountNonce: bigint, totalSpent: bigint, nextAccountNonce: bigint, root: bigint, signatureHash:bigint, recipient:Address, feeData?:FeeData }) {
    //console.log("inserting:",{ totalSpent: totalSpent, accountNonce: nextAccountNonce, viewingKey: syncedPrivateWallet.viewingKey })
    const accountNoteHash = hashAccountNote({ totalSpent: totalSpent, accountNonce: nextAccountNonce, viewingKey: syncedPrivateWallet.viewingKey })
    const accountNoteNullifier = hashNullifier({ accountNonce: prevAccountNonce, viewingKey: syncedPrivateWallet.viewingKey }) 
    ///-----------
    feeData = feeData ?? EMPTY_FEE_DATA
    const pubInputs: UnformattedPublicProofInputs = {
        amount: amountToReMint,
        signatureHash: signatureHash, 
        recipientAddress: recipient,
        feeData: feeData,
        accountNoteHash: accountNoteHash,
        accountNoteNullifier: accountNoteNullifier,
        root: root,
    }
    return pubInputs
}

export function getPrivInputs(
    { signatureData, syncedPrivateWallet, prevAccountNonce, prevTotalSpent, totalReceived, prevAccountNoteMerkle, totalReceivedMerkle }:
        { signatureData:SignatureData, amountToReMint: bigint, recipient: Address, syncedPrivateWallet: SyncedPrivateWallet, prevAccountNonce: bigint, prevTotalSpent: bigint, totalReceived: bigint, prevAccountNoteMerkle: MerkleData, totalReceivedMerkle: MerkleData }) {
    const privInputs: UnformattedPrivateProofInputs = {
        signatureData: signatureData,
        sharedSecret: syncedPrivateWallet.sharedSecret,
        totalReceived: totalReceived,
        prevTotalSpent: prevTotalSpent,
        viewingKey: syncedPrivateWallet.viewingKey,
        accountNonce: prevAccountNonce, //TODO fix naming in circuit so it's prevAccountNonce
        prevAccountNoteMerkle: prevAccountNoteMerkle,
        totalReceivedMerkle: totalReceivedMerkle,
    }
    return privInputs
}

export async function getUnformattedProofInputs(
    { wormholeToken, privateWallet, publicClient, amountToReMint, recipient, feeData }:
        { wormholeToken: WormholeToken | WormholeTokenTest, privateWallet: SyncedPrivateWallet, publicClient: PublicClient, recipient: Address, amountToReMint: bigint, feeData: FeeData }
) {
    const prevAccountNonce = privateWallet.accountNonce
    const prevTotalSpent = privateWallet.totalSpent
    const totalReceived = privateWallet.totalReceived
    const totalSpent = prevTotalSpent + amountToReMint
    const nextAccountNonce = prevAccountNonce + 1n
    const {signatureData, signatureHash, poseidonHash, preImageOfKeccak} = await signPrivateTransfer({ recipientAddress: recipient, amount: amountToReMint, feeData: feeData, privateWallet: privateWallet })
    const contractFormattedPreFix = await wormholeToken.read._getMessageWithEthPrefix([poseidonHash]);
    // console.log({
    //     preImageOfKeccak_______:preImageOfKeccak,
    //     contractFormattedPreFix, isEqual: preImageOfKeccak===contractFormattedPreFix })
    const { prevAccountNoteMerkle, totalReceivedMerkle, root } = await getMerkleProofs({
        privateWallet: privateWallet,
        wormholeToken: wormholeToken,
        publicClient: publicClient,
        prevAccountNonce: prevAccountNonce,
        prevTotalSpent: prevTotalSpent,
        totalReceived: totalReceived
    })

    const pubInputs = getPubInputs({
        amountToReMint: amountToReMint,
        signatureHash: signatureHash,
        recipient: recipient,
        syncedPrivateWallet: privateWallet,
        prevAccountNonce: prevAccountNonce,
        totalSpent: totalSpent,
        nextAccountNonce: nextAccountNonce,
        root: root,
    })

    const privInputs = getPrivInputs({
        signatureData:signatureData,
        amountToReMint: amountToReMint,
        recipient: recipient,
        syncedPrivateWallet: privateWallet,
        prevAccountNonce: prevAccountNonce,
        prevTotalSpent: prevTotalSpent,
        totalReceived: totalReceived,
        prevAccountNoteMerkle: prevAccountNoteMerkle,
        totalReceivedMerkle: totalReceivedMerkle
    })

    const unformattedProofInputs = {pubInputs,privInputs}
    return unformattedProofInputs as UnformattedProofInputs
}

export function getAvailableThreads() {
    if (typeof navigator !== undefined && 'hardwareConcurrency' in navigator) {
        return navigator.hardwareConcurrency ?? 1;
    } else {
        // TODO naively assumes that it runs on node if not in browser!
        return (process as any).availableParallelism()
    }
}

export async function getBackend(threads?: number) {
    console.log("initializing backend with circuit")
    threads = threads ?? getAvailableThreads()
    console.log({ threads })
    return new UltraHonkBackend(privateTransferCircuit.bytecode, { threads: threads }, { recursive: false });
}

export async function generateProof({ proofInputs, backend }: { proofInputs: FormattedProofInputs, backend?: UltraHonkBackend }) {
    backend = backend ?? await getBackend()

    const noir = new Noir(privateTransferCircuit as CompiledCircuit);
    const { witness } = await noir.execute(proofInputs as InputMap);
    console.log("generating proof")
    const proof = await backend.generateProof(witness, { keccakZK: true });
    return proof
}

export async function verifyProof({ proof, backend }: { proof: ProofData, backend?: UltraHonkBackend }) {
    backend = backend ?? await getBackend()
    return await backend.verifyProof(proof, { keccakZK: true })
}