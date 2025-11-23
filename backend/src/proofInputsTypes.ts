import { InputMap } from "@noir-lang/noir_js";
import { Address, Hex, SignMessageReturnType } from "viem";
import { MAX_TREE_DEPTH } from "./constants.js"


export interface UnformattedProofInputsPublic {
    root: bigint,
    amount: bigint,
    signature_hash: bigint, // [u8;32]
    burn_address_public_proof_data: UnFormattedBurnAddressProofDataPublic[],
    recipient_address: Address,
    feeData: FeeData
}

export interface UnformattedProofInputsPrivate {
    signature_data: UnFormattedSignatureData,
    viewing_key: bigint,
    burn_address_private_proof_data: UnFormattedBurnAddressProofDataPrivate[],
}

export interface UnFormattedBurnAddressProofDataPublic {
    account_note_hash: bigint,
    account_note_nullifier: bigint,

}
export interface UnFormattedBurnAddressProofDataPrivate {
    total_received: bigint,
    prev_total_spent: bigint,
    prev_account_nonce: bigint,
    prev_account_note_merkle: UnFormattedMerkleData,
    total_received_merkle: UnFormattedMerkleData,
    amount: bigint,
    shared_secret: bigint
}

export interface UnFormattedSignatureData {
    publicKeyX: Hex,
    publicKeyY: Hex,
    signature: SignMessageReturnType
}

export interface UnFormattedMerkleData {
    depth: bigint,
    indices: bigint[],                          // [u8;40]
    siblings: bigint[],                         // [u8;40]
}



export interface FeeData {
    relayerAddress: Address,
    priorityFee: bigint,
    conversionRate: bigint,
    maxFee: bigint,
    feeToken: Address,
}

export interface UnformattedProofInputs {
    publicInputs: UnformattedProofInputsPublic,
    privateInputs: UnformattedProofInputsPrivate
}

///------------formatted-----------------------------------
export interface FormattedProofInputs extends InputMap {
    root: Hex,
    amount: Hex,
    signature_hash: Hex[], // [u8;32]
    burn_address_public_proof_data: FormattedBurnAddressProofDataPublic[],
    //private
    signature_data: FormattedSignatureData,
    viewing_key: Hex,
    burn_address_private_proof_data: FormattedBurnAddressProofDataPrivate[],
}

export interface FormattedBurnAddressProofDataPublic extends InputMap {
    account_note_hash: Hex,
    account_note_nullifier: Hex,
}

export interface FormattedSignatureData extends InputMap {
    public_key_x: Hex[],   // [u8;32]
    public_key_y: Hex[],   // [u8;32]
    signature: Hex[]     // [u8;64]
}

export interface FormattedMerkleData extends InputMap {
    depth: Hex,
    indices: Hex[],     // [u8;40]
    siblings: Hex[],    // [u8;40]
}

export interface FormattedBurnAddressProofDataPrivate extends InputMap {
    total_received: Hex,
    prev_total_spent: Hex,
    prev_account_nonce: Hex,
    prev_account_note_merkle: FormattedMerkleData,
    total_received_merkle: FormattedMerkleData,
    amount: Hex,
    shared_secret: Hex
}
//----------------------------