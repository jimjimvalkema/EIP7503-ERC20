import { hexToBigInt, hexToBytes, Hex } from "viem"
import { UnformattedProofInputs } from "./types.js"

export function formatProofInputs({pubInputs,privInputs}: UnformattedProofInputs) {
    const proofInputs = {
        //----- public inputs
        amount: pubInputs.amount,
        recipient_address: hexToBigInt(pubInputs.recipientAddress),
        fee_data: {
            relayer_address: hexToBigInt(pubInputs.feeData.relayerAddress),
            priority_fee: pubInputs.feeData.priorityFee,
            conversion_rate: pubInputs.feeData.conversionRate,
            max_fee: pubInputs.feeData.maxFee,
            fee_token: hexToBigInt(pubInputs.feeData.feeToken),
        },
        account_note_hash: pubInputs.accountNoteHash,
        account_note_nullifier: pubInputs.accountNoteNullifier,
        root: pubInputs.root,
        //-----very privacy sensitive data -----
        signature_data: {
            public_key_x:   [...hexToBytes(privInputs.signatureData.publicKeyX,{size:32})].map((v)=>BigInt(v)), 
            public_key_y:   [...hexToBytes(privInputs.signatureData.publicKeyY,{size:32})].map((v)=>BigInt(v)),
            signature:      [...hexToBytes(privInputs.signatureData.signature.slice(0, 2+128) as Hex,{size:64})].map((v)=>BigInt(v)), // we need to skip the last byte
        },
        pow_nonce: privInputs.powNonce,
        total_received: privInputs.totalReceived,
        prev_total_spent: privInputs.prevTotalSpent,
        viewing_key: privInputs.viewingKey,
        account_nonce: privInputs.accountNonce,
        prev_account_note_merkle: privInputs.prevAccountNoteMerkle,
        total_received_merkle: privInputs.totalReceivedMerkle,
    }
    return proofInputs
}