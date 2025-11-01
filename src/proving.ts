import { hexToBigInt, hexToBytes, Hex } from "viem"
import { UnformattedProofInputs } from "./types.js"
import { MAX_TREE_DEPTH } from "./constants.js"

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
            public_key_x:   padArray({size:32,dir:"left",arr:[...hexToBytes(privInputs.signatureData.publicKeyX)].map((v)=>BigInt(v))}), 
            public_key_y:   padArray({size:32,dir:"left",arr:[...hexToBytes(privInputs.signatureData.publicKeyY,{size:32})].map((v)=>BigInt(v))}),
            signature:      padArray({size:64,dir:"left",arr:[...hexToBytes(privInputs.signatureData.signature.slice(0, 2+128) as Hex)].map((v)=>BigInt(v))}), // we need to skip the last byte
        },
        pow_nonce: privInputs.powNonce,
        total_received: privInputs.totalReceived,
        prev_total_spent: privInputs.prevTotalSpent,
        viewing_key: privInputs.viewingKey,
        prev_account_nonce: privInputs.accountNonce,
        prev_account_note_merkle: {
            depth: privInputs.prevAccountNoteMerkle.depth,
            indices: padArray({arr:privInputs.prevAccountNoteMerkle.indices, size:MAX_TREE_DEPTH}),
            siblings: padArray({arr:privInputs.prevAccountNoteMerkle.siblings, size:MAX_TREE_DEPTH}),
        },
        total_received_merkle: {
            depth: privInputs.totalReceivedMerkle.depth,
            indices: padArray({arr:privInputs.totalReceivedMerkle.indices, size:MAX_TREE_DEPTH}),
            siblings: padArray({arr:privInputs.totalReceivedMerkle.siblings, size:MAX_TREE_DEPTH}),
        }
    }
    return proofInputs
}

export function padArray<T>({arr,size,value,dir}:{arr:T[],size:number,value?:T,dir?:"left"|"right"}):T[] {
    dir = dir ?? "right"
    if(value===undefined) {
        if (typeof arr[0] === 'string' && arr[0].startsWith('0x')) {
            value = "0x00" as T
        } else if (typeof arr[0] === "bigint") {
            value = 0n as T
        } else {//if (typeof arr[0] === "number") {
            value = 0 as T
        }
    }

    const padding = (new Array(size - arr.length)).fill(value)
    return dir === "left" ? [...padding,...arr] : [...arr,...padding]
}