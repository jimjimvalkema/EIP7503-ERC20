// import { Hex, toBytes,  } from "viem";
// import { FormattedProofInputs } from "./types.js";

// export function noir_verify_sig({pubKeyXHex,pubKeyYHex,rawSigHex,hash}:{pubKeyXHex:Hex,pubKeyYHex:Hex,rawSigHex:Hex,hash:Hex}) {
//     return `
// #[test]
// fn verify_sig() {
//     let signature_data:SignatureData = SignatureData {
//         public_key_x: [${[...toBytes(pubKeyXHex)].toString()}],
//         public_key_y: [${[...toBytes(pubKeyYHex)].toString()}],
//         signature: [${[...toBytes(rawSigHex)].toString()}]
//     };
//     let message_hash:[u8;32] = ${hash}.to_be_bytes();

//     let valid_signature: bool = std::ecdsa_secp256k1::verify_signature(
//         signature_data.public_key_x,
//         signature_data.public_key_y,
//         signature_data.signature,
//         message_hash,
//     );

//     assert(valid_signature, "invalid signature");
// }
// `
// }

// export function noir_test_main_self_relay(proofInput: FormattedProofInputs, testName="main_self_relay_test") {
//     return `
// #[test]
// fn ${testName}() {   
//     let amount: Field = ${BigInt(proofInput.amount).toString()};
//     let recipient_address: Field = ${proofInput.recipient_address};
//     let fee_data: FeeData = FeeData {
//         relayer_address: ${proofInput.fee_data.relayer_address},
//         priority_fee: ${BigInt(proofInput.fee_data.priority_fee).toString()},
//         conversion_rate: ${BigInt(proofInput.fee_data.conversion_rate).toString()},
//         max_fee: ${BigInt(proofInput.fee_data.max_fee).toString()},
//         fee_token: ${proofInput.fee_data.fee_token},
//     };
//     let account_note_hash: Field = ${proofInput.account_note_hash};       
//     let account_note_nullifier: Field = ${proofInput.account_note_nullifier}; 
//     let root: Field = ${proofInput.root};                    
//     let signature_data: SignatureData = SignatureData {
//         public_key_x: [${proofInput.signature_data.public_key_x.toString()}],
//         public_key_y: [${proofInput.signature_data.public_key_y.toString()}],
//         signature: [${proofInput.signature_data.signature.toString()}],
//     }; 
//     let shared_secret: Field = ${proofInput.shared_secret};                  
//     let total_received: Field = ${BigInt(proofInput.total_received).toString()};              
//     let prev_total_spent: Field = ${BigInt(proofInput.prev_total_spent).toString()};            
//     let viewing_key: Field = ${proofInput.viewing_key};                 
//     let prev_account_nonce: Field = ${BigInt(proofInput.prev_account_nonce).toString()};               
//     let prev_account_note_merkle: MerkleData = MerkleData {
//         depth: ${BigInt(proofInput.prev_account_note_merkle.depth).toString()},
//         indices: [${proofInput.prev_account_note_merkle.indices.map((v) => Number(v)).toString()}],
//         siblings: [${proofInput.prev_account_note_merkle.siblings.map((v) => v).toString()}]
//     };
//     let total_received_merkle: MerkleData = MerkleData {
//         depth: ${BigInt(proofInput.total_received_merkle.depth).toString()},
//         indices: [${proofInput.total_received_merkle.indices.map((v) => Number(v)).toString()}],
//         siblings: [${proofInput.total_received_merkle.siblings.map((v) => v).toString()}]
//     };
//     main(
//         amount,
//         recipient_address,
//         fee_data,
//         account_note_hash, 
//         account_note_nullifier,
//         root,
//         signature_data,
//         shared_secret,        
//         total_received,  
//         prev_total_spent,
//         viewing_key,   
//         prev_account_nonce,
//         prev_account_note_merkle,
//         total_received_merkle,
//     );
// }
//  `   
// }