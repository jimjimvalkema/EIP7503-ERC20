use privateTransferLib::{spendFromBurnAddresses, BurnDataPublic, BurnDataPrivate, SignatureData};

global BURN_ADDRESSES_LEN: u32 = 2; 
fn main(
    //----- public inputs
    root: pub Field,
    chain_id: Field, // pub key word is removed since we don't use cross-chain functionality
    amount: pub Field,
    signature_hash: pub [u8;32],
    burn_data_public: pub [BurnDataPublic; BURN_ADDRESSES_LEN],
    // --- private inputs ---
    signature_data: SignatureData,      
    burn_data_private: [BurnDataPrivate; BURN_ADDRESSES_LEN],
    amount_burn_addresses:u32 // always one but still a input to be consistent with other circuits
) {

    // one signature for all burns. Cheaper, better UX, but you cant spent with different private keys
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
        chain_id,
        amount,
        burn_data_public,
        //private
        burn_data_private,
        pub_key_x_field,      
        amount_burn_addresses
    )
}