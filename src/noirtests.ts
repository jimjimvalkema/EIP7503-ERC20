import { Hex, toBytes, toHex } from "viem";
import { FormattedProofInputs } from "./types.js";

export function noir_verify_sig({pubKeyXHex,pubKeyYHex,rawSigHex,hash}:{pubKeyXHex:Hex,pubKeyYHex:Hex,rawSigHex:Hex,hash:Hex}) {
    return `
#[test]
fn verify_sig() {
    let signature_data:SignatureData = SignatureData {
        public_key_x: [${[...toBytes(pubKeyXHex)].toString()}],
        public_key_y: [${[...toBytes(pubKeyYHex)].toString()}],
        signature: [${[...toBytes(rawSigHex)].toString()}]
    };
    let message_hash:[u8;32] = ${hash}.to_be_bytes();

    let valid_signature: bool = std::ecdsa_secp256k1::verify_signature(
        signature_data.public_key_x,
        signature_data.public_key_y,
        signature_data.signature,
        message_hash,
    );

    assert(valid_signature, "invalid signature");
}
`
}

export function noir_test_main(proofInput:FormattedProofInputs) {
    return`
#[test]
fn main_test() {   
    let amount: Field = ${proofInput.amount.toString()};
    let recipient_address: Field = ${toHex(proofInput.recipient_address)};
    let fee_data: FeeData = FeeData {
        relayer_address:  ${toHex(proofInput.fee_data.relayer_address)},
        priority_fee: ${proofInput.fee_data.priority_fee.toString()},
        conversion_rate: ${proofInput.fee_data.conversion_rate.toString()},
        max_fee: ${proofInput.fee_data.max_fee.toString()},
        fee_token:  ${toHex(proofInput.fee_data.fee_token)},
    };
    let account_note_hash: Field = ${toHex(proofInput.account_note_hash)};       
    let account_note_nullifier: Field = ${toHex(proofInput.account_note_nullifier)}; 
    let root: Field = ${toHex(proofInput.root)};                    
    let signature_data: SignatureData = SignatureData {
        public_key_x: [${proofInput.signature_data.public_key_x.toString()}],
        public_key_y: [${proofInput.signature_data.public_key_y.toString()}],
        signature: [${proofInput.signature_data.signature.toString()}],
    }; 
    let pow_nonce: Field = ${toHex(proofInput.pow_nonce)};                  
    let total_received: Field = ${proofInput.total_received.toString()};              
    let prev_total_spent: Field = ${proofInput.prev_total_spent.toString()};            
    let viewing_key: Field = ${toHex(proofInput.viewing_key)};                 
    let prev_account_nonce: Field = ${proofInput.prev_account_nonce.toString()};               
    let prev_account_note_merkle: MerkleData = MerkleData {
        depth: ${proofInput.prev_account_note_merkle.depth.toString()},
        indices:[${proofInput.prev_account_note_merkle.indices.toString()}],
        siblings:[${proofInput.prev_account_note_merkle.siblings.map((v)=>toHex(v)).toString()}]
    };
    let total_received_merkle: MerkleData = MerkleData {
        depth: ${proofInput.total_received_merkle.depth.toString()},
        indices:[${proofInput.total_received_merkle.indices.toString()}],
        siblings:[${proofInput.total_received_merkle.siblings.map((v)=>toHex(v)).toString()}]
    };
    main(
        amount,
        recipient_address,
        fee_data,
        account_note_hash, 
        account_note_nullifier,
        root,
        signature_data,
        pow_nonce,        
        total_received,  
        prev_total_spent,
        viewing_key,   
        prev_account_nonce,
        prev_account_note_merkle,
        total_received_merkle,
    );
}
 `   
}