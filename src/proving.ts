import { hexToBytes, toHex, hexToNumber } from "viem"
import type { Hex, Address, PublicClient, TypedDataDomain} from "viem"
import type { MerkleData, SpendableBalanceProof, PreSyncedTree, PrivateWalletData, ProofInputs1n, ProofInputs4n, SignatureData, SyncedBurnAccount, u1AsHexArr, u32AsHex, u8sAsHexArrLen64, UnsyncedBurnAccount, WormholeToken, PublicProofInputs, BurnDataPublic, u8sAsHexArrLen32, BurnDataPrivate, PrivateProofInputs } from "./types.js"
import { CIRCUIT_SIZES, EMPTY_UNFORMATTED_MERKLE_PROOF, FIELD_LIMIT, FIELD_MODULUS, MAX_TREE_DEPTH } from "./constants.ts"
import { hashTotalSpentLeaf, hashNullifier, hashTotalBurnedLeaf, signPrivateTransfer } from "./hashing.ts"
import type {LeanIMTMerkleProof} from  "@zk-kit/lean-imt"
import { LeanIMT } from "@zk-kit/lean-imt"
import type { WormholeTokenTest } from "../test/2inRemint.test.ts"
import { getSyncedMerkleTree } from "./syncing.ts"
import type { ProofData } from '@aztec/bb.js';
import { UltraHonkBackend } from '@aztec/bb.js';
import type { CompiledCircuit, InputMap } from "@noir-lang/noir_js"
import { Noir } from "@noir-lang/noir_js"
import privateTransfer2InCircuit from '../circuits/privateTransfer2In/target/privateTransfer2In.json' with { type: 'json' };
import privateTransfer41InCircuit from '../circuits/privateTransfer100In/target/privateTransfer100In.json'  with { type: 'json' };

//import { Fr } from "@aztec/aztec.js"
import { PrivateWallet } from "./PrivateWallet.ts"
import { getCircuitSize } from "./transact.ts"
import { assert } from "node:console"

export function padArray<T>({ arr, size, value, dir }: { arr: T[], size: number, value?: T, dir?: "left" | "right" }): T[] {
    if (arr.length > size) { throw new Array(`array is larger then target size. Array len: ${arr.length}, target len: ${size}`) }
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

export function formatMerkleProof(merkleProof: LeanIMTMerkleProof<bigint>, maxTreeDepth: number = MAX_TREE_DEPTH): MerkleData {
    const depth = toHex(merkleProof.siblings.length)
    const indices = BigInt(merkleProof.index).toString(2).split('').reverse().map((v) => toHex(Number(v)))
    const siblings = merkleProof.siblings.map((v) => toHex(v))
    const formattedMerkleProof = {
        depth: depth as u32AsHex,
        indices: padArray({ arr: indices, size: maxTreeDepth, value: "0x00" }) as u1AsHexArr, // todo slice this in the right size. Maybe it need reverse?
        siblings: padArray({ arr: siblings, size: maxTreeDepth, value: "0x00" }) as Hex[]
    }
    return formattedMerkleProof

}

/**
 * @param param0 
 * @returns 
 */
export function getAccountNoteMerkle(
    { totalSpendNoteHashLeaf, tree, maxTreeDepth = MAX_TREE_DEPTH }:
        { totalSpendNoteHashLeaf: bigint, tree: LeanIMT<bigint>, maxTreeDepth?: number }
): MerkleData {
    if (totalSpendNoteHashLeaf === 0n) {
        const merkleProof = formatMerkleProof(EMPTY_UNFORMATTED_MERKLE_PROOF, maxTreeDepth)
        return merkleProof
    } else {
        const totalSpendNoteHashIndex = tree.indexOf(totalSpendNoteHashLeaf)
        const unformattedMerkleProof = tree.generateProof(totalSpendNoteHashIndex)
        const merkleProof = formatMerkleProof(unformattedMerkleProof, maxTreeDepth)
        return merkleProof
    }
}


export function getBurnedMerkle(
    { totalBurnedLeaf, tree, maxTreeDepth = MAX_TREE_DEPTH }:
        { tree: LeanIMT<bigint>, totalBurnedLeaf: bigint, maxTreeDepth?: number }
): MerkleData {
    const totalReceivedIndex = tree.indexOf(totalBurnedLeaf)
    const unformattedMerkleProof = tree.generateProof(totalReceivedIndex)
    const merkleProof = formatMerkleProof(unformattedMerkleProof, maxTreeDepth)
    return merkleProof
}

/**
 * @notice does not sync the wallet or tree. Assumes it is already synced, will create merkle proofs on commitments that are already nullified or on a old tree
 * @param param0 
 * @returns 
 */
export function getSpendableBalanceProof(
    { totalSpendNoteHashLeaf, totalBurnedLeaf, tree, maxTreeDepth = MAX_TREE_DEPTH }:
        { totalSpendNoteHashLeaf: bigint, totalBurnedLeaf: bigint, tree: LeanIMT<bigint>, maxTreeDepth?: number }
): SpendableBalanceProof {
    const totalSpendMerkleProofs = getAccountNoteMerkle({ totalSpendNoteHashLeaf, tree, maxTreeDepth })
    const totalBurnedMerkleProofs = getBurnedMerkle({ totalBurnedLeaf, tree, maxTreeDepth })

    return {
        totalSpendMerkleProofs: totalSpendMerkleProofs,
        totalBurnedMerkleProofs: totalBurnedMerkleProofs,
        root: toHex(tree.root),
    }
}


function randomBN254FieldElement(): bigint {
  while (true) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const val = bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
    if (val < FIELD_MODULUS) return val;
  }
}

