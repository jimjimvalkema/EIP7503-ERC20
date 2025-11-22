use privateTransfer::{spendFromBurnAddresses, BurnAddressPublicProofData, BurnAddressPrivateProofData, SignatureData};

global AMOUNT_BURN_ADDRESSES: u32 = 1; 
fn main(
    //----- public inputs
    root: pub Field,
    amount: pub Field,
    signature_hash: pub [u8;32],
    burn_address_public_proof_data: pub [BurnAddressPublicProofData; AMOUNT_BURN_ADDRESSES],
    // --- private inputs ---
    signature_data: SignatureData,      
    shared_secret: Field,
    viewing_key: Field,
    burn_address_private_proof_data: [BurnAddressPrivateProofData; AMOUNT_BURN_ADDRESSES],
) {
    let valid_signature: bool = std::ecdsa_secp256k1::verify_signature(
        signature_data.public_key_x,
        signature_data.public_key_y,
        signature_data.signature,
        signature_hash,
    );
    assert(valid_signature, "invalid signature");

    // slice off the first byte so it fits in the field
    let mut small_pub_key_x: [u8; 32] = signature_data.public_key_x;
    small_pub_key_x[0] = 0;
    let pub_key_x_field: Field = Field::from_be_bytes(small_pub_key_x);

    spendFromBurnAddresses(
        root,
        amount,
        burn_address_public_proof_data,
        //private
        pub_key_x_field,      
        shared_secret,
        viewing_key,
        burn_address_private_proof_data,
    )
}