export function getPubInputs(
    { amountToReMint, root, chainId, signatureHash, nullifiers, noteHashes, circuitSize }:
        { amountToReMint: bigint, root: bigint, chainId: bigint, signatureHash: Hex, nullifiers: bigint[], noteHashes: bigint[], circuitSize?: number }) {

    const burn_data_public: BurnDataPublic[] = []
    circuitSize ??= getCircuitSize(nullifiers.length)
    for (let index = 0; index < circuitSize; index++) {
        // empty values are ignored in the circuit, but it's still better for privacy to set them to something random since these are public
        const noteHash = noteHashes[index] === undefined ? randomBN254FieldElement() : noteHashes[index]
        const nullifier = nullifiers[index] === undefined ? randomBN254FieldElement() : nullifiers[index]
        const publicBurnPoofData: BurnDataPublic = {
            account_note_hash: toHex(noteHash),
            account_note_nullifier: toHex(nullifier),
        }
        burn_data_public.push(publicBurnPoofData)
    }
    const pubInputs: PublicProofInputs = {
        root: toHex(root),
        chain_id: toHex(chainId),
        amount: toHex(amountToReMint),
        signature_hash: hexToU8AsHexLen32(signatureHash),
        burn_data_public: burn_data_public,
    }
    return pubInputs
}


export interface BurnAccountProof {
    burnAccount: SyncedBurnAccount,
    merkleProofs: SpendableBalanceProof,
    claimAmount: bigint
}

/**
 * Notice: assumes the merkle proofs are in the same order as syncedPrivateWallets and amountsToClaim
 * @param param0 
 * @returns 
 */
export function getPrivInputs(
    { signatureData, burnAccountsProofs, circuitSize, maxTreeDepth }:
        { signatureData: SignatureData, burnAccountsProofs: BurnAccountProof[], circuitSize?: number, maxTreeDepth?:number }) {

    const burn_address_private_proof_data: BurnDataPrivate[] = [];
    circuitSize ??= getCircuitSize(burnAccountsProofs.length)
    for (let index = 0; index < circuitSize; index++) {
        const burnAccountProof = burnAccountsProofs[index];
        if (burnAccountProof === undefined) {
                // circuit is not constraining this but it still needs something
                const privateBurnData: BurnDataPrivate = {
                    viewing_key: toHex(0n),
                    pow_nonce: toHex(0n),
                    total_burned: toHex(0n),
                    prev_total_spent: toHex(0n),
                    amount_to_spend: toHex(0n),
                    prev_account_nonce: toHex(0n),
                    prev_account_note_merkle_data: formatMerkleProof(EMPTY_UNFORMATTED_MERKLE_PROOF, maxTreeDepth),
                    total_burned_merkle_data: formatMerkleProof(EMPTY_UNFORMATTED_MERKLE_PROOF, maxTreeDepth),
                }
                burn_address_private_proof_data.push(privateBurnData)
        } else {
            const prevTotalSpendMerkleProof = burnAccountProof.merkleProofs.totalSpendMerkleProofs
            const totalBurnedMerkleProof = burnAccountProof.merkleProofs.totalBurnedMerkleProofs;
            const claimAmount = burnAccountProof.claimAmount


            const prevAccountNonce = burnAccountProof.burnAccount.accountNonce
            const prevTotalSpent = burnAccountProof.burnAccount.totalSpent
            const totalBurned = burnAccountProof.burnAccount.totalBurned
            // const nextTotalSpent = prevTotalSpent + claimAmount
            // const nextAccountNonce = prevAccountNonce + 1n

            const privateBurnData: BurnDataPrivate = {
                viewing_key: burnAccountProof.burnAccount.viewingKey,
                pow_nonce: burnAccountProof.burnAccount.powNonce,
                total_burned: totalBurned,
                prev_total_spent: prevTotalSpent,
                amount_to_spend: toHex(claimAmount),
                prev_account_nonce: prevAccountNonce,
                prev_account_note_merkle_data: prevTotalSpendMerkleProof,
                total_burned_merkle_data: totalBurnedMerkleProof,
            }
            burn_address_private_proof_data.push(privateBurnData)

        }

    }

    const privInputs: PrivateProofInputs = {
        burn_data_private: burn_address_private_proof_data,
        signature_data: signatureData,
        amount_burn_addresses: toHex(burnAccountsProofs.length) as u32AsHex
    }
    return privInputs
}

// export async function getProofInputs(
//     { wormholeToken, privateWallets, amountsToClaim, publicClient, amountToReMint, recipient, signatureHash, merkleProofs }:
//         { merkleProofs: SpendableBalanceProof, wormholeToken: WormholeToken | WormholeTokenTest, privateWallets: SyncedPrivateWallet[], amountsToClaim: bigint[], publicClient: PublicClient, recipient: Address, amountToReMint: bigint, signatureHash: bigint }
// ) {
//     const publicInputs = getPubInputs({
//         amountsToClaim: amountsToClaim,
//         amountToReMint: amountToReMint,
//         signatureHash: signatureHash,
//         recipient: recipient,
//         syncedPrivateWallets: privateWallets,
//         root: root,
//     })

//     const privateInputs = getPrivInputs({
//         signatureData: signatureData,
//         amountToReMint: amountToReMint,
//         recipient: recipient,
//         syncedPrivateWallets: privateWallets,
//         prevAccountNoteMerkleProofs: totalSpendMerkleProofs,
//         totalReceivedMerkleProofs: totalReceivedMerkleProofs,
//         amountsToClaim: amountsToClaim
//     })

//     const unformattedProofInputs: UnformattedProofInputs = { publicInputs, privateInputs }
//     return unformattedProofInputs
// }

export function getAvailableThreads() {
    if (typeof navigator !== undefined && 'hardwareConcurrency' in navigator) {
        return navigator.hardwareConcurrency ?? 1;
    } else {
        // TODO naively assumes that it runs on node if not in browser!
        return (process as any).availableParallelism()
    }
}

export async function getBackend(circuitSize: number, threads?: number) {
    console.log("initializing backend with circuit")
    threads = threads ?? getAvailableThreads()
    console.log({ threads })
    const byteCode = circuitSize === 2 ? privateTransfer2InCircuit.bytecode : privateTransfer41InCircuit.bytecode
    return new UltraHonkBackend(byteCode, { threads: threads }, { recursive: false });
}

export async function generateProof({ proofInputs, backend }: { proofInputs: ProofInputs1n | ProofInputs4n, backend?: UltraHonkBackend }) {
    const circuitSize = getCircuitSize(proofInputs.burn_data_public.length)
    console.log("proving with:", {circuitSize, proofSize:proofInputs.burn_data_public.length})
    backend = backend ?? await getBackend(circuitSize, undefined)

    const circuitJson = circuitSize === 2 ? privateTransfer2InCircuit : privateTransfer41InCircuit;
    const noir = new Noir(circuitJson as CompiledCircuit);
    const { witness } = await noir.execute(proofInputs as InputMap);
    console.log("generating proof")
    const start = Date.now()
    const proof = await backend.generateProof(witness, { keccakZK: true });
    console.log(`finished proving. It took ${Date.now() - start}ms`)
    return proof
}

export async function verifyProof({ proof, backend, circuitSize = 2 }: { proof: ProofData, backend?: UltraHonkBackend, circuitSize?: number }) {
    backend = backend ?? await getBackend(circuitSize, undefined)
    return await backend.verifyProof(proof, { keccakZK: true })
}

export function hexToU8AsHexLen32(hex: Hex): u8sAsHexArrLen32 {
    const unPadded = [...hexToBytes(hex)].map((v) => toHex(v))
    return padArray({ size: 32, dir: "left", arr: unPadded }) as u8sAsHexArrLen32
}

export function hexToU8AsHexLen64(hex: Hex): u8sAsHexArrLen64 {
    const unPadded = [...hexToBytes(hex)].map((v) => toHex(v))
    return padArray({ size: 64, dir: "left", arr: unPadded }) as u8sAsHexArrLen64
}